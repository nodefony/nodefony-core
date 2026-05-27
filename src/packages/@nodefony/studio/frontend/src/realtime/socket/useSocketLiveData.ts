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
