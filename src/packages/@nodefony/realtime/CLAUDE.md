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
(peer isomorphe partagé avec le client core), backplane cluster (**3 drivers natifs** : `loopback`,
`cluster` IPC, `redis`) + registre ouvert pour les drivers userland.

> ⚠️ **Kafka n'existe pas.** Aucun `KafkaBackplane` n'est codé, et `backplaneRegistry.test.ts`
> **interdit explicitement le littéral** (`expect(names).to.not.include("kafka")`) — règle « pas de
> nom mort ». Ne l'annonce nulle part comme disponible. Idem `nodefony/src/protocols/` (TCP/UDP/Unix) :
> le dossier n'existe pas sur disque.

**Le client navigateur n'est PAS dans ce module** — il vit dans le cœur, importable sans dépendre
du framework serveur.

> ⚠️ **Le subpath est `nodefony/client`, PAS `nodefony/realtime`.** Ce dernier **n'existe pas** :
> les exports réels du cœur sont `.`, `./bundler`, `./client`, `./debugbar`, `./react`, `./roles`.
> L'import `nodefony/realtime` est **cassé pour tout consommateur**.

## Décisions techniques figées

| Sujet                 | Décision                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Client navigateur** | Subpath **`nodefony/client`** du core — **PAS** dans ce module (raison : isomorphisme). ⚠️ `nodefony/realtime` **n'existe pas**                                                                                                                                                                                                                                                                                                                                          |
| **Vocabulaire**       | `socket` = la prise (`IRealtimeSocket`, handle), `hub` = broker serveur (`RealtimeHub`), `backplane` = fond de panier cluster (`IBackplane`), `peer` = `JsonRpcPeer` (isomorphe)                                                                                                                                                                                                                                                                                         |
| **Protocole**         | JSON-RPC 2.0 maison + RPC bidirectionnel (Promise) + types partagés `ServerToClientEvents`/`ClientToServerEvents`                                                                                                                                                                                                                                                                                                                                                        |
| **Backplane**         | Contrat `IBackplane` + **registre de drivers** (`backplaneRegistry.ts`) : `config.backplane.driver` → fabrique, ZÉRO `if` sur nom en dur. Chaque driver porte son nom (`X.driver` static). Natifs : `loopback`, `cluster` (IPC), `redis` (✅ P13.5 pub/sub cross-pod). Userland : `registerBackplaneDriver(name, factory)`. Schéma `z.string()` ouvert. `NF_REALTIME_DRIVER` = env layering                                                                              |
| **Pluggable user**    | Un utilisateur écrit son `MyXxxBackplane implements IBackplane` (NATS, Pulsar, RabbitMQ…) et le branche par **`registerBackplaneDriver(name, factory)` + `backplane: { driver: name }`** (recommandé) OU par le **service DI `realtimeBackplane`** (instance déjà construite). ⚠️ **PAS** via une instance dans la config `use()` (Zod la strippe) ni le 2ᵉ arg du builder (inatteignable depuis une app — cf ligne Config)                                              |
| **Config**            | `defineRealtimeConfig()` builder + Zod (style `defineSecurityConfig`) — ✅ livré (Bloc A étape 5). Voie app pour une instance backplane = **service DI `realtimeBackplane`** (résolu `RealtimeService.ts:98`). Le **2ᵉ arg du builder** (`defineRealtimeConfig(cfg, { backplane })` → `backplane.instance`) n'est atteignable que par qui APPELLE le builder (Module custom) — le module core l'appelle sans (`index.ts:216`), donc une app via `use()` ne l'atteint pas |
| **Cadence client**    | AIMD (Additive Increase Multiplicative Decrease) auto-ajustée par canal — livré (P13.10)                                                                                                                                                                                                                                                                                                                                                                                 |
| **Observabilité**     | Sonde `RealtimeHub.probe()` → canal `nodefony:socket` + endpoint `/nodefony/realtime/api/health` — livré (P13.11)                                                                                                                                                                                                                                                                                                                                                        |
| **Tests**             | Vitest + coverage v8 (convention universelle Nodefony, cf `feedback_test_framework_vitest`). Pas Mocha.                                                                                                                                                                                                                                                                                                                                                                  |
| **Sécurité**          | 5 seams obligatoires DANS le module (cf section ci-dessous) pour que P6 se branche en plug                                                                                                                                                                                                                                                                                                                                                                               |

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
├── rolldown.config.ts                    ← NE PAS MODIFIER sans accord
├── tsconfig.json                       ← NE PAS MODIFIER sans accord
├── vitest.config.ts
├── CLAUDE.md / MEMORY.md / README.md
├── docs/                               ← surfacé dans Studio — 9 pages
│   ├── index.md                        ← hub (catalogue en cards)
│   ├── vocabulaire.md
│   ├── architecture.md
│   ├── protocole.md                    ← grammaire des frames, codes d'erreur réels
│   ├── actions.md                      ← RPC : appeler et savoir si ça a marché
│   ├── configuration.md
│   ├── securite.md
│   ├── observabilite.md                ← sonde, canaux de santé, écrans
│   └── cookbook-chat.md
└── nodefony/
    ├── interfaces/                     ← IBackplane, IRealtimeController, IRealtimeProbe, IRealtimeAuthenticator
    ├── src/
    │   ├── errors/RealtimeError.ts
    │   ├── server/                     ← RealtimeHub, RealtimeController, RealtimeAdminApi
    │   ├── backplane/                  ← LoopbackBackplane, ClusterBackplane, RedisBackplane + backplaneRegistry
    │   ├── config/defineModuleConfig.ts  ← builder + Zod
    │   └── decorators/                 ← @RealtimeAction, @RealtimeChannel, @RealtimeInbound
    └── tests/unit/                     ← RealtimeHub.test.ts, RealtimeController.test.ts, ClusterBackplane.test.ts
