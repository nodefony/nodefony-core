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
import helmet from "helmet";
import cors from "cors";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
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
app.set("env", "production");
app.disable("x-powered-by");

/* Même travail par requête qu'express-fair.mjs — voir ses commentaires. */
const als = new AsyncLocalStorage();
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
function parseTraceparent(h) {
  if (!h) return null;
  const m = TRACEPARENT.exec(h);
  return m ? { traceId: m[1], parentId: m[2], flags: m[3] } : null;
}
const AREAS = [
  { name: "studio", re: /^\/nodefony\/studio/, secure: true },
  { name: "admin-api", re: /^\/nodefony\/[a-z-]+\/api\//, secure: true },
  { name: "test-secure", re: /^\/nodefony\/test\/secure/, secure: true },
  { name: "documentation", re: /^\/nodefony\/documentation/, secure: false },
  { name: "public", re: /^\//, secure: false },
];
function matchArea(path) {
  for (const a of AREAS) if (a.re.test(path)) return a;
  return null;
}
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
function csrfOk(req) {
  if (SAFE.has(req.method)) return true;
  const site = req.headers["sec-fetch-site"];
  if (site) return site === "same-origin" || site === "none";
  const origin = req.headers.origin;
  return !origin || origin === `http://127.0.0.1:${port}`;
}

app.use(helmet());
app.use(cors());
app.use((req, res, next) => {
  const store = {
    requestId: randomUUID(),
    traceparent: parseTraceparent(req.headers.traceparent),
    user: null,
  };
  als.run(store, () => {
    res.setHeader("X-Request-Id", store.requestId);
    const area = matchArea(req.path);
    if (area?.secure && !store.user) return res.status(401).end();
    if (!csrfOk(req)) return res.status(403).end();
    next();
  });
});

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

const port = Number(process.env.PORT ?? 5166);
app.listen(port, "127.0.0.1", () =>
  console.log(`express-fair-drizzle (${MODE}) :${port}`),
);
process.on("SIGINT", () => process.exit(0));
