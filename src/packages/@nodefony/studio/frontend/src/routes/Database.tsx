import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type ReactFlowInstance,
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
  Menu,
  Button,
  SegmentedControl,
  useComputedColorScheme,
} from "@mantine/core";
import {
  IconDatabase,
  IconKey,
  IconRefresh,
  IconCheck,
  IconDownload,
  IconBraces,
  IconSearch,
  IconTarget,
  IconArrowsMaximize,
} from "@tabler/icons-react";
import { useNavigate } from "react-router";
import { useStore } from "../stores";
import {
  PageLayout,
  DocHint,
  DataGrid,
  PAGE_CONTENT_HEIGHT_WITH_BAND,
  type DataGridColumn,
} from "../components/ui";

/** Version de la doc des fiches d'aide (`DocHint`) de la vue base de données. */
const DB_DOC = "v1.0";

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
  connector: string;
  /** Module Nodefony propriétaire (`""` = non rattaché → groupe « — »). */
  module: string;
  /** Classification (domaine fonctionnel) — axe de regroupement prioritaire si présent. */
  domain: string;
  columns: ColumnInfo[];
  relations: RelationInfo[];
}

/**
 * Clé de regroupement ERD : le **domaine** (classification, ex. `facturation`)
 * s'il est renseigné, sinon le **module** (propriété). Permet de subdiviser une
 * grosse base mono-module (Dolibarr : 1 module, 34 domaines).
 */
const groupKey = (e: EntityNode): string => e.domain || e.module || "";
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

/** Valeur d'option pour le groupe « non rattaché » (module vide). */
const NONE = "·none·";

/** Palette Mantine cyclée pour distinguer les modules dans l'ERD. */
const MODULE_COLORS = [
  "blue",
  "grape",
  "teal",
  "orange",
  "cyan",
  "pink",
  "lime",
  "indigo",
  "violet",
  "green",
];

/**
 * Couleur Mantine déterministe d'un module (hash du nom → palette). Vide → gris
 * (groupe « non rattaché »). Stable entre rendus → même couleur nœud + légende.
 */
function moduleColor(module: string): string {
  if (!module) return "gray";
  let h = 0;
  for (let i = 0; i < module.length; i += 1) {
    h = (h * 31 + module.charCodeAt(i)) >>> 0;
  }
  return MODULE_COLORS[h % MODULE_COLORS.length];
}

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
  const color = moduleColor(groupKey(entity));
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
          background: `var(--mantine-color-${color}-light)`,
          color: `var(--mantine-color-${color}-light-color)`,
          fontWeight: 600,
          borderBottom: "1px solid var(--mantine-color-default-border)",
        }}
      >
        <IconDatabase size={14} />
        <span style={{ flex: 1 }}>{entity.name}</span>
        <span style={{ opacity: 0.7, fontSize: 10 }}>
          {groupKey(entity) || "—"}
        </span>
      </div>
      <div>
        {entity.columns.length === 0 && (
          <div
            style={{
              height: ROW_H,
              lineHeight: `${ROW_H}px`,
              padding: "0 10px",
              color: "var(--mantine-color-dimmed)",
            }}
          >
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
              <span
                style={{
                  fontSize: 9,
                  color: "var(--mantine-color-blue-5)",
                  fontWeight: 700,
                }}
              >
                FK
              </span>
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
            <span
              style={{ color: "var(--mantine-color-dimmed)", fontSize: 11 }}
            >
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

/** Place les entités via dagre (gauche→droite) et construit nœuds + arêtes.
 *  `rootName` (optionnel, mode focus) = nœud surligné + arêtes incidentes accentuées. */
function layoutGraph(
  entities: EntityNode[],
  rootName?: string,
): { nodes: Node[]; edges: Edge[] } {
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
        const incident = rootName === e.name || rootName === r.target;
        edges.push({
          id: `m2m-${key}`,
          source: e.name,
          target: r.target,
          type: "smoothstep",
          animated: true,
          label: REL_LABEL["many-to-many"],
          markerEnd: { type: MarkerType.ArrowClosed },
          style: {
            stroke: incident
              ? "var(--mantine-primary-color-filled)"
              : "var(--mantine-color-grape-5)",
            strokeDasharray: "5 5",
            strokeWidth: incident ? 2 : 1,
          },
        });
        continue;
      }
      // FK canonique : table portant la FK → table portant la PK ciblée.
      const fkTable = r.type === "one-to-many" ? r.target : e.name;
      const pkTable = r.type === "one-to-many" ? e.name : r.target;
      const fk =
        r.foreignKey ?? camelFk(r.type === "one-to-many" ? e.name : r.target);
      const key = `${fkTable}.${fk}>${pkTable}`;
      if (seen.has(key)) continue;
      seen.add(key);
      g.setEdge(fkTable, pkTable);
      const incident = rootName === fkTable || rootName === pkTable;
      edges.push({
        id: key,
        source: fkTable,
        target: pkTable,
        type: "smoothstep",
        animated: incident,
        label:
          r.type === "one-to-one"
            ? REL_LABEL["one-to-one"]
            : REL_LABEL["many-to-one"],
        markerEnd: { type: MarkerType.ArrowClosed },
        style: {
          stroke: incident
            ? "var(--mantine-primary-color-filled)"
            : "var(--mantine-color-blue-5)",
          strokeWidth: incident ? 2 : 1,
        },
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
      style:
        e.name === rootName
          ? {
              outline: "3px solid var(--mantine-primary-color-filled)",
              outlineOffset: 2,
              borderRadius: 8,
            }
          : undefined,
    };
  });
  return { nodes, edges };
}

