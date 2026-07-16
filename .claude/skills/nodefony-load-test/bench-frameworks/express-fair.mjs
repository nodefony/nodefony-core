/**
 * Express 5 — « ÉQUITABLE » : même travail par requête que le pipeline Nodefony.
 *
 * POURQUOI CE FICHIER. `express.mjs` ne fait que router + `res.json()`. Le pipeline
 * Nodefony, lui, exécute sur CHAQUE requête : un scope AsyncLocalStorage (requestId),
 * la corrélation traceparent (W3C), CORS, les en-têtes de sécurité, le contrôle CSRF
 * (Fetch Metadata) et le matching des zones du firewall. Comparer les deux revient à
 * comparer une berline équipée à un kart : le delta de RPS ne mesure pas « le coût du
 * framework », il mesure « le coût des fonctionnalités qu'Express ne rend pas ».
 *
 * Ce fichier rétablit l'équité : Express + les middlewares qui font le MÊME travail.
 * L'écart restant face à `express.mjs` = le PRIX de ces fonctionnalités, quel que soit
 * le framework. L'écart restant face à Nodefony = le vrai surcoût d'implémentation.
 *
 * Ce qui n'est PAS ajouté (car Nodefony ne le fait pas non plus sur cette route) :
 *   - session : elle est PARESSEUSE et cette route n'en demande pas (vérifié : 0 Set-Cookie,
 *     0 octet écrit en base sur 200 requêtes) ;
 *   - audit nominal : coupé au boot par le levier T1 quand le sink de log est `null`
 *     (NF_LOG_DRIVER=null), ce que le banc positionne.
 *
 * Usage : NODE_ENV=production PORT=5164 node express-fair.mjs
 */
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { state, BENCH_PATH, dummyRoutes } from "./payload.mjs";

const app = express();
app.set("env", "production");
app.disable("x-powered-by");

/* 1. Scope de requête (AsyncLocalStorage) + requestId — équivalent RequestContext. */
const als = new AsyncLocalStorage();

/* 2. Corrélation distribuée W3C — équivalent resolveTraceparent. */
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
function parseTraceparent(h) {
  if (!h) return null;
  const m = TRACEPARENT.exec(h);
  return m ? { traceId: m[1], parentId: m[2], flags: m[3] } : null;
}

/* 3. Zones du firewall — patterns triés par spécificité, matchés à chaque requête. */
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

/* 4. CSRF — Fetch Metadata en défense primaire, repli Origin (équivalent Nodefony). */
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
function csrfOk(req) {
  if (SAFE.has(req.method)) return true;
  const site = req.headers["sec-fetch-site"];
  if (site) return site === "same-origin" || site === "none";
  const origin = req.headers.origin;
  return !origin || origin === `http://127.0.0.1:${port}`;
}

app.use(helmet()); // en-têtes de sécurité (CSP, HSTS, nosniff, frameguard…)
app.use(cors()); // négociation CORS

app.use((req, res, next) => {
  const store = {
    requestId: randomUUID(),
    traceparent: parseTraceparent(req.headers.traceparent),
    user: null,
  };
  als.run(store, () => {
    res.setHeader("X-Request-Id", store.requestId);
    const area = matchArea(req.path); // firewall : matching de zone
    if (area?.secure && !store.user) return res.status(401).end(); // fail-closed
    if (!csrfOk(req)) return res.status(403).end();
    next();
  });
});

const { before, after } = dummyRoutes();
for (const p of before)
  app.get(p, (req, res) => res.json({ id: req.params.id }));
app.get(BENCH_PATH, (_req, res) => res.json(state));
for (const p of after)
  app.get(p, (req, res) => res.json({ id: req.params.id }));

const port = Number(process.env.PORT ?? 5164);
app.listen(port, "127.0.0.1", () => console.log(`express-fair :${port}`));
process.on("SIGINT", () => process.exit(0));
