/**
 * Micro-banc — ce que le service gRPC (#695, lot 3) coûte à une requête qui
 * n'est PAS gRPC.
 *
 * Le lot 3 a posé deux points sur le chemin de toute requête :
 * - `HttpKernel.serveHttpRequest` : la garde de l'attrape-tout —
 *   `hasGrpcRoutes() && resolve && POST && !route.grpc && grpcWireOf(…)` ;
 * - `Http2Response` : `headers["grpc-status"]` lu au `respond()` et au test de
 *   fin (deux lectures par réponse HTTP/2).
 *
 * A/B sur les fonctions RÉELLES du `dist` bâti de @nodefony/http
 * (`src/grpc/refusal.js`), importé DEUX fois : une instance où aucune route
 * gRPC n'est déclarée, une où `markGrpcRoute` l'a été (l'application de dev).
 * `A` = le cycle sans la garde, `B` = avec ; médiane de RUNS séries ALTERNÉES
 * (la dérive porte sur les deux).
 *
 * Validité : la garde doit rendre FAUX pour toute requête mesurée (aucune
 * n'est gRPC native) et VRAI pour un témoin `application/grpc` — sinon exit 1,
 * aucun chiffre publié.
 *
 * Il ment dans l'autre sens d'un serveur (site monomorphe, fonctions
 * inlinées) : un écart sous ~1 ns n'a pas de sens ici. Il dit l'ordre de
 * grandeur, à rapporter au coût d'une requête (~61 µs de framework sur une
 * route triviale, SKILL.md).
 *
 * Usage : node .claude/skills/nodefony-load-test/scripts/micro/micro-grpc-request-cost-ab.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WARM = 2e5;
const N = 5e6;
const RUNS = 9;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const distFile = path.join(
  root,
  "src/packages/@nodefony/http/dist/nodefony/src/grpc/refusal.js",
);
if (!fs.existsSync(distFile)) {
  console.error(`${distFile} absent — bâtir @nodefony/http d'abord`);
  process.exit(1);
}
const url = pathToFileURL(distFile).href;
// Deux instances du module : l'indicateur « route gRPC déclarée » est un
// état de module, qu'on ne remet pas à faux une fois posé.
const plain = await import(`${url}?app=sans-grpc`);
const grpc = await import(`${url}?app=avec-grpc`);
grpc.markGrpcRoute({ grpc: true });
if (plain.hasGrpcRoutes() || !grpc.hasGrpcRoutes()) {
  console.error(
    "décor faux : l'indicateur de route gRPC ne suit pas l'instance",
  );
  process.exit(1);
}

/** Une route applicative résolue, non gRPC. */
const resolver = { resolve: true, route: { grpc: undefined } };
const REQUESTS = {
  GET: { method: "GET", headers: { accept: "application/json" } },
  "POST JSON": {
    method: "POST",
    headers: { "content-type": "application/json", accept: "*/*" },
  },
};
/** Les en-têtes d'une réponse HTTP/2 ordinaire (relevés sur le serveur). */
const responseHeaders = {
  "x-status-message": "OK",
  server: "nodefony",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-type": "application/json; charset=utf-8",
  "x-request-id": "37eea369-ff89-4e87-ad58-8de5cac06914",
  traceparent: "00-76df6e45ea9f782a6a403cd97476e18d-7f679be4a0ef6e6f-01",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
};

/**
 * La garde telle qu'écrite dans `HttpKernel.serveHttpRequest`, fermée sur les
 * liaisons d'UNE instance — comme les imports du noyau. (Mesuré : une garde
 * partagée entre les deux instances rend les mêmes chiffres, l'écart n'est
 * pas un artefact de polymorphisme.)
 */
const makeGuard =
  ({ hasGrpcRoutes, grpcWireOf, GRPC_WIRE_GRPC }) =>
  (method, headers) =>
    hasGrpcRoutes() &&
    resolver.resolve &&
    method === "POST" &&
    resolver.route?.grpc !== true &&
    grpcWireOf(headers) === GRPC_WIRE_GRPC;
const guards = new Map([
  [plain, makeGuard(plain)],
  [grpc, makeGuard(grpc)],
]);

const grpcGuard = guards.get(grpc);
if (
  grpcGuard("POST", REQUESTS["POST JSON"].headers) ||
  !grpcGuard("POST", { "content-type": "application/grpc" })
) {
  console.error("décor faux : la garde ne rend pas ce que rend le noyau");
  process.exit(1);
}

let sink = 0;
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const spread = (xs) => (Math.max(...xs) - Math.min(...xs)) / med(xs);

/**
 * Mesure `body` (une itération = une requête) contre le même cycle privé du
 * seul point mesuré ; rend les ns par requête.
 */
function ab(label, base, withCost) {
  const time = (fn) => {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) fn(i);
    return Number(process.hrtime.bigint() - t0) / N;
  };
  for (let i = 0; i < WARM; i++) {
    base(i);
    withCost(i);
  }
  const runs = { A: [], B: [] };
  for (let i = 0; i < RUNS; i++) {
    if (i % 2 === 0) {
      runs.A.push(time(base));
      runs.B.push(time(withCost));
    } else {
      runs.B.push(time(withCost));
      runs.A.push(time(base));
    }
  }
  const mA = med(runs.A);
  const mB = med(runs.B);
  return {
    cas: label,
    nsSans: +mA.toFixed(2),
    nsAvec: +mB.toFixed(2),
    ecartNs: +(mB - mA).toFixed(2),
    dispersion: {
      A: +spread(runs.A).toFixed(3),
      B: +spread(runs.B).toFixed(3),
    },
  };
}

// Le cycle de base : ce que le noyau lit de toute façon à cet endroit.
const touch = (method, headers) => {
  if (method.length > 0 && headers !== null) sink++;
};

const results = [];
for (const [app, mod] of [
  ["app sans route gRPC", plain],
  ["app avec routes gRPC", grpc],
]) {
  for (const [kind, req] of Object.entries(REQUESTS)) {
    const guard = makeGuard(mod);
    results.push(
      ab(
        `${app} · ${kind}`,
        () => touch(req.method, req.headers),
        () => {
          touch(req.method, req.headers);
          if (guard(req.method, req.headers)) sink += 7;
        },
      ),
    );
  }
}
results.push(
  ab(
    "réponse HTTP/2 · deux lectures de grpc-status",
    () => {
      if (responseHeaders.server !== undefined) sink++;
    },
    () => {
      if (responseHeaders.server !== undefined) sink++;
      if (responseHeaders["grpc-status"] !== undefined) sink += 3;
      if (responseHeaders["grpc-status"] !== undefined) sink += 5;
    },
  ),
);

console.log(
  JSON.stringify(
    { node: process.version, runs: RUNS, iterations: N, results, sink },
    null,
    2,
  ),
);
