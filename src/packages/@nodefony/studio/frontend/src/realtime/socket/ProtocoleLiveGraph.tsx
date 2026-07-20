import { useMemo } from "react";
import { observer } from "mobx-react-lite";
import {
  IconArrowDown,
  IconCpu,
  IconDeviceDesktop,
  IconHash,
  IconNotification,
} from "@tabler/icons-react";
import {
  FlowGraph,
  type FlowGraphEdge,
  type FlowGraphNode,
} from "../../components/ui";
import { mapProtocoleLive, useSocketLiveData } from "./useSocketLiveData";

/* ════════════════════════════════════════════════════════════════════════
 * ProtocoleLiveGraph — schéma « JSON-RPC 2.0 » de la Socket.
 *
 * Quatre types de frames entre Client et Server, croisées par 2 axes :
 *   axe 1 : direction (client→server ou server→client)
 *   axe 2 : `id` présent (RPC request/response) ou absent (notification)
 *
 *   sans `id` (notification, fire-and-forget) :
 *     - notifyOut : subscribe / unsubscribe / publish        (client → server)
 *     - notifyIn  : channel push / realtime:welcome          (server → client)
 *
 *   avec `id` (requête RPC, round-trip attendu) :
 *     - request   : kernel:ping, …                            (client → server)
 *     - response  : result / error                            (server → client)
 *
 * Pattern « 0 ticker quand OFF » : abonnement vit dans `<LiveBranch>`,
 * monté seulement si `live={true}` (cf [[project_realtime_socket_probe]]).
 * ════════════════════════════════════════════════════════════════════════ */

/** Nœuds figés du graphe Protocole. */
const NODES: FlowGraphNode[] = [
  {
    id: "client",
    data: {
      label: "RealtimeClient",
      sub: "Navigateur · JsonRpcPeer (isomorphe)",
      icon: <IconDeviceDesktop size={20} />,
      color: "blue",
    },
  },
  {
    id: "notifyOut",
    data: {
      label: "subscribe / publish",
      sub: "notification client→server · pas de `id`",
      icon: <IconArrowDown size={20} />,
      color: "cyan",
    },
  },
  {
    id: "request",
    data: {
      label: "request",
      sub: "kernel:ping, … · avec `id`",
      icon: <IconHash size={20} />,
      color: "violet",
    },
  },
  {
    id: "server",
    data: {
      label: "RealtimeController",
      sub: "Hub broker · dispatch + actions",
      icon: <IconCpu size={20} />,
      color: "indigo",
      emphasis: true,
    },
  },
  {
    id: "response",
    data: {
      label: "response",
      sub: "result / error · même `id` que la request",
      icon: <IconHash size={20} />,
      color: "grape",
    },
  },
  {
    id: "notifyIn",
    data: {
      label: "channel push / welcome",
      sub: "notification server→client · pas de `id`",
      icon: <IconNotification size={20} />,
      color: "teal",
    },
  },
];

/** Les 4 chemins de frames. Suffisant en live : chaque nœud y porte son état. */
const EDGES_LIVE: FlowGraphEdge[] = [
  // Sans id — pub/sub fire-and-forget.
  { source: "client", target: "notifyOut", label: "sans id", color: "cyan" },
  { source: "notifyOut", target: "server", label: "method", color: "cyan" },
  // Avec id — round-trip RPC.
  { source: "client", target: "request", label: "avec id", color: "violet" },
  { source: "request", target: "server", label: "method", color: "violet" },
  { source: "server", target: "response", label: "même id", color: "grape" },
  {
    source: "response",
    target: "client",
    label: "result | error",
    color: "grape",
  },
  // Sans id — push server→client (le gros volume).
  {
    source: "server",
    target: "notifyIn",
    label: "method = channel",
    color: "teal",
  },
  { source: "notifyIn", target: "client", label: "payload", color: "teal" },
];

/**
 * Rendu statique : on ajoute le rappel « tout passe par une seule WSS ». En live
 * cette arête doublonnerait les 4 chemins déjà tracés (le raccourci client→server
 * se superpose visuellement à notifyOut→server), sans rien mesurer.
 */
const EDGES_STATIC: FlowGraphEdge[] = [
  ...EDGES_LIVE,
  {
    source: "client",
    target: "server",
    label: "WSS frames JSON-RPC 2.0",
    color: "blue",
  },
];

const LiveBranch = observer(({ height }: { height: number }) => {
  const snap = useSocketLiveData();
  const liveNodeData = useMemo(() => mapProtocoleLive(snap), [snap]);
  return (
    <FlowGraph
      nodes={NODES}
      edges={EDGES_LIVE}
      dir="TB"
      height={height}
      ariaLabel="Protocole JSON-RPC 2.0 — temps réel actif"
      liveNodeData={liveNodeData}
    />
  );
});

export interface ProtocoleLiveGraphProps {
  /** Active la sonde live (sinon : graphe statique, pas d'abonnement serveur). */
  live?: boolean;
  height?: number;
}

export function ProtocoleLiveGraph({
  live = false,
  height = 540,
}: ProtocoleLiveGraphProps) {
  if (live) return <LiveBranch height={height} />;
  return (
    <FlowGraph
      nodes={NODES}
      edges={EDGES_STATIC}
      dir="TB"
      height={height}
      ariaLabel="Protocole JSON-RPC 2.0 (statique)"
    />
  );
}

export default ProtocoleLiveGraph;
