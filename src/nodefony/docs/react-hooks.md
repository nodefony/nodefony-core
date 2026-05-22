---
module: "@nodefony/core"
topic: react-hooks
audience: [human, ai]
tags: [react, hooks, realtime, websocket, syslog, isomorphic, nodefony/react]
status: stable
last-updated: 2026-05-22
---

# Hooks React — `nodefony/react`

> Bindings React **fins** du client temps réel isomorphe de Nodefony. Tu obtiens
> l'état de connexion, les canaux pub/sub, les stats et le flux syslog sous forme
> de hooks idiomatiques — sans recopier la moindre glue. Réutilisable par Studio
> comme par n'importe quelle app React servie par `@nodefony/frontend`.

Le subpath s'importe directement :

```ts
import {
  NodefonyProvider,
  useNodefony,
  useNodefonyState,
  useNodefonyChannel,
  useNodefonyChannelData,
  useNodefonyChannelStats,
  useNodefonySyslog,
} from "nodefony/react";
```

`react` est une **peerDependency optionnelle** : ce module n'est tiré dans ton
bundle que si tu importes `nodefony/react`. Rien n'est ajouté au build serveur.

> **Vue & Angular** : les équivalents (`nodefony/vue`, `nodefony/angular`) suivront
> la même surface ; cette page couvre React.

---

## 1. Mise en place

Deux choses : créer **un** `RealtimeClient` (l'URL se dérive de l'origine, `wss://`
en HTTPS) et l'injecter via `<NodefonyProvider>`. L'app reste **maîtresse du cycle
de connexion** : appelle `client.connect()` une fois, au montage du shell.

```tsx
import { RealtimeClient } from "nodefony";
import { NodefonyProvider } from "nodefony/react";

// Singleton applicatif (1 par app).
const client = new RealtimeClient({
  url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/nodefony/studio/api/realtime`,
  autoReconnect: true,
});

export function App() {
  return (
    <NodefonyProvider client={client}>
      <Shell />
    </NodefonyProvider>
  );
}

// Quelque part au montage du shell, UNE fois :
//   useEffect(() => { void client.connect(); }, []);
```

> Les hooks ne **connectent** pas : ils s'abonnent. La connexion (et sa
> reconnexion automatique) est gérée par le client. Si tu utilises Studio, c'est
> déjà fait pour toi.

---

## 2. Les hooks

Chaque hook a **une** responsabilité — tu composes ce dont la vue a besoin (pas de
god-hook qui re-render à chaque message). Tous portent le préfixe `useNodefony*`.

| Hook | Renvoie | Quand l'utiliser |
| ---- | ------- | ---------------- |
| `useNodefony()` | le `RealtimeClient` brut | cas avancé / échappatoire |
| `useNodefonyState()` | `"connected" \| "reconnecting" \| …` | badge / état de connexion |
| `useNodefonyChannel(ch, onMsg, deps?)` | `void` (effet) | réagir aux messages d'un canal |
| `useNodefonyChannelData<T>(ch)` | dernière valeur `T \| null` | afficher la dernière mesure |
| `useNodefonyChannelStats(ch)` | `{ rate, series, msgCount, lastMessage } \| null` | VU-mètre / débit |
| `useNodefonySyslog(opts)` | `unknown[]` (ring buffer) | flux de logs |

### `useNodefonyState()`

État de la connexion temps réel. Re-render **uniquement** quand l'état change
(snapshot via `useSyncExternalStore`, sans *tearing* en mode concurrent).

```tsx
function ConnectionBadge() {
  const state = useNodefonyState();
  const online = state === "connected";
  return <Badge color={online ? "green" : "gray"}>{online ? "online" : state}</Badge>;
}
```

### `useNodefonyChannel(channel, onMessage, deps?)`

S'abonne à un canal pub/sub : `onMessage(payload)` est appelé à chaque message.
Gère subscribe/unsubscribe + re-subscribe au reconnect. Le handler peut changer à
chaque render sans re-déclencher l'abonnement (capturé en interne) ; passe `deps`
si le **nom du canal** dépend d'autres valeurs.

```tsx
function Notifications() {
  useNodefonyChannel("notifications", (payload) => {
    console.log("reçu :", payload);
  });
  return null;
}
```

### `useNodefonyChannelData<T>(channel, initial?)`

La **dernière valeur** reçue sur un canal — le cas le plus courant (afficher la
dernière mesure d'un flux). `null` tant que rien n'est arrivé.

```tsx
interface Stats { cpuPercent: number; eventLoopMs: number }