/**
 * Sous-graphe « focus » : la table `root` + ses voisines à `depth` sauts (BFS sur
 * les relations dans LES DEUX SENS — tables qu'elle référence ET qui la
 * référencent). Rend une grosse base (410 tables) lisible en ne montrant qu'un
 * voisinage. `depth=1` = relations directes ; `depth=2` = + voisines des voisines.
 */
function neighborhood(
  entities: EntityNode[],
  root: string,
  depth: number,
): EntityNode[] {
  const byName = new Map(entities.map((e) => [e.name, e]));
  if (!byName.has(root)) return [];
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    let s = adj.get(a);
    if (!s) {
      s = new Set();
      adj.set(a, s);
    }
    s.add(b);
  };
  for (const e of entities) {
    for (const r of e.relations) {
      if (!byName.has(r.target)) continue;
      link(e.name, r.target);
      link(r.target, e.name);
    }
  }
  const keep = new Set<string>([root]);
  let frontier = [root];
  for (let d = 0; d < depth; d += 1) {
    const next: string[] = [];
    for (const n of frontier) {
      for (const m of adj.get(n) ?? []) {
        if (!keep.has(m)) {
          keep.add(m);
          next.push(m);
        }
      }
    }
    frontier = next;
  }
  return entities.filter((e) => keep.has(e.name));
}

/** Au-delà de ce nombre de tables, on n'auto-rend pas le graphe complet (focus requis). */
const LARGE_GRAPH = 60;

/** Ligne de la vue Liste (inventaire des entités). */
interface ListRow {
  name: string;
  group: string;
  cols: number;
  rels: number;
  /** Nb de lignes : `null` = pas encore chargé, `-1` = non comptable (ORM déconnecté). */
  rows: number | null;
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
  // Entités brutes du connecteur (avant filtre module) + filtre module courant.
  const [allEntities, setAllEntities] = useState<EntityNode[]>([]);
  const [moduleFilter, setModuleFilter] = useState<string | null>(null);
  // Focus = table ciblée par la recherche → sous-graphe (table + voisines).
  const [focus, setFocus] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  // Au-delà de LARGE_GRAPH tables sans focus, on attend un choix (perf) sauf override.
  const [showAll, setShowAll] = useState(false);
  // Instance React Flow (capturée au montage) pour cadrer le sous-graphe (fitView).
  const rfRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const navigate = useNavigate();
  // Vue : diagramme (relations / focus) ou liste triable (inventaire + stats).
  const [view, setView] = useState<"graph" | "list">("graph");
  // Nb de lignes par table — lazy (chargé à l'ouverture de la Liste), par connecteur.
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  // Groupes présents (domaine sinon module) — légende + filtre. "" = non rattaché.
  const modules = useMemo(
    () => [...new Set(allEntities.map(groupKey))].sort(),
    [allEntities],
  );

