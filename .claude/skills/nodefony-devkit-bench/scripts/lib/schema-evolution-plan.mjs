/**
 * Plan d'ÉVOLUTION d'un schéma réel, d'une version à la suivante — ce que le
 * banc doit déclarer à `orm:generate`, lu dans ce que l'auteur du schéma a
 * VOULU.
 *
 * L'oracle est le script de passage que l'auteur publie (`<A>-<B>.sql`) : un
 * `CHANGE COLUMN a b` y est un RENOMMAGE, un `DROP COLUMN` une suppression
 * décidée. Les deux formes d'installation (descriptions neutres de `A` et de
 * `B`) disent le reste : ce qui disparaît de la forme d'installation sans que
 * le script le supprime est ABANDONNÉ — l'amont le laisse en base, un schéma
 * déclaratif le supprime. Le banc le dit, il ne le cache pas.
 *
 * Hors périmètre, et nommé : les instructions de DONNÉES du script (`UPDATE`,
 * `INSERT`, `DELETE`) — elles relèvent de la logique de l'application.
 *
 * Module PUR : aucune entrée-sortie (autotest :
 * `schema-evolution-plan.selftest.mjs`).
 *
 * @module
 */

const IDENT = "`?([A-Za-z_][\\w$]*)`?";

/**
 * Découpe un script MySQL en instructions, sans ses commentaires.
 *
 * Un `--` ouvre un commentaire jusqu'à la fin de la ligne (les variantes
 * conditionnelles `-- VMYSQL4.3 …` en font partie : elles visent d'anciens
 * moteurs, jamais celui qu'on éprouve).
 *
 * @param {string} sql
 * @returns {string[]}
 */
export function splitScript(sql) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/u, ""))
    .join("\n")
    .split(";")
    .map((s) => s.replace(/\s+/gu, " ").trim())
    .filter((s) => s.length > 0);
}

/**
 * Lit les gestes de SCHÉMA d'un script de passage.
 *
 * Les noms de table sont rendus FINALS : un renommage de colonne écrit sur
 * l'ancien nom d'une table renommée plus loin vise la même table.
 *
 * @param {string} sql - contenu du script `<A>-<B>.sql`.
 * @returns {{
 *   tableRenames: { from: string, to: string }[],
 *   columnRenames: { table: string, from: string, to: string }[],
 *   drops: { table: string, column?: string }[],
 *   dataStatements: number,
 * }}
 */
export function parseOracleMigration(sql) {
  const tableRenames = [];
  const rawColumns = [];
  const rawDrops = [];
  let dataStatements = 0;
  const re = (body) => new RegExp(`^${body}`, "iu");
  const renameTo = re(`ALTER TABLE ${IDENT} RENAME TO ${IDENT}$`);
  const renameTable = re(`RENAME TABLE ${IDENT} TO ${IDENT}$`);
  const change = re(
    `ALTER TABLE ${IDENT} CHANGE (?:COLUMN )?${IDENT} ${IDENT} `,
  );
  const dropColumn = re(`ALTER TABLE ${IDENT} DROP COLUMN ${IDENT}$`);
  const dropTable = re(`DROP TABLE (?:IF EXISTS )?${IDENT}$`);
  for (const statement of splitScript(sql)) {
    let m;
    if ((m = renameTo.exec(statement) ?? renameTable.exec(statement))) {
      tableRenames.push({ from: m[1], to: m[2] });
    } else if ((m = change.exec(statement))) {
      // `CHANGE COLUMN a a <type>` ne change que le type.
      if (m[2].toLowerCase() !== m[3].toLowerCase()) {
        rawColumns.push({ table: m[1], from: m[2], to: m[3] });
      }
    } else if ((m = dropColumn.exec(statement))) {
      rawDrops.push({ table: m[1], column: m[2] });
    } else if ((m = dropTable.exec(statement))) {
      rawDrops.push({ table: m[1] });
    } else if (/^(UPDATE|INSERT|DELETE|REPLACE)\b/iu.test(statement)) {
      dataStatements += 1;
    }
  }
  const final = (table) => {
    let name = table;
    for (const r of tableRenames) if (r.from === name) name = r.to;
    return name;
  };
  return {
    tableRenames,
    columnRenames: rawColumns.map(({ table, from, to }) => ({
      table: final(table),
      from,
      to,
    })),
    drops: rawDrops.map(({ table, column }) =>
      column === undefined
        ? { table: final(table) }
        : { table: final(table), column },
    ),
    dataStatements,
  };
}

/**
 * La version de départ AMPUTÉE de ses suppressions — l'état intermédiaire que
 * la première des deux générations atteint.
 *
 * @param {readonly { name: string, columns: Record<string, { kind: string, target?: string }>, indexes?: { on: string[] }[] }[]} specs
 * @param {ReadonlySet<string>} drops - `table` ou `table.colonne`, noms de départ.
 * @throws Quand une table conservée référence une table supprimée.
 */
