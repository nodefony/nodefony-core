# @nodefony/mediasoup

> **Statut : banc de test ORM** (aujourd'hui) → **module visioconférence / média temps réel** (futur, Phase 15).
>
> Ce module a **deux vies** :
>
> 1. **Maintenant** — il ne contient **que le modèle de données** (schémas Drizzle) et un **build Vue 3 prêt** (aucun front codé). Il sert de **banc d'essai réaliste pour l'abstraction ORM `@nodefony/orm-core`** et alimente l'**ERD de Studio** avec un vrai modèle métier.
> 2. **Plus tard (P15)** — il portera la couche **mediasoup** (SFU WebRTC + RTP brut/SIP pour agent IA vocal). Le modèle persisté étant déjà conçu et testé, l'implémentation démarrera sur des fondations éprouvées.

---

## Pourquoi ce module existe d'abord comme banc ORM

Tester une abstraction multi-ORM sur des entités synthétiques (`Foo`/`Bar`) ne prouve rien. Le modèle
historique de **`nodefony-mediasoup`** (app legacy JS) est au contraire **riche et réaliste** :
clé primaire `string` **et** UUID, **ENUM**, colonnes **JSON**, **relation N-N** (table de jonction),
**1-N** avec sémantique **CASCADE**, **FK multiples** sur une même entité. C'est le banc parfait pour
durcir `@nodefony/orm-core` — puis le modèle servira tel quel à la vraie implémentation P15.

> **Triple dividende** : (1) valide `@nodefony/orm-core` ; (2) éprouve `@nodefony/user` (l'entité `User`) ;
> (3) pré-construit le modèle persisté de la future visio P15.

---

## Stack technique

### Legacy de référence (`/repository/nodefony-mediasoup`, JS)

<!-- prettier-ignore -->
| Domaine | Techno legacy |
| --- | --- |
| SFU média | **mediasoup** (Worker / Router / **WebRtcTransport** + **PlainTransport** / Producer / Consumer) |
| Signaling | **ws** (WebSocket) |
| Enregistrement / diffusion | **ffmpeg** + **gstreamer** (workers via PlainTransport RTP) |
| Persistance | **dual ORM** (SQL + Mongoose) |
| API | **GraphQL** (+ REST) |
| Frontend | **Vue** + **Element UI** (Options API), build **webpack** |
| Process | **pm2** |
| Client navigateur | **nodefony-client** |
| Divers | i18n-iso-countries |

### Cible Nodefony TypeScript (ce module)

<!-- prettier-ignore -->
| Domaine | Techno cible | Remplace |
| --- | --- | --- |
| Persistance | **`@nodefony/drizzle`** (ORM SQL par défaut) via **`@nodefony/orm-core`** ; portabilité testée sur Mongoose | ORM en dur |
| Frontend | **`@nodefony/frontend`** (Vite) + **Vue 3** (Composition API) | webpack |
| Signaling temps réel | **`@nodefony/realtime`** / Core isomorphe `nodefony` (JSON-RPC 2.0) | ws brut |
| SFU média (P15) | **mediasoup** (Worker/Router/**PlainTransport RTP** + SIP/Asterisk pour agent IA vocal) | WebRtcTransport navigateur |
| Enregistrement (P15) | **ffmpeg / gstreamer** workers | identique |
| API admin | data plane `/nodefony/mediasoup/api/*` (Studio) | — |
| Process | **cloud-native** (1 pod = 1 process) | pm2 (déprécié) |
| Client | subpaths Core `nodefony/*` (isomorphe) | nodefony-client |

> ⚠️ **Divergence de cas d'usage assumée** : le legacy = visio **WebRTC navigateur**. La cible roadmap P15
> vise en plus le **RTP brut (PlainTransport) + SIP/Asterisk** pour un **agent IA vocal** (PSTN). L'archi
> Worker/Router/Transport est réutilisable ; le transport et le signaling diffèrent.

---

## État actuel du module

```
src/modules/mediasoup/
├── index.ts                         # Module : enregistre le build Vue + monte le connecteur Drizzle "mediasoup"
├── nodefony/
│   ├── config/config.ts             # module-frontend { https: true }
│   ├── controller/MediasoupController.ts   # GET /mediasoup (page Vue) + /mediasoup/api/data
│   └── entity/schema.ts             # ⭐ LE modèle ORM (schémas Drizzle + registerMediasoupEntities)
└── frontend/                        # build Vue 3 PRÊT — front NON implémenté (placeholder)
    └── src/{main.ts, App.vue}
```

- **Connecteur ORM dédié** `mediasoup` (Drizzle, `:memory:`), ouvert à `onKernelBoot`, fermé à `onTerminate`.
- Les entités sont enregistrées **avant** `connect()` (l'adapter résout les relations au connect).
- Toutes taggées `module: "mediasoup"` → **regroupées dans l'ERD Studio**.

### Voir l'ERD

Serveur dev lancé (skill `nodefony-start-server`), puis dans **Studio → Database** : sélectionner le
connecteur **`mediasoup`**. Ou en ligne de commande :

```bash
curl -sk "https://127.0.0.1:5152/nodefony/orm/api/graph?connector=mediasoup"          # graphe JSON
curl -sk "https://127.0.0.1:5152/nodefony/orm/api/export/dbml?connector=mediasoup"    # DBML (dbdiagram.io)
curl -sk "https://127.0.0.1:5152/nodefony/orm/api/export/jsonschema?connector=mediasoup"  # JSON Schema (IA)
```

---

## Modèle de données

```
                ┌────────────┐
                │   User     │◄───────────────┐
                │ (userTable)│                │ creatorId
                └────┬───────┘                │
            userId  │  ▲ userId        ┌──────┴─────┐ calendarId ┌──────────┐
        ┌───────────┘  │              │  Calendar  │◄───────────│  Event   │
        ▼              │              │  etag(uuid)│            │ start/end│
 ┌────────────┐   ┌────┴───────┐      └────────────┘   roomId ─►│  (json)  │
 │ RoomMember │──►│   Room     │◄───────────────────────────────┘
 │ (jonction) │   │ name (pk)  │
 └────────────┘   │ type ENUM  │
                  └────────────┘
```

<!-- prettier-ignore -->
| Entité | PK | Champs notables | Relations (FK) |
| --- | --- | --- | --- |
| **User** | `id` (uuid) | identifier, password, `roles` (json), enabled, locked… _(table `@nodefony/user`)_ | cible de RoomMember, Calendar, Event |
| **Room** | `name` (text) | `type` (ENUM WEBRTC), `access` (ENUM private/public), secure, locked, stickyCookie | cible de RoomMember, Event |
| **RoomMember** | `id` (uuid) | role, joinedAt | **N-1 Room** (`roomId`) + **N-1 User** (`userId`) → **= jonction N-N** |
| **Calendar** | `id` (uuid) | `etag` (uuid unique), summary, `conferenceProperties` (json), `defaultReminders` (json), isPrimary, hidden | **N-1 User** (`creatorId`) |
| **Event** | `id` (uuid) | `start`/`end`/`recurrence`/`attendees`/`organizer` (json), status, visibility, timezone, `deletedAt` (soft-delete) | **N-1 Calendar** (`calendarId`) + **N-1 Room** (`roomId`, nullable) + **N-1 User** (`creatorId`) + **N-1 Event** (`parentEventId`, **auto-référence**) |
| **Recording** | `id` (uuid) | kind/format/status (pseudo-ENUM), durationMs, sizeBytes, `metadata` (json), `deletedAt` (soft-delete) | **N-1 Room** (`roomId`) + **N-1 Event** (`eventId`, **nullable**) |
| **Tag** | `id` (uuid) | `name` (**unique**), color | cible de EventTag |
| **EventTag** | `id` (uuid) | — | **N-1 Event** (`eventId`) + **N-1 Tag** (`tagId`) → **= 2ᵉ jonction N-N** |

> 🔸 **Les N-N sont explicites** (`RoomMember`, `EventTag`) : les adapters Nodefony
> (Drizzle/Mongoose) **rejettent le `many-to-many` déclaratif** — la table de jonction est
> le pattern portable (et la bonne pratique SQL). C'est volontairement un cas de test.
> 🔸 **8 entités** au total. Cas de test couverts : N-N (×2), **auto-référence** (`Event.parentEventId`),
> **FK nullable** (`Recording.eventId`), **soft-delete** (`Event`/`Recording.deletedAt`), **unique** (`Tag.name`),
> JSON, UUID, FK multiples.
> 🔸 **Contrainte orm-core découverte** : les relations exigent une **PK `id`** sur chaque entité
> (`localKey`/`targetKey` figés à `"id"` dans l'adapter) → `Room` utilise `id` UUID (et non `name`).
> Le `many-to-many` déclaratif est rejeté → jonction explicite. (À lever si l'abstraction gère des PK arbitraires.)

---

## Plan de tests ORM (banc)

Ce que ce modèle permet de couvrir (à écrire dans `tests/` — tests **scénario/intégration**, les
tests unitaires génériques restant dans `@nodefony/orm-core`) :

- **CRUD portable** sur PK `string` (Room) **et** UUID (les autres).
- **Relations N-1** multiples sur une même entité (`Event` → Calendar + Room + User).
- **Jonction N-N** via `RoomMember` : ajout/retrait de membres, unicité (room, user).
- **Eager-load** portable (`{ relations: [...] }`) : charger une `Room` + ses `members`, un `Event` + son `calendar`/`creator`.
- **Colonnes JSON** : round-trip `conferenceProperties`, `attendees`, `start/end` (objets/arrays).
- **Opérateurs riches** (`$in`, `$like`, `$gte`…) sur events par date/statut.
- **Transactions** : créer un `Event` + ses dépendances atomiquement (commit/rollback).
- **Portabilité multi-ORM** : rejouer le **même** banc sur **Mongoose** (preuve « swap d'ORM »).
- **Sémantique CASCADE** (suppression d'un `User` → ses `Calendar`/`Event`) — à valider par adapter.

> Fixtures : le legacy fournit `nodefony-mediasoup/src/bundles/*/Fixtures/*` (rooms, calendar, events,
> users) — à porter pour des données réalistes.

---

## Backlog — enrichissements du modèle (= plus de tests ORM)

Implémentés (2026-05-22) :

- ✅ **`Recording`** (1-N `Room`, N-1 `Event` **nullable**) : sortie ffmpeg/gstreamer — JSON, pseudo-ENUM, soft-delete.
- ✅ **Auto-référence** `Event.parentEventId → Event` (instance d'un récurrent) : FK **auto-référente**.
- ✅ **Soft-delete** (`deletedAt`) sur `Event` et `Recording`.
- ✅ **`Tag` N-N `Event`** via `EventTag` (2ᵉ jonction) + `Tag.name` **unique**.

Restent (non implémentés) :

- **Index/unicité composite** (ex. `RoomMember(roomId, userId)` unique) — ⚠️ l'adapter Drizzle ne génère pas encore d'index composite dans son DDL dérivé (`#createTableSQL` = colonnes + pk/unique par colonne) ; à traiter avec le support index.
- **Volume** : générer N milliers de lignes (suite lourde) pour le stress ORM/perf.
- ⬜ **Portabilité Mongoose** (store documentaire : refs ObjectId + virtual populate).

---

## Roadmap

- ✅ **Modèle ORM Drizzle** (8 entités) + connecteur dédié + ERD Studio (2026-05-22).
- ✅ **Tests d'intégration ORM** (`tests/integration/orm-mediasoup.test.ts`, **11 tests** : N-N ×2, auto-réf, FK nullable, soft-delete, unique, JSON, eager-load, opérateurs, transactions) — `npm test`.
- ✅ **Banc Drizzle** : MÊME modèle logique + MÊME API repository, **11 tests verts**.
- ⬜ Portabilité Mongoose (même modèle).
- ⬜ Fixtures portées du legacy.
- ⬜ **P15** — couche mediasoup : `MediasoupService` (Workers), `RoomManager`/`PeersService`,
  signaling `@RealtimeController`, recorder/streamer ffmpeg-gstreamer, transport **PlainTransport RTP + SIP**.
- ⬜ Frontend Vue 3 réel (visio / admin salles).

---

## Liens

- Abstraction ORM : [`@nodefony/orm-core`](../../packages/@nodefony/orm-core/README.md)
- Adapter par défaut : [`@nodefony/drizzle`](../../packages/@nodefony/drizzle/README.md)
- Builder front : [`@nodefony/frontend`](../../packages/@nodefony/frontend/README.md)
- Legacy de référence : `/repository/nodefony-mediasoup` (JS)
- Licence : CeCILL-B
