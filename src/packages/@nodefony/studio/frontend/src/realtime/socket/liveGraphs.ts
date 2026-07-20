import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/* ════════════════════════════════════════════════════════════════════════
 * liveGraphs.ts — REGISTRE des graphes live de la socket. Source UNIQUE.
 *
 * Deux consommateurs, un seul registre :
 *  - une PAGE DE DOC, par une fence typée (rendue par `MarkdownDoc`) :
 *
 *        ```nodefony-livegraph
 *        { "graph": "backplane", "height": 520 }
 *        ```
 *
 *  - le JUMEAU VIVANT (`SocketExplorer`), qui en fait des onglets de forage.
 *
 * Avant, le registre était dérivé d'un `import.meta.glob` sur les fichiers
 * `docs/realtime/socket/*.md` : les graphes n'existaient que pour ce dossier,
 * et leur ordre venait du préfixe numérique des pages. Ils sont désormais
 * autonomes — une page les invoque par NOM, où elle veut.
 *
 * Ajouter un graphe = une entrée ici. Aucune autre modification.
 * ════════════════════════════════════════════════════════════════════════ */

/** Signature commune à tous les graphes live (cf `LiveGraphSection`). */
export type LiveGraphComponent = ComponentType<{
  live?: boolean;
  height?: number;
}>;

/** Une entrée du catalogue. */
export interface LiveGraphEntry {
  /**
   * Nom invoqué dans une fence. **Stable** : il est écrit dans des pages de
   * documentation versionnées — le renommer casse les pages qui l'utilisent
   * (le rendu dégrade en bloc brut avec la raison, il n'explose pas).
   */
  name: string;
  /** Libellé lisible — onglet du Jumeau, titre par défaut du bloc. */
  label: string;
  /** Chargé à la demande : une page sans fence ne tire aucun de ces modules. */
  component: LazyExoticComponent<LiveGraphComponent>;
}

/** Le catalogue, dans l'ordre d'apprentissage (= ordre des onglets du Jumeau). */
export const LIVE_GRAPH_CATALOG: readonly LiveGraphEntry[] = [
  {
    name: "architecture",
    label: "Architecture",
    component: lazy(() =>
      import("./ArchitectureLiveGraph").then((m) => ({
        default: m.ArchitectureLiveGraph,
      })),
    ),
  },
  {
    name: "protocole",
    label: "Protocole",
    component: lazy(() =>
      import("./ProtocoleLiveGraph").then((m) => ({
        default: m.ProtocoleLiveGraph,
      })),
    ),
  },
  {
    name: "fan-out",
    label: "Fan-out",
    component: lazy(() =>
      import("./FanOutLiveGraph").then((m) => ({ default: m.FanOutLiveGraph })),
    ),
  },
  {
    name: "actions",
    label: "Actions",
    component: lazy(() =>
      import("./ActionsLiveGraph").then((m) => ({
        default: m.ActionsLiveGraph,
      })),
    ),
  },
  {
    name: "backplane",
    label: "Backplane",
    component: lazy(() =>
      import("./BackplaneLiveGraph").then((m) => ({
        default: m.BackplaneLiveGraph,
      })),
    ),
  },
  {
    name: "sondes",
    label: "Sondes",
    component: lazy(() =>
      import("./SondesLiveGraph").then((m) => ({ default: m.SondesLiveGraph })),
    ),
  },
] as const;

/** Les noms acceptés dans une fence — sert aussi au message d'erreur. */
export const LIVE_GRAPH_NAMES: string[] = LIVE_GRAPH_CATALOG.map((g) => g.name);

/** Résout un nom de fence. `undefined` = nom inconnu (le bloc reste brut). */
export function resolveLiveGraph(
  name: string,
): LazyExoticComponent<LiveGraphComponent> | undefined {
  return LIVE_GRAPH_CATALOG.find((g) => g.name === name)?.component;
}
