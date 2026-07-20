import { useMemo } from "react";
import { observer } from "mobx-react-lite";
import {
  IconArrowsSplit2,
  IconBroadcast,
  IconCircuitResistor,
  IconCpu,
  IconDeviceDesktop,
} from "@tabler/icons-react";
import {
  FlowGraph,
  type FlowGraphEdge,
  type FlowGraphNode,
} from "../../components/ui";
import { mapFanOutLive, useSocketLiveData } from "./useSocketLiveData";

/* ════════════════════════════════════════════════════════════════════════
 * FanOutLiveGraph — schéma « Fan-out & pub/sub » de la Socket.
 *
 * Lecture LR : un publish part d'un service → hub local → 3 peers locaux.
 * En cluster, le hub forward au backplane, qui relaie au hub B d'un autre
 * worker, qui fan-oute à ses propres peers.
 *
 * Les 3 peers locaux s'allument PAR RANG (≥1, ≥2, ≥3 abonnés simultanés sur un
 * canal) : le seuil est mesuré, l'identité du peer est illustrative. La branche
 * cross-worker n'est alimentée qu'en vue pod agrégée avec un second worker.
 *
 * Pattern « 0 ticker quand OFF » : l'abonnement vit dans `<LiveBranch>`
 * monté seulement si `live={true}`. OFF = pas d'abonnement = pas de ticker
 * côté serveur (cf [[project_realtime_socket_probe]]).
 * ════════════════════════════════════════════════════════════════════════ */

/** Nœuds figés du graphe Fan-out. Les métriques arrivent via `liveNodeData`. */
const NODES: FlowGraphNode[] = [
  {
    id: "source",
    data: {
      label: "Service publisher",
      sub: "publish(channel, payload)",
      icon: <IconArrowsSplit2 size={20} />,
      color: "violet",
    },
  },
  {
    id: "hub",
    data: {
      label: "RealtimeHub A",
      sub: "Map<canal, Set<peers>> — fan-out local",
      icon: <IconBroadcast size={20} />,
      color: "indigo",
      emphasis: true,
    },
  },
  {
    id: "peerA",
    data: {
      label: "Peer A1",
      sub: "abonné local · allumé dès 1 abonné sur un canal",
      icon: <IconDeviceDesktop size={20} />,
      color: "blue",
    },
  },
  {
    id: "peerB",
    data: {
      label: "Peer A2",
      sub: "abonné local · allumé dès 2 abonnés sur un canal",
      icon: <IconDeviceDesktop size={20} />,
      color: "blue",
    },
  },
  {
    id: "peerC",
    data: {
      label: "Peer A3",
      sub: "abonné local · allumé dès 3 abonnés sur un canal",
      icon: <IconDeviceDesktop size={20} />,
      color: "blue",
    },
  },
  {
    id: "backplane",
    data: {
      label: "IBackplane",
      sub: "forward cross-worker — Loopback / Cluster IPC / Redis",
      icon: <IconCircuitResistor size={20} />,
      color: "orange",
    },
  },
  {
    id: "hubB",
    data: {
      label: "RealtimeHub B",
      sub: "2ᵉ worker du pod — neutre hors vue pod agrégée",
      icon: <IconBroadcast size={20} />,
      color: "grape",
    },
  },
  {
    id: "peerX",
    data: {
      label: "Peer B1",
      sub: "abonné worker B · allumé dès 1 abonné",
      icon: <IconCpu size={20} />,
      color: "teal",
    },
  },
  {
    id: "peerY",
    data: {
      label: "Peer B2",
      sub: "abonné worker B · allumé dès 2 abonnés",
      icon: <IconCpu size={20} />,
      color: "teal",
    },
  },
];

/** Arêtes : 1 publish → 1 forward + N notify ; 1 relais → N notify (branche cluster). */
const EDGES: FlowGraphEdge[] = [
  { source: "source", target: "hub", label: "publish", color: "violet" },
  { source: "hub", target: "peerA", label: "notify", color: "indigo" },
  { source: "hub", target: "peerB", label: "notify", color: "indigo" },
  { source: "hub", target: "peerC", label: "notify", color: "indigo" },
  { source: "hub", target: "backplane", label: "forward", color: "orange" },
  { source: "backplane", target: "hubB", label: "relais", color: "orange" },
  { source: "hubB", target: "peerX", label: "notify", color: "grape" },
  { source: "hubB", target: "peerY", label: "notify", color: "grape" },
];

/** Branche live : abonnement `realtime:health` (ref-compté, démonté = coupé). */
const LiveBranch = observer(({ height }: { height: number }) => {
  const snap = useSocketLiveData();
  const liveNodeData = useMemo(() => mapFanOutLive(snap), [snap]);
  return (
    <FlowGraph
      nodes={NODES}
      edges={EDGES}
      dir="LR"
      height={height}
      ariaLabel="Fan-out d'un publish vers N abonnés — temps réel actif"
      liveNodeData={liveNodeData}
    />
  );
});

export interface FanOutLiveGraphProps {
  /** Active la sonde live (sinon : graphe statique, pas d'abonnement serveur). */
  live?: boolean;
  height?: number;
}

export function FanOutLiveGraph({
  live = false,
  height = 540,
}: FanOutLiveGraphProps) {
  if (live) return <LiveBranch height={height} />;
  return (
    <FlowGraph
      nodes={NODES}
      edges={EDGES}
      dir="LR"
      height={height}
      ariaLabel="Fan-out d'un publish vers N abonnés (statique)"
    />
  );
}

export default FanOutLiveGraph;
