/**
 * Micro-banc — ce que coûte le profileur de développement à CHAQUE requête :
 * `Profiler.collect()`, appelé au démontage HTTP (et par trame WS profilée).
 *
 * Le profileur n'existe pas en production (`Http.onKernelBoot` ne l'enregistre
 * que hors `production`) : ce banc dit si, en DÉVELOPPEMENT, il pèse dans le
 * budget d'une requête — la question qui décide s'il mérite un audit.
 *
 * Trois variantes, sur des contextes réalistes (identifiant UNIQUE par appel :
 * l'anneau se remplit puis évince, comme sur un serveur qui tourne) :
 *
 * - `nu`       : requête simple — 6 phases fermées, ni requête SQL ni zone ;
 * - `complet`  : 6 phases, 3 requêtes SQL, zone de pare-feu et décision ;
 * - `ouverte`  : comme `nu`, la phase `action` encore OUVERTE (client parti,
 *                #646) — paie un `performance.now()` de plus.
 *
 * Validité : après la mesure, l'anneau `app` doit être plein (500) et le
 * dernier identifiant lisible par `get()` — sinon exit 1, aucun chiffre publié.
 *
 * Il ment dans l'autre sens d'un serveur (tas froid, site monomorphe) :
 * l'arbitre reste une mesure in-situ.
 *
 * Usage : node .claude/skills/nodefony-load-test/scripts/micro/micro-profiler-collect.mjs
 *   (prérequis : `dist` de @nodefony/http bâti)
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const DIST = path.resolve(
  "src/packages/@nodefony/http/dist/nodefony/src/profiler/Profiler.js",
);
const { Profiler } = await import(pathToFileURL(DIST).href);

const WARM = 5e4;
const N = 5e5;
const RUNS = 7;

const PHASES = ["resolve", "parse", "initialize", "action", "render", "send"];
const resolver = {
  route: { name: "app-index" },
  controller: { name: "AppController" },
  actionName: "index",
};
const security = {
  name: "app",
  security: true,
  mode: "first",
  authenticators: ["session", "anonymous"],
};
const securityTrace = {
  authenticator: "session",
  outcome: "authenticated",
  reason: null,
  user: "admin",
  roles: ["ROLE_USER"],
};

let seq = 0;
/** Un contexte neuf par appel, comme `createHttpContext`. */
function makeContext(full, open) {
  const t = 1000 + seq;
  const phases = PHASES.map((name, i) => ({
    name,
    startMs: t + i * 0.05,
    durationMs: open && name === "action" ? undefined : 0.04,
  }));
  return {
    requestId: `r-${seq++}`,
    type: "http",
    scheme: "https",
    method: "GET",
    url: "https://127.0.0.1:5152/app/index",
    remoteAddress: "127.0.0.1",
    traceparent: null,
    error: null,
    response: { statusCode: 200 },
    phases,
    resolver,
    profilerQueries: full
      ? [
          {
            sql: "select 1",
            startMs: t,
            durationMs: 0.05,
            rows: 1,
            connector: "drizzle",
          },
          {
            sql: "select 2",
            startMs: t,
            durationMs: 0.05,
            rows: 1,
            connector: "drizzle",
          },
          {
            sql: "select 3",
            startMs: t,
            durationMs: 0.05,
            rows: 1,
            connector: "drizzle",
          },
        ]
      : null,
    security: full ? security : null,
    securityTrace: full ? securityTrace : null,
  };
}

/** ns par appel : le contexte est construit HORS chrono (lot pré-alloué). */
function measure(profiler, full, open) {
  const batch = 1e4;
  for (let i = 0; i < WARM; i++) profiler.collect(makeContext(full, open));
  let total = 0n;
  for (let done = 0; done < N; done += batch) {
    const ctxs = Array.from({ length: batch }, () => makeContext(full, open));
    const t0 = process.hrtime.bigint();
    for (const c of ctxs) profiler.collect(c);
    total += process.hrtime.bigint() - t0;
  }
  return Number(total) / N;
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const variants = {
  nu: [false, false],
  complet: [true, false],
  ouverte: [false, true],
};
const out = {};
for (const [name, [full, open]] of Object.entries(variants)) {
  const runs = [];
  for (let r = 0; r < RUNS; r++) {
    const profiler = new Profiler();
    runs.push(measure(profiler, full, open));
    const last = `r-${seq - 1}`;
    if (profiler.size < 500 || profiler.get(last) == null) {
      console.error(
        `invalide (${name}) : anneau ${profiler.size}, ${last} illisible`,
      );
      process.exit(1);
    }
  }
  out[name] = {
    medianNs: Math.round(median(runs)),
    minNs: Math.round(Math.min(...runs)),
    maxNs: Math.round(Math.max(...runs)),
  };
}
console.log(JSON.stringify({ node: process.version, N, RUNS, out }, null, 2));
