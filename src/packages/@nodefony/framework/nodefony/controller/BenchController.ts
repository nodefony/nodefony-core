import type { Module } from "nodefony";
import type { ContextType } from "@nodefony/http";
import Router from "../service/router";
import Controller from "../src/Controller";

/**
 * Corps servi par la cible de banc — **gelé et partagé** : ce qu'on chronomètre
 * est le pipeline, pas la construction d'un objet. Le figer évite qu'une
 * allocation par requête ne s'ajoute au coût mesuré.
 *
 * Sa forme reprend celle du banc comparatif inter-frameworks
 * (`.claude/skills/nodefony-load-test/bench-frameworks/payload.mjs`), pour que
 * Nodefony, bare, Express et Fastify sérialisent **exactement le même corps**.
 * Comparer deux corps différents, c'est comparer deux travaux différents.
 */
const BENCH_PAYLOAD = Object.freeze({
  byContext: {},
  lastHookRequestId: null,
  hookUser: null,
  lateHookRequestId: null,
  wsHookRequestId: null,
  wsHookHandshakeId: null,
  wsHookFireCount: 0,
  hookCount: 0,
});

let mounted = false;

/**
 * Cible de mesure du **pipeline applicatif** — un controller ordinaire qui rend un
 * corps figé, et rien d'autre.
 *
 * **Pourquoi un controller et pas un endpoint du data plane admin** : une route
 * `/nodefony/<ns>/api/*` traverse, en plus du pipeline, la résolution de zone du
 * firewall, un authenticator et le broker d'administration. La mesurer et la
 * comparer à un handler Express nu revient à chronométrer deux choses
 * différentes — et à imputer au framework le coût de son étage d'administration.
 * Ce controller emprunte le chemin d'une route applicative normale : routing,
 * contexte, sérialisation, réponse.
 *
 * **Chemin hors aire admin** : `/nodefony/kernel/bench` (deux segments, sans
 * `/api/`) échappe au pattern `^/nodefony/[^/]+/api(/|$)` de la zone
 * `nodefony-admin`, donc aucune zone ne s'y applique — pas de 401 à mesurer, et
 * pas besoin d'ouvrir une zone dédiée. Il évite aussi le repli SPA mono-segment
 * de Studio (`/nodefony/{page}`).
 *
 * **N'existe que sous `NF_BENCH_ROUTE=1`** : zéro surface en production par
 * défaut. C'est un drapeau d'OUTILLAGE (banc), pas une option applicative — d'où
 * une variable d'environnement plutôt qu'une clé de configuration.
 */
class BenchController extends Controller {
  constructor(context: ContextType) {
    super("BenchController", context);
  }

  /** Rend le corps figé. Aucune lecture de kernel, aucun I/O, aucune allocation. */
  index() {
    return this.renderJson(BENCH_PAYLOAD);
  }
}

/**
 * Monte la route de banc — appelée par le module framework, uniquement si
 * `NF_BENCH_ROUTE=1`.
 */
export function mountBenchRoutes(frameworkModule: Module): void {
  if (mounted) return;
  Router.createRoute("framework.bench", {
    path: "/nodefony/kernel/bench",
    constructor: BenchController as unknown as Controller["constructor"],
    classMethod: "index",
    requirements: { methods: ["GET"] },
    // Hors aire data plane : aucune zone ne matche ce chemin. Le `bypassFirewall`
    // reste inutile — on ne veut pas non plus le poser, pour que la mesure passe
    // par le MÊME chemin qu'une route applicative ordinaire non protégée.
  });
  if (
    !Object.prototype.hasOwnProperty.call(BenchController.prototype, "module")
  ) {
    Router.setController(
      BenchController as unknown as Parameters<typeof Router.setController>[0],
      frameworkModule,
    );
  }
  mounted = true;
}

export default BenchController;
