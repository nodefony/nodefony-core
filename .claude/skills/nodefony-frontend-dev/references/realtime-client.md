# `RealtimeClient` & hooks React (`nodefony/client`, `nodefony/react`)

Référence du **client temps réel isomorphe** et de ses bindings React. Le client parle **JSON-RPC 2.0** sur WebSocket ; il gère reconnexion, pub/sub ref-compté, RPC, mutations idempotentes, duplex serveur→client, identité, notices, stats et cadence adaptative. Ancres `fichier:ligne` vérifiées (chemins relatifs à la racine du repo).

> Pour l'isomorphisme (dual-build, subpaths, `customConditions`) et le RBAC `nodefony/roles` → voir [`isomorphic.md`](./isomorphic.md).

Source : `src/nodefony/src/client/realtime/RealtimeClient.ts` (1300 l). Contrats partagés : `src/nodefony/src/realtime/` (`JsonRpcPeer`, `IRealtimeSocket`, `IRealtimeTransport`, `RealtimeEventMap`, `channelRate`). Transport navigateur : `src/client/realtime/BrowserWsTransport.ts`. Socle agnostique : `src/client/realtime/observe.ts` (330 l) + table `client/realtime/localEvents.ts`. Liaisons : `src/client/react/index.ts` (React) · `src/client/vue/index.ts` (Vue 3).

## Sommaire

