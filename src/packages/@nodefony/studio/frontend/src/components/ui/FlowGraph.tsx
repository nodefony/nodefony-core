import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Box,
  Paper,
  Group,
  Text,
  ThemeIcon,
  Tooltip,
  Modal,
  rem,
} from "@mantine/core";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { IconMaximize } from "@tabler/icons-react";
import { MODAL_FULLSCREEN_CONTENT } from "./layout";

/* ════════════════════════════════════════════════════════════════════════
 * FlowGraph — brique de schéma RÉUTILISABLE (React Flow + dagre).
 *
 * Même moteur que l'ERD ORM (`Database.tsx`) : nœuds custom accentués, layout
 * auto dagre, fond pointillé, minimap, plein écran. Donné des nœuds/arêtes
 * logiques → rendu « beau » sans plomberie. Réutilisé par : la doc (archi/sondes),
 * le graphe de classes par module, et le futur module @nodefony/documentation.
 *
 * Mode LIVE (prop `liveNodeData`) : chaque nœud peut afficher un bandeau de
 * métriques temps réel (tabular-nums) + un dot d'état (ok/warn/down/idle).
 * Pattern « temps réel CALME » (cf skill nodefony-studio-dev) : pas d'animation
 * rejouante, transitions compositor-only (`opacity`), `contain: layout paint`
 * sur la carte pour isoler le repaint au tick.
 *
 * Cf [[project_doc_portal_faisabilite]] · [[feedback_recharts_react19]].
 * ════════════════════════════════════════════════════════════════════════ */

/** Une ligne du bandeau live (label → valeur). */
export interface LiveNodeMetric {
  label: string;
  value: string | number;
}

/** Données live attachées à un nœud du graphe (toutes optionnelles). */
export interface LiveNodeData {
  /** Bandeau sous le sous-titre (≤ 4 lignes recommandées). */
  metrics?: LiveNodeMetric[];
  /** Influence la couleur du dot. */
  status?: "ok" | "warn" | "down" | "idle";
  /**
   * Active la pulsation du dot. Animation `opacity` SEULE (compositor),
   * coupée par `prefers-reduced-motion`.
   */
  pulse?: boolean;
}

/** Données d'un nœud (la `dir` est injectée par FlowGraph, pas par l'appelant). */
export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  sub: string;
  icon: ReactNode;
  /** Clé de couleur Mantine (blue, teal, indigo…). */
  color: string;
  emphasis?: boolean;
  dir?: "TB" | "LR";
  /** Données live (injectées par FlowGraph depuis `liveNodeData[id]`). */
  live?: LiveNodeData;
}
export interface FlowGraphNode {
  id: string;
  data: FlowNodeData;
}
export interface FlowGraphEdge {
  source: string;
  target: string;
  label?: string;
  /** Couleur Mantine de l'arête (défaut : gray). */
  color?: string;
  dashed?: boolean;
}
type LayerNodeType = Node<FlowNodeData>;

/** Couleur Mantine → variable CSS (suit le thème clair/sombre). */
const mc = (color: string, shade: number) =>
  `var(--mantine-color-${color}-${shade})`;

/**
 * Injecte UNE seule fois les styles temps réel du graphe (dot + pulse). `:hover` /
 * keyframes impossibles en inline → CSS injecté. Idempotent (early return).
 */
function ensureFlowGraphLiveStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("nf-flowgraph-live-styles")) return;
  const s = document.createElement("style");
  s.id = "nf-flowgraph-live-styles";
  s.textContent = `
    .nf-fg-dot {
      width: 9px; height: 9px; border-radius: 50%;
      display: inline-block;
      transition: opacity 0.25s ease, background-color 0.25s ease;
      flex-shrink: 0;
    }
    .nf-fg-dot.is-ok { background: var(--mantine-color-teal-5); opacity: 1; }
    .nf-fg-dot.is-warn { background: var(--mantine-color-yellow-5); opacity: 0.95; }
    .nf-fg-dot.is-down { background: var(--mantine-color-red-5); opacity: 0.95; }
    .nf-fg-dot.is-idle { background: var(--mantine-color-gray-5); opacity: 0.45; }
    .nf-fg-dot.is-pulse { animation: nf-fg-pulse 2.4s ease-in-out infinite; }
    @keyframes nf-fg-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    @media (prefers-reduced-motion: reduce) {
      .nf-fg-dot { transition: none; }
      .nf-fg-dot.is-pulse { animation: none; opacity: 1; }
    }
  `;
  document.head.appendChild(s);
}

