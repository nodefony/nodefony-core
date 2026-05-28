import { useNodefonyChannelData, useNodefonyState } from "nodefony/react";
import type { LiveNodeData } from "../../components/ui";

/* ════════════════════════════════════════════════════════════════════════
 * useSocketLiveData — hook qui livre un snapshot temps réel de la Socket.
 *
 * Source = canal `realtime:health` (sonde de la Socket elle-même, livrée
 * côté serveur en P16.H.7 — cf skill `nodefony-framework-dev`). Le hook
 * est un ABONNEMENT (ref-compté par `useNodefonyChannelData`) : monter le
 * composant active la sonde côté serveur, démonter la coupe.
 *
 * Les `mapXxxLive(snap)` projettent le snapshot vers un `Record<nodeId,
 * LiveNodeData>` exploitable par `FlowGraph` — un par schéma de la doc.
 * Le mapping est PUR (testable, 0 allocation cachée), `FlowGraph` n'a pas
 * besoin de connaître le métier.
 * ════════════════════════════════════════════════════════════════════════ */

/** Forme de la sonde realtime:health (miroir local — pas d'import serveur). */
export interface RealtimeHealth {
  channels?: { channel: string; subscribers: number; messages: number }[];
  connectionCount?: number;
  publishTotal?: number;
  fanoutTotal?: number;
  messagesSentTotal?: number;
  bytesSentTotal?: number;
  backpressure?: {
    maxBufferedAmount?: number;
    totalBufferedAmount?: number;
    slowConsumers?: number;
  };
}

export interface SocketLiveSnapshot {
  rt: RealtimeHealth | null;
  /** État de la socket côté client (RealtimeClient). */
  clientState: ReturnType<typeof useNodefonyState>;
}

/** Snapshot brut + état client. À mapper ensuite via `mapXxxLive(snap)`. */
export function useSocketLiveData(): SocketLiveSnapshot {
  const rt = useNodefonyChannelData<RealtimeHealth>("realtime:health");
  const clientState = useNodefonyState();
  return { rt, clientState };
}

/* ─── Mappings vers les graphes de la doc ────────────────────────────────── */

/** Format compact pour les compteurs > 1k. */
function fmt(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * Mapping pour le **graphe Architecture** (Client → Transport → Peer → Hub →
 * Backplane → Workers). Chaque node a `metrics?` quand la donnée fait sens.
 * Status :
 *  - "ok"   = preuve d'activité (≥1 connexion / ≥1 fan-out / cycle frappé)
 *  - "idle" = pas de signe d'activité (mais pas d'erreur)
 *  - "warn" = anomalie (backpressure, slow consumers)
 *  - "down" = ne pas pulser (rouge fixe)
 */
export function mapArchitectureLive(
  snap: SocketLiveSnapshot,
): Record<string, LiveNodeData> {
  const rt = snap.rt;
  const connected = snap.clientState === "connected";
  const channels = rt?.channels?.length ?? 0;
  const conns = rt?.connectionCount ?? 0;
  const fanout = rt?.fanoutTotal ?? rt?.publishTotal ?? 0;
  const bp = rt?.backpressure;
  const slow = bp?.slowConsumers ?? 0;
  const bpBytes = bp?.totalBufferedAmount ?? 0;
  const hubWarn = slow > 0 || bpBytes > 0;
  return {
    client: {
      status: connected ? "ok" : "idle",
      pulse: connected,
      metrics: [
        { label: "état", value: snap.clientState },
        { label: "transport", value: "WSS" },
      ],
    },
    transport: {
      status: conns > 0 ? "ok" : "idle",
      pulse: conns > 0,
      metrics: [{ label: "connexions", value: fmt(conns) }],
    },
    peer: {
      status: rt ? "ok" : "idle",
      pulse: !!rt,
      metrics: [
        { label: "msgs émis", value: fmt(rt?.messagesSentTotal) },
        { label: "octets émis", value: fmt(rt?.bytesSentTotal) },
      ],
    },
    hub: {
      status: hubWarn ? "warn" : channels > 0 ? "ok" : "idle",
      pulse: channels > 0,
      metrics: [
        { label: "canaux", value: fmt(channels) },
        { label: "fan-out", value: fmt(fanout) },
        ...(hubWarn ? ([{ label: "slow", value: fmt(slow) }] as const) : []),
      ],
    },
    backplane: {
      // pas de signal direct (la sonde sera enrichie en P13) → idle stable
      status: "idle",
      metrics: [{ label: "mode", value: "loopback" }],
    },
  };
}

