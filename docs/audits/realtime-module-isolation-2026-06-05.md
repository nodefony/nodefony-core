---
title: Audit — isolation inter-module de la socket realtime
date: 2026-06-05
scope: "@nodefony/realtime (hub singleton) + tous ses consommateurs dans nodefony-core"
method: grep/lecture du code (pas de runtime) — état du dépôt au 2026-06-05
status: factuel
related:
  - docs/realtime/socket/08-distribue.md
  - src/packages/@nodefony/realtime/MEMORY.md
  - MIGRATION_STATUS.md (P13, dettes #1/#2/#3)
---

## Objet

Évaluer, **dans le code réel** (pas en théorie), l'isolation entre modules métier
qui partagent l'unique `RealtimeHub` du process (singleton `getRealtimeHub()`).
Question motrice : deux modules aux métiers séparés (ex. un futur `mediasoup` →
`sip:*` et `studio` → observabilité) peuvent-ils se marcher dessus ?

## Méthode

`grep` sur `src/**` (hors `dist/`, `node_modules`, `*.test.*`) :
`extends RealtimeController`, `getRealtimeHub`, `realtimeService`,
`createRealtimeChannel`, `realtimeBroadcastChannels`, `markBroadcastChannel`, et
inventaire des littéraux de canaux `"<préfixe>:..."`.

## Cartographie — qui touche le hub

| Module               | Touche le hub ?                         | Surface                                                              |
| -------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| `@nodefony/realtime` | définit le hub                          | `RealtimeHub`, `RealtimeController` (base), `RealtimeService`        |
| `@nodefony/studio`   | **OUI — seul consommateur applicatif**  | `StudioRealtimeController` (route WS `/realtime`) + `realtime/providers.ts` |
| `src/modules/test`   | **NON** (WS brut, hors hub)             | `WebSocketController` / `AlsController` = `node:ws` direct, PAS de JSON-RPC ni hub |
| core (`RealtimeClient`) | côté navigateur (isomorphe)          | n'accède pas au hub (l'autre bout du fil)                            |

> Les littéraux `chat:*`, `sip:*`, `presence:*` relevés par grep proviennent des
> **tests** du module realtime (`tests/**`), **pas** de controllers applicatifs.
> Aucun module de prod n'expose ces canaux aujourd'hui.

## Canaux exposés par Studio (`StudioRealtimeController` + `providers.ts`)

Tous sont des canaux d'**observabilité système**, déclarés dans `CHANNELS`, servis
par l'override `createRealtimeChannel` (match exact + suffixe de cadence `:<ms>` +
regex de drill `@<pid>`) :

| Préfixe                  | Contenu                                  | Cadence `:<ms>` | Drill `@<pid>` |
| ------------------------ | ---------------------------------------- | --------------- | -------------- |
| `dashboard:supervision`  | métriques process (CPU/heap/ELU…)        | oui             | oui (rich)     |
| `dashboard:stats`        | stats agrégées                           | oui             | —              |
| `debugbar:stats`         | widget debug bar                         | oui             | —              |
| `syslog:stream`          | flux de logs                             | —               | —              |
| `orm:health`             | santé ORM                                | oui             | —              |
| `orm:flow`               | flux requêtes ORM                        | —               | oui (rich)     |
| `realtime:health`        | auto-sonde du hub                        | oui             | —              |
| `node:cluster` / `node:stream` | vues cluster/stream                | —               | —              |
| `frontend:status`        | état Vite/HMR                            | —               | —              |

**`realtimeBroadcastChannels()` : non surchargé → `[]`.** Donc **aucun** de ces
canaux n'est marqué broadcast → tous **instance-local** (jamais forwardés au
backplane). Cohérent avec le design « sondes per-pod, agrégat = backplane ».

## Constats d'isolation

### C1 — Le risque est LATENT, pas réalisé (aujourd'hui)

Il n'existe **qu'un seul** consommateur du hub (Studio). Pas de second module qui
partagerait la `Map` de canaux → **aucune collision ni fuite observable
actuellement**. Le problème d'isolation est **architectural / futur** : il
s'activera au **premier** second `RealtimeController` (mediasoup SIP prévu, ou
module tiers de l'écosystème).

### C2 — Le cas-fuite (« cas 2 ») est présent dans le code mais non exploitable ici