  // Noms de tables (options de recherche), triés.
  const entityNames = useMemo(
    () => allEntities.map((e) => e.name).sort((a, b) => a.localeCompare(b)),
    [allEntities],
  );

  // Périmètre visible : focus (sous-graphe) > filtre module > tout (gardé si grand).
  const { visible, oversized, totalBase } = useMemo(() => {
    if (focus) {
      return {
        visible: neighborhood(allEntities, focus, depth),
        oversized: false,
        totalBase: 0,
      };
    }
    const base = moduleFilter
      ? allEntities.filter((e) => (groupKey(e) || NONE) === moduleFilter)
      : allEntities;
    if (base.length > LARGE_GRAPH && !showAll) {
      return {
        visible: [] as EntityNode[],
        oversized: true,
        totalBase: base.length,
      };
    }
    return { visible: base, oversized: false, totalBase: base.length };
  }, [allEntities, moduleFilter, focus, depth, showAll]);

  // Inventaire (vue Liste) — filtré par groupe, indépendant du focus graphe.
  // Le tri + la pagination sont délégués au composant <DataGrid> (mode client).
  const listRows = useMemo<ListRow[]>(() => {
    // Liste = TOUTES les entités du connecteur ; le <DataGrid> gère recherche + filtre groupe.
    return allEntities.map((e) => ({
      name: e.name,
      group: groupKey(e) || "—",
      cols: e.columns.length,
      rels: e.relations.length,
      rows: counts ? (counts[e.name] ?? null) : null,
    }));
  }, [allEntities, counts]);

  // Counts (nb lignes) — lazy : chargés à l'ouverture de la Liste, par connecteur.
  const loadCounts = useCallback(
    (orm: string) => {
      store.api
        .getAbsolute<Record<string, number>>(
          `/nodefony/orm/api/counts?connector=${encodeURIComponent(orm)}`,
        )
        .then(setCounts)
        .catch(() => setCounts({}));
    },
    [store],
  );
  useEffect(() => {
    if (view === "list" && selected && counts === null) loadCounts(selected);
  }, [view, selected, counts, loadCounts]);

  // Navigation vers la page détail d'une entité (clic nœud graphe OU ligne liste).
  const goEntity = useCallback(
    (name: string) =>
      navigate(
        `/nodefony/orm-entity?name=${encodeURIComponent(name)}&connector=${encodeURIComponent(selected ?? "")}`,
      ),
    [navigate, selected],
  );

  // Cellule « nb lignes » : … (chargement), — (non comptable), sinon le nombre.
  const rowsCell = (n: number | null) =>
    n === null ? (
      <Text size="sm" c="dimmed">
        …
      </Text>
    ) : n < 0 ? (
      <Text size="sm" c="dimmed">
        —
      </Text>
    ) : (
      <Text size="sm">{n.toLocaleString()}</Text>
    );

  // Colonnes de la vue Liste (déléguée au <DataGrid> : tri + pagination client).
  const listColumns: DataGridColumn<ListRow>[] = [
    {
      key: "name",
      header: "Table",
      sortable: true,
      filterable: true,
      filterType: "text",
      value: (r) => r.name,
      render: (r) => (
        <Text size="sm" fw={500}>
          {r.name}
        </Text>
      ),
    },
    {
      key: "group",
      header: "Domaine / module",
      sortable: true,
      filterable: true,
      filterType: "select",
      value: (r) => r.group,
      render: (r) => (
        <Badge
          size="xs"
          variant="light"
          color={moduleColor(r.group === "—" ? "" : r.group)}
        >
          {r.group}
        </Badge>
      ),
    },
    {
      key: "cols",
      header: "Colonnes",
      align: "right",
      sortable: true,
      filterable: true,
      filterType: "number",
      value: (r) => r.cols,
    },
    {
      key: "rels",
      header: "Relations",
      align: "right",
      sortable: true,
      filterable: true,
      filterType: "number",
      value: (r) => r.rels,
    },
    {
      key: "rows",
      header: "Lignes",
      align: "right",
      sortable: true,
      filterable: true,
      filterType: "number",
      value: (r) => r.rows ?? -1,
      hint: "COUNT(*) par table. « … » = comptage en cours, « — » = ORM déconnecté / non comptable.",
      render: (r) => rowsCell(r.rows),
    },
  ];