/**
 * Mapping pour le **graphe Fan-out** : un publish part d'un service vers le hub
 * local, qui notifie ses N abonnés ET forward au backplane (lequel relaie aux
 * autres workers). Distinction nette entre la branche locale (signaux directs
 * dans la sonde) et la branche cross-worker (idle stable, signal réel en P13).
 *
 * Pulse synchronisé sur l'activité fan-out (`fanoutTotal`) — donne l'illusion
 * de la propagation 1→N. Backpressure se reflète sur le hub local (warn).
 */
export function mapFanOutLive(
  snap: SocketLiveSnapshot,
): Record<string, LiveNodeData> {
  const rt = snap.rt;
  const channels = rt?.channels?.length ?? 0;
  const fanout = rt?.fanoutTotal ?? rt?.publishTotal ?? 0;
  const publishes = rt?.publishTotal ?? 0;
  const conns = rt?.connectionCount ?? 0;
  const bp = rt?.backpressure;
  const slow = bp?.slowConsumers ?? 0;
  const bpBytes = bp?.totalBufferedAmount ?? 0;
  const hubWarn = slow > 0 || bpBytes > 0;
  const active = fanout > 0;
  const localAttached = conns > 0;
  // Peers locaux : tous abonnés effectifs si au moins 1 connexion, sinon idle.
  const peerStatus = localAttached ? "ok" : "idle";
  return {
    source: {
      status: publishes > 0 ? "ok" : "idle",
      pulse: active,
      metrics: [{ label: "publish total", value: fmt(publishes) }],
    },
    hub: {
      status: hubWarn ? "warn" : channels > 0 ? "ok" : "idle",
      pulse: active,
      metrics: [
        { label: "canaux", value: fmt(channels) },
        { label: "fan-out", value: fmt(fanout) },
        ...(hubWarn ? ([{ label: "slow", value: fmt(slow) }] as const) : []),
      ],
    },
    peerA: { status: peerStatus, pulse: active },
    peerB: { status: peerStatus, pulse: active },
    peerC: { status: peerStatus, pulse: active },
    // Branche cross-worker : signal direct absent (P13) → idle stable.
    backplane: {
      status: "idle",
      metrics: [{ label: "mode", value: "loopback" }],
    },
    hubB: {
      status: "idle",
      metrics: [{ label: "fan-out distant", value: "—" }],
    },
    peerX: { status: "idle" },
    peerY: { status: "idle" },
  };
}

/**
 * Mapping pour le **graphe Protocole** — illustre les 4 types de frames
 * JSON-RPC 2.0 qui circulent sur la socket :
 *  - `notifyOut` : notifications client→server SANS `id` (subscribe / unsubscribe / publish)
 *  - `request`   : requêtes client→server AVEC `id` (kernel:ping, …)
 *  - `response`  : réponses server→client (result / error, même `id`)
 *  - `notifyIn`  : notifications server→client SANS `id` (channel push, realtime:welcome)
 *
 * Le push `notifyIn` est le gros volume — son `pulse` suit `fanoutTotal`.
 * `request`/`response` n'ont pas de compteur dédié dans la sonde (rare en
 * usage normal) → idle stable, c'est documentaire.
 */
