import { useMemo } from "react";
import { observer } from "mobx-react-lite";
import {
  IconActivity,
  IconBroadcast,
  IconChartLine,
  IconClock,
  IconDeviceDesktop,
  IconRoute,
} from "@tabler/icons-react";
import {
  FlowGraph,
  type FlowGraphEdge,
  type FlowGraphNode,
} from "../../components/ui";
import { mapSondesLive, useSocketLiveData } from "./useSocketLiveData";

/* ════════════════════════════════════════════════════════════════════════
 * SondesLiveGraph — schéma « Patron probe → health → canal → Studio ».
 *
 * Les 5 pièces canoniques (cf doc 05-sondes.md) :
 *   1. I<X>Probe          — sonde au plus près du code métier
 *   2. build<X>Health()   — agrégateur pur
 *   3. GET /api/<x>/health — endpoint HTTP 1er paint
 *   4. Provider ticker    — push live via setInterval + publish
 *   5. Canal <x>:health   — RealtimeHub → Studio (générique via broker)
 *
 * Signal live = lecture du canal `realtime:health` : `channels[]` filtré
 * sur les noms `*:health` donne le nombre de sondes vivantes ET leur
 * trafic cumulé (somme `messages`). Pas besoin de signal supplémentaire.
 *
 * Pattern « 0 ticker quand OFF » via `<LiveBranch>` (cf frères du dossier).
 * ════════════════════════════════════════════════════════════════════════ */

/** Nœuds figés du graphe Sondes. */
const NODES: FlowGraphNode[] = [
  {
    id: "probe",
    data: {
      label: "I<X>Probe",
      sub: "Sonde dans le service métier · probe() best-effort",
      icon: <IconActivity size={20} />,
      color: "violet",
    },
  },
  {
    id: "health",
    data: {
      label: "build<X>Health()",
      sub: "Agrégateur pur · ajoute status + dérivés",
      icon: <IconChartLine size={20} />,
      color: "grape",
    },
  },
  {
    id: "endpoint",
    data: {
      label: "GET /api/<x>/health",
      sub: "Endpoint HTTP · 1er paint sans attendre le tick",
      icon: <IconRoute size={20} />,
      color: "cyan",
    },
  },
  {
    id: "ticker",
    data: {
      label: "Provider ticker",
      sub: "setInterval(1s).unref() · publish(<x>:health, …)",
      icon: <IconClock size={20} />,
      color: "orange",
    },
  },
  {
    id: "channel",
    data: {
      label: "Canal <x>:health",
      sub: "RealtimeHub · cadence par défaut 1 Hz, AIMD-aware",
      icon: <IconBroadcast size={20} />,
      color: "indigo",
      emphasis: true,
    },
  },
  {
    id: "studio",
    data: {
      label: "Panneau Studio",
      sub: 'Générique · broker + useNodefonyChannel("<x>:health")',
      icon: <IconDeviceDesktop size={20} />,
      color: "blue",
    },
  },
];

const EDGES: FlowGraphEdge[] = [
  { source: "probe", target: "health", label: "métriques", color: "violet" },
  { source: "health", target: "endpoint", label: "snapshot", color: "cyan" },
  { source: "health", target: "ticker", label: "live", color: "orange" },
  {
    source: "endpoint",
    target: "channel",
    label: "1er paint (HTTP)",
    color: "cyan",
  },
  { source: "ticker", target: "channel", label: "push 1 Hz", color: "orange" },
  {
    source: "channel",
    target: "studio",
    label: "abonnement (ref-compté)",
    color: "indigo",
  },
];

const LiveBranch = observer(({ height }: { height: number }) => {
  const snap = useSocketLiveData();
  const liveNodeData = useMemo(() => mapSondesLive(snap), [snap]);
  return (
    <FlowGraph
      nodes={NODES}
      edges={EDGES}
      dir="LR"
      height={height}
      ariaLabel="Patron des sondes Nodefony — temps réel actif"
      liveNodeData={liveNodeData}
    />
  );
});

export interface SondesLiveGraphProps {
  /** Active la sonde live (sinon : graphe statique, pas d'abonnement serveur). */
  live?: boolean;
  height?: number;
}

export function SondesLiveGraph({
  live = false,
  height = 540,
}: SondesLiveGraphProps) {
  if (live) return <LiveBranch height={height} />;
  return (
    <FlowGraph
      nodes={NODES}
      edges={EDGES}
      dir="LR"
      height={height}
      ariaLabel="Patron des sondes Nodefony (statique)"
    />
  );
}

export default SondesLiveGraph;
