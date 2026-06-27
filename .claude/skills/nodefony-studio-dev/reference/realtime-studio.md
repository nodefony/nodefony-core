# Référence — Realtime Studio (canaux · hub UI · log protocole · patron sondes)

> Le temps réel est **le différenciateur** Nodefony. Les **mécanismes généraux** de la socket client
> (`RealtimeClient`, ref-comptage, pont `api.request`, reconnexion) vivent dans **`nodefony-frontend-dev`**
> (`reference/realtime-client.md`) — ne pas les redocumenter ici. CE fichier = la part **Studio** :
> canaux servis, hub UI, log de protocole, et le PATRON observabilité (sondes back + abonnement hub).

## Sommaire

- 1. Canaux realtime Studio (ajouter un canal, canaux santé génériques)
- 2. Actions (requête→réponse) côté Studio
- 3. Invariant socket partagée (rappel — détail dans frontend-dev)
- 4. Log protocole (inspecteur de frames)
- 5. Hub (UI)
- 6. 🎯 PATRON Studio = sondes back + abonnement hub

## 1. Canaux realtime Studio

Architecture : WS JSON-RPC 2.0 `WS /nodefony/studio/api/realtime` (`StudioRealtimeController`) ⇄
`RealtimeClient` (Core, `nodefony`). Pub/sub PAR CANAL on-demand ; providers serveur
**transport-agnostiques** (`nodefony/realtime/providers.ts`).

**Ajouter un canal realtime** :

1. Serveur : un provider qui `publish(channel, payload)` (cf `createSyslogBridge`/`createStatsTicker`) ;
   le `StudioRealtimeController` le démarre au `subscribe`, `dispose()` au `unsubscribe` + `onFinish`.
2. Client : **s'abonner = ref-compté** via `useNodefonyChannel("<canal>", handler)` (page) ou
   `useNodefonyChannelData/Stats` ; le client ré-abonne seul au reconnect.