export function withoutDrops(specs, drops) {
  const out = [];
  for (const spec of specs) {
    if (drops.has(spec.name)) continue;
    const gone = (column) => drops.has(`${spec.name}.${column}`);
    const columns = Object.fromEntries(
      Object.entries(spec.columns).filter(([key]) => !gone(key)),
    );
    for (const [key, c] of Object.entries(columns)) {
      if (c.kind === "ref" && c.target !== undefined && drops.has(c.target)) {
        throw new Error(
          `${spec.name}.${key} référence ${c.target}, que l'évolution supprime`,
        );
      }
    }
    out.push({
      ...spec,
      columns,
      ...(spec.indexes
        ? { indexes: spec.indexes.filter((i) => !i.on.some(gone)) }
        : {}),
    });
  }
  return out;
}

/**
 * Confronte l'oracle aux deux formes d'installation et rend ce qu'il faut
 * déclarer.
 *
 * - un renommage de l'oracle n'est retenu que s'il s'APPLIQUE (l'ancien nom
 *   existe au départ, le nouveau à l'arrivée) ; sinon il est nommé, avec sa
 *   raison ;
 * - une suppression est VOULUE (l'oracle la fait) ou ABANDONNÉE (la forme
 *   d'installation la perd, le script non) — les deux sont déclarées, et
 *   distinguées dans le rapport.
 *
 * @param {{ from: readonly object[], to: readonly object[], oracle: ReturnType<typeof parseOracleMigration> }} input
 * @returns {{
 *   renames: string[],
 *   drops: string[],
 *   declaredDrops: string[],
 *   abandoned: string[],
 *   between: object[],
 *   notApplied: { what: string, why: string }[],
 * }}
 */
export function planEvolution({ from, to, oracle }) {
  const a = new Map(from.map((s) => [s.name, s]));
  const b = new Map(to.map((s) => [s.name, s]));
  const notApplied = [];
  const tableTo = new Map();
  for (const r of oracle.tableRenames) {
    const what = `table ${r.from} → ${r.to}`;
    if (!a.has(r.from))
      notApplied.push({ what, why: `${r.from} absente au départ` });
    else if (!b.has(r.to))
      notApplied.push({ what, why: `${r.to} absente à l'arrivée` });
    else if (b.has(r.from))
      notApplied.push({ what, why: `${r.from} existe encore à l'arrivée` });
    else tableTo.set(r.from, r.to);
  }
  const tableFrom = new Map([...tableTo].map(([f, t]) => [t, f]));
  const columnTo = new Map();
  for (const r of oracle.columnRenames) {
    const what = `colonne ${r.table}.${r.from} → ${r.to}`;
    const start = a.get(tableFrom.get(r.table) ?? r.table);
    const end = b.get(r.table);
    if (!start || !end)
      notApplied.push({ what, why: "table absente d'un côté" });
    else if (!(r.from in start.columns))
      notApplied.push({ what, why: `${r.from} absente au départ` });
    else if (!(r.to in end.columns))
      notApplied.push({ what, why: `${r.to} absente à l'arrivée` });
    else if (r.to in start.columns)
      notApplied.push({ what, why: `${r.to} existe déjà au départ` });
    else columnTo.set(`${start.name}.${r.from}`, r.to);
  }
  const declared = new Set(
    oracle.drops.map((d) => {
      const table = tableFrom.get(d.table) ?? d.table;
      return d.column === undefined ? table : `${table}.${d.column}`;
    }),
  );
  const drops = [];
  for (const spec of from) {
    const end = b.get(tableTo.get(spec.name) ?? spec.name);
    if (!end) {
      drops.push(spec.name);
      continue;
    }
    for (const key of Object.keys(spec.columns)) {
      if (!((columnTo.get(`${spec.name}.${key}`) ?? key) in end.columns)) {
        drops.push(`${spec.name}.${key}`);
      }
    }
  }
  return {
    renames: [
      ...[...tableTo].map(([f, t]) => `${f}=${t}`),
      ...[...columnTo].map(([key, t]) => {
        const [table, column] = key.split(".");
        return `${tableTo.get(table) ?? table}.${column}=${t}`;
      }),
    ],
    drops,
    declaredDrops: drops.filter((d) => declared.has(d)),
    abandoned: drops.filter((d) => !declared.has(d)),
    between: withoutDrops(from, new Set(drops)),
    notApplied,
  };
}

/**
 * Un texte (une instruction, une sortie de commande) NOMME-t-il cette
 * suppression ? Identifiants entiers : `llx_user` ne mord pas sur
 * `llx_user_rights`, `status` ne mord pas sur `fk_status`.
 *
 * @param {string} text
 * @param {string} drop - `table` ou `table.colonne`.
 * @returns {boolean}
 */
export function namesDrop(text, drop) {
  const has = (name) =>
    new RegExp(
      `(?<![\\w$])${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![\\w$])`,
      "u",
    ).test(text);
  const [table, column] = drop.split(".");
  return has(table) && (column === undefined || has(column));
}
