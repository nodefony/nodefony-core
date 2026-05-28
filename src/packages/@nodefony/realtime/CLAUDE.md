# CLAUDE.md — @nodefony/realtime

## Docs liées

- [`MEMORY.md`](./MEMORY.md) — internals IA (gotchas, config, internals)
- [`README.md`](./README.md) — usage humain
- [`docs/`](./docs/) — **doc vulgarisée surfacée dans Studio `/nodefony/documentation`**
- [`../../../../CLAUDE.md`](../../../../CLAUDE.md) — règles globales projet
- Mémoires IA :
  - `project_p13_realtime_finish_plan` — plan d'exécution P13 (4 blocs A/B/C/D, swap P13↔P6)
  - `project_p13_realtime_dx_vision` — vision DX vulgarisée (12 mots + 5 étages + flot frame)
  - `project_realtime_nodefony_socket_vision` — north star « la socket = hub fusionnel isomorphe »
  - `project_decisions_realtime_isomorphic` — décisions Kafka / JSON-RPC / P13.3 supprimé
  - `project_client_lib_subpaths_decision` — client = subpath core (pas package navigateur)
  - `project_cluster_backplane_vision` — `IBackplane` Loopback→IPC→Redis

## Rôle du module

Couche **realtime serveur** Nodefony : hub WebSocket (broker fan-out), protocole JSON-RPC 2.0
(peer isomorphe partagé avec le client core), backplane cluster (4 drivers : Loopback / Cluster
IPC / Redis / Kafka) et — à terme — protocoles TCP / UDP / Unix sockets (P13.1).

**Le client navigateur n'est PAS dans ce module** — il vit dans le subpath `nodefony/realtime`
du core, pour rester importable depuis un navigateur sans dépendre du framework serveur.

## Décisions techniques figées

| Sujet                 | Décision                                                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Client navigateur** | Subpath `nodefony/realtime` du core — **PAS** dans ce module (raison isomorphisme, décision figée 2026-05-21)                                                                                             |
| **Vocabulaire**       | `socket` = la prise (`IRealtimeSocket`, handle), `hub` = broker serveur (`RealtimeHub`), `backplane` = fond de panier cluster (`IBackplane`), `peer` = `JsonRpcPeer` (isomorphe)                          |
| **Protocole**         | JSON-RPC 2.0 maison + RPC bidirectionnel (Promise) + types partagés `ServerToClientEvents`/`ClientToServerEvents`                                                                                         |
| **Backplane**         | Contrat `IBackplane` interchangeable. 4 drivers : `LoopbackBackplane` (mono, livré), `ClusterBackplane` (IPC, livré), `RedisBackplane` (P13.5), `KafkaBackplane` (P13.6)                                  |
| **Pluggable user**    | Un utilisateur peut écrire son `MyXxxBackplane implements IBackplane` (NATS, Pulsar, RabbitMQ…) et le passer à `defineRealtimeConfig({ backplane: instance })`                                            |
| **Config**            | `defineRealtimeConfig()` builder + Zod (style `defineSecurityConfig`) — ✅ livré (Bloc A étape 5, 2026-05-28). Backplane custom userland passé en 2ᵉ arg du builder OU via service DI `realtimeBackplane` |
| **Cadence client**    | AIMD (Additive Increase Multiplicative Decrease) auto-ajustée par canal — livré (P13.10)                                                                                                                  |
| **Observabilité**     | Sonde `RealtimeHub.probe()` → canal `realtime:health` + endpoint `/nodefony/realtime/api/health` — livré (P13.11)                                                                                         |
| **Tests**             | Vitest + coverage v8 (convention universelle Nodefony, cf `feedback_test_framework_vitest`). Pas Mocha.                                                                                                   |
| **Sécurité**          | 5 seams obligatoires DANS le module (cf section ci-dessous) pour que P6 se branche en plug                                                                                                                |

## 🪡 5 seams sécurité à coder DANS P13 (avant que P6 démarre)

Sans eux = refonte garantie en P6. Coût total ~1,2 ses.

| #   | Seam                                                                     | Étage        | Branchement P6                               |
| --- | ------------------------------------------------------------------------ | ------------ | -------------------------------------------- |
| 1   | **`beforeDispatch(frame, peer)`** dans `JsonRpcPeer`                     | Protocole    | Lecture metadata `@IsGranted` + voters       |
| 2   | **`IRealtimeAuthenticator`** sur handshake WS (façade `RealtimeService`) | Hub          | JwtAuthenticator / UserPasswordAuthenticator |
| 3   | **Areas WS** dans `defineSecurityConfig()`                               | Hub + config | Bind par P6.3 firewall                       |
| 4   | **Origin check natif** sur upgrade WS                                    | Hub          | Configurable par P6.7 csrf                   |
| 5   | **`onFrameAudit(reason, frame)`** dans `JsonRpcPeer`                     | Protocole    | Consommé par `AuditEventEntity` (P6.14)      |