  // Liste des connecteurs (sélecteur) + choix initial = ORM par défaut.
  useEffect(() => {
    store.api
      .getAbsolute<OrmSummary[]>("/nodefony/orm/api/orms")
      .then((list) => {
        setOrms(list);
        setSelected(
          (s) =>
            s ?? list.find((o) => o.default)?.name ?? list[0]?.name ?? null,
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
          `/nodefony/orm/api/graph?connector=${encodeURIComponent(orm)}`,
        )
        .then((g) => {
          setAllEntities(g.entities);
          setError(null);
        })
        .catch((e: unknown) =>
          setError(e instanceof Error ? e.message : "graph failed"),
        )
        .finally(() => setLoading(false));
    },
    [store],
  );

  // Changer de connecteur recharge le graphe et réinitialise filtre/focus.
  useEffect(() => {
    if (selected) {
      setModuleFilter(null);
      setFocus(null);
      setShowAll(false);
      setCounts(null);
      loadGraph(selected);
    }
  }, [selected, loadGraph]);

  // (Re)calcule nœuds + arêtes dès que le périmètre visible change.
  useEffect(() => {
    setEntityCount(visible.length);
    const laid = layoutGraph(visible, focus ?? undefined);
    setNodes(laid.nodes);
    setEdges(laid.edges);
  }, [visible, focus, setNodes, setEdges]);

  // En mode focus, cadrer (zoom) le sous-graphe une fois les nœuds committés.
  useEffect(() => {
    if (!focus || nodes.length === 0) return;
    const id = requestAnimationFrame(() =>
      rfRef.current?.fitView({ padding: 0.25, duration: 400, maxZoom: 1.3 }),
    );
    return () => cancelAnimationFrame(id);
  }, [focus, nodes]);

  // Export du modèle (formats pivot IA) → presse-papier. Un même endpoint
  // `/export/{format}` sert DBML (diagramme) et JSON Schema (validation/IA).
  const copyExport = useCallback(
    (format: "dbml" | "jsonschema") => {
      if (!selected) return;
      store.api
        .getAbsolute<{ content: string }>(
          `/nodefony/orm/api/export/${format}?connector=${encodeURIComponent(selected)}`,
        )
        .then((r) => navigator.clipboard.writeText(r.content))
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
        .catch(() => {});
    },
    [store, selected],
  );

  return (
    <PageLayout
      icon={<IconDatabase size={24} />}
      title="ORM — Modèle de données"
      subtitle={
        <Group gap="xs" align="center">
          <Text span size="sm" c="dimmed">
            {entityCount} entités · {edges.length} relations
          </Text>
          <Badge variant="light" color="brand">
            ERD
          </Badge>
          {focus && (
            <Badge
              variant="filled"
              color="brand"
              leftSection={<IconTarget size={11} />}
              rightSection={
                <ActionIcon
                  size={14}
                  variant="transparent"
                  color="gray"
                  aria-label="quitter le focus"
                  onClick={() => setFocus(null)}
                >
                  ✕
                </ActionIcon>
              }
            >
              focus : {focus}
            </Badge>
          )}
        </Group>
      }
      actions={
        <Group gap="xs">
          <Group gap={4} wrap="nowrap">
            <SegmentedControl
              size="xs"
              value={view}
              onChange={(v) => setView(v as "graph" | "list")}
              data={[
                { label: "Graphe", value: "graph" },
                { label: "Liste", value: "list" },
              ]}
              aria-label="mode d'affichage"
            />
            <DocHint
              title="Vues Graphe / Liste"
              version={DB_DOC}
              summary="Deux façons d'explorer le schéma de la base."
              sections={[
                {
                  label: "Graphe",
                  body: "Diagramme des relations (recherche + focus sur une table).",
                },
                {
                  label: "Liste",
                  body: "Inventaire triable (colonnes, relations, nombre de lignes par table).",
                },
              ]}
            />
          </Group>
          {view === "graph" && (
            <>
              <Group gap={4} wrap="nowrap">
                <Select
                  data={entityNames}
                  value={focus}
                  onChange={setFocus}
                  searchable
                  clearable
                  size="xs"
                  style={{ width: 240 }}
                  placeholder="Rechercher une table…"
                  nothingFoundMessage="aucune table"
                  leftSection={<IconSearch size={14} />}
                  comboboxProps={{ withinPortal: true }}
                  aria-label="rechercher et cibler une table"
                />
                <DocHint
                  title="Recherche / focus"
                  version={DB_DOC}
                  summary="Cible une table : l'ERD n'affiche plus qu'elle + ses tables liées et zoome dessus."
                  sections={[
                    {
                      label: "Pourquoi",
                      body: `Indispensable sur une grosse base (ici ${allEntities.length} tables) : on ne dessine que le voisinage par les clés étrangères.`,
                    },
                  ]}
                />
              </Group>
              {focus && (
                <Group gap={4} wrap="nowrap">
                  <SegmentedControl
                    size="xs"
                    value={String(depth)}
                    onChange={(v) => setDepth(Number(v))}
                    data={[
                      { label: "1 saut", value: "1" },
                      { label: "2 sauts", value: "2" },
                    ]}
                    aria-label="profondeur du voisinage"
                  />
                  <DocHint
                    title="Profondeur (sauts)"
                    version={DB_DOC}
                    summary="Étendue du voisinage affiché autour de la table ciblée."
                    sections={[
                      {
                        label: "1 saut",
                        body: "Relations directes (FK entrantes + sortantes).",
                      },
                      {
                        label: "2 sauts",
                        body: "+ les voisines des voisines (plus large, plus dense).",
                      },
                    ]}
                  />
                </Group>
              )}
            </>
          )}
          <Group gap={4} wrap="nowrap">
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
              aria-label="connecteur ORM"
            />
            <DocHint
              title="Connecteur"
              version={DB_DOC}
              summary="Connecteur ORM (base de données) à visualiser."
              sections={[
                {
                  label: "Légende",
                  body: "« ⚠ » = connecteur déclaré mais non connecté au boot.",
                },
              ]}
            />
          </Group>
          {view === "graph" && modules.length > 1 && (
            <Group gap={4} wrap="nowrap">
              <Select
                data={modules.map((m) => ({
                  value: m || NONE,
                  label: m || "—",
                }))}
                value={moduleFilter}
                onChange={setModuleFilter}
                size="xs"
                style={{ width: 180 }}
                placeholder="Domaine / module…"
                clearable
                disabled={!!focus}
                aria-label="filtrer par domaine ou module"
              />
              <DocHint
                title="Domaine / module"
                version={DB_DOC}
                summary="Regroupe les tables par domaine fonctionnel (ex. « facturation ») si l'entité en déclare un, sinon par module Nodefony propriétaire."
                sections={[
                  {
                    label: "Ici",
                    body: `${modules.length} groupe(s) sur ce connecteur. Désactivé en mode focus.`,
                  },
                ]}
              />
            </Group>
          )}
          <Menu shadow="md" position="bottom-end" withinPortal>
            <Menu.Target>
              <Tooltip label="Exporter le schéma (pivot IA)">
                <ActionIcon variant="default" aria-label="export schema">
                  {copied ? (
                    <IconCheck size={16} />
                  ) : (
                    <IconDownload size={16} />
                  )}
                </ActionIcon>
              </Tooltip>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Copier dans le presse-papier</Menu.Label>
              <Menu.Item
                leftSection={<IconDatabase size={14} />}
                onClick={() => copyExport("dbml")}
              >
                DBML (dbdiagram.io)
              </Menu.Item>
              <Menu.Item
                leftSection={<IconBraces size={14} />}
                onClick={() => copyExport("jsonschema")}
              >
                JSON Schema (IA / validation)
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
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
      }
    >
      {error && (
        <Alert color="red" variant="light" title="Erreur">
          {error}
        </Alert>
      )}

      {view === "graph" && modules.length > 1 && (
        <Group gap="xs" aria-label="légende des groupes">
          <Group gap={4} wrap="nowrap">
            <Text size="xs" c="dimmed">
              Domaine / module :
            </Text>
            <DocHint
              title="Légende des couleurs"
              version={DB_DOC}
              summary="La couleur d'une table = son domaine fonctionnel (ex. « facturation ») si défini, sinon son module Nodefony."
              sections={[
                {
                  label: "Interaction",
                  body: "Clique un badge = filtre (même axe que le sélecteur « Domaine / module »).",
                },
                { label: "Légende", body: "⚠ = connecteur non connecté." },
              ]}
            />
          </Group>
          {modules.map((m) => {
            const key = m || NONE;
            const active = moduleFilter === key;
            return (
              <Badge
                key={key}
                component="button"
                size="sm"
                variant={!moduleFilter || active ? "light" : "outline"}
                color={moduleColor(m)}
                onClick={() => !focus && setModuleFilter(active ? null : key)}
                disabled={!!focus}
                aria-pressed={active}
                aria-label={`filtrer : ${m || "non rattaché"}`}
                style={{ cursor: focus ? "default" : "pointer" }}
              >
                {m || "—"}
              </Badge>
            );
          })}
        </Group>
      )}

      <Paper
        withBorder
        style={{
          // Hauteur DÉFINIE obligatoire : React Flow est en height:100% → un
          // simple minHeight (parent height:auto) le résout à 0 = canvas vide.
          height: PAGE_CONTENT_HEIGHT_WITH_BAND,
          minHeight: 480,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {loading && view === "graph" && (
          <Group
            justify="center"
            align="center"
            style={{ position: "absolute", inset: 0, zIndex: 5 }}
          >
            <Loader size="sm" />
          </Group>
        )}
        {view === "list" ? (
          <div
            style={{
              height: "100%",
              padding: "var(--mantine-spacing-xs)",
              boxSizing: "border-box",
            }}
          >
            <DataGrid
              mode="client"
              data={listRows}
              columns={listColumns}
              getRowId={(r) => r.name}
              onRowClick={(r) => goEntity(r.name)}
              initialSort={{ key: "name", dir: "asc" }}
              pageSize={25}
              height="100%"
              loading={loading}
              searchPlaceholder="Rechercher une table…"
              emptyMessage="Aucune entité pour ce connecteur."
              persist={{ key: "studio.orm.databases", storage: "local" }}
            />
          </div>
        ) : !loading && nodes.length === 0 ? (
          <Stack
            align="center"
            justify="center"
            gap="sm"
            style={{ position: "absolute", inset: 0, padding: 24 }}
          >
            {oversized ? (
              <>
                <IconTarget size={28} style={{ opacity: 0.45 }} />
                <Text c="dimmed" size="sm" ta="center" maw={460}>
                  Grand schéma : <b>{totalBase}</b> tables. Recherche une table
                  ci-dessus pour la cibler avec ses voisines, bascule en vue
                  Liste, ou affiche tout (le rendu peut ramer).
                </Text>
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconArrowsMaximize size={14} />}
                  onClick={() => setShowAll(true)}
                >
                  Afficher les {totalBase} tables
                </Button>
              </>
            ) : (
              <Text c="dimmed" size="sm">
                Aucune entité pour ce connecteur.
              </Text>
            )}
          </Stack>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, node) => goEntity(node.id)}
            onInit={(inst) => {
              rfRef.current = inst;
            }}
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
    </PageLayout>
  );
});