export function mapProtocoleLive(
  snap: SocketLiveSnapshot,
): Record<string, LiveNodeData> {
  const rt = snap.rt;
  const connected = snap.clientState === "connected";
  const channels = rt?.channels?.length ?? 0;
  const fanout = rt?.fanoutTotal ?? rt?.publishTotal ?? 0;
  const msgs = rt?.messagesSentTotal ?? 0;
  const conns = rt?.connectionCount ?? 0;
  return {
    client: {
      status: connected ? "ok" : "idle",
      pulse: connected,
      metrics: [{ label: "état", value: snap.clientState }],
    },
    server: {
      status: rt ? "ok" : "idle",
      pulse: !!rt,
      metrics: [{ label: "connexions", value: fmt(conns) }],
    },
    // Sans `id` — c'est ici que vivent les abonnements (le canal actif).
    notifyOut: {
      status: channels > 0 ? "ok" : "idle",
      pulse: channels > 0,
      metrics: [{ label: "canaux abonnés", value: fmt(channels) }],
    },
    // Sans `id` — c'est ici que vit le gros volume (push de la sonde, logs, …).
    notifyIn: {
      status: fanout > 0 ? "ok" : "idle",
      pulse: fanout > 0,
      metrics: [
        { label: "msgs émis", value: fmt(msgs) },
        { label: "fan-out", value: fmt(fanout) },
      ],
    },
    // Avec `id` — rare en régime normal (actions de contrôle ponctuelles).
    request: { status: "idle" },
    response: { status: "idle" },
  };
}

/**
 * Mapping pour le **graphe Sondes** — illustre le patron en 5 pièces :
 *   probe → buildHealth → { endpoint HTTP, ticker WS } → canal → Studio.
 *
 * Le signal direct disponible = le canal `realtime:health` lui-même expose
 * la liste des canaux abonnés (`channels[]`) et leur trafic. On dérive :
 *  - nombre de canaux `*:health` actifs (sondes vivantes côté serveur)
 *  - somme des messages sur ces canaux (= ticks reçus)
 *
 * `probe`/`buildHealth` n'ont pas de signal propre — leur activité est
 * portée par le `ticker` (l'absence d'un canal `*:health` = pas de probe).
 */
export function mapSondesLive(
  snap: SocketLiveSnapshot,
): Record<string, LiveNodeData> {
  const rt = snap.rt;
  const connected = snap.clientState === "connected";
  const healthChannels = (rt?.channels ?? []).filter((c) =>
    c.channel.endsWith(":health"),
  );
  const sondesCount = healthChannels.length;
  const totalTicks = healthChannels.reduce((acc, c) => acc + c.messages, 0);
  const active = sondesCount > 0 && totalTicks > 0;
  return {
    // Pièce 1 — la sonde dans le service métier (signal indirect).
    probe: {
      status: sondesCount > 0 ? "ok" : "idle",
      pulse: active,
      metrics: [{ label: "sondes actives", value: fmt(sondesCount) }],
    },
    // Pièce 2 — l'agrégateur pur (idem, signal porté par le ticker).
    health: {
      status: sondesCount > 0 ? "ok" : "idle",
      pulse: active,
    },
    // Pièce 3 — endpoint HTTP 1er paint (toujours dispo si module up).
    endpoint: {
      status: sondesCount > 0 ? "ok" : "idle",
      metrics: [{ label: "GET /api/health", value: "JSON" }],
    },
    // Pièce 4 — provider ticker (cœur du temps réel).
    ticker: {
      status: sondesCount > 0 ? "ok" : "idle",
      pulse: active,
      metrics: [{ label: "ticks", value: fmt(totalTicks) }],
    },
    // Pièce 5a — canaux `<x>:health` du RealtimeHub.
    channel: {
      status: sondesCount > 0 ? "ok" : "idle",
      pulse: active,
      metrics: [{ label: "canaux *:health", value: fmt(sondesCount) }],
    },
    // Pièce 5b — Studio (abonné).
    studio: {
      status: connected ? "ok" : "idle",
      pulse: connected && active,
      metrics: [{ label: "état", value: snap.clientState }],
    },
  };
}

