/**
 * @nodefony/realtime — Couche realtime serveur Nodefony.
 *
 * Ce module porte le hub WebSocket (broker fan-out), le protocole JSON-RPC 2.0
 * (peer isomorphe partagé avec le client core), le backplane cluster
 * (Loopback / Cluster IPC / Redis / Kafka) et, à terme, les protocoles TCP / UDP
 * / Unix sockets (P13.1).
 *
 * État actuel (2026-05-28) — scaffold + doc. Le code serveur (RealtimeHub,
 * RealtimeController, RealtimeAdminApi, IBackplane, LoopbackBackplane,
 * ClusterBackplane et les tests associés) sera rapatrié depuis
 * `@nodefony/framework` en P13.0. Le client isomorphe reste dans le subpath
 * `nodefony/realtime` du core (décision figée — pas de package navigateur).
 *
 * Lire `docs/index.md` pour la vue d'ensemble (vulgarisée, surfacée dans
 * Studio /nodefony/documentation).
 *
 * Voir aussi :
 *  - CLAUDE.md  — décisions d'archi figées
 *  - MEMORY.md  — internals IA
 *  - README.md  — usage humain
 */

export { RealtimeError } from "./nodefony/src/errors/RealtimeError";
