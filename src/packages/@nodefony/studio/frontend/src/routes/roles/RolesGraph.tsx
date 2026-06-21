/**
 * Onglet **Graphe** de la page Rôles — DAG d'héritage RBAC via `FlowGraph`
 * (React Flow + dagre). Les arêtes sont les héritages **directs** déclarés :
 * un lien `A → B` signifie « A hérite de B ». La transitivité se lit comme un
 * chemin (A → B → C ⇒ A couvre C). Topologie statique → liens **fixes**
 * (`animated: false`, charte « temps réel calme » : pas de marching-ants).
 *
 * Hauteur : pattern ERD (cf `Database.tsx`) — un conteneur à hauteur DÉFINIE
 * (`PAGE_CONTENT_HEIGHT_WITH_BAND` = sous PageHeader + la bande Tabs.List) +
 * `minHeight` fallback ; `FlowGraph` en `height:100%`. Pas de flex (un parent
 * `height:auto` résout React Flow à 0 = canvas vide).
 */
import { useMemo } from "react";
import { Text } from "@mantine/core";
import { IconUsersGroup } from "@tabler/icons-react";
import {
  FlowGraph,
  PAGE_CONTENT_HEIGHT_WITH_BAND,
  type FlowGraphEdge,
  type FlowGraphNode,
} from "../../components/ui";
import { type RoleHierarchy } from "./rolesModel";

/** Construit nœuds + arêtes du DAG d'héritage depuis la hiérarchie déclarée. */
function buildRoleGraph(data: RoleHierarchy): {
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
} {
  const hierarchy = data.hierarchy;
  const all = new Set<string>();
  const inheritedBySomeone = new Set<string>();

  for (const [role, list] of Object.entries(hierarchy)) {
    all.add(role);
    for (const t of list) {
      all.add(t);
      inheritedBySomeone.add(t);
    }
  }
  // Rôles déclarés mais sans héritage (présents dans roles[], hierarchy vide).
  for (const r of data.roles) all.add(r.role);

  const nodes: FlowGraphNode[] = [...all].sort().map((role) => {
    const direct = hierarchy[role] ?? [];
    // « Sommet » = personne ne l'hérite → rôle le plus puissant (point d'entrée).
    const isTop = !inheritedBySomeone.has(role);
    return {
      id: role,
      data: {
        label: role,
        sub: direct.length > 0 ? `hérite de ${direct.length}` : "base",
        icon: <IconUsersGroup size={18} />,
        color: isTop ? "indigo" : "blue",
        emphasis: isTop,
      },
    };
  });

  const edges: FlowGraphEdge[] = [];
  for (const [role, list] of Object.entries(hierarchy)) {
    for (const t of list) {
      edges.push({ source: role, target: t, color: "indigo", animated: false });
    }
  }
  return { nodes, edges };
}

export interface RolesGraphProps {
  data: RoleHierarchy;
  /** Hauteur du conteneur (px ou token layout). Défaut = plein viewport. */
  height?: number | string;
}

export function RolesGraph({
  data,
  height = PAGE_CONTENT_HEIGHT_WITH_BAND,
}: RolesGraphProps) {
  const { nodes, edges } = useMemo(() => buildRoleGraph(data), [data]);

  if (edges.length === 0) {
    return (
      <Text size="sm" c="dimmed" fs="italic">
        Aucun héritage déclaré — le graphe n'a pas d'arête. Chaque rôle est
        autonome (il ne couvre que lui-même).
      </Text>
    );
  }

  // FlowGraph reçoit une hauteur CONCRÈTE (le token calc) DIRECTEMENT. Surtout
  // PAS de chaîne `height:100%` (Box token → FlowGraph 100% → ReactFlow 100%) :
  // dans un onglet + StrictMode, ReactFlow mesure 0 au mount → erreur #004
  // (« parent needs a width and a height »). Le conteneur du graphe porte la
  // hauteur, point (cf Database.tsx).
  return (
    <FlowGraph
      nodes={nodes}
      edges={edges}
      dir="TB"
      height={height}
      ariaLabel="Graphe d'héritage des rôles RBAC"
    />
  );
}
