import { useMemo } from "react";
import { observer } from "mobx-react-lite";
import {
  IconArrowBackUp,
  IconBook2,
  IconDeviceDesktop,
  IconHistory,
  IconPlayerPlay,
  IconRouteSquare,
  IconShieldCheck,
} from "@tabler/icons-react";
import {
  FlowGraph,
  type FlowGraphEdge,
  type FlowGraphNode,
} from "../../components/ui";
import { mapActionsLive, useSocketLiveData } from "./useSocketLiveData";

/* ════════════════════════════════════════════════════════════════════════
 * ActionsLiveGraph — schéma « pipeline d'une action RPC » de la Socket.
 *
 * Direction « contrôle » (vs « observation » des sondes). Le trajet RÉEL d'une
 * frame avec `id`, tel que `JsonRpcPeer` le fait tourner :
 *
 *   request → résolution de méthode → beforeDispatch → handler → result
 *
 * Deux choses que ce schéma ne raconte volontairement PAS :
 *  - il n'y a aucune étape de validation générique des `params` : `-32602` est
 *    écrit à la main PAR un handler qui contrôle ses entrées, pas par le
 *    pipeline. La validation vit donc DANS le nœud handler ;
 *  - `realtime:welcome` n'est pas une étape par requête : il est émis une seule
 *    fois au handshake pour annoncer le registre. D'où son arête pointillée
 *    latérale vers la résolution, plutôt qu'un maillon de la chaîne.
 *
 * Le seam d'audit `onFrameAudit` ne se déclenche QUE sur rejet (invalid, denied,
 * method_not_found, internal_error) — une `RpcError` assumée par un handler n'est
 * délibérément pas auditée. Il vit donc sur les branches d'erreur, pas sur le
 * chemin de succès.
 *
 * Pattern « 0 ticker quand OFF » via `<LiveBranch>` (cf frères du dossier).
 * ════════════════════════════════════════════════════════════════════════ */

/** Nœuds figés du pipeline Actions. */
const NODES: FlowGraphNode[] = [
  {
    id: "request",
    data: {
      label: "client.request()",
      sub: "frame JSON-RPC avec `id` · attend une réponse",
      icon: <IconDeviceDesktop size={20} />,
      color: "blue",
    },
  },
  {
    id: "welcome",
    data: {
      label: "realtime:welcome",
      sub: "Registre annoncé UNE fois au handshake · découvrabilité",
      icon: <IconBook2 size={20} />,
      color: "cyan",
    },
  },
  {
    id: "resolve",
    data: {
      label: "Résolution de méthode",
      sub: "actions.get(method) · inconnue → -32601 method not found",
      icon: <IconRouteSquare size={20} />,
      color: "cyan",
    },
  },
  {
    id: "authz",
    data: {
      label: "beforeDispatch",
      sub: "Zero Trust · peer.roles (server-derived) · refus → -32001",
      icon: <IconShieldCheck size={20} />,
      color: "red",
    },
  },
  {
    id: "handler",
    data: {
      label: "Handler",
      sub: "Logique métier · valide SES params (-32602) · throw = -32603 générique",
      icon: <IconPlayerPlay size={20} />,
      color: "indigo",
      emphasis: true,
    },
  },
  {
    id: "audit",
    data: {
      label: "onFrameAudit",
      sub: "Seam d'audit sur REJET : invalid · denied · method_not_found · internal_error",
      icon: <IconHistory size={20} />,
      color: "grape",
    },
  },
  {
    id: "result",
    data: {
      label: "Result | Error",
      sub: "Frame de retour avec même `id` · result ou error",
      icon: <IconArrowBackUp size={20} />,
      color: "teal",
    },
  },
];

const EDGES: FlowGraphEdge[] = [
  { source: "request", target: "resolve", label: "method", color: "blue" },
  // Annotation latérale : le registre est annoncé au handshake, il ne traverse
  // pas le pipeline à chaque requête.
  {
    source: "welcome",
    target: "resolve",
    label: "registre (1× au handshake)",
    color: "cyan",
    dashed: true,
    animated: false,
  },
  {
    source: "resolve",
    target: "authz",
    label: "méthode connue",
    color: "cyan",
  },
  { source: "authz", target: "handler", label: "autorisé", color: "red" },
  { source: "handler", target: "result", label: "result", color: "indigo" },
  { source: "result", target: "request", label: "même id", color: "teal" },
  // Branches d'ERREUR — le seul chemin qui déclenche le seam d'audit.
  {
    source: "resolve",
    target: "audit",
    label: "-32601",
    color: "grape",
    dashed: true,
  },
  {
    source: "authz",
    target: "audit",
    label: "-32001 · realtime:denied",
    color: "grape",
    dashed: true,
  },
  {
    source: "handler",
    target: "audit",
    label: "throw → -32603",
    color: "grape",
    dashed: true,
  },
  {
    source: "audit",
    target: "result",
    label: "error",
    color: "grape",
    dashed: true,
  },
];

const LiveBranch = observer(({ height }: { height: number }) => {
  const snap = useSocketLiveData();
  const liveNodeData = useMemo(() => mapActionsLive(snap), [snap]);
  return (
    <FlowGraph
      nodes={NODES}
      edges={EDGES}
      dir="TB"
      height={height}
      ariaLabel="Pipeline d'une action RPC — temps réel actif"
      liveNodeData={liveNodeData}
    />
  );
});

export interface ActionsLiveGraphProps {
  /** Active la sonde live (sinon : graphe statique, pas d'abonnement serveur). */
  live?: boolean;
  height?: number;
}

export function ActionsLiveGraph({
  live = false,
  height = 600,
}: ActionsLiveGraphProps) {
  if (live) return <LiveBranch height={height} />;
  return (
    <FlowGraph
      nodes={NODES}
      edges={EDGES}
      dir="TB"
      height={height}
      ariaLabel="Pipeline d'une action RPC (statique)"
    />
  );
}

export default ActionsLiveGraph;
