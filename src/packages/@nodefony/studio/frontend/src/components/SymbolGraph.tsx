import { useMemo } from "react";
import { Alert, Group, Badge, Text, Stack } from "@mantine/core";
import {
  IconBox,
  IconHexagon,
  IconCircleDot,
  IconCode,
  IconInfoCircle,
} from "@tabler/icons-react";
import {
  FlowGraph,
  type FlowGraphNode,
  type FlowGraphEdge,
} from "./ui/FlowGraph";

/* ════════════════════════════════════════════════════════════════════════
 * ModuleSymbolGraph — graphe de classes/interfaces AUTO-GÉNÉRÉ d'un module.
 *
 * Source = l'endpoint EXISTANT /nodefony/kernel/api/module/{name}/symbols (chaque
 * symbole porte extends/implements) → 0 backend neuf. Arêtes = héritage
 * (extends) + implémentation (implements). Jamais périmé : reflète le code réel.
 * Réutilisé par la vue module ; repris tel quel par @nodefony/documentation.
 * Cf [[project_doc_portal_faisabilite]].
 * ════════════════════════════════════════════════════════════════════════ */

export interface ModuleSymbol {
  name: string;
  kind: string;
  file?: string;
  description?: string | null;
  extends?: string | null;
  implements?: string[];
  decorators?: string[];
}

const MAX_NODES = 64;

const KIND_COLOR: Record<string, string> = {
  class: "indigo",
  interface: "cyan",
  type: "grape",
  function: "teal",
  enum: "orange",
};

function kindIcon(kind: string) {
  switch (kind) {
    case "class":
      return <IconBox size={20} />;
    case "interface":
      return <IconHexagon size={20} />;
    case "type":
    case "enum":
      return <IconCircleDot size={20} />;
    default:
      return <IconCode size={20} />;
  }
}

export function ModuleSymbolGraph({
  symbols,
  height = 520,
}: {
  symbols: ModuleSymbol[];
  /** Hauteur du canevas (px ou token layout). Défaut 520 ; plein viewport via un token. */
  height?: number | string;
}) {
  const { nodes, edges, total, truncated } = useMemo(() => {
    const byName = new Map(symbols.map((s) => [s.name, s]));
    const rawEdges: FlowGraphEdge[] = [];
    for (const s of symbols) {
      if (s.extends) {
        rawEdges.push({
          source: s.name,
          target: s.extends,
          label: "extends",
          color: "indigo",
        });
      }
      for (const impl of s.implements ?? []) {
        rawEdges.push({
          source: s.name,
          target: impl,
          label: "implements",
          color: "cyan",
          dashed: true,
        });
      }
    }
    // Noms impliqués dans une relation (on n'affiche pas les symboles isolés).
    const involved = new Set<string>();
    rawEdges.forEach((e) => {
      involved.add(e.source);
      involved.add(e.target);
    });
    const names = [...involved];
    const isTruncated = names.length > MAX_NODES;
    const kept = new Set(names.slice(0, MAX_NODES));
    const keptEdges = rawEdges.filter(
      (e) => kept.has(e.source) && kept.has(e.target),
    );
    const graphNodes: FlowGraphNode[] = [...kept].map((name) => {
      const s = byName.get(name);
      const isExternal = !s; // cité par un extends/implements mais hors module
      const kind = s?.kind ?? "externe";
      const color = isExternal ? "gray" : (KIND_COLOR[kind] ?? "blue");
      return {
        id: name,
        data: {
          label: name,
          sub: isExternal ? "externe (hors module)" : kind,
          icon: kindIcon(kind),
          color,
          emphasis: Boolean(s?.decorators?.length),
        },
      };
    });
    return {
      nodes: graphNodes,
      edges: keptEdges,
      total: names.length,
      truncated: isTruncated,
    };
  }, [symbols]);

  if (!edges.length) {
    return (
      <Alert color="gray" variant="light" icon={<IconInfoCircle size={18} />}>
        Aucune relation <b>extends</b>/<b>implements</b> détectée dans ce module
        — rien à représenter en graphe de classes. (Le graphe se nourrit du même{" "}
        <code>symbols.json</code> que l'onglet API.)
      </Alert>
    );
  }

  return (
    <Stack gap="xs">
      <Group gap="sm">
        <Text size="sm" c="dimmed">
          Héritage &amp; implémentation — {nodes.length} symbole(s),{" "}
          {edges.length} relation(s).
        </Text>
        <Badge variant="dot" color="indigo">
          extends
        </Badge>
        <Badge variant="dot" color="cyan">
          implements
        </Badge>
        <Badge variant="dot" color="gray">
          externe
        </Badge>
        {truncated && (
          <Badge color="orange" variant="light">
            tronqué à {MAX_NODES}/{total}
          </Badge>
        )}
      </Group>
      <FlowGraph
        nodes={nodes}
        edges={edges}
        dir="LR"
        height={height}
        ariaLabel="Graphe de classes du module (extends / implements)"
      />
    </Stack>
  );
}

export default ModuleSymbolGraph;
