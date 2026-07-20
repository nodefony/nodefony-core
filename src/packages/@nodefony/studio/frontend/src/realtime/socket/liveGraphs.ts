import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/* ════════════════════════════════════════════════════════════════════════
 * liveGraphs.ts — REGISTRE des graphes live insérables dans une page de doc.
 *
 * Une page écrit une fence typée, exactement comme ```mermaid :
 *
 *     ```nodefony-livegraph
 *     { "graph": "backplane", "height": 520 }
 *     ```
 *
 * `MarkdownDoc` résout le nom ici et monte le composant SOUS le paragraphe
 * où l'auteur l'a posé — le graphe vit DANS le propos, il n'est plus collé
 * en pied de page.
 *
 * Pourquoi un registre et pas un import direct dans `MarkdownDoc` :
 *  - `components/ui/` ne doit pas dépendre d'un dossier métier ;
 *  - `lazy()` par graphe = une page sans fence ne charge AUCUN de ces
 *    composants (ils tirent `FlowGraph` + les hooks realtime).
 *
 * Ajouter un graphe = une entrée ici. Aucune autre modification.
 * ════════════════════════════════════════════════════════════════════════ */

/** Signature commune à tous les graphes live (cf `LiveGraphSection`). */
export type LiveGraphComponent = ComponentType<{
  live?: boolean;
  height?: number;
}>;

/**
 * Nom écrit dans la fence → composant. Les noms sont **stables** : ils sont
 * écrits dans des pages de documentation versionnées, en renommer un casse
 * les pages qui l'utilisent (le rendu dégrade en bloc brut, il n'explose pas).
 */
export const LIVE_GRAPHS: Record<
  string,
  LazyExoticComponent<LiveGraphComponent>
> = {
  architecture: lazy(() =>
    import("./ArchitectureLiveGraph").then((m) => ({
      default: m.ArchitectureLiveGraph,
    })),
  ),
  "fan-out": lazy(() =>
    import("./FanOutLiveGraph").then((m) => ({ default: m.FanOutLiveGraph })),
  ),
  protocole: lazy(() =>
    import("./ProtocoleLiveGraph").then((m) => ({
      default: m.ProtocoleLiveGraph,
    })),
  ),
  sondes: lazy(() =>
    import("./SondesLiveGraph").then((m) => ({ default: m.SondesLiveGraph })),
  ),
  backplane: lazy(() =>
    import("./BackplaneLiveGraph").then((m) => ({
      default: m.BackplaneLiveGraph,
    })),
  ),
  actions: lazy(() =>
    import("./ActionsLiveGraph").then((m) => ({ default: m.ActionsLiveGraph })),
  ),
};

/** Les noms acceptés dans une fence — sert aussi au message d'erreur. */
export const LIVE_GRAPH_NAMES = Object.keys(LIVE_GRAPHS);

/** Résout un nom de fence. `undefined` = nom inconnu (le bloc reste brut). */
export function resolveLiveGraph(
  name: string,
): LazyExoticComponent<LiveGraphComponent> | undefined {
  return LIVE_GRAPHS[name];
}
