import { useCallback, useEffect, useState } from "react";
import { observer } from "mobx-react-lite";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { type CSSProperties } from "react";
import {
  Group,
  Title,
  Select,
  Badge,
  Text,
  Stack,
  Paper,
  Loader,
  Tooltip,
  ActionIcon,
  Alert,
  useComputedColorScheme,
} from "@mantine/core";
import {
  IconDatabase,
  IconKey,
  IconRefresh,
  IconCopy,
  IconCheck,
} from "@tabler/icons-react";
import { useStore } from "../stores";

// ── Types miroir du data plane /nodefony/orm/api (graphe canonique) ──────────
interface ColumnInfo {
  name: string;
  type: string;
  primaryKey: boolean;
  nullable: boolean;
  unique: boolean;
}
interface RelationInfo {
  type: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";
  target: string;
  field: string;
  foreignKey?: string;
}
interface EntityNode {
  name: string;
  orm: string;
  columns: ColumnInfo[];
  relations: RelationInfo[];
}
interface OrmSummary {
  name: string;
  default: boolean;
  connected: boolean;
  entityCount: number;
}
interface OrmGraph {
  orms: OrmSummary[];
  entities: EntityNode[];
}

type TableNodeData = { entity: EntityNode };

const NODE_W = 250;
const HEADER_H = 40;
const ROW_H = 24;

const camelFk = (target: string) =>
  `${target.charAt(0).toLowerCase()}${target.slice(1)}Id`;

const REL_LABEL: Record<RelationInfo["type"], string> = {
  "one-to-one": "1—1",
  "one-to-many": "1—N",
  "many-to-one": "N—1",
  "many-to-many": "N—N",
};

/**
 * Relie le thème React Flow aux variables CSS Mantine → le canvas suit le
 * Studio (fond = `--mantine-color-body`, pas le noir par défaut) et bascule
 * light/dark avec le scheme. Posé sur `style` de `<ReactFlow>` (les vars
 * cascadent vers Background/Controls/MiniMap/edges).
 */
const RF_THEME = {
  width: "100%",
  height: "100%",
  "--xy-background-color": "var(--mantine-color-body)",
  "--xy-background-pattern-color": "var(--mantine-color-default-border)",
  "--xy-edge-stroke": "var(--mantine-color-blue-5)",
  "--xy-edge-stroke-selected": "var(--mantine-primary-color-filled)",
  "--xy-connectionline-stroke": "var(--mantine-color-blue-5)",
  "--xy-controls-button-background-color": "var(--mantine-color-default)",
  "--xy-controls-button-background-color-hover":
    "var(--mantine-color-default-hover)",
  "--xy-controls-button-color": "var(--mantine-color-text)",
  "--xy-controls-button-color-hover": "var(--mantine-color-text)",
  "--xy-controls-button-border-color": "var(--mantine-color-default-border)",
  "--xy-minimap-background-color": "var(--mantine-color-default)",
  "--xy-minimap-mask-background-color":
    "color-mix(in srgb, var(--mantine-color-body) 70%, transparent)",
} as unknown as CSSProperties;

