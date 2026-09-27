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
// ⚖️ L'ORM et le pilote viennent de la PASSERELLE, jamais d'un spécificateur nu
// écrit ici : ce dossier a son propre `node_modules`, un `import "drizzle-orm"`
// y atteindrait une SECONDE instance de drizzle, distincte de celle dont vient
// le schéma. Le pourquoi et le coût mesuré : `../repo-drizzle-sqlite.mjs`.
import {
  drizzle,
  eq,
  Pool,
  Column,
  getTableColumns,
} from "../repo-drizzle-pg.mjs";
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

// ⚖️ GARDE D'ÉQUITÉ — UNE SEULE instance de drizzle dans ce process.
// Elle contrôle une IDENTITÉ, pas une version : les colonnes du schéma sont-elles
// des instances de la classe `Column` que ce camp exécute ? Si non, `is()` retombe
// sur la remontée de prototypes à chaque colonne de chaque ligne, et ce camp mesure
// une résolution de modules au lieu d'un ORM (#402).
{
  const colonnes = Object.values(getTableColumns(llx_facture));
  const temoin = colonnes[0];
  if (!(temoin instanceof Column)) {
    console.error(
      "❌ ÉQUITÉ ROMPUE — deux instances de drizzle-orm dans ce process.\n" +
        `   Les colonnes du schéma (${temoin?.constructor?.name}) ne sont pas des\n` +
        "   instances de la classe Column que ce camp exécute.\n" +
        "   → importer l'ORM depuis `../repo-drizzle-pg.mjs`, jamais par un\n" +
        "     spécificateur nu écrit dans `bench-frameworks/`.",
    );
    process.exit(2);
  }
}

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
