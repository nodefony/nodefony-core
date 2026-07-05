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

| Sujet                 | Décision                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Client navigateur** | Subpath `nodefony/realtime` du core — **PAS** dans ce module (raison isomorphisme, décision figée 2026-05-21)                                                                                                                                                                                                                                                                               |
| **Vocabulaire**       | `socket` = la prise (`IRealtimeSocket`, handle), `hub` = broker serveur (`RealtimeHub`), `backplane` = fond de panier cluster (`IBackplane`), `peer` = `JsonRpcPeer` (isomorphe)                                                                                                                                                                                                            |
| **Protocole**         | JSON-RPC 2.0 maison + RPC bidirectionnel (Promise) + types partagés `ServerToClientEvents`/`ClientToServerEvents`                                                                                                                                                                                                                                                                           |
| **Backplane**         | Contrat `IBackplane` + **registre de drivers** (`backplaneRegistry.ts`) : `config.backplane.driver` → fabrique, ZÉRO `if` sur nom en dur. Chaque driver porte son nom (`X.driver` static). Natifs : `loopback`, `cluster` (IPC), `redis` (✅ P13.5 pub/sub cross-pod). Userland : `registerBackplaneDriver(name, factory)`. Schéma `z.string()` ouvert. `NF_REALTIME_DRIVER` = env layering |
| **Pluggable user**    | Un utilisateur peut écrire son `MyXxxBackplane implements IBackplane` (NATS, Pulsar, RabbitMQ…) et le passer à `defineRealtimeConfig({ backplane: instance })`                                                                                                                                                                                                                              |
| **Config**            | `defineRealtimeConfig()` builder + Zod (style `defineSecurityConfig`) — ✅ livré (Bloc A étape 5, 2026-05-28). Backplane custom userland passé en 2ᵉ arg du builder OU via service DI `realtimeBackplane`                                                                                                                                                                                   |
| **Cadence client**    | AIMD (Additive Increase Multiplicative Decrease) auto-ajustée par canal — livré (P13.10)                                                                                                                                                                                                                                                                                                    |
| **Observabilité**     | Sonde `RealtimeHub.probe()` → canal `realtime:health` + endpoint `/nodefony/realtime/api/health` — livré (P13.11)                                                                                                                                                                                                                                                                           |
| **Tests**             | Vitest + coverage v8 (convention universelle Nodefony, cf `feedback_test_framework_vitest`). Pas Mocha.                                                                                                                                                                                                                                                                                     |
| **Sécurité**          | 5 seams obligatoires DANS le module (cf section ci-dessous) pour que P6 se branche en plug                                                                                                                                                                                                                                                                                                  |

## 🪡 5 seams sécurité — TOUS LIVRÉS (Bloc A étapes 2+6, 2026-05-28)

P6 pourra se brancher sans refonte. Vue d'ensemble vulgarisée → [`docs/securite.md`](./docs/securite.md).

| #    | Seam                                                                                            | Étage     | Branchement P6                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| ✅ 1 | **`beforeDispatch(frame, peer)`** dans `JsonRpcPeer`                                            | Protocole | Lecture metadata `@IsGranted` + voters                                                                  |
| ✅ 2 | **`IRealtimeAuthenticator`** sur handshake WS (`RealtimeService.useAuthenticator`)              | Hub       | `JwtRealtimeAuthenticator` / `ApiKey...`                                                                |
| ✅ 3 | **Matchers WS** `{ pattern, host? }` (API neutre côté realtime, pas de dep security)            | Hub       | P6 appelle `useAuthenticator()` au boot depuis `defineSecurityConfig().areas` filtrées `realtime: true` |
| ✅ 4 | **Origin check natif** sur upgrade WS (`csrf.checkOrigin` Zod, RFC 6455 §10.2)                  | Hub       | Configurable, fail-closed                                                                               |
| ✅ 5 | **`onFrameAudit(reason, frame, peer)`** dans `JsonRpcPeer` (3ᵉ arg `peer` slot #6 actor lookup) | Protocole | Consommé par `AuditEventEntity` (P6.14)                                                                 |

**Contrats publics du seam #2** : `IRealtimeToken` (structural-compat `IToken` security), `IRealtimeHandshake` (DTO neutre — headers/cookies/url/origin/protocols), `IRealtimeAuthenticator` (`supports/authenticate/onSuccess/onFailure`), `IRealtimeAuthenticatorMatcher` (pattern URL + vhost). `ANONYMOUS_REALTIME_TOKEN` = singleton gelé fallback Zero Trust.

## Structure des fichiers (réelle — rapatriement P13.0 fait)

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
    │   ├── config/defineModuleConfig.ts  ← builder + Zod
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

## Roadmap (P13) — resync code 2026-06-12 (autorité : `MIGRATION_STATUS.md` § P13)

> **167 tests verts** (+9 skipped docker). Dettes backplane #1 (namespace canal) et #2 (originId
> cross-pod) **fixées** (`c082560`) : `resolveBackplaneOriginId()` + `backplane.namespace` Zod →
> canal `nodefony:realtime:<ns>`. Reste dette #3 (frontière inter-modules, attend P6).

| Étape                                                   | Statut        | Description                                                       |
| ------------------------------------------------------- | ------------- | ----------------------------------------------------------------- |
| Scaffold + doc                                          | ✅ 2026-05-28 | Module créé + 6 pages doc vulgarisée                              |
| **P13.0** Rapatriement framework→realtime               | ✅            | 10 src + 5 tests `git mv`, cycle cassé                            |
| **Seams** sécurité (5 hooks)                            | ✅ 2026-05-28 | cf section « 5 seams » ci-dessus                                  |
| **P13.8** Décorateurs realtime                          | 🔶            | 3 décorateurs livrés ; reste pattern RegExp                       |
| **P13.7** Protocole JSON-RPC 2.0 + types partagés       | ✅            | RPC bidirectionnel ; long-polling droppé                          |
| **P13.4** `IRealtimeHub` + `RealtimeService` + config   | ✅            | Builder Zod + service DI                                          |
| **P13.9** Tests cluster IPC (sans infra)                | ✅            | e2e `child_process.fork`, 5 tests                                 |
| **P13.2** Refacto `@nodefony/redis`                     | 🔶            | fondation conventions + config Zod ; 15 tests                     |
| **P13.5** `RedisBackplane` driver                       | ✅            | pub/sub cross-pod, **prouvé cluster live -w2** ; registre drivers |
| **P13.6** `KafkaBackplane` driver                       | ⬜            | apps massives + bus agents IA                                     |
| **P13.1** TCP / UDP / Unix sockets                      | 🔶 différable | scaffold ; code protocoles reste (niche)                          |
| **Banc de conformité ventilation** (scénarios × driver) | ⬜            | matrice : `docs/audits/realtime-module-isolation-2026-06-05.md`   |