function CpuGauge() {
  const stats = useNodefonyChannelData<Stats>("dashboard:stats");
  if (!stats) return <span>…</span>;
  return <span>{stats.cpuPercent}%</span>;
}
```

### `useNodefonyChannelStats(channel)`

Statistiques live calculées par le client : débit instantané (`rate`, msg/s),
série glissante (`series`, pour un VU-mètre), total (`msgCount`).

```tsx
function Throughput() {
  const s = useNodefonyChannelStats("dashboard:stats");
  return <span>{s?.rate ?? 0} msg/s</span>;
}
```

### `useNodefonySyslog(options?)`

Flux syslog prêt à l'emploi : **ring buffer** borné + filtre de sévérité. Gère le
format coalescé du canal (`{ logs: Pdu[], dropped }`) comme le Pdu unique.

| Option | Défaut | Rôle |
| ------ | ------ | ---- |
| `max` | `500` | taille du buffer (les plus anciennes lignes sont évincées) |
| `severities` | toutes | ne garder que ces sévérités (ex `["ERROR","CRITIC"]`) |
| `channel` | `"syslog:stream"` | canal source |

```tsx
function ErrorLog() {
  const lines = useNodefonySyslog({ max: 200, severities: ["ERROR", "CRITIC"] });
  return (
    <ul>
      {lines.map((l, i) => (
        <li key={i}>{(l as { payload?: string }).payload}</li>
      ))}
    </ul>
  );
}
```

### `useNodefony()`

Renvoie le client brut — pour les cas non couverts (RPC `request()`, `stream()`,
`emit()` bas niveau). Référence **stable** (ne provoque pas de re-render).

```tsx
function ChatBox() {
  const client = useNodefony();
  const ask = () =>
    client.stream("chat:ask", { prompt }, (chunk) => append(chunk));
  // …
}
```

---

## 3. Comportements garantis

- **Abonnement ref-compté** : N composants abonnés au même canal ⇒ **un seul**
  `subscribe` envoyé au serveur ; le `unsubscribe` n'est émis qu'au **dernier**
  désabonnement. Démonter un composant ne coupe donc jamais le flux d'un autre —
  ni d'un éventuel store qui partage le même canal. (Le compteur vit dans le
  `RealtimeClient`, autorité unique.)
- **Reconnexion transparente** : après une coupure, le client se reconnecte
  (back-off exponentiel) **et ré-abonne** automatiquement tous les canaux encore
  utilisés. Aucune action côté composant.
- **Pas de tearing** : `useNodefonyState` lit l'état via `useSyncExternalStore`
  (sûr en rendu concurrent React 18/19).
- **Connexion ≠ abonnement** : les hooks s'abonnent ; la connexion est ouverte
  une fois par l'app (`client.connect()`).

---

## 4. Exemple complet — widget live

```tsx
import { useNodefonyState, useNodefonyChannelData } from "nodefony/react";

interface Stats { cpuPercent: number; eventLoopMs: number }

export function MiniMonitor() {
  const state = useNodefonyState();
  const stats = useNodefonyChannelData<Stats>("dashboard:stats");

  if (state !== "connected") return <span>Realtime : {state}…</span>;
  if (!stats) return <span>en attente des mesures…</span>;

  return (
    <div>
      CPU {stats.cpuPercent}% · event-loop {stats.eventLoopMs.toFixed(1)} ms
    </div>
  );
}
```

À monter sous un `<NodefonyProvider>` dont le client est connecté — et c'est tout.

---

## Voir aussi

- [`request-context.md`](./request-context.md) — propagation `requestId` côté serveur.
- `RealtimeClient` (`import { RealtimeClient } from "nodefony"`) — le client
  isomorphe sous-jacent (RPC `request`/`stream`, pub/sub, stats).
- Studio est le consommateur de référence : la page Dashboard est entièrement
  bâtie sur ces hooks.
