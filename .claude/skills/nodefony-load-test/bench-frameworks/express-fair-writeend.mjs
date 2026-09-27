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
 *   - session : elle est PARESSEUSE et cette route n'en demande pas (prouvé : 0 Set-Cookie
 *     sur 1 000 requêtes) ;
 *   - audit nominal : coupé au boot par le levier T1 quand le sink de log est `null`
 *     (NF_LOG_DRIVER=null), ce que le banc positionne (prouvé : 0 commit sqlite sur la
 *     fenêtre de 1 000 requêtes — `PRAGMA data_version` stable depuis une connexion
 *     readonly ouverte pendant toute la fenêtre, deltas 0 sur les tables framework) ;
 *   - profiler/timing : dev-only, non montés en production (data plane profiler → 404 ;
 *     `Context` pose le tableau `phases` figé partagé hors dev).
 * Preuve rejouable : `node .claude/skills/nodefony-load-test/bench-frameworks/express-fair-proof.mjs`
 * depuis la racine du repo (serveur mono prod au décor du banc lancé au préalable).
 *
 * Usage : NODE_ENV=production PORT=5164 node express-fair.mjs
 */
import express from "express";
import { installExpressFair } from "./fair-express.mjs";
import { state, BENCH_PATH, dummyRoutes } from "./payload.mjs";

const app = express();

const port = Number(process.env.PORT ?? 5164);
installExpressFair(app, port);

const { before, after } = dummyRoutes();
for (const p of before)
  app.get(p, (req, res) => res.json({ id: req.params.id }));
// VARIANTE writeend — isole la FORME D'ÉCRITURE (PR nodejs#65466).
// res.json est retiré des DEUX variantes : il pose un ETag, donc un hachage du
// corps, qui masquerait l'écart qu'on cherche.
app.get(BENCH_PATH, (_req, res) => {
  const buf = Buffer.from(JSON.stringify(state));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", buf.length);
  res.write(buf);
  res.end(); // forme Nodefony : end() VIDE après un write()
});
for (const p of after)
  app.get(p, (req, res) => res.json({ id: req.params.id }));

app.listen(port, "127.0.0.1", () => console.log(`express-fair :${port}`));
process.on("SIGINT", () => process.exit(0));
