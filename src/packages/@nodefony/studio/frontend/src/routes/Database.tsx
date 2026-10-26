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
  IconMap,
} from "@tabler/icons-react";
import { useNavigate } from "react-router";
import { useStore } from "../stores";
import { type NonEmptyList, cyclicPick } from "../utils/palette";
import {
  PageLayout,
  DocHint,
  DataGrid,
  PAGE_CONTENT_HEIGHT_WITH_BAND,
  type DataGridColumn,
} from "../components/ui";
import {
  type EntityNode,
  type ErdLink,
  type DomainLink,
  type DomainSummary,
  LARGE_GRAPH,
  NONE,
  groupKey,
  filterKey,
  canonicalLinks,
  linkedNames,
  foreignKeyColumns,
  keyColumns,
  domainMap,
  domainScope,
} from "./orm/erdModel";

/** Version de la doc des fiches d'aide (`DocHint`) de la vue base de données. */
const DB_DOC = "v1.1";

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

/**
 * Données d'un nœud table. `compact` = grand schéma : la boîte ne montre que ses
 * clés. `ghost` = voisine d'un autre domaine, dessinée en retrait.
 */
type TableNodeData = { entity: EntityNode; compact: boolean; ghost: boolean };
/** Nœud table typé : `NodeProps` rend `data` sans conversion. */
type TableFlowNode = Node<TableNodeData, "table">;
/** Données d'un nœud de la carte des domaines. */
type DomainNodeData = { domain: DomainSummary };
/** Nœud domaine typé. */
type DomainFlowNode = Node<DomainNodeData, "domain">;

const NODE_W = 250;
const HEADER_H = 40;
const ROW_H = 24;
const DOMAIN_W = 240;
const DOMAIN_H = 76;

const REL_LABEL: Record<ErdLink["kind"], string> = {
  "one-to-one": "1—1",
  "many-to-one": "N—1",
  "many-to-many": "N—N",
};

