// Micro-bench isolé — un SELECT à opérateur de comparaison, reconstruit à
// chaque appel ou préparé une fois (#510).
//
// Forme mesurée : celle de `DrizzleTokenStore.isJtiDenied`, lue à CHAQUE
// requête authentifiée par jeton — `jti = ? AND expiresAt > ? LIMIT 1`.
// Avant #510, le cache de formes de `DrizzleRepository` refusait tout
// opérateur : la requête était reconstruite par Drizzle puis recompilée par
// SQLite à chaque appel. Ce banc mesure le MÉCANISME (Drizzle nu), pas le
// repository : il dit ce que la préparation retire, pas ce que coûte le reste.
//
// Usage (racine du dépôt) :
//   node .claude/skills/nodefony-load-test/scripts/micro/micro-select-ops.mjs
import { drizzle, eq, sql, Database } from "../../repo-drizzle-sqlite.mjs";
import { and, gt } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

const denied = sqliteTable("denied_jti", {
  jti: text("jti").primaryKey(),
  expiresAt: integer("expiresAt").notNull(),
});

const sqlite = new Database(":memory:");
sqlite.exec(
  'CREATE TABLE denied_jti (jti TEXT PRIMARY KEY, "expiresAt" INTEGER NOT NULL)',
);
const db = drizzle(sqlite);
const ROWS = Number(process.env.MICRO_ROWS ?? 10_000);
const insert = sqlite.prepare("INSERT INTO denied_jti VALUES (?, ?)");
const future = Date.now() + 3_600_000;
sqlite.transaction(() => {
  for (let i = 0; i < ROWS; i++) insert.run(`jti-${i}`, future);
})();

let n = 0;
const nextJti = () => `jti-${n++ % (ROWS * 2)}`; // moitié présents, moitié absents

// Ancien chemin : construit par Drizzle et recompilé à chaque appel.
const rebuilt = () =>
  db
    .select()
    .from(denied)
    .where(and(eq(denied.jti, nextJti()), gt(denied.expiresAt, Date.now())))
    .limit(1)
    .all();

// Nouveau chemin : préparé une fois, valeurs passées en placeholders.
const prepared = db
  .select()
  .from(denied)
  .where(
    and(
      eq(denied.jti, sql.placeholder("jti")),
      gt(denied.expiresAt, sql.placeholder("now")),
    ),
  )
  .limit(sql.placeholder("lim"))
  .prepare();
const reused = () => prepared.all({ jti: nextJti(), now: Date.now(), lim: 1 });

// Garde : les deux chemins rendent la même chose.
n = 0;
const a = rebuilt();
n = 0;
const b = reused();
if (JSON.stringify(a) !== JSON.stringify(b)) {
  console.error("❌ les deux chemins divergent :", a, b);
  process.exit(2);
}

const N = Number(process.env.MICRO_N ?? 20_000);
const ROUNDS = Number(process.env.MICRO_ROUNDS ?? 9);
const time = (fn) => {
  const t = process.hrtime.bigint();
  for (let i = 0; i < N; i++) fn();
  return Number(process.hrtime.bigint() - t) / N / 1000;
};
const cases = { rebuilt, reused };
for (const fn of Object.values(cases)) time(fn);
const runs = { rebuilt: [], reused: [] };
for (let r = 0; r < ROUNDS; r++)
  for (const [k, fn] of Object.entries(cases)) runs[k].push(time(fn));
const med = (x) => [...x].sort((p, q) => p - q)[x.length >> 1];
const spread = (x) => (Math.max(...x) - Math.min(...x)) / med(x);
console.log(`N=${N} × ${ROUNDS} tours alternés, ${ROWS} lignes — µs/appel`);
for (const [k, x] of Object.entries(runs))
  console.log(
    `  ${k.padEnd(8)} ${med(x).toFixed(2).padStart(7)}  ±${(spread(x) * 100).toFixed(1)} %`,
  );
console.log(
  `  gain : ${(med(runs.rebuilt) - med(runs.reused)).toFixed(2)} µs/appel`,
);
