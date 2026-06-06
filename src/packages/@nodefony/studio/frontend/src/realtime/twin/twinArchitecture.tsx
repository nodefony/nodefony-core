import { useRef, useState, type ReactNode } from "react";
import {
  IconAtom2,
  IconBroadcast,
  IconCircuitResistor,
  IconDatabase,
  IconFileText,
  IconPlug,
  IconPlugConnected,
  IconServer,
} from "@tabler/icons-react";
import { useNodefonyChannel } from "nodefony/react";
import type { LiveNodeData } from "../../components/ui";
import type { NormalizedHealth } from "../../utils/realtimeHealth";
import type { KernelInfo } from "./useTwinTopology";

/* ════════════════════════════════════════════════════════════════════════
 * twinArchitecture — le SCHÉMA D'ARCHITECTURE RUNTIME du Jumeau (vue d'accueil).
 *
 * PAS la liste des modules npm (« aucun intérêt ») : l'architecture qui TOURNE,
 * lue comme le voyage d'une requête —
 *
 *   [Entrée HTTP] [Entrée WS]   ← le pont d'entrée
 *          │           │
 *        [ Kernel · Pipeline ]  ← routing → controller
 *        ╱      │        ╲
 *    [ORM]  [Realtime Hub]  [Backplane logs]
 *      │          │
 * [Connecteurs] [Backplane realtime]
 *
 * Chaque brique est un MÉTIER cliquable → popup card live (ce qui s'y passe).
 * Les données viennent de contrats DÉJÀ servis : `realtime:health` (process,
 * orm, canaux, backpressure), `kernel/api/info` (fonds de panier), et
 * `syslog:stream` (les request id qui entrent en direct).
 * ════════════════════════════════════════════════════════════════════════ */

export type ArchNodeId =
  | "http"
  | "ws"
  | "kernel"
  | "orm"
  | "connectors"
  | "realtime"
  | "bp-realtime"
  | "bp-logs";

/** Métadonnées d'une brique (titre + accent + icône + page de forage). */
export const ARCH_NODE_INFO: Record<
  ArchNodeId,
  { title: string; color: string; icon: () => ReactNode; href: string }
> = {
  http: {
    title: "Entrée HTTP",
    color: "blue",
    icon: () => <IconServer size={20} />,
    href: "/nodefony/routes",
  },
  ws: {
    title: "Entrée WebSocket",
    color: "cyan",
    icon: () => <IconPlugConnected size={20} />,
    href: "/nodefony/hub",
  },
  kernel: {
    title: "Kernel · Pipeline",
    color: "indigo",
    icon: () => <IconAtom2 size={22} />,
    href: "/nodefony/runtime",
  },
  orm: {
    title: "ORM",
    color: "teal",
    icon: () => <IconDatabase size={20} />,
    href: "/nodefony/orm",
  },
  connectors: {
    title: "Connecteurs",
    color: "teal",
    icon: () => <IconPlug size={20} />,
    href: "/nodefony/databases",
  },
  realtime: {
    title: "Realtime Hub",
    color: "grape",
    icon: () => <IconBroadcast size={20} />,
    href: "/nodefony/hub",
  },
  "bp-realtime": {
    title: "Fond de panier · Realtime",
    color: "orange",
    icon: () => <IconCircuitResistor size={20} />,
    href: "/nodefony/cluster",
  },
  "bp-logs": {
    title: "Fond de panier · Logs",
    color: "orange",
    icon: () => <IconFileText size={20} />,
    href: "/nodefony/logs",
  },
};