1. [Architecture en couches](#1-architecture-en-couches)
2. [Obtenir un client : `shared` / constructeur / `connect`](#2-obtenir-un-client--shared--constructeur--connect)
3. [État de connexion & reconnexion](#3-etat-de-connexion--reconnexion)
4. [Pub/sub : `subscribe`/`unsubscribe`/`on`/`publish` (ref-comptage)](#4-pubsub--subscribeunsubscribeonpublish-ref-comptage)
5. [RPC : `request`, `mutate`, `ping`, `stream` + pont `api.request`](#5-rpc--request-mutate-ping-stream--pont-apirequest)
6. [Duplex serveur→client : `register`/`notify`](#6-duplex-serveurclient--registernotify)
7. [Identité & découverte (`welcome`)](#7-identite--decouverte-welcome)
8. [Notices & refus de canal](#8-notices--refus-de-canal)
9. [Stats & inspecteur de frames](#9-stats--inspecteur-de-frames)
10. [Cadence adaptative (`adaptiveChannel`)](#10-cadence-adaptative-adaptivechannel)
11. [Liaisons de vue : socle agnostique `observe*`, hooks React, composables Vue](#11-liaisons-de-vue--socle-agnostique-observe--hooks-react)
12. [Gotchas](#12-gotchas)

---

## 1. Architecture en couches

Trois couches, séparées pour rester isomorphes (seule la dernière diffère client/serveur) :

```
RealtimeClient            ← la « socket » (orchestration : reconnect, heartbeat, stats,
  (IRealtimeSocket)          ref-count subscribe, identité, frameLog). RealtimeClient.ts:154
   └─ JsonRpcPeer         ← moteur protocole JSON-RPC 2.0 ISOMORPHE (classe une frame,
        (IRealtimePeer)      route, corrèle les id, gère erreurs). realtime/JsonRpcPeer.ts:280
         └─ IRealtimeTransport  ← LES OCTETS — seul maillon qui diffère. Front =
                                  BrowserWsTransport (wrap WebSocket). IRealtimeTransport.ts:34
```

- `RealtimeClient` **compose** un `JsonRpcPeer` (`RealtimeClient.ts:199`) et lui **délègue** tout le plan de contrôle (request/notify/stream/receive/register/erreurs/corrélation d'id). Il ne garde que le « client » : transport, reconnect, heartbeat, stats, ref-count, identité. `send` est déréférencé à chaque frame (pas `.bind`) → testable.
- Le transport est **injectable** (constructeur, 2ᵉ arg `RealtimeTransportFactory`, `RealtimeClient.ts:248`) → tests sans vrai socket ; défaut = `BrowserWsTransport`.
- `RealtimeClient` implémente `IRealtimeSocket` (`IRealtimeSocket.ts:122`) ET `IRealtimePeer` (`JsonRpcPeer.ts:233`) — le MÊME contrat qu'exposera une façade serveur. Du code écrit contre ces interfaces tourne des deux côtés.

Discrimination JSON-RPC (le cœur, `JsonRpcPeer.ts:315-375`) : le rôle d'une frame se lit sur `method`, PAS sur `id` —
`method`+`id` = **requête** entrante ; `method` seul = **notification** ; `id` sans `method` = **réponse** à une de nos requêtes sortantes.

---

## 2. Obtenir un client : `shared` / constructeur / `connect`

```ts
// Singleton PAR URL (recommandé) — RealtimeClient.ts:236
static shared(opts?: RealtimeOptions): RealtimeClient;

// Constructeur direct — RealtimeClient.ts:216
constructor(opts?: RealtimeOptions, transportFactory?: RealtimeTransportFactory);
```

`RealtimeClient.shared(opts)` renvoie **une seule instance par URL** (résolue en absolu, stockée sur `globalThis.__nfRealtime__`, `RealtimeClient.ts:268-278`) → plusieurs consommateurs d'une même page (app + debug bar) partagent **une seule socket WebSocket**. Les `opts` ne s'appliquent qu'à la 1ʳᵉ création. C'est la forme utilisée par le front (Studio `RootStore.ts:54`).

`RealtimeOptions` (`RealtimeClient.ts:82-93`) :

```ts
interface RealtimeOptions {
  url?: string; // défaut : wss?://<host>/nodefony/api/realtime (resolveUrl, :249)
  token?: string | null; // ajouté en ?token=… à l'URL (openSocket, :918)
  autoReconnect?: boolean; // défaut true
  reconnectDelay?: number; // backoff initial ms — défaut 1000
  reconnectDelayMax?: number; // backoff max ms — défaut 30000
  heartbeatInterval?: number; // ping ms — défaut 30000
}
```

Cycle de connexion (l'**app** en est maîtresse — connecter une fois au shell) :

```ts
await client.connect(url?);   // idempotent ; no-op si déjà connected/connecting (:304)
client.disconnect();          // logout : ferme (1000), annule les requêtes en vol, identité→null (:311)
```

`connect()` résout une fois `connected`. `disconnect()` est une fermeture **volontaire** : elle dispose le peer (rejette les requêtes en vol immédiatement plutôt que timeout) et remet `identity`/`serverChannels`/`serverMethods` à `null`.

---

## 3. État de connexion & reconnexion

```ts
type RealtimeState = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";  // :75
get state(): RealtimeState;                 // :266
get reconnectAttempts(): number;            // :271
get nextRetryAt(): number | null;           // ms epoch de la prochaine tentative, null hors backoff (:279)
retryNow(): void;                           // force une reco immédiate, annule le backoff (:287)
```

- **State machine** : `disconnected → connecting → connected → reconnecting → error`. Chaque transition émet l'event LOCAL `__state__` (`setState`, `:1289`).
- **Backoff exponentiel** (`scheduleReconnect`, `:986-1004`) : `delay = min(reconnectDelay × 2^(attempt-1), reconnectDelayMax)`. Émet l'event local `__reconnect__` `{ attempt, delay, nextRetryAt }` → l'UI peut afficher un compte à rebours.
- **Re-subscribe automatique** : à chaque (ré)ouverture, tous les canaux ref-comptés sont ré-émis au serveur (`openSocket` `:937-939`) — couvre le reconnect ET un `subscribe` appelé avant l'ouverture.
- **Heartbeat** : ping `{ ts }` toutes les `heartbeatInterval` ms tant que le transport est OPEN (`startHeartbeat`, `:1160`). Timer `unref` (n'empêche pas la sortie de process côté Node/test).
- **Sémantique des close codes** (RFC 6455 §7.4) : un code **définitif** (1000, 1002, 1003, 1007, 1008=401/403, 1010, 4004 privé Nodefony) **ne relance PAS** la reco (sinon un anonyme martèle un endpoint protégé) → état `error`, l'app doit agir (login) puis `connect()`/`retryNow()`. Les codes **transitoires** (1001 restart, 1006 perte réseau, 1011, code absent) relancent la reco. Décidé par `isReconnectableCloseCode` (`notice.ts:156`, set `FATAL_CLOSE_CODES` `:140`).

Limite assumée : une frame émise hors connexion (`send` quand le transport n'est pas OPEN) est **droppée** (pas de buffering offline, `RealtimeClient.ts:1245-1247`).

---

## 4. Pub/sub : `subscribe`/`unsubscribe`/`on`/`publish` (ref-comptage)

```ts
subscribe(channel): void;            // demande au serveur de pousser le canal (:423)
unsubscribe(channel): void;          // arrête (:434)
on(event, handler): () => void;      // BRANCHE un handler de réception ; renvoie un dispose (:329)
off(event, handler): void;           // (:340)
publish(channel, payload?): void;    // émet sur un canal (alias clair de emit) (:406)
emit(method, params?): void;         // notification one-way client→serveur (:384)
get subscribedChannels(): string[];  // canaux ≥ 1 consommateur (:447)
channel(name): IRealtimeChannel;     // handle par-canal {on,send,open,close} (:492)
```

**Distinction fondamentale** : `on(channel, h)` **REÇOIT** (branche le handler local) ; `subscribe(channel)` **DEMANDE** au serveur de pousser. Les deux sont nécessaires : `on` sans `subscribe` ne reçoit rien (le serveur ne pousse pas) ; `subscribe` sans `on` reçoit mais n'a aucun handler.

**Ref-comptage** (`_subscriptions: Map<channel, count>`, `RealtimeClient.ts:189`) : la notification réseau `subscribe`/`unsubscribe` n'est émise qu'aux **transitions 0↔1**. N consommateurs (hooks React + store) sur le même canal partagent **UN seul abonnement serveur** sans se couper l'un l'autre :

- `subscribe` : `count++` ; émet `subscribe` réseau **seulement** au 1ᵉʳ (`count === 1`, `:501`).
- `unsubscribe` : `count--` ; émet `unsubscribe` réseau **seulement** au dernier (`:438-440`).

C'est l'autorité unique partagée par `nodefony/react` ET un store applicatif (cf §11). `channel(name)` (`:613`) donne un handle objet par-canal (`on`/`send`/`open`/`close`, contrat `IRealtimeChannel` `IRealtimeSocket.ts:87`) — forme naturelle des canaux à état.

Convention de **cadence dans le nom du canal** (`channelRate.ts`) : `base` nu = cadence serveur par défaut ; `base:<ms>` = cadence explicite → 1 canal = 1 cadence = 1 ref-count.
`rateChannel(base, intervalMs?, defaultMs?)` (`:44`) fabrique le nom (réexporté par `nodefony/client` ET `nodefony/react`) ; `parseRate` (`:63`) / `isRateChannel` (`:75`) côté serveur.

---

## 5. RPC : `request`, `mutate`, `ping`, `stream` + pont `api.request`

```ts
// Deux formes (overloads, RealtimeClient.ts:562-600) :
request<T>(path: `/${string}`, timeoutMs?): Promise<T>;          // forme PATH → pont api.request (lecture GET)
request<K, T>(method: K, params?, timeoutMs?): Promise<…>;       // forme RPC JSON-RPC classique
```

- **Forme RPC** : `request("kernel:ping", params, timeout)` → requête JSON-RPC corrélée, Promise résolue avec `result`, rejette avec `RpcError` sur `error`/timeout (défaut 30000 ms).
- **Forme PATH** (« API souveraine » : 1 action controller = N transports) : un argument commençant par `/` est détecté au runtime (charCode 47, `:724`) et réécrit en méthode `api.request` avec `params = { path }`. Le 2ᵉ argument devient alors le **timeout**. Exemple :
  ```ts
  const modules = await socket.request("/nodefony/kernel/api/modules");
  // = la même action controller que le GET REST, via la socket.
  ```
  Échec → `RpcError` dont `data.status` porte le statut HTTP équivalent (404 path inconnu, 403 refus…). Un path commence toujours par `/`, une méthode JSON-RPC jamais → zéro collision.

### `mutate` — écriture idempotente

```ts
mutate<T>(path: `/${string}`, init: {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  idempotencyKey: string;          // OBLIGATOIRE
  timeoutMs?: number;              // défaut 30000
}): Promise<T>;                    // RealtimeClient.ts:616
```

Pendant **écriture** de `request` (qui ne fait que des GET). Transporte la méthode HTTP logique + le corps + une **clé d'idempotence obligatoire** : une socket reconnecte et peut rejouer une frame en vol → la clé dédoublonne le rejeu (anti double-effet) côté serveur. Échec → `RpcError` (`data.status` : 400 clé absente, 409 rejeu concurrent, 403 refus, 404 path inconnu…).

```ts
await socket.mutate("/nodefony/security/api/apikeys/42/revoke", {
  method: "POST",
  idempotencyKey: crypto.randomUUID(),
});
```

### `ping` — RTT

```ts
ping(timeoutMs = 5000): Promise<KernelPingResult & { rtt: number }>;   // RealtimeClient.ts:645
// KernelPingResult (:145) = { pong: true; ts; uptime; pid; version? }
```

Helper réutilisable (topbar, debug bar) : mesure le round-trip via la méthode RPC standard `kernel:ping` (convention : tout endpoint realtime y répond). `rtt` = aller-retour mesuré côté client (ms).

### `stream` — réponse en chunks

> **Pas de streaming RPC.** Une action rend UNE valeur ; il n'existe aucune frame de fragment.
> Pour une réponse qui progresse (LLM token par token, export long) : motif **« travail + canal »**
> — l'action accuse réception, la progression arrive sur un canal `subscribe`.

### Erreur RPC

`RpcError` (réexportée par `nodefony/client`, `JsonRpcPeer.ts:66-79`) : `{ message, code, data? }`. `code`/`data` préservés de bout en bout — un appelant discrimine un 404 d'un refus voter via `e.data.status` sans parser le message :

```ts
try { await socket.request("/nodefony/x"); }
catch (e) { if (e instanceof RpcError && (e.data as any)?.status === 404) … }
```

---

## 6. Duplex serveur→client : `register`/`notify`

Le client expose la surface bidirectionnelle isomorphe (`IRealtimePeer`) — un serveur peut le `request` (duplex réel serveur→client).

```ts
register<K>(method, handler): void;     // expose une action appelable PAR LE SERVEUR (:713)
unregister<K>(method): void;            // (:721)
get methods(): string[];                // actions exposées par CE client (découverte) (:726)
notify<K>(method, params?): void;       // notification sortante typée (:687)
receive(frame): JsonRpcFrameKind;       // ingestion d'une frame entrante déjà parsée (:735)
dispose(reason?): void;                 // annule les requêtes sortantes en attente (:743)
```

Sans handler `register`, une requête entrante reçoit `-32601` (method not found). Avec, le `result` repart au serveur (confirmation d'action, invalidation de cache poussée, health serveur→client). Côté protocole, un handler qui throw renvoie `-32603` générique au pair (Zero Trust) sauf s'il lève une `RpcError` (alors `code`/`message`/`data` sont exposés volontairement) — `JsonRpcPeer.ts:419-461`.

---

## 7. Identité & découverte (`welcome`)

```ts
get identity(): RealtimeIdentity | null;          // :459 — null tant que pas de welcome
get serverChannels(): readonly string[] | null;   // canaux annoncés par le serveur (:464)
get serverMethods(): readonly string[] | null;    // actions RPC annoncées (:469)
onIdentity(handler: (id: RealtimeIdentity | null) => void): () => void;  // event local __identity__ (:481)
```

Le serveur pousse `realtime:welcome` en **1ʳᵉ frame** après le handshake (`IRealtimeWelcome`, `RealtimeEventMap.ts:204`). Le client l'ingère (`ingestWelcome`, `:957`) : mémorise l'identité résolue + les capabilities (canaux/actions découvrables) puis émet `__identity__`. `identity` est `null` tant qu'aucun welcome n'est reçu ; une fois reçu, un anonyme a `authenticated: false` (jamais `null`).

`RealtimeIdentity` (`RealtimeEventMap.ts:127-138`) : `{ type, authenticated, userIdentifier, roles, scopes }`. Brique du gating front : `authenticated:false` → écran login **sans** route `/auth/me`. Les `roles` sont **résolus serveur** (cf RBAC isomorphe, [`isomorphic.md`](./isomorphic.md) §6). Rafraîchie à chaque (re)welcome ; remise à `null` au `disconnect()` volontaire (une perte réseau garde la dernière identité jusqu'au prochain welcome → évite un flash login pendant une micro-reco).

---

## 8. Notices & refus de canal

```ts
onNotice(handler: (n: NodefonyNotice) => void): () => void;    // criticités temps réel normalisées (:359)
onDenied(handler: (d: IRealtimeDenied) => void): () => void;   // refus d'un canal précis (:379)
```

- `onNotice` : flux de **notices normalisées** (`NodefonyNotice` `notice.ts:20` = `{ level, title?, message, source, code?, ts }`). Le client interprète les close codes RFC 6455 (`closeCodeToNotice`, `notice.ts:67` — `null` pour 1000/1001, pas de bruit), les erreurs serveur poussées, et émet une notice `success` au rétablissement de connexion. Brancher un centre de notifications (snackbar) — monter **une seule fois** (shell) pour ne pas dupliquer les toasts.
- `onDenied` : refus d'abonnement/push poussé par le serveur (`realtime:denied`, `IRealtimeDenied` `RealtimeEventMap.ts:228` = `{ channel, reason }`). Réaction CIBLÉE par canal (griser un contrôle). Le motif est **générique** (`"forbidden"`) — le serveur ne révèle jamais le rôle/scope manquant (pas d'oracle). Émet AUSSI une notice via `onNotice`.

---

## 9. Stats & inspecteur de frames

```ts
get framesReceived(): number;                       // total notifications reçues (:750)
get lastFrameAt(): number | null;                   // ms (:755)
get lastFrameMethod(): string | null;               // (:760)
getStats(): MessageStats[];                          // snapshot par canal — refs internes, à LIRE (:766)
getChannelStats(method): MessageStats | undefined;  // (:771)
get frameLog(): readonly RealtimeFrame[];           // ring des dernières frames, redactées (:1027)
clearFrameLog(): void;                               // (:1034)
```

- `MessageStats` (alias de `IChannelStats`, `IRealtimeSocket.ts:64`) = `{ method, msgCount, lastMessage, rate, series }`. Le débit `rate` (msg/s) + la `series` (VU-mètre, 32 points) sont échantillonnés **1×/s** (`startStatsSampler`, `:1028`, timer `unref`), puis l'event local `__stats__` est émis pour les consommateurs réactifs.
- `frameLog` : ring ALWAYS-ON des `FRAME_LOG_MAX = 300` dernières frames (`:134`), **redactées** (clés sensibles `token|password|secret|api_key|authorization|bearer` → `[redacted]`, `FRAME_REDACT_RE` `:137`). Coût à l'écriture = 1 push de réf brute ; construction + redaction **différées** à la lecture (ou au live `__frame__` si la console écoute). → l'inspecteur « retrace l'instant » dès l'ouverture, sans démarrer à vide.

Events LOCAUX (jamais réseau, branchables via `on`) : `__state__`, `__identity__`, `__notice__`, `__denied__`, `__reconnect__`, `__stats__`, `__frame__`, `*` (wildcard : handler reçoit `(method, params)`).

---

## 10. Cadence adaptative (`adaptiveChannel`)

```ts
adaptiveChannel(base: string, handler: RealtimeHandler, options: BindAdaptiveOptions): AdaptiveChannelBinding;  // :533
```

Abonne un canal d'**ÉTAT** (latest-wins : stats, supervision) en **cadence adaptative AIMD client-driven** (`AdaptiveRate.ts`) — pendant exact de l'ABR vidéo / du contrôle de congestion TCP : si les frames arrivent plus lentement que demandé (famine), la lib se ré-abonne à une cadence plus **grossière** (`1s→2s→5s`, Multiplicative Decrease immédiate) ; quand c'est sain durablement, elle remonte **doucement** (Additive Increase après N échantillons), avec bande morte anti-flip-flop. Aucun changement serveur (la cadence vit dans le nom du canal, §4).

`BindAdaptiveOptions` (`AdaptiveRate.ts:200`) : `intervalMs` (requis, cadence désirée la plus fine) + `defaultMs?`, `ladder?`, `starvationFactor?` (1.8), `healthyFactor?` (1.25), `recoveryWindow?` (4), `maxMs?` (60000), `enabled?` (true ; `false` = mode fixe, 0 watchdog), `onRate?(ms, reason)`, `clock?`, `scheduler?`.
`AdaptiveChannelBinding` (`:216`) : `{ intervalMs, channel, dispose() }`.

⚠️ Réservé aux canaux d'**ÉTAT** (décimer est sans perte). PAS pour les canaux d'**événements** (syslog, frames) où chaque item compte (eux se batchent, pas se décimer).

---

## 11. Liaisons de vue : socle agnostique `observe*`, hooks React, composables Vue

### 11.1 Le socle — `nodefony/client`, pour les QUATRE fronts

Souscrire à un canal, tenir une dernière valeur, borner un journal, filtrer par sévérité, se désabonner : **rien de cela n'appartient à un framework de vue**. Ces règles vivent dans `src/client/realtime/observe.ts` et sont consommées à l'identique par React, Vue, Angular, Svelte — et par les quatre gabarits d'application.

Une liaison ne contient QUE la traduction _rappel + libération → réactivité locale_ (`useState`, `ref`, `signal`, rune). Tout le reste est une recopie qui divergera.

```ts
// Cycle de connexion — la seule fonction qui fabrique/adopte une socket.
function connectShared(opts: { url?: string; client?: RealtimeClient }): {
  socket: RealtimeClient;
  owned: boolean; // false = socket FOURNIE par l'app : son cycle ne se touche pas
  start(): void; // connect() idempotent, rejet AVALÉ ; jamais de disconnect()
};

// Forme UNIQUE de tous les observateurs : `emit` reçoit la valeur COURANTE à la
// souscription, puis chaque changement ; le retour libère tout.
type Dispose = () => void;
observeState(client, emit: (s: RealtimeState) => void): Dispose;
observeIdentity(client, emit: (i: RealtimeIdentity | null) => void): Dispose;
observeReconnect(client, emit: (i: RealtimeReconnectInfo) => void): Dispose; // ÉVÉNEMENT : rien de rejoué
observeChannel(client, channel, emit: (payload: unknown) => void): Dispose;
observeChannelData<T>(client, channel, emit: (v: T | null) => void, initial?): Dispose; // dernier gagne
observeChannelStats(client, channel, emit: (s: MessageStats | null) => void): Dispose;
observeAdaptiveChannel(client, base, emit, desiredMs, opts?): AdaptiveChannelBinding;
observeSyslog(client, emit: (entries: unknown[]) => void, opts?): Dispose; // coalescé + anneau 500 + filtre
observeNotices(client, emit: (n: NodefonyNotice) => void): Dispose;
observeNoticeLog(client, emit: (n: NodefonyNotice[]) => void, opts?): Dispose; // anneau 50 + filtre source
adaptiveRebindKey(base, desiredMs, enabled?): string; // les 3 SEULES valeurs qui refont l'abonnement
```

Un écran non-React s'écrit donc en trois lignes, dans n'importe quel framework :

```ts
const live = connectShared({ url: "/api/live/realtime" });
const off = observeChannelData<Evenement>(live.socket, "live:events", (e) =>
  setDernier(e),
);
live.start(); // au démontage : off() — surtout PAS live.socket.disconnect()
```

**Événements locaux** : `LOCAL_EVENTS` (`client/realtime/localEvents.ts`) est la source unique des six noms `__…__` ; les portes publiques sont `onState`/`onIdentity`/`onStats`/`onNotice`/`onDenied`/`onReconnect`. Écrire `on("__state__", …)` en clair est refusé par un gate (`tests/clientObserve.test.ts`), gabarits compris — ils avaient déjà divergé.

### 11.2 Les hooks React `nodefony/react`

Bindings React **fins et composables** (un hook = une responsabilité), tous préfixés `useNodefony*` — de **minces enveloppes** sur le socle ci-dessus, sans une règle en propre. `react` est une peerDep **optionnelle** ; aucun JSX dans le Core (provider via `createElement`). Source : `src/client/react/index.ts`.

Le Provider porte le cycle de connexion (`connectShared`) ; les hooks ne gèrent QUE l'abonnement aux canaux (subscribe/unsubscribe ref-comptés + re-subscribe au reconnect — autorité dans le client, §4).

```ts
// Montage (une fois, au shell). `url` = voie SIMPLE (le Provider fabrique et
// connecte la socket partagée) ; `client` = voie AVANCÉE, l'emporte sur `url`,
// et son cycle n'est pas touché.
function NodefonyProvider(props: {
  url?: string;
  client?: RealtimeClient;
  children?: ReactNode;
}): ReactElement;

// Le client brut (échappatoire avancée ; référence stable, pas de re-render) — :67
function useNodefony(): RealtimeClient; // throw hors <NodefonyProvider>

// État de connexion (useSyncExternalStore → re-render au seul changement d'état) — :87
function useNodefonyState(): RealtimeState;

// Identité résolue serveur (welcome) ; null avant 1er welcome — :104
function useNodefonyIdentity(): RealtimeIdentity | null; // { authenticated, roles, userIdentifier, scopes, type }

// S'abonner à un canal : onMessage à chaque message (handler capturé par ref → peut changer
// sans re-bind ; passer `deps` si le canal effectif dépend d'autres valeurs) — :120
function useNodefonyChannel(
  channel: string,
  onMessage: (payload: unknown) => void,
  deps?: DependencyList,
): void;

// Dernière valeur reçue sur un canal (cas le plus courant : dernière mesure) — :148
function useNodefonyChannelData<T = unknown>(
  channel: string,
  initial?: T | null,
): T | null;

// Variante cadence adaptative (AIMD) — renvoie la cadence effective (ms) pour un badge — :182
function useNodefonyAdaptiveChannel(
  base: string,
  onMessage: (p: unknown) => void,
  desiredMs: number,
  opts?: AdaptiveChannelHookOptions,
  deps?: DependencyList,
): number;
// + dernière valeur — :221
function useNodefonyAdaptiveChannelData<T = unknown>(
  base: string,
  desiredMs: number,
  opts?: AdaptiveChannelHookOptions,
  deps?: DependencyList,
): { data: T | null; intervalMs: number };

// Stats live d'un canal (débit, série VU-mètre, total ; échantillonné 1×/s) — :253
function useNodefonyChannelStats(channel: string): ChannelStatsSnapshot | null;
//   ChannelStatsSnapshot = { msgCount, lastMessage, rate, series }  (:239)

// Flux syslog prêt à l'emploi : ring borné + filtre sévérité (gère le format coalescé { logs[] }) — :284
function useNodefonySyslog(opts?: {
  max?: number;
  severities?: string[];
  channel?: string;
}): unknown[];
//   défauts : max=500, channel="syslog:stream"

// Notices normalisées (snackbar) — monter UNE fois (shell) — :320
function useNodefonyNotifications(
  onNotice: (n: NodefonyNotice) => void,
  deps?: DependencyList,
): void;
// Ring borné des dernières notices, filtrable par source — :345
function useNodefonyNoticeLog(opts?: {
  max?: number;
  sources?: NodefonyNotice["source"][];
}): NodefonyNotice[];

// Réexportés ici aussi (fabriquer un canal cadencé depuis le même subpath) — :31
export { rateChannel, parseRate, isRateChannel };
```

Détails d'implémentation utiles :

- `useNodefonyState` / `useNodefonyIdentity` utilisent `useSyncExternalStore` (snapshot primitif/stable, pas de tearing en mode concurrent). `useNodefonyChannelStats` est en `state`+effet (le snapshot est un objet recréé → la stabilité de réf requise par le store externe ne tiendrait pas).
- `useNodefonyChannel` : le `handler` est capturé via `useRef` → il peut changer à chaque render **sans** re-déclencher l'abonnement ; seuls `client`, `channel` et `deps` re-bindent.
- `useNodefonyAdaptiveChannel` re-bind seulement si `base`, `desiredMs`, `enabled` ou `deps` changent (handler + opts capturés par ref). `AdaptiveChannelHookOptions = Omit<BindAdaptiveOptions, "intervalMs" | "onRate">` (`:158`).

Exemple consommateur réel (Studio) : `App.tsx:12` importe `NodefonyProvider` depuis `nodefony/react`, monté `App.tsx:278` au-dessus du shell avec `client={rootStore.realtime}` (client `RealtimeClient.shared`).

### 11.3 Les composables Vue `nodefony/vue`

**Même surface, mêmes noms, mêmes garanties que React** — traduite dans la langue de Vue, pas recopiée. Source : `src/client/vue/index.ts`. Page publiée : `src/nodefony/docs/vue-composables.md`.

```ts
// La politique s'installe en PLUGIN (le vocabulaire de Vue), pas en composant
// enveloppant. `url` = voie simple ; `client` = voie avancée, l'emporte, cycle
// non touché. Sans l'un des deux : refus (le framework ne devine aucune adresse).
app.use(nodefonyVue, { url: "/api/live/realtime" });

useNodefony(): RealtimeClient;                                   // throw hors plugin
useNodefonyState(): Readonly<Ref<RealtimeState>>;
useNodefonyIdentity(): Readonly<Ref<RealtimeIdentity | null>>;
useNodefonyChannel(canal: MaybeRefOrGetter<string>, onMessage): void;
useNodefonyChannelData<T>(canal: MaybeRefOrGetter<string>, initial?): Readonly<Ref<T | null>>;
useNodefonyAdaptiveChannel(base, onMessage, desiredMs, opts?): Readonly<Ref<number>>;
useNodefonyAdaptiveChannelData<T>(base, desiredMs, opts?): { data, intervalMs };
useNodefonyChannelStats(canal): Readonly<Ref<MessageStats | null>>;
useNodefonySnapshot(): Readonly<Ref<SocketSnapshot | null>>;     // aussi ajouté à React
useNodefonySyslog(opts?): Readonly<Ref<unknown[]>>;
useNodefonyNotifications(onNotice): void;
useNodefonyNoticeLog(opts?): Readonly<Ref<NodefonyNotice[]>>;
export const nodefonyClientKey: InjectionKey<RealtimeClient>;    // provide() manuel d'un sous-arbre
```

Trois règles que Vue impose et que React ne montre pas — les rater ne casse rien tout de suite :

1. **Le client est `markRaw`.** Dans un `ref()`/`reactive()`, il serait proxifié : égalités de référence cassées, interception à chaque accès. Une page marche parfaitement avec un client proxifié, jusqu'au jour où une comparaison d'identité échoue.
2. **La libération passe par `onScopeDispose`**, pas `onUnmounted` : seul le premier couvre une portée créée hors composant (`effectScope()`). **Un abonnement qui fuit ne se voit pas à l'écran** — seul le compte des trames `subscribe`/`unsubscribe` le dit (c'est ce que compte `src/tests/clientVue.test.ts`).
3. **Hors portée, le composable LÈVE** au lieu de fuir en silence, et le message nomme le remède.

Les arguments « canal » et « cadence » sont des `MaybeRefOrGetter` : l'abonnement suit la valeur (ancien libéré avant nouveau pris). C'est ce qui remplace, en Vue, la liste `deps` que React doit se faire passer à la main.

Angular (#38) et Svelte (#39) n'ont pas encore leur liaison : leurs vitrines consomment le socle en direct, et la sentinelle `vitrinesCommunes.test.ts` porte la table qui dit où en est chaque front.

---

## 12. Gotchas

- **`on` ≠ `subscribe`** : `on(channel, h)` reçoit, `subscribe(channel)` demande au serveur. Il faut les DEUX (les hooks `useNodefonyChannel*` font les deux pour toi).
- **`mutate` : `idempotencyKey` obligatoire** — l'omettre = 400 serveur (anti double-effet sur rejeu de socket). Utiliser `crypto.randomUUID()` par mutation.
- **Forme PATH de `request`** : le 2ᵉ argument est le **timeout** (pas des params) ; seul un path GET passe par là (`request("/x", 5000)`). Pour passer un body → `mutate`.
- **Réponse mémorisée ≠ replay d'un `render` manuel** (côté serveur idempotence) : la valeur rejouée est la valeur RETOURNÉE par l'action.
- **`onNotice`/`useNodefonyNotifications` : monter une seule fois** (shell) sinon toasts dupliqués.
- **Canaux d'événements ≠ cadence adaptative** : ne JAMAIS `adaptiveChannel`/`useNodefonyAdaptiveChannel*` sur syslog/frames (chaque item compte) — réservé aux canaux d'ÉTAT latest-wins.
- **Pas de buffering offline** : une frame émise hors connexion est droppée (`RealtimeClient.ts:1245`).
- **`disconnect()` ≠ perte réseau** : volontaire → identité `null` (login) + requêtes en vol rejetées ; perte réseau → identité conservée + reco (selon close code, §3).
- **Close code fatal (1008=401/403, 4004…) ne relance pas la reco** → état `error` ; l'app doit corriger (login) puis `connect()`/`retryNow()`.