## Structure des fichiers (cible — après rapatriement P13.0)

```
src/packages/@nodefony/realtime/
├── index.ts                            ← exports publics (server + interfaces)
├── package.json
├── rollup.config.ts                    ← NE PAS MODIFIER sans accord
├── tsconfig.json                       ← NE PAS MODIFIER sans accord
├── vitest.config.ts
├── CLAUDE.md / MEMORY.md / README.md
├── docs/                               ← surfacé dans Studio
│   ├── index.md
│   ├── vocabulaire.md
│   ├── architecture.md
│   ├── configuration.md
│   ├── etat-actuel.md
│   └── cookbook-chat.md
└── nodefony/
    ├── interfaces/                     ← IBackplane, IRealtimeController, IRealtimeProbe, IRealtimeAuthenticator
    ├── src/
    │   ├── errors/RealtimeError.ts     ← (livré)
    │   ├── server/                     ← (P13.0) RealtimeHub, RealtimeController, RealtimeAdminApi
    │   ├── backplane/                  ← (P13.0) LoopbackBackplane, ClusterBackplane, (P13.5) RedisBackplane, (P13.6) KafkaBackplane
    │   ├── config/defineRealtimeConfig.ts  ← (P13.4) builder + Zod
    │   ├── decorators/                 ← (P13.8) @RealtimeController, @RealtimeEvent
    │   └── protocols/                  ← (P13.1) tcp/, udp/, unix/
    └── tests/unit/                     ← (P13.0) RealtimeHub.test.ts, RealtimeController.test.ts, ClusterBackplane.test.ts
```

## Ce qu'il ne faut JAMAIS faire sans accord

- Modifier `rollup.config.ts` ou `tsconfig.json`
- Ajouter `dependencies` directes (toujours `peerDependencies`)
- **Coder un Module class** (`extends Module`) pour ce module sans en parler — pour l'instant lib pure, le wiring serveur reste consommé par les services Nodefony existants
- **Dupliquer le client realtime** dans ce module — c'est un subpath du core, point
- **Dupliquer le contrat `IRealtimeSocket`** — il est dans le core (isomorphe). Le module serveur l'IMPLÉMENTE côté serveur, ne le redéclare pas

## Visibilité Studio

✅ **Page module** : [`/nodefony/modules/realtime`](https://127.0.0.1:5152/nodefony/modules/realtime)
— onglets Docs / Routes / Symbols / Coverage / Tests / Config alimentés par
`/nodefony/kernel/api/module/realtime/*` (cf `framework/.../KernelAdminApi.ts`).
Le scan des `docs/*.md` du module est fait par le helper `docsReader.ts`.

✅ **Vitrine pédagogique** (séparée) : `/nodefony/documentation` → section « Realtime / La
Socket Nodefony » qui surface les 7 fichiers `docs/realtime/socket/*.md` racine avec
live graphs (FanOut/Protocole/Sondes/Backplane/Actions).

Les 2 vues cohabitent intentionnellement (cf [[project_doc_portal_faisabilite]] + ADR-0001
emplacement hybride). Migration éventuelle des 7 fichiers racine vers le module = P13.0.

## Roadmap (P13)

| Étape                                                                                       | Statut                  | Description                                                        |
| ------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------ |
| Scaffold + doc                                                                              | ✅ 2026-05-28           | Module créé + 6 pages doc vulgarisée (frontmatter Studio-friendly) |
| **P13.0** Rapatriement framework→realtime                                                   | ⬜ Bloc A étape 1       | 8 fichiers `src/` + 3 tests à déplacer via git mv                  |
| **Seams** sécurité (5 hooks)                                                                | ⬜ Bloc A étapes 2 et 6 | 1,2 ses au total                                                   |
| **P13.8** Décorateurs `@RealtimeController` / `@RealtimeEvent`                              | ⬜ Bloc A étape 3       | 2 ses                                                              |
| **P13.7 reste** Long-polling fallback + types `ServerToClientEvents`/`ClientToServerEvents` | ✅ 2026-05-28 (étape 4) | Types Socket.IO-style + long-polling droppé (frame retry suffit)   |
| **P13.4 reste** Façade `RealtimeService` + `defineRealtimeConfig()` builder                 | ✅ 2026-05-28 (étape 5) | Builder Zod + service DI + JSON Schema, fix `.default(() => …)`    |
| **P13.9** Tests cluster IPC (sans infra)                                                    | ⬜ Bloc A étape 7       | 2 ses                                                              |
| **P13.2** Refacto `@nodefony/redis`                                                         | ⬜ Bloc B               | 8 ses                                                              |
| **P13.5** `RedisBackplane` driver                                                           | ⬜ Bloc B               | 1 ses (réduit grâce au contrat existant)                           |
| **P13.6** `KafkaBackplane` driver                                                           | ⬜ Bloc C               | 3 ses                                                              |
| **P13.1** TCP / UDP / Unix sockets                                                          | ⬜ Bloc D (différable)  | 7 ses                                                              |