/**
 * Mapping pour le **graphe Backplane** — 3 workers ↔ IBackplane ↔ 4 drivers.
 *
 * Signal direct sur le driver actif est ABSENT de la sonde courante
 * (sera enrichie en P13). On marque `loopback` comme actif (cohérent avec
 * `mapArchitectureLive` qui affiche déjà `mode: loopback`) et les 3 autres
 * comme « disponibles » (status idle, sub-text de leur métrique = leur
 * caractéristique). Pulse global suit `fanoutTotal` côté workers/backplane.
 *
 * Quand la sonde exposera `backplane.driver` (P13), changer la fonction
 * pour lire `rt.backplane?.driver` et activer dynamiquement le bon node.
 */
export function mapBackplaneLive(
  snap: SocketLiveSnapshot,
): Record<string, LiveNodeData> {
  const rt = snap.rt;
  const fanout = rt?.fanoutTotal ?? rt?.publishTotal ?? 0;
  const publishes = rt?.publishTotal ?? 0;
  const active = fanout > 0;
  // Pulse sur les workers indique qu'au moins 1 publish a circulé.
  const workerStatus = publishes > 0 ? "ok" : "idle";
  return {
    workerA: {
      status: workerStatus,
      pulse: active,
      metrics: [{ label: "rôle", value: "publish" }],
    },
    workerB: {
      status: workerStatus,
      pulse: active,
      metrics: [{ label: "rôle", value: "publish" }],
    },
    workerC: {
      status: workerStatus,
      pulse: active,
      metrics: [{ label: "rôle", value: "publish" }],
    },
    backplane: {
      status: active ? "ok" : "idle",
      pulse: active,
      metrics: [
        { label: "publish total", value: fmt(publishes) },
        { label: "fan-out", value: fmt(fanout) },
      ],
    },
    // Driver actif aujourd'hui (sera dynamique en P13).
    loopback: {
      status: "ok",
      pulse: active,
      metrics: [
        { label: "actif", value: "✓" },
        { label: "latence", value: "~0 µs" },
      ],
    },
    // Alternatives disponibles — idle stable.
    clusterIpc: {
      status: "idle",
      metrics: [
        { label: "topologie", value: "1 host" },
        { label: "latence", value: "1-2 ms" },
      ],
    },
    redis: {
      status: "idle",
      metrics: [
        { label: "topologie", value: "N hosts" },
        { label: "latence", value: "1-5 ms" },
      ],
    },
    kafka: {
      status: "idle",
      metrics: [
        { label: "topologie", value: "N hosts" },
        { label: "garantie", value: "replay" },
      ],
    },
  };
}

/**
 * Mapping pour le **graphe Actions** — pipeline RPC d'une action :
 *   request → welcome (registry) → authz → validate → handler → audit → result.
 *
 * La sonde courante n'expose pas de compteur dédié aux RPC (rare en régime
 * normal). On marque `request`/`welcome` ok dès qu'on est connecté (le welcome
 * arrive au handshake), et les étapes du pipeline restent idle stable —
 * documentaire. Les étapes vivront le jour où la sonde exposera un compteur
 * `rpcTotal` (P13).
 */
export function mapActionsLive(
  snap: SocketLiveSnapshot,
): Record<string, LiveNodeData> {
  const rt = snap.rt;
  const connected = snap.clientState === "connected";
  return {
    request: {
      status: connected ? "ok" : "idle",
      pulse: connected,
      metrics: [{ label: "client", value: connected ? "prêt" : "déconnecté" }],
    },
    // Le welcome arrive 1× au handshake → on infère « ok » sur présence sonde.
    welcome: {
      status: rt ? "ok" : "idle",
      metrics: [{ label: "registry", value: rt ? "actif" : "—" }],
    },
    authz: {
      status: "idle",
      metrics: [{ label: "garde", value: "peer.roles" }],
    },
    validate: {
      status: "idle",
      metrics: [{ label: "schema", value: "Zod" }],
    },
    handler: {
      status: "idle",
      metrics: [{ label: "exécution", value: "métier" }],
    },
    audit: {
      status: "idle",
      metrics: [{ label: "log", value: "who/what/when" }],
    },
    result: {
      status: "idle",
      metrics: [{ label: "réponse", value: "result | -32xxx" }],
    },
  };
}
