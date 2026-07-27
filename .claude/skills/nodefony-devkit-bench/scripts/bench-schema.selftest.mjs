#!/usr/bin/env node
/**
 * Éprouve le BANC lui-même — avant qu'il ne juge quoi que ce soit.
 *
 * Un juge non éprouvé rend des verdicts faux avec l'aplomb des verdicts justes.
 * Ce fichier existe parce que les deux lecteurs de `bench-schema.mjs` ont
 * commencé leur vie avec des défauts SILENCIEUX : celui de Ghost perdait toute
 * définition de colonne étalée sur plusieurs lignes (`visibility`, cinq lignes,
 * simplement absente), et le compte de colonnes qui en sortait — 130 — avait
 * exactement l'allure d'un compte juste.
 *
 * La méthode : compter la MÊME chose par un chemin INDÉPENDANT du lecteur, et
 * exiger l'égalité. Un lecteur qui se vérifie avec sa propre logique ne vérifie
 * rien.
 *
 *   node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.selftest.mjs
 *   node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.selftest.mjs --prove
 *
 * `--prove` casse volontairement chaque lecteur pour montrer que le contrôle
 * MORD : un test qu'on n'a jamais vu échouer ne garde rien.
 *
 * Sortie : exit 0 si tous les contrôles passent, 1 sinon.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  pgMismatch,
  readKnex,
  readPostgres,
  readPrisma,
  SCHEMAS,
  subset,
} from "./bench-schema.mjs";

function findRepoRoot(from) {
  let dir = from;
  for (let up = 0; up < 8; up += 1) {
    if (existsSync(path.join(dir, "src/nodefony/bin/nodefony"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("racine du dépôt introuvable");
}

const REPO = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(REPO, "tmp", "devkit-schema", ".sources");

let failures = 0;
const check = (name, actual, expected, detail = "") => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "✅" : "❌"} ${name.padEnd(46)} ${String(actual).padStart(4)} / ${expected}` +
      (ok || !detail ? "" : `\n       ${detail}`),
  );
  return ok;
};

/**
 * Isole le corps d'une table dans une source, par comptage d'accolades.
 *
 * Indépendant des lecteurs : il ne partage avec eux ni regex, ni découpage.
 *
 * @param src - texte de la source.
 * @param open - la ligne qui ouvre la table (`model X {` ou `posts: {`).
 * @returns le texte du corps, accolades extérieures exclues.
 */
function sliceBlock(src, open) {
  // Ancré en DÉBUT DE LIGNE, indentation comprise : un `indexOf` nu sur
  // « posts: { » tombait sur « show_latest_posts: { », et le contrôle rendait
  // « 1 colonne attendue » avec le même aplomb qu'un compte juste.
  const anchor = new RegExp(
    `^\\s*${open.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`,
    "mu",
  );
  const found = anchor.exec(src);
  const start = found ? found.index : -1;
  if (start === -1) return null;
  let depth = 0;
  let i = src.indexOf("{", start);
  const from = i + 1;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(from, i);
    }
  }
  return null;
}

/**
 * Compte INDÉPENDAMMENT les colonnes d'une table Prisma.
 *
 * Une colonne est une ligne `nom Type…` dont le type est scalaire ou une
 * énumération déclarée. Tout le reste est une navigation. On recompte les
 * énumérations ici, sans réutiliser celles du lecteur.
 */
function countPrismaColumns(src, model) {
  const body = sliceBlock(src, `model ${model} {`);
  if (body === null) return null;
  const enums = new Set(
    [...src.matchAll(/^enum\s+(\w+)\s*\{/gmu)].map((m) => m[1]),
  );
  const scalars = new Set([
    "String",
    "Int",
    "BigInt",
    "Float",
    "Decimal",
    "Boolean",
    "DateTime",
    "Json",
    "Bytes",
  ]);
  let n = 0;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
    const m = /^(\w+)\s+(\w+)(\??)(\[\])?/u.exec(line);
    if (!m) continue;
    const [, , type, , list] = m;
    if (scalars.has(type) && !list) n += 1;
    else if (enums.has(type)) n += 1; // y compris un TABLEAU d'énumération
  }
  return n;
}

