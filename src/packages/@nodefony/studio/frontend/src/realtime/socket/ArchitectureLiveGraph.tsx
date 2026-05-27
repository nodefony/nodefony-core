import { useMemo } from "react";
import { observer } from "mobx-react-lite";
import {
  IconBroadcast,
  IconCircuitResistor,
  IconCpu,
  IconDeviceDesktop,
  IconPlugConnected,
  IconStack2,
} from "@tabler/icons-react";
import {
  FlowGraph,
  type FlowGraphEdge,
  type FlowGraphNode,
} from "../../components/ui";
import { mapArchitectureLive, useSocketLiveData } from "./useSocketLiveData";

/* ════════════════════════════════════════════════════════════════════════
 * ArchitectureLiveGraph — schéma "Architecture en couches" de la Socket.
 *
 * Couches : Client → Transport → Peer → Hub → Backplane → Workers.
 * Pattern « 0 ticker quand OFF » : l'abonnement `realtime:health` vit dans
 * un sous-composant `<LiveBranch>` monté SEULEMENT si `live={true}`. OFF =
 * pas d'abonnement = pas de ticker côté serveur. Démonter le composant =
 * couper net.
 * ════════════════════════════════════════════════════════════════════════ */

/** Nœuds figés du graphe Architecture. Les métriques arrivent via `liveNodeData`. */
const NODES: FlowGraphNode[] = [
  {
    id: "client",
    data: {
      label: "RealtimeClient",
      sub: "Navigateur · isomorphe · subscribe / on / publish / request",
      icon: <IconDeviceDesktop size={20} />,
      color: "blue",
    },
  },
  {
    id: "transport",
    data: {
      label: "Transport (WSS)",
      sub: "IRealtimeTransport · seul à connaître le réseau",
      icon: <IconPlugConnected size={20} />,
      color: "cyan",
    },
  },
  {
    id: "peer",
    data: {
      label: "JsonRpcPeer",
      sub: "JSON-RPC 2.0 · le même protocole des 2 côtés (isomorphe)",
      icon: <IconStack2 size={20} />,
      color: "grape",
    },
  },
  {
    id: "hub",
    data: {
      label: "RealtimeHub",
      sub: "Broker pub/sub · fan-out par canal",
      icon: <IconBroadcast size={20} />,
      color: "indigo",
      emphasis: true,
    },
  },
  {
    id: "backplane",
    data: {
      label: "IBackplane",
      sub: "Fond de panier · Loopback → IPC cluster → Redis",
      icon: <IconCircuitResistor size={20} />,
      color: "orange",
      emphasis: true,
    },
  },
  {
    id: "w1",
    data: {
      label: "Worker A",
      sub: "process / pod",
      icon: <IconCpu size={20} />,
      color: "teal",
    },
  },
  {
    id: "w2",
    data: {
      label: "Worker B",
      sub: "process / pod",
      icon: <IconCpu size={20} />,
      color: "teal",
    },
  },
];

const EDGES: FlowGraphEdge[] = [
  { source: "client", target: "transport", label: "WSS", color: "blue" },
  { source: "transport", target: "peer", label: "frames", color: "cyan" },
  {
    source: "peer",
    target: "hub",
    label: "subscribe / publish",
    color: "grape",
  },
  {
    source: "hub",
    target: "backplane",
    label: "fan-out cross-process",
    color: "indigo",
  },
  { source: "backplane", target: "w1", label: "delivery", color: "orange" },
  { source: "backplane", target: "w2", label: "delivery", color: "orange" },
];

/** Branche live : abonnement `realtime:health` (ref-compté, démonté = coupé). */
const LiveBranch = observer(({ height }: { height: number }) => {
  const snap = useSocketLiveData();
  const liveNodeData = useMemo(() => mapArchitectureLive(snap), [snap]);
  return (
    <FlowGraph
      nodes={NODES}
      edges={EDGES}
      dir="TB"
      height={height}
      ariaLabel="Architecture en couches de la Socket Nodefony — temps réel actif"
      liveNodeData={liveNodeData}
    />
  );
});

export interface ArchitectureLiveGraphProps {
  /** Active la sonde live (sinon : graphe statique, pas d'abonnement serveur). */
  live?: boolean;
  height?: number;
}

export function ArchitectureLiveGraph({
  live = false,
  height = 540,
}: ArchitectureLiveGraphProps) {
  if (live) return <LiveBranch height={height} />;
  return (
    <FlowGraph
      nodes={NODES}
      edges={EDGES}
      dir="TB"
      height={height}
      ariaLabel="Architecture en couches de la Socket Nodefony (statique)"
    />
  );
}

export default ArchitectureLiveGraph;