**Canaux SANTÉ génériques (broker ticker)** : `orm:health`/`orm:flow`/**`realtime:health`** sont poussés par
`createBrokerTicker(() => fetchAdminEndpoint(broker, ns, path), …)` → Studio reste générique (0 dép au module
producteur). Le **canal `realtime:health`** = sonde de **la Socket Nodefony** (`RealtimeHub.probe`, exposé côté
back via `nodefony-framework-dev`) : `{channels[{channel,subscribers,messages}], publish/fanoutTotal,
connectionCount, bytes/messagesSentTotal, backpressure{max/totalBufferedAmount, slowConsumers}}`. Endpoint 1ᵉʳ
paint = `GET /nodefony/realtime/api/health`. Panneau « Hub » = KpiCard canaux/abonnés/fan-out + MiniChart débit

- **jauge backpressure** (bufferedAmount max/total + slow-consumers).

> ⚠️ **Le débit/s se DÉRIVE** des snapshots (delta `total`/`ts`) dans un **store sampler** (comme les stats
> realtime), **PAS** en `setInterval` React. Nommage « la Socket Nodefony » (majuscule = concept).

## 2. Actions (requête→réponse, ≠ pub/sub) — direction CONTRÔLE

- Une frame **avec `id`** attend une réponse `result`/`error` (boutons « reconnecter / vacuum / purger / Force GC »).
  Front : `const r = await conn.request<T>("kernel:ping", params)` (Promise id-matchée, timeout 30 s) ; helper
  réutilisable `conn.ping()` (RTT). Le `realtime:welcome` annonce `params.methods` → **actions découvrables**.
- Côté serveur : le controller étend **`RealtimeController`** (framework) et déclare `realtimeActions()`
  (`kernel:ping`/`kernel:gc`). Inconnu → `-32601` ; throw → `-32603` générique. **Pour ajouter une action serveur
  → skill `nodefony-framework-dev`.** Le générique (protocole, RTT) vit dans la lib/le framework, PAS dupliqué front.

**Architecture « la socket Nodefony »** (north-star) : `RealtimeHub` (broker serveur) = lien fusionnel isomorphe ;
sous lui Endpoint(`IRealtimePeer`) > Peer(`JsonRpcPeer`) > Transport(`IRealtimeTransport`, seul seam). `RealtimeClient`
et `StudioRealtimeController` composent le MÊME peer. Front = consommateur du hub → hooks/stores, ne touche jamais le
protocole.

## 3. Invariant socket partagée (rappel)

> Mécanisme **général** → détail dans `nodefony-frontend-dev` (`reference/realtime-client.md`). Rappel des points
> qui mordent en Studio :

- **1 SEULE socket par origine** : `RealtimeClient.shared({url})` (singleton par URL sur `globalThis`, scheme
  normalisé ws/wss). Studio (`RootStore`) ET la debug bar l'utilisent → pas 2 connexions.
- **TOUS les consommateurs ref-comptent** (`client.subscribe`/`useNodefonyChannel`/`conn.subscribe`) — **JAMAIS**
  de raw `client.emit("subscribe")` : sur le client partagé, un `unsubscribe` (ref→0) coupe le canal pour TOUS.
- Un consommateur MobX (store) **initialise son état depuis `client.state`** au montage : la socket peut être DÉJÀ
  ouverte (barre montée avant) → sinon on rate l'event « connected » passé.

## 4. Log protocole (inspecteur de frames)

- `RealtimeClient` garde un **ring always-on bon marché** : `recordFrame` ne pousse qu'une réf brute
  `{ts,dir,msg}` ; la construction + **redaction des secrets** sont DIFFÉRÉES à la lecture
  (`get frameLog`) ou au live (`__frame__`, émis seulement si un listener écoute). → la console
  « retrace l'instant » dès l'ouverture (seed depuis `frameLog`), sans surcoût hors console.
- Côté UI : payload stringifié **uniquement à l'ouverture** d'une ligne (pas 300 `Collapse`/stringify),
  **cap ~150 lignes rendues** (ring = 300), uptime isolé (`<SessionUptime>`) pour ne pas re-render la
  liste chaque seconde. Payload affiché en TEXTE (jamais d'HTML).

## 5. Hub (UI)

Source unique `components/RealtimeHubContent.tsx` (carte connexion + stats + VU-mètres par canal + couper),
réutilisée dans :

- **HoverCard du chip topbar** = aperçu live des abonnements de la PAGE COURANTE (la vraie vision par
  page, sans la quitter) ; le chip **navigue** (clic) → **plus de drawer**.
- **Console `/nodefony/hub`** (« Realtime Hub ») = plein écran : KPIs + abonnements (Protocole/Transport/
  peer, forward-compat SIP/UDP/TCP) + log protocole. La console **s'auto-abonne** aux canaux standard
  → toujours vivante. Box stable = `tabular-nums` + `nowrap` (sinon saute à chaque message).

## 6. 🎯 PATRON Studio = Sondes back + Abonnement hub (observabilité/contrôle temps réel)

> **Le modèle de TOUT panneau Studio d'observabilité.** Studio = console de **contrôle temps réel** de chaque
> sous-système (ORM, http, sécurité, agents IA…), PAS un dashboard statique.

**Les 5 pièces (à répliquer par module) :**

1. **Sondes riches côté back** — interface `I<X>Probe` + méthode **optionnelle** `probe(): Promise<I<X>Probe>`
   sur le service/adapter → métriques profondes module-spécifiques. Best-effort (jamais throw, **jamais de
   credential**). Ex ORM : latence (fenêtre glissante min/moy/max), cycle de vie (connexions/reconnexions/
   erreurs/uptime), stockage (SQLite PRAGMA size/journal/freelist), pool (Mongo).
2. **Moniteur générique lazy** process-wide (ex `ConnectionMonitor`) branché sur les **template methods**
   du cycle de vie (`Orm.connect`) → capture latence/erreurs/reconnexions. Alloc **lazy** (`null` par défaut,
   ring borné), **per-instance** (cloud-native).
3. **Fonction `build<X>Health()` réutilisable** dans le module → exposée par un **endpoint data plane**
   `/nodefony/<module>/api/<x>/health` ET poussée par un **provider ticker** realtime (transport-agnostique,
   `publish`, `dispose()` au unsubscribe + `onFinish`, `setInterval` unref).
4. **Studio reste GÉNÉRIQUE** : le provider realtime invoque l'endpoint admin **via le broker**
   (`this.get<IAdminBroker>("adminBroker")` → `broker.list()`→producer `adminNamespace`→
   `endpoint.handler({params:{},query:{},roles:[]})`), **PAS de dép directe au module** (philosophie IAdminApi).
5. **Front** : abonnement **conditionnel** (switch « Temps réel ») via **montage/démontage** d'un petit
   composant qui appelle `useNodefonyChannel("<module>:health", onData)` (ref-compté → unsubscribe auto au
   démontage) ; fallback `useResource` HTTP pour le 1ᵉʳ paint + bouton « Tester » (one-shot).

**Subtilité CSS = voir CE QUI BOUGE dans les cartes** (pas juste un point on/off) : **flash léger** sur les
valeurs qui changent (re-clé sur la valeur → l'animation CSS rejoue : `key={String(v)}` + classe `nf-flash`
`@keyframes` background bref). + point pulsant on/off près du switch. Style injecté **une fois**
(`document.createElement("style")` gardé par flag), hover/anim en CSS pur (0 re-render).

**Cloud-native** : `instanceId`=pid stampé ; per-instance, vue multi-pod = Prometheus / fan-out Redis.
NE PAS agréger dans le process.

**« Contrôle total »** : pas que de la lecture → aussi des **actions** (boutons : reconnecter, vacuum,
purger…) sur le même canal/data-plane (DEV-ONLY + RBAC `ROLE_NODEFONY_ADMIN`).