/** Palette Mantine cyclée pour distinguer les modules dans l'ERD. */
const MODULE_COLORS: NonEmptyList<string> = [
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
  return cyclicPick(MODULE_COLORS, h);
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

/** Colonnes rendues dans une boîte : toutes, ou les seules clés en compact. */
const shownColumns = (e: EntityNode, compact: boolean) =>
  compact ? keyColumns(e) : e.columns;

/** Nœud « table » de l'ERD : nom d'entité + colonnes (PK/FK/unique typées). */
function TableNode({ data }: NodeProps<TableFlowNode>) {
  const { entity, compact, ghost } = data;
  const fk = foreignKeyColumns(entity);
  const color = moduleColor(groupKey(entity));
  const columns = ghost ? [] : shownColumns(entity, compact);
  const hidden = ghost ? 0 : entity.columns.length - columns.length;
  return (
    <div
      style={{
        width: NODE_W,
        borderRadius: 8,
        border: ghost
          ? "1px dashed var(--mantine-color-default-border)"
          : "1px solid var(--mantine-color-default-border)",
        background: "var(--mantine-color-body)",
        boxShadow: ghost ? "none" : "var(--mantine-shadow-sm)",
        opacity: ghost ? 0.8 : 1,
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
          background: ghost
            ? "transparent"
            : `var(--mantine-color-${color}-light)`,
          color: ghost
            ? "var(--mantine-color-dimmed)"
            : `var(--mantine-color-${color}-light-color)`,
          fontWeight: 600,
          borderBottom: ghost
            ? "none"
            : "1px solid var(--mantine-color-default-border)",
        }}
      >
        <IconDatabase size={14} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entity.name}
        </span>
        <span style={{ opacity: 0.7, fontSize: 10 }}>
          {ghost ? "↗ " : ""}
          {groupKey(entity) || "—"}
        </span>
      </div>
      {!ghost && (
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
          {columns.map((c) => (
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
          {hidden > 0 && compact && (
            <div
              style={{
                height: ROW_H,
                lineHeight: `${ROW_H}px`,
                padding: "0 10px",
                borderTop: "1px solid var(--mantine-color-default-border)",
                color: "var(--mantine-color-dimmed)",
                fontStyle: "italic",
              }}
            >
              + {hidden} colonne{hidden > 1 ? "s" : ""} (clic : la fiche)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Nœud de la carte des domaines : nom, nombre de tables, tables sans lien. */
function DomainNode({ data }: NodeProps<DomainFlowNode>) {
  const { domain } = data;
  const color = moduleColor(domain.key === NONE ? "" : domain.label);
  return (
    <div
      style={{
        width: DOMAIN_W,
        height: DOMAIN_H,
        boxSizing: "border-box",
        borderRadius: 10,
        border: `2px solid var(--mantine-color-${color}-light-color)`,
        background: `var(--mantine-color-${color}-light)`,
        color: `var(--mantine-color-${color}-light-color)`,
        padding: "8px 12px",
        cursor: "pointer",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div style={{ fontWeight: 700, fontSize: 18 }}>{domain.label}</div>
      <div style={{ fontSize: 14, opacity: 0.85 }}>
        {domain.tables} table{domain.tables > 1 ? "s" : ""}
        {domain.isolated > 0 ? ` · ${domain.isolated} sans lien` : ""}
      </div>
    </div>
  );
}

const nodeTypes = { table: TableNode, domain: DomainNode };

/** Hauteur d'une boîte — la MÊME règle que son rendu (`shownColumns`). */
const nodeHeight = (e: EntityNode, compact: boolean, ghost = false) => {
  if (ghost) return HEADER_H + 2;
  const shown = shownColumns(e, compact).length;
  const more = compact && shown < e.columns.length ? 1 : 0;
  return HEADER_H + (Math.max(1, shown) + more) * ROW_H + 2;
};

/**
 * Range des nœuds en grille sous un graphe déjà placé — dagre empilerait sinon
 * chaque nœud sans lien sur une seule colonne.
 */
function placeGrid(
  ids: readonly string[],
  size: (id: string) => { w: number; h: number },
  top: number,
  position: Map<string, { x: number; y: number }>,
): void {
  if (ids.length === 0) return;
  const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length * 3)));
  let y = top;
  for (let i = 0; i < ids.length; i += cols) {
    const row = ids.slice(i, i + cols);
    let x = 0;
    for (const id of row) {
      position.set(id, { x, y });
      x += size(id).w + 45;
    }
    y += Math.max(...row.map((id) => size(id).h)) + 45;
  }
}

/** Options d'un dessin de tables. */
interface ILayoutOptions {
  /** Table ciblée (focus) : surlignée, arêtes incidentes accentuées. */
  rootName?: string;
  /** Grand schéma : boîtes réduites à leurs clés. */
  compact: boolean;
  /** Voisines d'autres domaines, dessinées en retrait (domaine ouvert). */
  ghosts: ReadonlySet<string>;
  /** Grand schéma : les tables sans lien ne sont pas dessinées, elles sont rendues à part. */
  isolatedApart: boolean;
}

/** Place les entités via dagre (gauche→droite) et construit nœuds + arêtes. */
function layoutGraph(
  entities: EntityNode[],
  opts: ILayoutOptions,
): { nodes: Node[]; edges: Edge[]; isolated: EntityNode[] } {
  const { rootName, compact, ghosts, isolatedApart } = opts;
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 45, ranksep: 90 });
  g.setDefaultEdgeLabel(() => ({}));
  const byName = new Map(entities.map((e) => [e.name, e]));
  const height = (e: EntityNode) => nodeHeight(e, compact, ghosts.has(e.name));
  const links = canonicalLinks(entities);
  const linked = linkedNames(links);
  for (const e of entities) {
    if (linked.has(e.name)) {
      g.setNode(e.name, { width: NODE_W, height: height(e) });
    }
  }
  const edges: Edge[] = links.map((l) => {
    g.setEdge(l.source, l.target);
    const incident = rootName === l.source || rootName === l.target;
    const m2m = l.kind === "many-to-many";
    return {
      id: l.id,
      source: l.source,
      target: l.target,
      type: "smoothstep",
      animated: m2m || incident,
      label: REL_LABEL[l.kind],
      markerEnd: { type: MarkerType.ArrowClosed },
      style: {
        stroke: incident
          ? "var(--mantine-primary-color-filled)"
          : m2m
            ? "var(--mantine-color-grape-5)"
            : "var(--mantine-color-blue-5)",
        strokeWidth: incident ? 2 : 1,
        ...(m2m ? { strokeDasharray: "5 5" } : {}),
      },
    };
  });
  dagre.layout(g);
  const position = new Map<string, { x: number; y: number }>();
  let bottom = 0;
  for (const name of g.nodes()) {
    const p = g.node(name);
    position.set(name, { x: p.x - p.width / 2, y: p.y - p.height / 2 });
    bottom = Math.max(bottom, p.y + p.height / 2);
  }
  // Une table sans lien ne dit rien dans un dessin de liens. Petit schéma :
  // rangée en grille sous le graphe. Grand schéma : rendue à part, en pastilles.
  const isolated = entities.filter((e) => !linked.has(e.name));
  if (!isolatedApart) {
    placeGrid(
      isolated.map((e) => e.name),
      (id) => {
        const e = byName.get(id);
        return { w: NODE_W, h: e ? height(e) : HEADER_H };
      },
      position.size > 0 ? bottom + 90 : 0,
      position,
    );
  }
  const drawn = isolatedApart
    ? entities.filter((e) => linked.has(e.name))
    : entities;
  const nodes: Node[] = drawn.map((e) => ({
    id: e.name,
    type: "table",
    position: position.get(e.name) ?? { x: 0, y: 0 },
    data: { entity: e, compact, ghost: ghosts.has(e.name) },
    style:
      e.name === rootName
        ? {
            outline: "3px solid var(--mantine-primary-color-filled)",
            outlineOffset: 2,
            borderRadius: 8,
          }
        : undefined,
  }));
  return { nodes, edges, isolated: isolatedApart ? isolated : [] };
}

/**
 * Dessine la carte des domaines : un nœud par domaine, une arête par paire de
 * domaines reliés, d'autant plus épaisse qu'elle porte de clés étrangères.
 */
function layoutDomainMap(map: {
  domains: DomainSummary[];
  links: DomainLink[];
}): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 70 });
  g.setDefaultEdgeLabel(() => ({}));
  const connected = new Set<string>();
  for (const l of map.links) connected.add(l.source).add(l.target);
  for (const d of map.domains) {
    if (connected.has(d.key)) {
      g.setNode(d.key, { width: DOMAIN_W, height: DOMAIN_H });
    }
  }
  for (const l of map.links) g.setEdge(l.source, l.target);
  dagre.layout(g);
  const position = new Map<string, { x: number; y: number }>();
  let bottom = 0;
  for (const key of g.nodes()) {
    const p = g.node(key);
    position.set(key, { x: p.x - p.width / 2, y: p.y - p.height / 2 });
    bottom = Math.max(bottom, p.y + p.height / 2);
  }
  placeGrid(
    map.domains.filter((d) => !connected.has(d.key)).map((d) => d.key),
    () => ({ w: DOMAIN_W, h: DOMAIN_H }),
    position.size > 0 ? bottom + 90 : 0,
    position,
  );
  const nodes: Node[] = map.domains.map((d) => ({
    id: d.key,
    type: "domain",
    position: position.get(d.key) ?? { x: 0, y: 0 },
    data: { domain: d },
  }));
  const edges: Edge[] = map.links.map((l) => ({
    id: `${l.source}>${l.target}`,
    source: l.source,
    target: l.target,
    type: "default",
    label: String(l.weight),
    style: {
      stroke: "var(--mantine-color-blue-5)",
      strokeWidth: 1 + Math.min(7, l.weight * 0.6),
      opacity: 0.75,
    },
  }));
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
  // `<Edge>` égale le défaut du paramètre, mais l'inférence depuis `[]` le
  // remplace par `never` : sans lui, `setEdges` refuse toute arête.
  // oxlint-disable-next-line typescript/no-unnecessary-type-arguments
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Grand schéma : tables sans lien du périmètre dessiné, rendues en pastilles.
  const [apart, setApart] = useState<EntityNode[]>([]);
  // Entités brutes du connecteur (avant filtre module) + filtre module courant.
  const [allEntities, setAllEntities] = useState<EntityNode[]>([]);
  const [moduleFilter, setModuleFilter] = useState<string | null>(null);
  // Focus = table ciblée par la recherche → sous-graphe (table + voisines).
  const [focus, setFocus] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  // Grand schéma sans focus ni domaine : carte des domaines, sauf « tout afficher ».
  const [showAll, setShowAll] = useState(false);
  // Instance React Flow (capturée au montage) pour cadrer le sous-graphe (fitView).
  const rfRef = useRef<ReactFlowInstance | null>(null);
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

  // Grand schéma : boîtes compactes, carte des domaines, tables sans lien à part.
  const large = allEntities.length > LARGE_GRAPH;
  // Liens du schéma ENTIER — le compteur de l'en-tête compte ce qui existe, pas
  // ce qui est dessiné (il annonçait « 0 relations » tant que rien ne l'était).
  const schemaLinks = useMemo(() => canonicalLinks(allEntities), [allEntities]);
  const map = useMemo(
    () => (large ? domainMap(allEntities) : null),
    [large, allEntities],
  );

  // Périmètre visible : focus (sous-graphe) > domaine ouvert > carte (grand
  // schéma) > tout. `ghosts` = voisines d'autres domaines d'un domaine ouvert.
  const { visible, ghosts, mapMode } = useMemo(() => {
    const none = new Set<string>();
    if (focus) {
      return {
        visible: neighborhood(allEntities, focus, depth),
        ghosts: none,
        mapMode: false,
      };
    }
    if (moduleFilter) {
      if (!large) {
        return {
          visible: allEntities.filter((e) => filterKey(e) === moduleFilter),
          ghosts: none,
          mapMode: false,
        };
      }
      const scope = domainScope(allEntities, moduleFilter);
      return {
        visible: [...scope.members, ...scope.ghosts],
        ghosts: new Set(scope.ghosts.map((e) => e.name)),
        mapMode: false,
      };
    }
    if (large && !showAll) {
      return { visible: [] as EntityNode[], ghosts: none, mapMode: true };
    }
    return { visible: allEntities, ghosts: none, mapMode: false };
  }, [allEntities, moduleFilter, focus, depth, showAll, large]);

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
    (name: string): void => {
      void navigate(
        `/nodefony/orm-entity?name=${encodeURIComponent(name)}&connector=${encodeURIComponent(selected ?? "")}`,
      );
    },
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
            s ?? list.find((o) => o.default)?.name ?? list.at(0)?.name ?? null,
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

  // Une mise en page de plus = un cadrage à refaire. Un compteur plutôt que
  // `nodes` : déplacer un nœud à la main change `nodes`, et ne doit pas recadrer.
  const [layoutRun, setLayoutRun] = useState(0);

  // (Re)calcule nœuds + arêtes dès que le périmètre visible change.
  useEffect(() => {
    if (mapMode && map) {
      const laid = layoutDomainMap(map);
      setNodes(laid.nodes);
      setEdges(laid.edges);
      setApart([]);
    } else {
      const laid = layoutGraph(visible, {
        ...(focus ? { rootName: focus } : {}),
        compact: large,
        ghosts,
        isolatedApart: large,
      });
      setNodes(laid.nodes);
      setEdges(laid.edges);
      setApart(laid.isolated);
    }
    setLayoutRun((n) => n + 1);
  }, [visible, ghosts, mapMode, map, focus, large, setNodes, setEdges]);

  // Cadrer le périmètre une fois les nœuds committés — à CHAQUE changement
  // (focus, filtre de domaine, « afficher tout »). La prop `fitView` de React
  // Flow ne joue qu'au montage : filtrer laissait le cadrage du graphe
  // précédent, et un domaine de 30 tables s'affichait sur un canevas vide.
  useEffect(() => {
    if (layoutRun === 0 || (visible.length === 0 && !mapMode)) return;
    const id = requestAnimationFrame(() => {
      void rfRef.current?.fitView(
        focus
          ? { padding: 0.25, duration: 400, maxZoom: 1.3 }
          : { padding: 0.1, maxZoom: 1 },
      );
    });
    return () => cancelAnimationFrame(id);
  }, [layoutRun, visible.length, mapMode, focus]);

  // Clic sur un nœud : un domaine s'ouvre, une voisine fantôme ouvre SON
  // domaine, une table ouvre sa fiche (toutes ses colonnes).
  const onNodeClick = useCallback(
    (node: Node): void => {
      if (node.type === "domain") {
        setModuleFilter(node.id);
        return;
      }
      const target = allEntities.find((e) => e.name === node.id);
      if (target && ghosts.has(node.id)) {
        setModuleFilter(filterKey(target));
        return;
      }
      goEntity(node.id);
    },
    [allEntities, ghosts, goEntity],
  );

  // Ce que montre le canevas, pour l'en-tête : le compte du SCHÉMA d'abord.
  const shownTables = mapMode ? 0 : visible.length - ghosts.size;

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
            {allEntities.length} entités · {schemaLinks.length} relations
            {mapMode
              ? ` · carte de ${map?.domains.length ?? 0} domaines`
              : shownTables < allEntities.length
                ? ` · ${shownTables} affichées`
                : ""}
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
              onChange={(v) => setView(v)}
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
        // Une seule ligne, défilante : la hauteur du canevas réserve UNE bande
        // (`PAGE_CONTENT_HEIGHT_WITH_BAND`) ; 38 domaines repliés sur trois
        // lignes le poussaient sous le bas de la fenêtre.
        <Group
          gap="xs"
          wrap="nowrap"
          role="group"
          aria-label="légende des groupes"
          style={{ overflowX: "auto", paddingBottom: 2 }}
        >
          <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
            <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
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
                style={{
                  cursor: focus ? "default" : "pointer",
                  flexShrink: 0,
                }}
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
        ) : !loading && nodes.length === 0 && apart.length === 0 ? (
          <Stack
            align="center"
            justify="center"
            gap="sm"
            style={{ position: "absolute", inset: 0, padding: 24 }}
          >
            <Text c="dimmed" size="sm">
              Aucune entité pour ce connecteur.
            </Text>
          </Stack>
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", height: "100%" }}
          >
            {large && !focus && (
              <Group
                gap="xs"
                px="xs"
                py={6}
                style={{
                  borderBottom: "1px solid var(--mantine-color-default-border)",
                }}
              >
                {mapMode ? (
                  <>
                    <Text size="xs" c="dimmed">
                      Grand schéma : {allEntities.length} tables réparties en{" "}
                      {map?.domains.length ?? 0} domaines,{" "}
                      {map?.links.length ?? 0} liaisons entre domaines. Un clic
                      ouvre un domaine.
                    </Text>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      leftSection={<IconArrowsMaximize size={12} />}
                      onClick={() => setShowAll(true)}
                    >
                      Afficher les {allEntities.length} tables
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      leftSection={<IconMap size={12} />}
                      onClick={() => {
                        setModuleFilter(null);
                        setShowAll(false);
                      }}
                    >
                      Carte des domaines
                    </Button>
                    {ghosts.size > 0 && (
                      <Text size="xs" c="dimmed">
                        {ghosts.size} voisine{ghosts.size > 1 ? "s" : ""}{" "}
                        d'autres domaines en pointillé — un clic ouvre leur
                        domaine.
                      </Text>
                    )}
                  </>
                )}
              </Group>
            )}
            <div style={{ flex: 1, minHeight: 0 }}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={(_, node) => onNodeClick(node)}
                onInit={(inst) => {
                  rfRef.current = inst;
                }}
                nodeTypes={nodeTypes}
                colorMode={scheme}
                style={RF_THEME}
                fitView
                fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
                minZoom={0.05}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={16} />
                <Controls />
                <MiniMap pannable zoomable />
              </ReactFlow>
            </div>
            {apart.length > 0 && (
              <div
                role="group"
                aria-label="tables sans lien"
                style={{
                  maxHeight: "28%",
                  overflowY: "auto",
                  borderTop: "1px solid var(--mantine-color-default-border)",
                  padding: "6px var(--mantine-spacing-xs)",
                }}
              >
                <Group gap={6}>
                  <Group gap={4} wrap="nowrap">
                    <Text size="xs" fw={600}>
                      {apart.length} table{apart.length > 1 ? "s" : ""} sans
                      lien
                    </Text>
                    <DocHint
                      title="Tables sans lien"
                      version={DB_DOC}
                      summary="Tables qui n'ont aucune clé étrangère, ni sortante ni entrante : un dessin de liens ne dirait rien d'elles."
                      sections={[
                        {
                          label: "Ici",
                          body: `${apart.length} sur ${shownTables} tables affichées. Un clic ouvre la fiche de la table.`,
                        },
                        {
                          label: "Pourquoi autant ?",
                          body: "Un schéma réel déclare souvent ses liens par convention de nom (colonne fk_…) sans contrainte : la base ne les connaît pas, l'écran non plus.",
                        },
                      ]}
                    />
                  </Group>
                  {apart.map((e) => (
                    <Badge
                      key={e.name}
                      component="button"
                      size="sm"
                      variant="outline"
                      color={moduleColor(groupKey(e))}
                      onClick={() => goEntity(e.name)}
                      aria-label={`ouvrir la table ${e.name}`}
                      style={{ cursor: "pointer", textTransform: "none" }}
                    >
                      {e.name}
                    </Badge>
                  ))}
                </Group>
              </div>
            )}
          </div>
        )}
      </Paper>
    </PageLayout>
  );
});
