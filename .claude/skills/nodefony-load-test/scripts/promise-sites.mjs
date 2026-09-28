// Carte des sites de création des Promises d'UNE requête (#505) — préchargé par
// `node --import` dans le serveur mesuré. GET :5199/start ouvre la fenêtre,
// GET :5199/stop la ferme et rend les piles (JSON). Compteur jumeau, pour la
// garde : `src/packages/@nodefony/http/nodefony/tests/helpers/promiseCounter.mjs`.
// ⚠️ Sous crochet, V8 crée une Promise jetable par `await` : le compte vaut
// « Promises + suspensions » — ne se compare qu'à un camp mesuré pareil
// (nest-fair : 20, Fastify nu : 2, Express : 0 ; Nodefony avant L2 : 53-57).
import { promiseHooks } from "node:v8";
import http from "node:http";

Error.stackTraceLimit = 25;
let capturing = false;
let stacks = [];
promiseHooks.onInit(() => {
  if (capturing) stacks.push(new Error().stack);
});
const clean = (line) =>
  line
    .trim()
    .replace(/^at /, "")
    .replace(/\(?file:\/\/\/Users\/cci\/repository\/nodefony-core\//, "")
    .replace(/\)$/, "");
const port = Number(process.env.NF_PROMISE_COUNTER_PORT ?? 5199);
http
  .createServer((req, res) => {
    if (req.url === "/start") {
      stacks = [];
      capturing = true;
      res.end("ok");
      return;
    }
    capturing = false;
    const out = stacks.map((s) =>
      s
        .split("\n")
        .slice(2) // "Error" + le cadre du hook
        .filter((l) => !l.includes("promise-sites.mjs"))
        .slice(0, 6)
        .map(clean),
    );
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(out));
  })
  .listen(port, "127.0.0.1")
  .unref();