/** Nœud « table » de l'ERD : nom d'entité + colonnes (PK/FK/unique typées). */
function TableNode({ data }: NodeProps) {
  const { entity } = data as unknown as TableNodeData;
  // FK = colonnes portées côté source (many-to-one / one-to-one).
  const fk = new Set<string>();
  for (const r of entity.relations) {
    if (r.type === "many-to-one" || r.type === "one-to-one") {
      fk.add(r.foreignKey ?? camelFk(r.target));
    }
  }
  return (
    <div
      style={{
        width: NODE_W,
        borderRadius: 8,
        border: "1px solid var(--mantine-color-default-border)",
        background: "var(--mantine-color-body)",
        boxShadow: "var(--mantine-shadow-sm)",
        fontSize: 12,
        overflow: "hidden",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div
        style={{
          height: HEADER_H,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 10px",
          background: "var(--mantine-primary-color-light)",
          color: "var(--mantine-primary-color-light-color)",
          fontWeight: 600,
          borderBottom: "1px solid var(--mantine-color-default-border)",
        }}
      >
        <IconDatabase size={14} />
        <span style={{ flex: 1 }}>{entity.name}</span>
        <span style={{ opacity: 0.6, fontSize: 10 }}>{entity.orm}</span>
      </div>
      <div>
        {entity.columns.length === 0 && (
          <div style={{ height: ROW_H, lineHeight: `${ROW_H}px`, padding: "0 10px", color: "var(--mantine-color-dimmed)" }}>
            (colonnes non introspectées)
          </div>
        )}
        {entity.columns.map((c) => (
          <div
            key={c.name}
            style={{
              height: ROW_H,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 10px",
              borderTop: "1px solid var(--mantine-color-default-border)",
            }}
          >
            {c.primaryKey ? (
              <IconKey size={11} color="var(--mantine-color-yellow-6)" />
            ) : fk.has(c.name) ? (
              <span style={{ fontSize: 9, color: "var(--mantine-color-blue-5)", fontWeight: 700 }}>FK</span>
            ) : (
              <span style={{ width: 11 }} />
            )}
            <span
              style={{
                flex: 1,
                fontWeight: c.primaryKey ? 600 : 400,
                color: "var(--mantine-color-text)",
              }}
            >
              {c.name}
              {c.unique && !c.primaryKey ? " ◦" : ""}
            </span>
            <span style={{ color: "var(--mantine-color-dimmed)", fontSize: 11 }}>
              {c.type}
              {c.nullable ? "?" : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const nodeTypes = { table: TableNode };

/** Hauteur estimée d'un nœud (pour le layout dagre). */
const nodeHeight = (e: EntityNode) =>
  HEADER_H + Math.max(1, e.columns.length) * ROW_H + 2;

/** Place les entités via dagre (gauche→droite) et construit nœuds + arêtes. */
function layoutGraph(entities: EntityNode[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 45, ranksep: 90 });
  g.setDefaultEdgeLabel(() => ({}));
  const names = new Set(entities.map((e) => e.name));
  for (const e of entities) {
    g.setNode(e.name, { width: NODE_W, height: nodeHeight(e) });
  }
  // Une FK physique peut être déclarée des deux côtés (1-N côté source + N-1 côté
  // cible) → on canonicalise chaque relation en arête `FK → PK` (sens ERD) et on
  // dédup par clé FK pour ne tracer qu'une arête par FK.
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const e of entities) {
    for (const r of e.relations) {
      if (!names.has(r.target)) continue; // relation hors du périmètre filtré
      if (r.type === "many-to-many") {
        const key = [e.name, r.target].sort().join("<>");
        if (seen.has(key)) continue;
        seen.add(key);
        g.setEdge(e.name, r.target);
        edges.push({
          id: `m2m-${key}`,
          source: e.name,
          target: r.target,
          type: "smoothstep",
          animated: true,
          label: REL_LABEL["many-to-many"],
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: "var(--mantine-color-grape-5)", strokeDasharray: "5 5" },
        });
        continue;
      }
      // FK canonique : table portant la FK → table portant la PK ciblée.
      const fkTable = r.type === "one-to-many" ? r.target : e.name;
      const pkTable = r.type === "one-to-many" ? e.name : r.target;
      const fk =
        r.foreignKey ??
        camelFk(r.type === "one-to-many" ? e.name : r.target);
      const key = `${fkTable}.${fk}>${pkTable}`;
      if (seen.has(key)) continue;
      seen.add(key);
      g.setEdge(fkTable, pkTable);
      edges.push({
        id: key,
        source: fkTable,
        target: pkTable,
        type: "smoothstep",
        animated: false,
        label:
          r.type === "one-to-one"
            ? REL_LABEL["one-to-one"]
            : REL_LABEL["many-to-one"],
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: "var(--mantine-color-blue-5)" },
      });
    }
  }
  dagre.layout(g);
  const nodes: Node[] = entities.map((e) => {
    const p = g.node(e.name);
    return {
      id: e.name,
      type: "table",
      position: { x: p.x - NODE_W / 2, y: p.y - nodeHeight(e) / 2 },
      data: { entity: e },
    };
  });
  return { nodes, edges };
}

/**
 * Page **ERD** du panneau ORM Studio — visualise le graphe canonique
 * (`/nodefony/orm/api/graph`) avec React Flow : un nœud table par entité
 * (colonnes PK/FK/unique typées), arêtes = relations déclarées, auto-layout
 * dagre (gauche→droite), pan/zoom/drag. Sélecteur de connecteur + copie DBML
 * (format pivot IA). Fondation visuelle de la couche IA/data-analyse.
 */
export const Database = observer(() => {
  const store = useStore();
  const scheme = useComputedColorScheme("dark");
  const [orms, setOrms] = useState<OrmSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [entityCount, setEntityCount] = useState(0);

  // Liste des connecteurs (sélecteur) + choix initial = ORM par défaut.
  useEffect(() => {
    store.api
      .getAbsolute<OrmSummary[]>("/nodefony/orm/api/orms")
      .then((list) => {
        setOrms(list);
        setSelected(
          (s) => s ?? list.find((o) => o.default)?.name ?? list[0]?.name ?? null,
        );
        if (list.length === 0) setLoading(false);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "orms failed"),
      );
  }, [store]);

  const loadGraph = useCallback(
    (orm: string) => {
      setLoading(true);
      store.api
        .getAbsolute<OrmGraph>(
          `/nodefony/orm/api/graph?orm=${encodeURIComponent(orm)}`,
        )
        .then((g) => {
          setEntityCount(g.entities.length);
          const laid = layoutGraph(g.entities);
          setNodes(laid.nodes);
          setEdges(laid.edges);
          setError(null);
        })
        .catch((e: unknown) =>
          setError(e instanceof Error ? e.message : "graph failed"),
        )
        .finally(() => setLoading(false));
    },
    [store, setNodes, setEdges],
  );

  useEffect(() => {
    if (selected) loadGraph(selected);
  }, [selected, loadGraph]);

  const copyDbml = useCallback(() => {
    if (!selected) return;
    store.api
      .getAbsolute<{ content: string }>(
        `/nodefony/orm/api/export/dbml?orm=${encodeURIComponent(selected)}`,
      )
      .then((r) => navigator.clipboard.writeText(r.content))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }, [store, selected]);

  return (
    <Stack gap="md" style={{ height: "100%" }}>
      <Group justify="space-between">
        <Group gap="xs">
          <IconDatabase size={20} />
          <Title order={2}>ORM — Modèle de données</Title>
          <Badge variant="light" color="brand">
            ERD
          </Badge>
          <Text size="sm" c="dimmed">
            {entityCount} entités · {edges.length} relations
          </Text>
        </Group>
        <Group gap="xs">
          <Select
            data={orms.map((o) => ({
              value: o.name,
              label: `${o.name}${o.default ? " (défaut)" : ""}${o.connected ? "" : " ⚠"}`,
            }))}
            value={selected}
            onChange={setSelected}
            size="xs"
            style={{ width: 220 }}
            placeholder="connecteur…"
          />
          <Tooltip label="Copier le schéma DBML (pivot IA)">
            <ActionIcon variant="default" onClick={copyDbml} aria-label="copy dbml">
              {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Rafraîchir">
            <ActionIcon
              variant="default"
              onClick={() => selected && loadGraph(selected)}
              aria-label="refresh"
            >
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {error && (
        <Alert color="red" variant="light" title="Erreur">
          {error}
        </Alert>
      )}

      <Paper
        withBorder
        style={{
          // Hauteur DÉFINIE obligatoire : React Flow est en height:100% → un
          // simple minHeight (parent height:auto) le résout à 0 = canvas vide.
          height: "calc(100vh - 210px)",
          minHeight: 480,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {loading && (
          <Group justify="center" align="center" style={{ position: "absolute", inset: 0, zIndex: 5 }}>
            <Loader size="sm" />
          </Group>
        )}
        {!loading && nodes.length === 0 ? (
          <Group justify="center" align="center" style={{ position: "absolute", inset: 0 }}>
            <Text c="dimmed" size="sm">
              Aucune entité pour ce connecteur.
            </Text>
          </Group>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            colorMode={scheme}
            style={RF_THEME}
            fitView
            fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
            minZoom={0.1}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        )}
      </Paper>
    </Stack>
  );
});
