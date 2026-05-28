/**
 * @nodefony/realtime — Couche realtime serveur Nodefony.
 *
 * Ce module porte le hub WebSocket (broker fan-out), le protocole JSON-RPC 2.0
 * (peer isomorphe partagé avec le client core), le backplane cluster
 * (Loopback / Cluster IPC / Redis / Kafka) et, à terme, les protocoles TCP / UDP
 * / Unix sockets (P13.1).
 *
 * État actuel (2026-05-28) — scaffold + doc + Module class minimale. Le code
 * serveur (RealtimeHub, RealtimeController, RealtimeAdminApi, IBackplane,
 * LoopbackBackplane, ClusterBackplane et les tests associés) sera rapatrié
 * depuis `@nodefony/framework` en P13.0. Le client isomorphe reste dans le
 * subpath `nodefony/realtime` du core (décision figée — pas de package navigateur).
 *
 * Module class présente pour que le module soit enregistrable dans `@modules()`
 * racine, ce qui le rend visible dans Studio via `/nodefony/modules/realtime`.
 * Lire `docs/index.md` pour la vue d'ensemble vulgarisée.
 *
 * Voir aussi :
 *  - CLAUDE.md  — décisions d'archi figées + 5 seams sécurité
 *  - MEMORY.md  — internals IA
 *  - README.md  — usage humain
 *  - docs/      — doc dev vulgarisée (6 pages)
 */
import { Kernel, Module } from "nodefony";
import config from "./nodefony/config/config";

class Realtime extends Module {
  constructor(kernel: Kernel) {
    super("realtime", kernel, import.meta.url, config);
  }
}

export default Realtime;
export { Realtime };

export { RealtimeError } from "./nodefony/src/errors/RealtimeError";
export type { RealtimeConfig } from "./nodefony/config/config";