`RealtimeHub.subscribe` n'appelle la factory que si le canal n'existe pas encore ;
sur un canal **déjà créé**, il ajoute le sink **sans aucun contrôle** :

```js
subscribe(channel, sink, factory) {
  let st = channels.get(channel);
  if (st) { st.sinks.add(sink); return true; }  // ◄ canal existant → 0 contrôle
  // sinon : factory(channel) → null = refus à la création
}
```

Exploitable **uniquement** si deux controllers coexistent et qu'un client d'un
endpoint peut émettre `subscribe("<canal de l'autre>")`. Avec un seul controller
(Studio), pas de surface. **Devient un vrai risque dès le 2ᵉ module.**

### C3 — Namespace de canaux PLAT, sans cloisonnement par route/module

Le hub indexe les canaux par **nom nu**, sans préfixe de module imposé. Rien
n'empêche structurellement un futur controller `mediasoup` d'ouvrir/servir un
canal `orm:health` (collision de préfixe) ou de recevoir celui de Studio (cas C2).
Les seules barrières actuelles :

1. **Isolation par connexion** (réelle) — on ne reçoit que ce qu'on `subscribe`.
2. **Factory du controller** (création seulement) — `null` pour canal inconnu.
3. **Sécurité P6** (non branchée) — la vraie frontière métier, à venir.
4. **Convention de préfixe** — hygiène, pas une barrière.

### C4 — La ventilation backplane n'est exercée par AUCUN code de prod

Aucun canal broadcast déclaré → le chemin `publish → backplane.publish` n'est
jamais pris hors tests. **Conséquence directe** : les dettes #1 (namespace topic)
et #2 (`originId` k8s) du backplane sont **invisibles en l'état** — elles ne se
manifesteront qu'au premier canal réellement broadcast (chat, présence d'un vrai
module). À garder en tête : « ça marche » aujourd'hui ne valide pas le distribué.

## Verdict

| Axe                                   | État              | Commentaire                                       |
| ------------------------------------- | ----------------- | ------------------------------------------------- |
| Fuite cross-module réelle             | 🟢 aucune          | 1 seul consommateur (Studio)                      |
| Robustesse du modèle au 2ᵉ module     | 🔴 insuffisante    | namespace plat + cas C2 + pas de frontière dure   |
| Ventilation cross-process exercée     | 🟠 non             | 0 canal broadcast → dettes #1/#2 latentes         |
| Cloisonnement par sécurité            | 🟠 à venir (P6)    | seams présents, non branchés                       |

**Conclusion : sûr aujourd'hui par absence de voisins, fragile par conception dès
qu'un second module realtime arrivera.** À traiter AVANT mediasoup/écosystème
tiers, conjointement au branchement P6.

## Recommandations (frontière dure — par ordre de coût croissant)

1. **Préfixe imposé par controller (le moins cher, structurel).**
   Chaque `RealtimeController` déclare son **namespace autorisé** (ex. `sip:` pour
   mediasoup, allowlist de préfixes pour Studio). La base **rejette** tout
   `subscribe` hors namespace **avant** de toucher le hub → ferme le cas C2 sans
   dépendre de P6.
   ```ts
   // base RealtimeController (proposé)
   protected realtimeAllowedPrefixes(): string[] { return []; }  // [] = pas de garde (compat)
   // startChannel : if (prefixes.length && !prefixes.some(p => channel.startsWith(p))) → refuse
   ```

2. **Voter par namespace de canal dans `beforeDispatch` (P6).**
   Autorisation fine (rôle/àpartenance) sur l'intention `subscribe <channel>`.
   Couvre les cas que le préfixe statique ne décide pas (multi-tenant, ACL).

