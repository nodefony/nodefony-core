// Micro-bench isolé — coût de la forme d'UPDATE de `DrizzleRepository.updateOne`
// face à celle du camp témoin du banc ORM (#510).
//
// Hypothèse testée : `updateOne` enveloppe le critère dans `#pickOne`
// (`pk in (select pk from (select pk … where <critère> limit 1) as picked)`) pour
// garantir « au plus une ligne ». Le témoin écrit `where rowid = ?`. Ni l'un ni
// l'autre n'est préparé : SQLite recompile la requête à CHAQUE appel, donc un SQL
// plus long et une sous-requête se paient sur chaque requête HTTP.
//
// Mesure les deux formes sur la MÊME connexion, en tours ALTERNÉS (la dérive
// thermique porte sur les deux), médiane de N tours. Écrit dans une COPIE de la
// base : jamais la base de l'application.
//
// Usage (racine du dépôt, module test bâti, base seedée par NF_BENCH_ORM=1) :
//   cp var/databases/nodefony-drizzle.db /tmp/micro-update.db
//   NF_BENCH_SQLITE_DB=/tmp/micro-update.db \
//     node .claude/skills/nodefony-load-test/scripts/micro/micro-update-pick.mjs
import { drizzle, eq, sql, Database } from "../../repo-drizzle-sqlite.mjs";

const DB_FILE = process.env.NF_BENCH_SQLITE_DB;
if (!DB_FILE) {
  console.error(
    "❌ NF_BENCH_SQLITE_DB manquant (copie seedée de la base du banc).",
  );
  process.exit(2);
}
const { llx_facture } = await import(
  new URL(
    "../../../../../src/modules/test/dist/nodefony/entity/dolibarr/llx_facture.js",
    import.meta.url,
  ).href
);

const sqlite = new Database(DB_FILE);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite);

const target = db
  .select({ rowid: llx_facture.rowid })
  .from(llx_facture)
  .where(eq(llx_facture.fk_user_author, 7))
  .limit(1)
  .get();
if (!target?.rowid) {
  console.error("❌ aucune ligne pour fk_user_author = 7 — base non seedée.");
  process.exit(2);
}
const id = target.rowid;
let seq = 0;
const set = () => ({
  total_ht: 100 + (++seq % 100),
  total_ttc: 120 + (seq % 100),
});

// Forme du TÉMOIN (`orm-sqlite-common.mjs`).
const witness = () =>
  db
    .update(llx_facture)
    .set(set())
    .where(eq(llx_facture.rowid, id))
    .returning()
    .get();

// Forme de `updateOne` : `#pickOne(#where(criteria))`, PK simple.
const pk = llx_facture.rowid;
const picked = () => {
  const where = eq(pk, id);
  const inner = sql`select ${pk} from ${llx_facture} where ${where} limit 1`;
  const pick = sql`${pk} in (select ${sql.identifier(pk.name)} from (${inner}) as picked)`;
  return db.update(llx_facture).set(set()).where(pick).returning().all()[0];
};

// Coût de la seule compilation SQLite de chaque texte (sans exécution).
const sqlOf = (q) => q.toSQL().sql;
const witnessSql = sqlOf(
  db.update(llx_facture).set(set()).where(eq(pk, id)).returning(),
);
const pickedSql = sqlOf(
  db
    .update(llx_facture)
    .set(set())
    .where(
      sql`${pk} in (select ${sql.identifier(pk.name)} from (${sql`select ${pk} from ${llx_facture} where ${eq(pk, id)} limit 1`}) as picked)`,
    )
    .returning(),
);
const prepWitness = () => sqlite.prepare(witnessSql);
const prepPicked = () => sqlite.prepare(pickedSql);

const N = Number(process.env.MICRO_N ?? 5_000);
const ROUNDS = Number(process.env.MICRO_ROUNDS ?? 7);
const time = (fn) => {
  const t = process.hrtime.bigint();
  for (let i = 0; i < N; i++) fn();
  return Number(process.hrtime.bigint() - t) / N / 1000; // µs/appel
};
const cases = { witness, picked, prepWitness, prepPicked };
for (const fn of Object.values(cases)) time(fn); // chauffe JIT + cache de pages
const runs = Object.fromEntries(Object.keys(cases).map((k) => [k, []]));
for (let r = 0; r < ROUNDS; r++)
  for (const [k, fn] of Object.entries(cases)) runs[k].push(time(fn));
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const spread = (a) => (Math.max(...a) - Math.min(...a)) / med(a);

console.log(
  `N=${N} × ${ROUNDS} tours alternés — µs/appel (médiane, dispersion)`,
);
for (const [k, a] of Object.entries(runs))
  console.log(
    `  ${k.padEnd(12)} ${med(a).toFixed(2).padStart(8)}  ±${(spread(a) * 100).toFixed(1)} %`,
  );
console.log(
  `  écart UPDATE complet : ${(med(runs.picked) - med(runs.witness)).toFixed(2)} µs`,
);
console.log(
  `  écart compilation    : ${(med(runs.prepPicked) - med(runs.prepWitness)).toFixed(2)} µs`,
);
console.log(
  `\nSQL témoin : ${witnessSql.length} car.\nSQL pickOne : ${pickedSql.length} car.`,
);