/** Nœud custom : carte accentuée (icône + titre + sous-titre + bandeau live optionnel). */
function LayerNode({ data }: NodeProps<LayerNodeType>) {
  const isLR = data.dir === "LR";
  const handleStyle = { opacity: 0, width: 1, height: 1, border: "none" };
  const live = data.live;
  const hasMetrics = !!live?.metrics && live.metrics.length > 0;
  return (
    <>
      <Handle
        type="target"
        position={isLR ? Position.Left : Position.Top}
        style={handleStyle}
      />
      <Paper
        radius="md"
        p="sm"
        withBorder
        style={{
          width: 232,
          borderColor: mc(data.color, 5),
          borderWidth: data.emphasis ? 2 : 1,
          background: `color-mix(in srgb, ${mc(data.color, 6)} 10%, var(--mantine-color-body))`,
          boxShadow: data.emphasis
            ? `0 0 0 3px color-mix(in srgb, ${mc(data.color, 6)} 22%, transparent)`
            : undefined,
          // Isole le repaint à la carte (perf temps réel sur graphe live).
          contain: "layout paint",
        }}
      >
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <ThemeIcon
            variant="light"
            color={data.color}
            size={36}
            radius="md"
            style={{ flexShrink: 0 }}
          >
            {data.icon}
          </ThemeIcon>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Group gap={6} wrap="nowrap" justify="space-between">
              <Text
                fw={700}
                size="sm"
                lh={1.2}
                lineClamp={1}
                style={{ minWidth: 0 }}
              >
                {data.label}
              </Text>
              {live && (
                <span
                  className={`nf-fg-dot is-${live.status ?? "idle"}${live.pulse ? " is-pulse" : ""}`}
                  aria-label={`État : ${live.status ?? "idle"}`}
                />
              )}
            </Group>
            <Text size="xs" c="dimmed" lh={1.25} mt={3} lineClamp={2}>
              {data.sub}
            </Text>
          </div>
        </Group>
        {hasMetrics && (
          <Box
            mt={8}
            pt={6}
            style={{
              borderTop: "1px solid var(--mantine-color-default-border)",
            }}
          >
            {live!.metrics!.map((m) => (
              <Group
                key={m.label}
                justify="space-between"
                gap={4}
                wrap="nowrap"
              >
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {m.label}
                </Text>
                <Text
                  size="xs"
                  fw={600}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {m.value}
                </Text>
              </Group>
            ))}
          </Box>
        )}
      </Paper>
      <Handle
        type="source"
        position={isLR ? Position.Right : Position.Bottom}
        style={handleStyle}
      />
    </>
  );
}

const nodeTypes = { layer: LayerNode };

/** Place les nœuds via dagre puis renvoie nœuds positionnés + arêtes stylées. */
function useFlowLayout(
  rawNodes: FlowGraphNode[],
  rawEdges: FlowGraphEdge[],
  dir: "TB" | "LR",
  liveNodeData?: Record<string, LiveNodeData>,
) {
  return useMemo(() => {
    const W = 232;
    // Hauteur dynamique : si N'IMPORTE quel nœud a des métriques live, on
    // élargit le rang dagre pour laisser respirer (sinon ça se chevauche).
    const hasAnyLive =
      !!liveNodeData &&
      rawNodes.some((n) => (liveNodeData[n.id]?.metrics?.length ?? 0) > 0);
    const H = hasAnyLive ? 132 : 86;
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({
      rankdir: dir,
      nodesep: 42,
      ranksep: hasAnyLive ? 96 : 72,
      marginx: 16,
      marginy: 16,
    });
    rawNodes.forEach((n) => g.setNode(n.id, { width: W, height: H }));
    rawEdges.forEach((e) => g.setEdge(e.source, e.target));
    dagre.layout(g);
    const nodes: LayerNodeType[] = rawNodes.map((n) => {
      const p = g.node(n.id);
      return {
        id: n.id,
        type: "layer",
        position: { x: p.x - W / 2, y: p.y - H / 2 },
        data: { ...n.data, dir, live: liveNodeData?.[n.id] },
        draggable: true,
      };
    });
    const edges: Edge[] = rawEdges.map((e, i) => ({
      id: `e${i}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      label: e.label,
      type: "smoothstep",
      animated: !e.dashed,
      style: {
        stroke: mc(e.color ?? "gray", 5),
        strokeWidth: 2,
        strokeDasharray: e.dashed ? "5 5" : undefined,
      },
      labelStyle: { fontSize: 11, fontWeight: 600 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 6,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: mc(e.color ?? "gray", 5),
      },
    }));
    return { nodes, edges };
  }, [rawNodes, rawEdges, dir, liveNodeData]);
}

export interface FlowGraphProps {
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
  dir?: "TB" | "LR";
  height?: number;
  ariaLabel: string;
  /**
   * Données live par nodeId — bandeau métriques + dot d'état. Quand fournie,
   * la hauteur des nœuds augmente automatiquement (dagre re-layout).
   */
  liveNodeData?: Record<string, LiveNodeData>;
}

/** Schéma React Flow prêt à l'emploi (fond, contrôles, minimap, plein écran). */
export function FlowGraph({
  nodes,
  edges,
  dir = "TB",
  height = 440,
  ariaLabel,
  liveNodeData,
}: FlowGraphProps) {
  useEffect(() => ensureFlowGraphLiveStyles(), []);
  const colorScheme =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-mantine-color-scheme") ===
      "light"
      ? "light"
      : "dark";
  const laid = useFlowLayout(nodes, edges, dir, liveNodeData);
  const [full, setFull] = useState(false);

  const flow = (h: number | string) => (
    <Box
      role="img"
      aria-label={ariaLabel}
      style={{
        height: h,
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: rem(10),
        overflow: "hidden",
        contain: "content",
      }}
    >
      <ReactFlow
        nodes={laid.nodes}
        edges={laid.edges}
        nodeTypes={nodeTypes}
        colorMode={colorScheme}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnScroll
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeStrokeWidth={3} />
      </ReactFlow>
    </Box>
  );

  return (
    <>
      <Box pos="relative">
        <Tooltip label="Plein écran">
          <Box
            component="button"
            onClick={() => setFull(true)}
            aria-label="Agrandir le schéma"
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              zIndex: 5,
              cursor: "pointer",
              border: "1px solid var(--mantine-color-default-border)",
              background: "var(--mantine-color-body)",
              borderRadius: rem(8),
              padding: rem(6),
              lineHeight: 0,
            }}
          >
            <IconMaximize size={16} />
          </Box>
        </Tooltip>
        {flow(height)}
      </Box>
      <Modal
        opened={full}
        onClose={() => setFull(false)}
        fullScreen
        radius={0}
        title={ariaLabel}
      >
        {flow(MODAL_FULLSCREEN_CONTENT)}
      </Modal>
    </>
  );
}

export default FlowGraph;
