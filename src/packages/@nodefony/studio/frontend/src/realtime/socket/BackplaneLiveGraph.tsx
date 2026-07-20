import { useMemo } from "react";
import { observer } from "mobx-react-lite";
import {
  IconBolt,
  IconCircuitResistor,
  IconCpu,
  IconLoader2,
  IconPuzzle,
  IconServer2,
} from "@tabler/icons-react";
import {
  FlowGraph,
  type FlowGraphEdge,
  type FlowGraphNode,
} from "../../components/ui";
import {
  mapBackplaneLive,
  NATIVE_BACKPLANE_DRIVERS,
  useSocketLiveData,
} from "./useSocketLiveData";

/* ════════════════════════════════════════════════════════════════════════
 * BackplaneLiveGraph — schéma « fond de panier » de la Socket.
 *
 * Les workers du pod (publish/subscribe symétrique) ↔ contrat `IBackplane` ↔
 * les drivers du REGISTRE :
 *   - Loopback           — mono-process, mémoire (défaut)
 *   - ClusterBackplane   — 1 host, node:cluster, transport IPC
 *   - RedisBackplane     — N hosts/pods, PUBLISH/SUBSCRIBE, cross-pod
 *   - …userland          — `registerBackplaneDriver(name, factory)`
 *
 * Le registre est OUVERT : figer la liste des drivers contredirait la thèse du
 * schéma. D'où le nœud « driver userland » et des arêtes CONSTRUITES à partir
 * du driver réellement branché (`backplane.driver` de la sonde) plutôt qu'un
 * « actif » écrit en dur. Sans sonde (rendu statique de la doc), aucun driver
 * n'est désigné : tous sont des alternatives.
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
      sub: "publish + subscribe · neutre si le pod n'a qu'un worker",
      icon: <IconCpu size={20} />,
      color: "teal",
    },
  },
  {
    id: "workerC",
    data: {
      label: "Worker C",
      sub: "publish + subscribe · neutre si le pod n'a qu'un worker",
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
      label: "LoopbackBackplane",
      sub: "driver `loopback` · mono-process · microtask · latence ordre µs",
      icon: <IconLoader2 size={20} />,
      color: "green",
    },
  },
  {
    id: "cluster",
    data: {
      label: "ClusterBackplane",
      sub: "driver `cluster` · transport `ipc` · 1 host · latence ordre ms",
      icon: <IconServer2 size={20} />,
      color: "blue",
    },
  },
  {
    id: "redis",
    data: {
      label: "RedisBackplane",
      sub: "driver `redis` · `redis-pubsub` · cross-pod · latence ordre ms",
      icon: <IconBolt size={20} />,
      color: "red",
    },
  },
  {
    id: "custom",
    data: {
      label: "Driver userland",
      sub: "registerBackplaneDriver(name, factory) — NATS, Pulsar, RabbitMQ…",
      icon: <IconPuzzle size={20} />,
      color: "grape",
    },
  },
];

/** Nœud driver → couleur de son arête. L'ordre fixe la disposition du schéma. */
const DRIVER_EDGES: readonly { id: string; color: string }[] = [
  { id: "loopback", color: "green" },
  { id: "cluster", color: "blue" },
  { id: "redis", color: "red" },
  { id: "custom", color: "grape" },
];

/**
 * Arêtes du contrat vers les drivers, étiquetées d'après le driver RÉELLEMENT
 * branché. `activeDriver` inconnu (rendu statique, sonde muette) → aucun n'est
 * désigné actif : le schéma montre le choix, pas une configuration inventée.
 */
function buildEdges(activeDriver: string | undefined): FlowGraphEdge[] {
  const custom =
    !!activeDriver &&
    !(NATIVE_BACKPLANE_DRIVERS as readonly string[]).includes(activeDriver);
  const edges: FlowGraphEdge[] = [
    // Symétrie : chaque worker publish ET reçoit. Une arête « bus » par worker
    // suffit visuellement (le retour est implicite — c'est le rôle du backplane).
    { source: "workerA", target: "backplane", label: "bus", color: "teal" },
    { source: "workerB", target: "backplane", label: "bus", color: "teal" },
    { source: "workerC", target: "backplane", label: "bus", color: "teal" },
  ];
  for (const d of DRIVER_EDGES) {
    const active = d.id === "custom" ? custom : d.id === activeDriver;
    edges.push({
      source: "backplane",
      target: d.id,
      label: active ? "actif" : "alternatif",
      color: d.color,
      dashed: !active,
    });
  }
  return edges;
}

/** Rendu statique : aucun driver connu → que des alternatives. */
const EDGES_STATIC: FlowGraphEdge[] = buildEdges(undefined);

const LiveBranch = observer(({ height }: { height: number }) => {
  const snap = useSocketLiveData();
  const liveNodeData = useMemo(() => mapBackplaneLive(snap), [snap]);
  const driver = snap.backplane?.driver;
  const edges = useMemo(() => buildEdges(driver), [driver]);
  return (
    <FlowGraph
      nodes={NODES}
      edges={edges}
      dir="TB"
      height={height}
      ariaLabel="Backplane Nodefony — drivers pluggables — temps réel actif"
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
      edges={EDGES_STATIC}
      dir="TB"
      height={height}
      ariaLabel="Backplane Nodefony — drivers pluggables (statique)"
    />
  );
}

export default BackplaneLiveGraph;