3. **Clé de canal scopée par module au niveau du hub (le plus invasif).**
   Indexer `#channels` par `(moduleKey, channel)` plutôt que `channel` nu. Évite
   toute collision de préfixe, mais casse le partage *voulu* d'un canal entre
   modules (à ne faire que si un besoin réel d'isolation totale apparaît).

> Recommandation : **(1) maintenant** (cheap, ferme C2/C3 avant le 2ᵉ module),
> **(2) avec P6** (autorisation métier). (3) seulement si un cas d'usage l'exige.

## Banc de conformité ventilation (« chat » de test) — À FAIRE

> [!IMPORTANT]
> Aujourd'hui **aucun test n'exerce le chemin `publish → backplane.publish`** hors
> tests unitaires bas niveau (cf C4). Il manque un **banc de conformité** qui
> prouve que **tous les drivers se comportent pareil** (le drop-in promis par
> `IBackplane`) et qui, ce faisant, exerce enfin les dettes #1/#2.

**Principe.** Un `RealtimeController` **« chat » minimal** dans `src/modules/test`
(route WS, ex. `/chat`), couvrant tous les patterns de fan-out, + **une suite de
scénarios paramétrée par driver**. Une seule implémentation des scénarios, rejouée
contre `loopback` / `cluster` (IPC) / `redis` / `kafka`. **Invariant** : pour les
scénarios applicables à la portée du driver, le comportement **observable** (qui
reçoit quoi, combien de fois) doit être **identique**.

**Scénarios (le « chat »)**

| #   | Scénario                                        | Attendu                                                                 |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| S1  | broadcast à **1** abonné                        | le client reçoit 1×                                                    |
| S2  | broadcast à **N** abonnés, **même** process     | tous reçoivent 1× (fan-out local)                                     |
| S3  | broadcast à **N** abonnés sur **K** pods        | tous reçoivent 1×, cross-process (forward backplane)                  |
| S4  | message **à une seule personne** (canal DM dédié `chat:dm:a:b`) | seuls `a` et `b` reçoivent ; les autres rien        |
| S5  | canal **non-broadcast** (instance-local), abonnés sur 2 pods | **seul** le pod émetteur sert ses abonnés ; l'autre pod ne reçoit RIEN |
| S6  | **anti-echo** : émetteur abonné à son propre canal cross-pod | reçoit **1×** (fan-out local), jamais 2× (pas de réinjection)        |
| S7  | **request/response RPC**                        | reste **local**, ne traverse jamais le backplane                      |
| S8  | unsubscribe / **ref-counting**                  | provider disposé au dernier abonné ; après `unsubscribe`, plus rien   |
| S9  | pod qui **rejoint après coup**                  | reçoit les messages émis **après** son subscribe (best-effort pub/sub) |
| S10 | **ordre par pair**                              | messages d'un même émetteur arrivent dans l'ordre                     |

**Matrice drivers**

| Driver         | Portée                 | Infra de test                         | Scénarios N/A                         |
| -------------- | ---------------------- | ------------------------------------- | ------------------------------------- |
| `loopback`     | mono-process           | aucune                                | S3, S5, S6 (cross-pod), S9 (0 pair)   |
| `cluster` (IPC) | intra-pod multi-worker | `child_process.fork` (déjà P13.9)     | —                                     |
| `redis`        | cross-pod              | `testcontainers` Redis (docker)       | —                                     |
| `kafka`        | cross-pod              | `testcontainers` Kafka (docker)       | attention `auto.offset.reset` pour S9 |

**Ce que le banc prouve en plus**

- **Drop-in** : S1→S10 verts sur tous les drivers = le hub est réellement
  agnostique du transport.
- **Dettes #1/#2 exercées** : S3/S5/S6 activent le forward cross-pod → le
  **namespace de topic** (dette #1) et l'**`originId` unique** (dette #2) sont
  enfin sollicités. **Le banc devient le test de non-régression du fix.**
  Sous-cas dédiés à ajouter une fois les dettes traitées :
  - **#1** : 2 « apps » (2 namespaces) sur le même Redis → S3 ne doit **PAS**
    fuiter de l'une à l'autre (cross-talk = échec).
  - **#2** : 2 pods avec un `originId` **collision-forcé** → S6 doit échouer
    (preuve du bug), puis réussir avec `originId` unique (preuve du fix).

**Réutilisation** : le harnais `clusterIpc.e2e.test.ts` (P13.9, `fork` + `ClusterRelay`
in-process) est le squelette pour `cluster` ; `testcontainers` pour redis/kafka.

## Dettes liées (suivi MIGRATION_STATUS P13)

- **#1** namespace de topic non câblé → cross-talk multi-app (cf [08](../realtime/socket/08-distribue.md)).
- **#2** `originId = process.pid` non unique en k8s → anti-echo cassé (HAUTE).
- **#3** pas de frontière dure inter-module → **cet audit** (reco #1/#2 ci-dessus).