/** Compteur compact. */
function fmt(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * Projette la santé + l'identité + l'activité logs vers `liveNodeData`.
 * Ergonomie « trop d'info tue l'info » : AU PLUS 2 métriques par brique sur le
 * canevas ; le détail riche vit dans la popup. Pulse = activité réelle.
 */
export function mapTwinArchLive(
  norm: NormalizedHealth | null,
  info: KernelInfo | null,
  activityCount: number,
): Record<string, LiveNodeData> {
  const t = norm?.totals;
  const conns = t?.connectionCount ?? 0;
  const orm = t?.orm;
  const channels = t?.channelCount ?? 0;
  const fanout = t?.fanoutTotal ?? t?.publishTotal ?? 0;
  const httpActive = activityCount > 0;
  const cluster = !!info?.cluster?.isCluster;
  return {
    http: {
      status: httpActive ? "ok" : "idle",
      pulse: httpActive,
      metrics: [{ label: "événements/8s", value: fmt(activityCount) }],
    },
    ws: {
      status: conns > 0 ? "ok" : "idle",
      pulse: conns > 0,
      metrics: [{ label: "connexions", value: fmt(conns) }],
    },
    kernel: {
      status: norm ? "ok" : "idle",
      metrics: [{ label: "modules", value: fmt(info?.modules) }],
    },
    orm: {
      status: orm ? (orm.connected > 0 ? "ok" : "down") : "idle",
      pulse: !!orm && orm.queryTotal > 0,
      metrics: orm
        ? [
            { label: "requêtes", value: fmt(orm.queryTotal) },
            { label: "connectés", value: `${orm.connected}/${orm.connectors}` },
          ]
        : undefined,
    },
    connectors: {
      status: orm ? (orm.connected > 0 ? "ok" : "down") : "idle",
      metrics: orm
        ? [{ label: "connectés", value: `${orm.connected}/${orm.connectors}` }]
        : undefined,
    },
    realtime: {
      status: channels > 0 ? "ok" : "idle",
      pulse: fanout > 0,
      metrics: [
        { label: "canaux", value: fmt(channels) },
        { label: "fan-out", value: fmt(fanout) },
      ],
    },
    "bp-realtime": {
      status: norm ? "ok" : "idle",
      metrics: [{ label: "mode", value: cluster ? "cluster" : "loopback" }],
    },
    "bp-logs": {
      status: info ? "ok" : "idle",
      metrics: [
        { label: "driver", value: info?.backplanes?.log?.driver ?? "—" },
      ],
    },
  };
}

/* ─── Activité logs : les request id qui entrent en direct ────────────────── */

/** Un événement de log normalisé (best-effort, frontière isomorphe). */
export interface LogPulse {
  requestId?: string;
  severity: string;
  message: string;
  module?: string;
  ts: number;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

/** Lit un Pdu syslog sans présumer sa forme exacte (champs best-effort). */
function readLog(payload: unknown): LogPulse {
  const r = asRecord(payload);
  const ctx = asRecord(r.context);
  return {
    requestId: str(r.requestId) ?? str(ctx.requestId),
    severity: (str(r.severityName) ?? str(r.severity) ?? "info").toLowerCase(),
    message: str(r.payload) ?? str(r.message) ?? str(r.msg) ?? "",
    module: str(r.moduleName) ?? str(r.module),
    ts: Date.now(),
  };
}

const ACTIVITY_WINDOW_MS = 8000;

/**
 * Abonnement `syslog:stream` (ref-compté) : fenêtre glissante des logs récents.
 * `count` = nombre d'événements sur ~8 s (signal d'activité HTTP) ; `recent` =
 * les dernières lignes avec leur request id (pour la popup d'entrée).
 */
export function useRecentLogActivity(): { count: number; recent: LogPulse[] } {
  const bufRef = useRef<LogPulse[]>([]);
  const [snap, setSnap] = useState<{ count: number; recent: LogPulse[] }>({
    count: 0,
    recent: [],
  });
  useNodefonyChannel("syslog:stream", (payload: unknown) => {
    const now = Date.now();
    const buf = bufRef.current.filter((l) => now - l.ts < ACTIVITY_WINDOW_MS);
    buf.push(readLog(payload));
    bufRef.current = buf.slice(-80);
    setSnap({
      count: bufRef.current.length,
      recent: bufRef.current.slice(-14).reverse(),
    });
  });
  return snap;
}
