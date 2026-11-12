// Coût du chemin d'ERREUR d'une requête, poste par poste, en ns par opération.
//
// Le profil comparé 404/200 attribue plusieurs µs à la construction de
// l'erreur et à la ligne d'audit — mais il sur-attribue les petites fonctions
// (jusqu'à ×15). Ce banc rend le coût RÉEL de chaque poste, isolé :
//   1. `new HttpError(…)` tel que le noyau le lève (pile capturée) ;
//   2. `HttpError.withoutStack(…)`, le verdict sans pile du noyau et du routeur ;
//   3. la lecture de `stack` (formatage paresseux de V8) ;
//   4. `JsonAuditLogger.renderHttp` sur un 404 (la ligne écrite par 4xx).
// La pile est capturée à une PROFONDEUR réaliste (le noyau lève ~25 cadres
// sous la boucle d'événements) : capturée à plat, elle coûterait moins.
//
// Usage (racine du dépôt, dist http construit) :
//   node --expose-gc .claude/skills/nodefony-load-test/scripts/micro/micro-error-path.mjs [iter=200000] [runs=7]
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const dist = (p) =>
  pathToFileURL(path.join(ROOT, "src/packages/@nodefony/http/dist", p)).href;
const { default: HttpError } = await import(
  dist("nodefony/src/errors/httpError.js")
);
const { default: JsonAuditLogger } = await import(
  dist("nodefony/service/audit-logger.js")
);

const ITER = Number(process.argv[2] ?? 200_000);
const RUNS = Number(process.argv[3] ?? 7);
const DEPTH = 30;

const response = {
  statusCode: 404,
  statusMessage: "Not Found",
  body: null,
  getStatusMessage: () => "Not Found",
};
const request = {
  headers: {
    host: "127.0.0.1:5151",
    "user-agent": "scanner/1.0",
    accept: "*/*",
  },
};
const context = {
  response,
  request,
  url: "/wp-admin/setup-config.php",
  resolver: null,
  requestId: "12f5dbc1-32aa-42f0-a48d-5317e79a8200",
  userIdentifier: null,
  scheme: "http",
  method: "GET",
  remoteAddress: "127.0.0.1",
  phases: [],
  error: null,
  stopClock: () => 0.42,
  getHost: () => "127.0.0.1:5151",
  getUserAgent: () => "scanner/1.0",
};

/** Exécute `fn` sous `depth` cadres de pile — la profondeur d'un vrai `throw`. */
const deep = (depth, fn) => (depth === 0 ? fn() : deep(depth - 1, fn));

let sink = null;
const cases = {
  "new HttpError (pile capturée)": () =>
    deep(DEPTH, () => new HttpError("Not Found", 404, context)),
  "HttpError.withoutStack (verdict)": () =>
    deep(DEPTH, () => HttpError.withoutStack("Not Found", 404, context)),
  "new HttpError + lecture de stack": () =>
    deep(DEPTH, () => {
      const e = new HttpError("Not Found", 404, context);
      sink = e.stack;
      return e;
    }),
};
const audit = new JsonAuditLogger({ includeStack: false });
const auditError = new HttpError("Not Found", 404, context);
cases["JsonAuditLogger.renderHttp (404)"] = () =>
  audit.renderHttp(context, auditError);

const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
console.log(
  `Node ${process.version} · ${ITER} itér. × ${RUNS} passes · profondeur ${DEPTH}`,
);
for (const [name, fn] of Object.entries(cases)) {
  for (let i = 0; i < ITER / 10; i++) sink = fn(); // chauffe (JIT)
  const ns = [];
  for (let r = 0; r < RUNS; r++) {
    globalThis.gc?.();
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < ITER; i++) sink = fn();
    ns.push(Number(process.hrtime.bigint() - t0) / ITER);
  }
  const m = median(ns);
  const spread = ((Math.max(...ns) - Math.min(...ns)) / m) * 100;
  console.log(
    `${m.toFixed(0).padStart(7)} ns/op  (dispersion ${spread.toFixed(1)} %)  ${name}`,
  );
}
if (sink === undefined) console.log("");
