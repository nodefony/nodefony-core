// ─────────────────────────────────────────────────────────────────────────────
// 🔴 CE CAMP EST FAUTIF PAR CONSTRUCTION. Il ne mesure PAS Express.
//
// Il reproduit à l'identique l'état d'AVANT la correction d'équité : imports nus
// de `drizzle-orm` (donc une SECONDE instance, distincte de celle dont vient le
// schéma) et garde d'identité retirée, sans quoi il refuserait de servir.
//
// Sa seule raison d'exister est de rendre le BIAIS mesurable plutôt que raconté.
// Opposé à `express-fair-drizzle.mjs` en paires alternées, il a rendu :
//
//     une instance   1 802,9 req/s   (inter-séries 0,1 %)
//     deux instances   983,2 req/s   (inter-séries 1,5 %)
//     effet          +83,4 %, séparation nette
//
// → le camp témoin du banc PostgreSQL tournait à 54,5 % de son vrai débit, ce
//   qui RETIRE le rapport ×1,07 publié (cf docs/performance/analyses.md).
//
// Rejouer la mesure :
//   NF_BENCH_BIAIS=1 BENCH_PATH=/nodefony/test/bench-orm/read-lean \
//     BENCH_EXPECT='"n":' BENCH_CONN=25 BENCH_DUR=30 BENCH_WARMUP=40 \
//     bash bench-pairs.sh express-fair-drizzle express-fair-drizzle-2copies 5166
//
// ⚠️ Il REFUSE de démarrer sans `NF_BENCH_BIAIS=1`. Un camp sans garde posé à
// côté des camps du banc finirait par entrer dans une comparaison de frameworks,
// et rendrait un « Express » à 983 req/s que personne ne saurait plus expliquer.
// ─────────────────────────────────────────────────────────────────────────────
if (process.env.NF_BENCH_BIAIS !== "1") {
  console.error(
    "❌ Camp FAUTIF par construction — il charge deux instances de drizzle-orm\n" +
      "   et ne mesure pas Express. Il ne sert qu'à mesurer le biais lui-même.\n" +
      "   → poser NF_BENCH_BIAIS=1 si c'est bien ce qu'on veut mesurer.",
  );
  process.exit(2);
}

// Express 5 « ÉQUITABLE » + Drizzle — le duel à armes égales avec le banc ORM
// Nodefony (`NF_BENCH_ORM` read-lean) : les middlewares d'express-fair.mjs (le
// travail que Nodefony rend par requête : ALS+requestId, traceparent, CORS,
// helmet, CSRF Fetch-Metadata, matching de zones) PLUS la même requête drizzle
// que express-drizzle.mjs (même schéma pg-core du dist module test, même
// version drizzle par résolution node_modules racine, pool pg défaut 10).
// La route bench-orm est PUBLIQUE ici comme côté Nodefony (aucune zone secure
// ne matche /nodefony/test/bench-orm) — le firewall est traversé, pas déclenché.
//
// Modes DRIZZLE_MODE=naive|prepared (cf express-drizzle.mjs).
// Usage : DRIZZLE_MODE=prepared PORT=5166 node express-fair-drizzle.mjs
import express from "express";
import { installExpressFair } from "./fair-express.mjs";
// 🔴 Imports NUS — c'est toute la faute que ce camp reproduit : écrits dans ce
// dossier, ils atteignent son `node_modules` et donc une SECONDE instance de
// drizzle, distincte de celle dont vient le schéma. Le camp SAIN passe par
// `../repo-drizzle-pg.mjs` ; ne pas « corriger » celui-ci, il n'aurait plus d'objet.
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { dummyRoutes } from "./payload.mjs";

const MODE = process.env.DRIZZLE_MODE ?? "prepared";
if (!["naive", "prepared"].includes(MODE)) {
  throw new Error(`DRIZZLE_MODE inconnu: ${MODE}`);
}
const url =
  process.env.NF_DATABASE_URL ??
  "postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony";

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
const preparedRead = naiveRead().prepare("bench_read_lean_fair");

const app = express();

const port = Number(process.env.PORT ?? 5166);
installExpressFair(app, port);

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

app.listen(port, "127.0.0.1", () =>
  console.log(`express-fair-drizzle (${MODE}) :${port}`),
);
process.on("SIGINT", () => process.exit(0));
