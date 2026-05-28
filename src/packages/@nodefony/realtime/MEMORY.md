# MEMORY.md — @nodefony/realtime

Purpose: couche realtime serveur Nodefony (hub WS, JSON-RPC 2.0, backplane cluster).

## Core Components (cible après rapatriement P13.0)

- **`RealtimeHub`** (server) — broker fan-out canaux PARTAGÉS, 1 par pod. Sonde `probe()`.
- **`RealtimeController`** (server, base class) — controllers WS extends ceci. Décorateurs `@RealtimeController`/`@RealtimeEvent` à coder (P13.8).
- **`RealtimeAdminApi`** (server) — endpoint `/nodefony/realtime/api/health` + canal `realtime:health`.
- **`IBackplane`** (contrat) — 4 impls : `LoopbackBackplane` (mono), `ClusterBackplane` (IPC), `RedisBackplane` (P13.5), `KafkaBackplane` (P13.6).
- **`RealtimeError`** — base error (code + context). ✅ livré.
- **`JsonRpcPeer`** = reste dans **core** (isomorphe). Le serveur le consomme via subpath `nodefony/realtime`.

## Vocabulaire figé (12 mots, ANALOGIE PHYSIQUE)

- **Socket** = prise murale = `IRealtimeSocket` (handle code applicatif)
- **Hub** = autocom = `RealtimeHub` (broker serveur)
- **Peer** = combiné = `JsonRpcPeer` (parle JSON-RPC 2.0)
- **Transport** = câble = `IRealtimeTransport` (WS / long-polling / TCP/UDP/Unix)
- **Frame** = enveloppe = message JSON-RPC 2.0
- **Channel** = conférence téléphonique = nom de canal (`chat:room-42`)
- **Fan-out** = ventilateur = 1 entrée → N abonnés
- **Backplane** = fond de panier rack = `IBackplane` (cross-pod)
- **Dispatch** = aiguillage = `JsonRpcPeer.dispatch(frame)`
- **AIMD** = régulateur TCP-style = cadence client auto
- **Sonde** = oscilloscope = `IRealtimeProbe.probe()`
- **Seam** = point de greffe = hook pour couche supérieure (security)

## Config DEFAULTS (cible, builder P13.4)

```ts
defineRealtimeConfig({
  backplane: "loopback", // "loopback" | "cluster-ipc" | "redis" | "kafka" | IBackplane custom
  hub: {
    maxBufferedAmount: 1_048_576, // 1MB par peer (backpressure)
    pingIntervalMs: 30_000,
    adaptiveCadence: true, // AIMD ON
  },
  probe: { enabled: true, sampleEveryMs: 5_000 },
});
```

## Pipeline (cycle de vie d'une frame en cluster — cas 2 pods)

```
Alice (pod A) → WS → JsonRpcPeer.dispatch (seam #1 beforeDispatch)
  → ChatController.onMessage → RealtimeHub.publish
  → fan-out LOCAL pod A + IBackplane.publish(originPodId=A)
  → réseau (Redis / Kafka / IPC) → IBackplane pod B reçoit
  → filtre anti-écho (originPodId == B ?) → RealtimeHub pod B
  → fan-out LOCAL → JsonRpcPeer envoie sur WS Bob
  → Bob.on receives
```

Alice/Bob ne savent PAS qu'ils sont sur des pods différents. Seul `IBackplane` sait.

## Behaviors

- **Canaux PARTAGÉS** : 1 provider par canal par pod (ref-counté). Re-subscribe à `onopen`.
- **Fan-out local** : appel synchrone à tous les peers locaux abonnés.
- **Filtre anti-écho** : chaque message porte un `originPodId` ; le backplane ne renvoie pas à l'expéditeur.
- **AIMD** : cadence par canal (`subscribe(base, {intervalMs})` ou suffixe `:<ms>`) auto-ajustée sur backpressure observé.
- **Sonde** : tick `sampleEveryMs` pousse `realtime:health` (KPI : abonnés/canal, fan-out/s, `slowConsumers`, `bufferedAmount`).

## Gotchas

- **NE PAS** créer 2 instances de `RealtimeClient` sur la même URL côté navigateur — utiliser `RealtimeClient.shared({url})` (singleton par URL sur `globalThis`).
- **NORMALISER `http(s)→ws(s)`** dans la clé `shared()` ET dans `new WebSocket(...)` : une URL relative hérite du scheme `https` → si non normalisée, 2 instances + `WebSocket("https://…")` throw.
- **Init depuis `client.state`** côté consommateur de socket partagée : la socket peut être DÉJÀ ouverte (event "connected" déjà passé) → sinon hub affiche "disconnected" à tort.
- **Frame ring lazy** : `__frame__` n'est émis que si un listener écoute → 0 surcoût hors console ouverte. Secrets redactés via `redactFrame`.
- **Tests cluster sans infra** : utiliser `ClusterBackplane` + `node:cluster` natif → 2+ workers, validation fan-out cross-process sans Redis.
- **Tests cluster Redis/Kafka** : `testcontainers-node` (peerDep dev à ajouter en Bloc B).

## API Studio (cible — surfacée dans `/nodefony/documentation`)

- `GET /nodefony/realtime/api/health` → IRealtimeHealth (snapshot)
- Canal `realtime:health` → push tick `sampleEveryMs` (sonde)
- Page Studio Hub (existante) consomme déjà via broker

## Tests (convention vitest — cf `feedback_test_framework_vitest`)

- `npm test` → vitest run (unit + intégration)
- `npm run coverage` → vitest run --coverage (provider v8, reports `.coverage/`)
- 0 test pour l'instant — les tests `RealtimeHub.test.ts`, `RealtimeController.test.ts`, `ClusterBackplane.test.ts` seront rapatriés depuis `@nodefony/framework/nodefony/tests/unit/` en P13.0