```

## Ce qu'il ne faut JAMAIS faire sans accord

- Modifier `rolldown.config.ts` ou `tsconfig.json`
- Ajouter `dependencies` directes (toujours `peerDependencies`)
- **Coder un Module class** (`extends Module`) pour ce module sans en parler — pour l'instant lib pure, le wiring serveur reste consommé par les services Nodefony existants
- **Dupliquer le client realtime** dans ce module — c'est un subpath du core, point
- **Dupliquer le contrat `IRealtimeSocket`** — il est dans le core (isomorphe). Le module serveur l'IMPLÉMENTE côté serveur, ne le redéclare pas

## Visibilité Studio

✅ **Page module** : [`/nodefony/modules/realtime`](https://127.0.0.1:5152/nodefony/modules/realtime)
— onglets Docs / Routes / Symbols / Coverage / Tests / Config alimentés par
`/nodefony/kernel/api/module/realtime/*` (cf `framework/.../KernelAdminApi.ts`).
Le scan des `docs/*.md` du module est fait par le helper `docsReader.ts`.

✅ **Vitrine pédagogique** (séparée) : `/nodefony/documentation` → les pages `docs/*.md` de CE
module. La doc « socket Nodefony » vit **ici seulement** — l'ancienne vitrine transverse
`docs/realtime/socket/` est supprimée, et `docs/architecture/realtime-socket-nodefony.md` ne porte
plus que la **trajectoire** (SIP, ponts protocolaires), pas la mécanique.

**Les graphes vivants** (`architecture`, `protocole`, `fan-out`, `actions`, `backplane`, `sondes`)
ne sont plus liés à un dossier de pages : ils vivent dans un registre
(`studio/frontend/src/realtime/socket/liveGraphs.ts`) et s'invoquent **par nom**, dans n'importe
quelle page, par une fence typée :

````markdown
```nodefony-livegraph
{ "graph": "backplane", "height": 520 }
```
````

Le même registre alimente le forage « Realtime Hub » du Jumeau Vivant (`SocketExplorer`) — une
seule source, deux consommateurs.

Les 2 vues cohabitent intentionnellement (cf [[project_doc_portal_faisabilite]] + ADR-0001
emplacement hybride).

## Où en est le module

**L'avancement vit dans `MIGRATION_STATUS.md` (§ P13) — pas ici.** Un tableau de statuts recopié
dans un CLAUDE.md devient un mensonge dès la session suivante : celui-ci annonçait encore un driver
Kafka « à faire » et 6 pages de doc alors qu'il y en a 9.

Ce qu'il faut savoir en entrant dans le module, et qui ne périme pas :

- Le **cœur est livré et prouvé en cluster** : hub, protocole, seams sécurité, backplane Redis
  cross-pod, sonde. On construit dessus, on ne le refonde pas.
- Les **dettes de nommage cross-pod sont soldées** : l'espace de nommage du canal et l'`originId`
  sont câblés. Toute doc qui les présente comme ouvertes est périmée.
- La dette qui **reste vraiment** : la frontière inter-modules des canaux. Le registre est plat et
  indexé par nom, donc un module peut redéclarer un canal avec une politique plus faible. Elle
  attend l'arbitrage sécurité — et elle n'a jamais porté le nom `#channelAllowed` qu'on lui prête.
