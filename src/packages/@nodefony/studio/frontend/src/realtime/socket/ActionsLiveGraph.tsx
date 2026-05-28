import { useMemo } from "react";
import { observer } from "mobx-react-lite";
import {
  IconArrowBackUp,
  IconBook2,
  IconChecks,
  IconDeviceDesktop,
  IconHistory,
  IconPlayerPlay,
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
 * Direction « contrôle » (vs « observation » des sondes). Une frame avec `id`
 * traverse 7 étapes côté serveur, dans cet ordre strict :
 *
 *   1. request   — client.request("orm:vacuum", params) avec `id`
 *   2. welcome   — registry des méthodes (annoncé au handshake)
 *   3. authz     — Zero Trust : check peer.roles (server-derived)
 *   4. validate  — Zod / schéma sur params
 *   5. handler   — logique métier (best-effort, throw = -32603 générique)
 *   6. audit     — log who/what/when (table audit, P6)
 *   7. result    — frame de retour (result OU error -32403/-32602/-32603)
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
      sub: "Registry des méthodes · découvrabilité côté Studio",
      icon: <IconBook2 size={20} />,
      color: "cyan",
    },
  },
  {
    id: "authz",
    data: {
      label: "Authz",
      sub: "Zero Trust · peer.roles (server-derived, pas params)",
      icon: <IconShieldCheck size={20} />,
      color: "red",
    },
  },
  {
    id: "validate",
    data: {
      label: "Validate",
      sub: "Schéma Zod sur params · -32602 si invalide",
      icon: <IconChecks size={20} />,
      color: "yellow",
    },
  },
  {
    id: "handler",
    data: {
      label: "Handler",
      sub: "Logique métier · throw = -32603 (message générique)",
      icon: <IconPlayerPlay size={20} />,
      color: "indigo",
      emphasis: true,
    },
  },
  {
    id: "audit",
    data: {
      label: "Audit log",
      sub: "Mutables : who · what · when · params hash · outcome",
      icon: <IconHistory size={20} />,
      color: "grape",
    },
  },
  {
    id: "result",
    data: {
      label: "Result | Error",
      sub: "Frame de retour avec même `id` · OK ou -32403/-32603",
      icon: <IconArrowBackUp size={20} />,
      color: "teal",
    },
  },
];

const EDGES: FlowGraphEdge[] = [
  { source: "request", target: "welcome", label: "method ?", color: "cyan" },
  {
    source: "welcome",
    target: "authz",
    label: "method connue",
    color: "cyan",
  },
  { source: "authz", target: "validate", label: "rôle OK", color: "red" },
  {
    source: "validate",
    target: "handler",
    label: "params valides",
    color: "yellow",
  },
  {
    source: "handler",
    target: "audit",
    label: "si mutable",
    color: "indigo",
  },
  {
    source: "audit",
    target: "result",
    label: "tracé",
    color: "grape",
  },
  {
    source: "result",
    target: "request",
    label: "même id",
    color: "teal",
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
