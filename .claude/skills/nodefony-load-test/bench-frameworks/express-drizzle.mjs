// Express 5 + Drizzle (node-postgres) — parité ORM avec le banc Nodefony
// `NF_BENCH_ORM` (route read-lean : SELECT 20 factures WHERE fk_user_author=7,
// réponse {n}). MÊMES conditions : version drizzle-orm/pg du node_modules
// RACINE (résolution ascendante — rien à installer ici), MÊME schéma pg-core
// (dist du module test, corpus gitignoré), MÊME décor PG docker seedé, mêmes
// 186 routes (bench en #31), pool pg défaut (max 10) comme DrizzleOrm.
//
// Deux modes (DRIZZLE_MODE) :
//   naive    — le code drizzle idiomatique : build de la requête PAR REQUÊTE
//              (l'équivalent du DrizzleRepository AVANT le lot prepared)
//   prepared — .prepare() mémoïsé une fois, .execute() par requête
//              (l'équivalent du lot prepared mémoïsé livré)
//
// Usage : DRIZZLE_MODE=naive PORT=5164 node express-drizzle.mjs
import express from "express";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { dummyRoutes } from "./payload.mjs";

const MODE = process.env.DRIZZLE_MODE ?? "naive";
if (!["naive", "prepared"].includes(MODE)) {
  throw new Error(`DRIZZLE_MODE inconnu: ${MODE}`);
}
const url =
  process.env.NF_DATABASE_URL ??
  "postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony";

// Schéma du banc : le MÊME objet pg-core que le serveur Nodefony (dist du
// module test — son import "drizzle-orm/pg-core" remonte au node_modules
// racine, donc même instance drizzle que ci-dessus).
const { llx_facture } = await import(
  new URL(
    "../../../../src/modules/test/dist/nodefony/entity/dolibarr/bench-pg.js",
    import.meta.url,
  ).href
);

const pool = new Pool({ connectionString: url });
const db = drizzle(pool);

const BENCH_READ_USER = 7;
const naiveRead = () =>
  db
    .select()
    .from(llx_facture)
    .where(eq(llx_facture.fk_user_author, BENCH_READ_USER))
    .limit(20);
// prepared : requête NOMMÉE compilée 1× (plan caché par connexion côté PG),
// comme le cache par forme du DrizzleRepository.
const preparedRead = naiveRead().prepare("bench_read_lean");

const app = express();
app.set("env", "production");
app.disable("x-powered-by");

const BENCH_PATH = "/nodefony/test/bench-orm/read-lean";
const { before, after } = dummyRoutes();
for (const p of before)
  app.get(p, (req, res) => res.json({ id: req.params.id }));
app.get(BENCH_PATH, async (_req, res) => {
  const rows =
    MODE === "naive" ? await naiveRead() : await preparedRead.execute();
  res.json({ n: rows.length });
});
for (const p of after)
  app.get(p, (req, res) => res.json({ id: req.params.id }));

const port = Number(process.env.PORT ?? 5164);
app.listen(port, "127.0.0.1", () =>
  console.log(`express-drizzle (${MODE}) :${port}`),
);
process.on("SIGINT", () => process.exit(0));
