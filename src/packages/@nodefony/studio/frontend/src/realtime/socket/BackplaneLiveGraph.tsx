import { useMemo } from "react";
import { observer } from "mobx-react-lite";
import {
  IconBolt,
  IconCircuitResistor,
  IconCpu,
  IconLoader2,
  IconLogs,
  IconServer2,
} from "@tabler/icons-react";
import {
  FlowGraph,
  type FlowGraphEdge,
  type FlowGraphNode,
} from "../../components/ui";
import { mapBackplaneLive, useSocketLiveData } from "./useSocketLiveData";

/* ════════════════════════════════════════════════════════════════════════
 * BackplaneLiveGraph — schéma « fond de panier » de la Socket.
 *
 * 3 workers (publish/subscribe symétrique) ↔ contrat `IBackplane` ↔ 4 drivers
 * pluggables :
 *   - Loopback   — mono-process, mémoire    (actif par défaut en dev)
 *   - Cluster IPC — 1 host, multi-worker
 *   - Redis      — N hosts, pub/sub fire-and-forget
 *   - Kafka      — event sourcing, replay, audit
 *
 * Aujourd'hui le driver actif n'est pas exposé dans la sonde `realtime:health`
 * (P13 enrichira). On marque `loopback` actif (cohérent avec `mapArchitectureLive`)
 * et les 3 autres « disponibles » (idle, leurs métriques décrivent leurs
 * caractéristiques). Pulse global sur `fanoutTotal`.
 *
 * Pattern « 0 ticker quand OFF » via `<LiveBranch>` (cf frères du dossier).
 * ════════════════════════════════════════════════════════════════════════ */

/** Nœuds figés du graphe Backplane. */
const NODES: FlowGraphNode[] = [
  {
    id: "workerA",
    data: {
      label: "Worker A",
      sub: "publish + subscribe",
      icon: <IconCpu size={20} />,
      color: "teal",
    },
  },
  {
    id: "workerB",
    data: {
      label: "Worker B",
      sub: "publish + subscribe",
      icon: <IconCpu size={20} />,
      color: "teal",
    },
  },
  {
    id: "workerC",
    data: {
      label: "Worker C",
      sub: "publish + subscribe",
      icon: <IconCpu size={20} />,
      color: "teal",
    },
  },
  {
    id: "backplane",
    data: {
      label: "IBackplane",
      sub: "Contrat · publish() · subscribe() · dispose()",
      icon: <IconCircuitResistor size={20} />,
      color: "orange",
      emphasis: true,
    },
  },
  {
    id: "loopback",
    data: {
      label: "Loopback",
      sub: "Mono-process · microtask · mémoire",
      icon: <IconLoader2 size={20} />,
      color: "green",
    },
  },
  {
    id: "clusterIpc",
    data: {
      label: "Cluster IPC",
      sub: "1 host · node:cluster · worker.send()",
      icon: <IconServer2 size={20} />,
      color: "blue",
    },
  },
  {
    id: "redis",
    data: {
      label: "Redis pub/sub",
      sub: "N hosts · PUBLISH / SUBSCRIBE · fire-and-forget",
      icon: <IconBolt size={20} />,
      color: "red",
    },
  },
  {
    id: "kafka",
    data: {
      label: "Kafka",
      sub: "N hosts · topic partitionné · log persistant · replay",
      icon: <IconLogs size={20} />,
      color: "grape",
    },
  },
];

const EDGES: FlowGraphEdge[] = [
  // Symétrie : chaque worker publish ET reçoit. Une arête « bus » par worker
  // suffit visuellement (le retour est implicite — c'est le rôle du backplane).
  { source: "workerA", target: "backplane", label: "bus", color: "teal" },
  { source: "workerB", target: "backplane", label: "bus", color: "teal" },
  { source: "workerC", target: "backplane", label: "bus", color: "teal" },
  // Le contrat se relie à 4 drivers — un seul actif à la fois (configuration).
  { source: "backplane", target: "loopback", label: "actif", color: "green" },
  {
    source: "backplane",
    target: "clusterIpc",
    label: "alternatif",
    color: "blue",
  },
  {
    source: "backplane",
    target: "redis",
    label: "alternatif",
    color: "red",
  },
  {
    source: "backplane",
    target: "kafka",
    label: "alternatif",
    color: "grape",
  },
];

const LiveBranch = observer(({ height }: { height: number }) => {
  const snap = useSocketLiveData();
  const liveNodeData = useMemo(() => mapBackplaneLive(snap), [snap]);
  return (
    <FlowGraph
      nodes={NODES}
      edges={EDGES}
      dir="TB"
      height={height}
      ariaLabel="Backplane Nodefony — 4 drivers pluggables — temps réel actif"
      liveNodeData={liveNodeData}
    />
  );
});

export interface BackplaneLiveGraphProps {
  /** Active la sonde live (sinon : graphe statique, pas d'abonnement serveur). */
  live?: boolean;
  height?: number;
}

export function BackplaneLiveGraph({
  live = false,
  height = 600,
}: BackplaneLiveGraphProps) {
  if (live) return <LiveBranch height={height} />;
  return (
    <FlowGraph
      nodes={NODES}
      edges={EDGES}
      dir="TB"
      height={height}
      ariaLabel="Backplane Nodefony — 4 drivers pluggables (statique)"
    />
  );
}

export default BackplaneLiveGraph;