/**
 * Compte INDÉPENDAMMENT les colonnes d'une table knex.
 *
 * Chaque colonne porte exactement un `type: '…'` ; rien d'autre dans le fichier
 * n'en porte au premier niveau (`fieldtype` est un autre mot).
 */
function countKnexColumns(src, table) {
  const body = sliceBlock(src, `${table}: {`);
  if (body === null) return null;
  return (body.match(/\btype:\s*'/gu) ?? []).length;
}

/** Compte INDÉPENDAMMENT les index d'une table Prisma. */
function countPrismaIndexes(src, model) {
  const body = sliceBlock(src, `model ${model} {`);
  if (body === null) return null;
  return (body.match(/^\s*@@(index|unique)\(/gmu) ?? []).length;
}

// ─────────────────────────────────────────────────────────────────────────────

function source(key) {
  const def = SCHEMAS[key];
  const file = path.join(
    CACHE,
    `${key}.${def.format === "knex" ? "js" : "prisma"}`,
  );
  if (!existsSync(file)) {
    console.log(
      `\n⚠️  source ${key} absente du cache — lancer d'abord :\n` +
        `   node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.mjs --schema ${key} --dump-only\n`,
    );
    return null;
  }
  return { def, src: readFileSync(file, "utf8") };
}

/** Le lecteur voit-il EXACTEMENT ce que le comptage indépendant voit ? */
function verify(key, { breakReader = false } = {}) {
  const s = source(key);
  if (!s) return;
  const { def, src } = s;
  console.log(`\n━━ ${key} (${def.format})`);

  let parsed = def.format === "prisma" ? readPrisma(src) : readKnex(src);

  if (breakReader) {
    // Preuve NÉGATIVE : on ampute le lecteur d'une colonne par table. Si les
    // contrôles restent verts, ils ne contrôlent rien.
    parsed = {
      ...parsed,
      tables: parsed.tables.map((t) => ({ ...t, columns: t.columns.slice(1) })),
    };
  }

  // Le sous-ensemble RENOMME les tables ; le comptage indépendant travaille sur
  // les noms d'ORIGINE. On garde donc la correspondance avant renommage.
  const wanted = new Set(def.tables);
  const before = parsed.tables.filter((t) => wanted.has(t.model));
  const originalNames = before.map((t) => t.model);
  const { tables: after } = subset(parsed, def);

  for (let i = 0; i < after.length; i += 1) {
    const origin = originalNames[i];
    const read = after[i];
    const expectedCols =
      def.format === "prisma"
        ? countPrismaColumns(src, origin)
        : countKnexColumns(src, origin);
    if (expectedCols === null) {
      console.log(`  ❌ ${origin} — introuvable dans la source`);
      failures += 1;
      continue;
    }
    check(`${origin} — colonnes`, read.columns.length, expectedCols);

    if (def.format === "prisma") {
      const expectedIdx = countPrismaIndexes(src, origin);
      check(`${origin} — index`, read.indexes.length, expectedIdx);
    }
  }
}

/**
 * Contrôles de FORME que le comptage ne couvre pas — chacun ancré sur un défaut
 * réellement rencontré, pas sur une inquiétude théorique.
 */
function verifyShape() {
  console.log(`\n━━ forme`);

  const ghost = source("ghost");
  if (ghost) {
    const { tables } = readKnex(ghost.src);
    const nl = tables.find((t) => t.model === "newsletters");
    // Le défaut d'origine : une définition étalée sur plusieurs lignes était
    // purement et simplement absente, sans un mot.
    const hasMultiline = nl?.columns.some((c) => c.prop === "visibility");
    console.log(
      `  ${hasMultiline ? "✅" : "❌"} newsletters.visibility (défini sur 5 lignes) est lu`,
    );
    if (!hasMultiline) failures += 1;

    // Les attributs que la grammaire ne sait pas dire doivent être RELEVÉS.
    const flagged = tables
      .flatMap((t) => t.columns)
      .filter((c) => c.note?.includes("INEXPRIMABLE")).length;
    console.log(
      `  ${flagged > 0 ? "✅" : "❌"} attributs inexprimables relevés : ${flagged}`,
    );
    if (flagged === 0) failures += 1;
  }

  const calcom = source("calcom");
  if (calcom) {
    const { tables, enums } = readPrisma(calcom.src);
    const membership = tables.find((t) => t.model === "Membership");
    const role = membership?.columns.find((c) => c.prop === "role");
    const ok = role?.logical === "enum" && role.note?.includes("PARTAGÉE");
    console.log(
      `  ${ok ? "✅" : "❌"} Membership.role reconnu comme énumération partagée` +
        (role ? ` (${role.sourceType})` : " — colonne absente"),
    );
    if (!ok) failures += 1;

    const webhook = tables.find((t) => t.model === "Webhook");
    const trig = webhook?.columns.find((c) => c.prop === "eventTriggers");
    const okArr = trig?.note?.includes("tableau");
    console.log(
      `  ${okArr ? "✅" : "❌"} Webhook.eventTriggers reconnu comme TABLEAU d'énumération`,
    );
    if (!okArr) failures += 1;

    console.log(`  ℹ️  ${enums.size} énumérations déclarées dans la source`);
  }

  const umami = source("umami");
  if (umami) {
    const { tables } = readPrisma(umami.src);
    const user = tables.find((t) => t.model === "User");
    // Le trou principal d'umami : la colonne SQL diffère de la propriété.
    const id = user?.columns.find((c) => c.prop === "id");
    const ok = id?.column === "user_id";
    console.log(
      `  ${ok ? "✅" : "❌"} User.id porte bien la colonne « user_id » (lu : ${id?.column})`,
    );
    if (!ok) failures += 1;

    const session = tables.find((t) => t.model === "Session");
    // Les index se déclarent en PROPRIÉTÉS et doivent être traduits en COLONNES.
    const composite = session?.indexes.find((i) => i.props?.length === 3);
    const okIdx = composite?.columns?.includes("website_id");
    console.log(
      `  ${okIdx ? "✅" : "❌"} index composite traduit en noms de COLONNE` +
        (composite ? ` (${composite.columns.join(", ")})` : ""),
    );
    if (!okIdx) failures += 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Le JUGE PostgreSQL — le chemin qui a rendu dix-huit faux positifs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verdicts de {@link pgMismatch} sur des cas NOMMÉS — sans base.
 *
 * Chaque ligne est ancrée sur une exigence réelle d'un des trois schémas, et
 * trois d'entre elles sur des défauts vécus : une clé `String @db.Uuid` prise
 * pour une chaîne (dix-huit écarts annoncés, tous faux, qui noyaient le seul
 * vrai), un `char(2)` d'umami confondu avec un `varchar`, une longueur déclarée
 * mais perdue à la création.
 *
 * `attendu` vaut `null` pour « aucun écart », sinon un fragment que le message
 * doit contenir — on vérifie que le juge DIT ce qui ne va pas, pas seulement
 * qu'il refuse.
 */
const PG_CASES = [
  ["uuid conservé", { logical: "uuid" }, { type: "uuid" }, null],
  ["uuid dégradé en text", { logical: "uuid" }, { type: "text" }, "dégradé"],
  [
    "char(2) accepté comme chaîne bornée",
    { logical: "string", length: 2 },
    { type: "bpchar", length: 2 },
    null,
  ],
  [
    "longueur trop courte signalée",
    { logical: "string", length: 500 },
    { type: "varchar", length: 255 },
    "longueur",
  ],
  [
    "longueur perdue signalée",
    { logical: "string", length: 500 },
    { type: "text", length: null },
    "perdue",
  ],
  [
    "aucune longueur exigée → aucun écart",
    { logical: "string" },
    { type: "varchar", length: 255 },
    null,
  ],
  [
    "précision décimale respectée",
    { logical: "decimal", precision: 19 },
    { type: "numeric", precision: 19 },
    null,
  ],
  [
    "précision décimale fausse signalée",
    { logical: "decimal", precision: 19 },
    { type: "numeric", precision: 10 },
    "précision",
  ],
  ["horodatage", { logical: "date" }, { type: "timestamptz" }, null],
  [
    "date rendue en chaîne signalée",
    { logical: "date" },
    { type: "varchar" },
    "horodatage",
  ],
  ["json en jsonb", { logical: "json" }, { type: "jsonb" }, null],
  ["booléen", { logical: "bool" }, { type: "bool" }, null],
  ["entier", { logical: "int" }, { type: "int4" }, null],
  [
    "binaire — inexprimable, contournement accepté",
    { logical: null },
    { type: "bytea" },
    null,
  ],
];

/** DDL témoin — écrit à la MAIN, sans une ligne du banc. C'est la référence. */
const JUDGE_TABLE = "zz_judge_selftest";
const JUDGE_DDL = `
CREATE TABLE ${JUDGE_TABLE} (
  id uuid PRIMARY KEY,
  code char(2) NOT NULL,
  label varchar(120),
  amount numeric(12,4) NOT NULL,
  payload jsonb,
  raw bytea,
  created_at timestamptz NOT NULL
);
CREATE INDEX ${JUDGE_TABLE}_pair ON ${JUDGE_TABLE} (code, label);
CREATE UNIQUE INDEX ${JUDGE_TABLE}_label ON ${JUDGE_TABLE} (label);`;

/**
 * Ampute le lecteur PostgreSQL — chaque mutilation REJOUE un défaut vécu.
 *
 * Sans elle, on ne saurait pas si les contrôles ci-dessous mordent : ils ont
 * tous été écrits APRÈS coup, face à un lecteur devenu correct.
 */
function mutilate(map) {
  const t = map.get(JUDGE_TABLE);
  if (!t) return map;
  return new Map([
    ...map,
    [
      JUDGE_TABLE,
      {
        // 1. une colonne disparaît · 2. les longueurs sont perdues ·
        // 3. les colonnes d'index redeviennent la chaîne brute que le pilote
        //    rend quand le cast `::text[]` manque.
        columns: t.columns.slice(1).map((c) => ({ ...c, length: null })),
        indexes: t.indexes.map((i) => ({
          ...i,
          columns: `{${(i.columns ?? []).join(",")}}`,
        })),
      },
    ],
  ]);
}

/**
 * Éprouve le lecteur PostgreSQL contre une table dont on CONNAÎT le DDL.
 *
 * Le juge du banc lit la base plutôt que les sources, ce qui est juste — mais
 * rien ne gardait ce lecteur-là : il a cassé au premier contact, puis rendu
 * dix-huit écarts imaginaires. On lui donne donc une table qu'on a écrite
 * nous-mêmes, et on exige qu'il la restitue exactement.
 *
 * @returns `false` si PostgreSQL est injoignable (contrôle NON exécuté).
 */
async function verifyPostgresJudge({ prove }) {
  console.log(`\n━━ juge PostgreSQL — verdicts sur cas nommés`);
  // Amputer le juge, c'est le rendre complaisant : s'il ne trouve plus jamais
  // d'écart, les cas qui en attendent un doivent tomber.
  const judge = prove ? () => null : pgMismatch;
  for (const [name, expected, got, want] of PG_CASES) {
    const verdict = judge(expected, got);
    const ok =
      want === null ? verdict === null : (verdict ?? "").includes(want);
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? "✅" : "❌"} ${name.padEnd(46)} ${verdict ?? "aucun écart"}`,
    );
  }

  const url =
    process.env.NF_PG_URL ??
    "postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony";
  let Client;
  try {
    ({ Client } = await import("pg"));
  } catch {
    console.log(`\n  ⏭️  pilote « pg » absent — lecteur NON exercé`);
    return false;
  }
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch (e) {
    console.log(
      `\n  ⏭️  PostgreSQL injoignable (${url}) — lecteur NON exercé\n` +
        `      ${String(e.message).split("\n")[0]}\n` +
        `      docker compose up -d postgres, ou NF_PG_URL=…`,
    );
    return false;
  }

  console.log(`\n━━ juge PostgreSQL — lecture d'une table au DDL connu`);
  try {
    await client.query(`DROP TABLE IF EXISTS ${JUDGE_TABLE} CASCADE`);
    await client.query(JUDGE_DDL);
    let map = await readPostgres(url);
    if (prove) map = mutilate(map);
    const t = map.get(JUDGE_TABLE);
    if (!t) {
      console.log(`  ❌ table ${JUDGE_TABLE} absente de la lecture`);
      failures += 1;
      return true;
    }
    const col = (n) => t.columns.find((c) => c.name === n);
    check(`colonnes lues`, t.columns.length, 7);
    check(`code — type`, col("code")?.type, "bpchar");
    check(`code — longueur`, col("code")?.length, 2);
    check(`label — longueur`, col("label")?.length, 120);
    check(`label — nullable`, col("label")?.nullable, true);
    check(`amount — précision`, col("amount")?.precision, 12);
    check(`amount — échelle`, col("amount")?.scale, 4);
    check(`amount — nullable`, col("amount")?.nullable, false);
    check(`payload — type`, col("payload")?.type, "jsonb");
    check(`raw — type`, col("raw")?.type, "bytea");
    check(`created_at — type`, col("created_at")?.type, "timestamptz");

    check(`index lus (dont la clé primaire)`, t.indexes.length, 3);
    const pair = t.indexes.find((i) => i.name === `${JUDGE_TABLE}_pair`);
    // Le contrôle décisif : sans le cast `::text[]`, le pilote rend « {code,
    // label} », une CHAÎNE — sur laquelle le juge appelait `.join()`.
    check(
      `index composite rendu en TABLEAU`,
      Array.isArray(pair?.columns),
      true,
      `obtenu : ${JSON.stringify(pair?.columns)}`,
    );
    check(
      `index composite — colonnes dans l'ordre`,
      Array.isArray(pair?.columns)
        ? pair.columns.join(",")
        : String(pair?.columns),
      "code,label",
    );
    const uniq = t.indexes.find((i) => i.name === `${JUDGE_TABLE}_label`);
    check(`index unique reconnu`, uniq?.unique, true);
    check(
      `index non unique reconnu`,
      t.indexes.find((i) => i.name === `${JUDGE_TABLE}_pair`)?.unique,
      false,
    );
    return true;
  } finally {
    await client.query(`DROP TABLE IF EXISTS ${JUDGE_TABLE} CASCADE`);
    await client.end();
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const prove = process.argv.includes("--prove");

console.log(
  prove
    ? "PREUVE NÉGATIVE — les lecteurs sont amputés d'une colonne par table.\n" +
        "Tout ce qui reste VERT ci-dessous ne contrôle rien."
    : "AUTO-CONTRÔLE DU BANC — chaque compte est refait par un chemin indépendant.",
);

for (const key of Object.keys(SCHEMAS)) verify(key, { breakReader: prove });
if (!prove) verifyShape();
const judgeExercised = await verifyPostgresJudge({ prove });

console.log(
  `\n${failures === 0 ? "✅ tous les contrôles passent" : `❌ ${failures} contrôle(s) en échec`}`,
);
// Un contrôle SAUTÉ compte vert si on ne le dit pas — c'est le piège maison
// n°1, et c'est le lecteur PostgreSQL qui l'a payé : il a vécu une session
// entière sans qu'aucun garde ne l'exerce.
if (!judgeExercised) {
  console.log(
    `   ⚠️  le lecteur PostgreSQL n'a PAS été exercé (base injoignable).\n` +
      `      Ce vert ne couvre donc PAS le chemin qui juge les vrais runs.`,
  );
}
if (prove) {
  console.log(
    failures > 0
      ? "   → le contrôle MORD : un lecteur amputé est détecté."
      : "   → ⚠️ AUCUN échec alors que les lecteurs sont cassés : le contrôle est INUTILE.",
  );
  process.exit(failures > 0 ? 0 : 1);
}
// Sortie 2 = « rien n'est faux, mais tout n'a pas été vu ». Un banc dont le juge
// n'a pas été exercé ne doit pas rendre le même code qu'un banc entièrement
// contrôlé, sinon la CI le lit comme un succès complet.
if (
  failures === 0 &&
  !judgeExercised &&
  !process.argv.includes("--allow-no-pg")
)
  process.exit(2);
process.exit(failures === 0 ? 0 : 1);
