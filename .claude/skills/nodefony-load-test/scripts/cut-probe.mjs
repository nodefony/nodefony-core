// ─────────────────────────────────────────────────────────────────────────────
// Bissection par COURT-CIRCUIT du pipeline HTTP — préchargée dans le serveur
// (`NODE_OPTIONS=--import=…/cut-probe.mjs`), jamais dans le produit.
//
// `NF_BENCH_CUT=<étage>` remplace UNE méthode de `HttpKernel` (ou de
// `HttpContext`) par une réponse immédiate : même corps que la route de banc
// (`payload.mjs`), en-têtes posés JUSQU'À cet étage compris. Les étages sont
// CUMULATIFS — le coût d'un étage est la différence entre deux coupes voisines,
// mesurées dans la même manche (`wait-compare.sh` avec `NF_WAIT_CUTS`).
//
//   entry    `onHttpRequest`     — serveur Node, parse HTTP, socket, écriture
//   context  `serveHttpContext`  — + en-têtes transport, scope DI, HttpContext
//   trace    `RequestContext.run`— + traceparent, charge utile ALS (seuil)
//   als      `runHttpPipeline`   — + entrée dans la bulle ALS
//   pipeline `routeHttpRequest`  — + CORS, hook onRequestScope
//   route    `serveHttpRequest`  — + routeur, en-têtes de sécurité applicatifs
//   action   `HttpContext.handle`— + corps, gardes (domaine, CSRF, session,
//                                    zone), armement de la route
//   (absent) — requête complète : action, rendu JSON, `writeHead`
//
// Pourquoi une sonde plutôt qu'un interrupteur dans `http-kernel.ts` : un test
// par étage dans le chemin chaud, payé par chaque requête de chaque
// application, pour un banc qui tourne quelques fois par an.
//
// ⚠️ La coupe mesure ce que l'étage COÛTE, pas ce qu'il coûterait isolé : le
// JIT voit un autre programme (moins de code chaud, formes différentes). Les
// écarts d'un étage sous ~1 µs ne se lisent pas.
// ─────────────────────────────────────────────────────────────────────────────
import { state } from "../bench-frameworks/payload.mjs";

const cut = process.env.NF_BENCH_CUT;
if (cut) {
  const { HttpKernel, HttpContext } = await import("@nodefony/http");
  // Même corps que `AlsController.state` : sérialisé UNE fois — la coupe ne
  // doit pas mesurer un `JSON.stringify` que la route complète paie ailleurs.
  const body = Buffer.from(JSON.stringify(state));
  const respond = (response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(body);
  };
  const K = HttpKernel.prototype;
  const table = {
    entry: () => {
      K.onHttpRequest = function (_req, response) {
        respond(response);
        return undefined;
      };
    },
    context: () => {
      K.serveHttpContext = function (context, _scope, _req, response) {
        respond(response);
        return context;
      };
    },
    // Sous-coupes de `pipeline` : `trace` s'arrête AU SEUIL de la bulle ALS
    // (traceparent + charge utile construits, `RequestContext.run` jamais
    // entré), `als` juste DEDANS (avant CORS). pipeline − als = CORS + hook.
    trace: async () => {
      const { RequestContext } = await import("nodefony");
      const run = RequestContext.run;
      RequestContext.run = function (payload, fn) {
        // Seule la bulle de la requête est coupée : la micro-bulle de
        // journalisation (`Context`, sans `scope`) suit son cours.
        if (payload.context && "scope" in payload) {
          respond(payload.context.response.response);
          return payload.context;
        }
        return run.call(this, payload, fn);
      };
    },
    als: () => {
      K.runHttpPipeline = function (context, _req, response) {
        respond(response);
        return context;
      };
    },
    pipeline: () => {
      K.routeHttpRequest = function (context, _req, response) {
        respond(response);
        return context;
      };
    },
    route: () => {
      K.serveHttpRequest = function (context) {
        respond(context.response.response);
        return context;
      };
    },
    action: () => {
      HttpContext.prototype.handle = function () {
        respond(this.response.response);
        return this;
      };
    },
  };
  const patch = table[cut];
  if (!patch) {
    console.error(
      `cut-probe : étage « ${cut} » inconnu — ${Object.keys(table).join(", ")}`,
    );
    process.exit(2);
  }
  await patch();
  // Prouve que la coupe a EU LIEU dans le serveur mesuré (le script le relit).
  process.stderr.write(`cut-probe: ${cut}\n`);
}
