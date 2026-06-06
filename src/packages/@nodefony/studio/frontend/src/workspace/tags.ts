/**
 * Taxonomie des BLOCS (widgets) — classement à facettes pour le catalogue.
 *
 * Deux axes SAISIS (sur `IWidgetDef.tags`) :
 *  • **DOMAINE** — le thème observé, HIÉRARCHIQUE (thème → sous-thème via `parent`).
 *    Ex. `systeme` → `cpu` / `memoire` / `gc`… ; `orm` → `orm-debit` / `orm-connecteurs`.
 *  • **NATURE** — le type de bloc (kpi / graphe / indice / liste / panneau).
 *
 * Un axe DÉRIVÉ (jamais saisi → 0 dérive) : les **CAPACITÉS** d'un bloc, calculées
 * depuis le `IWidgetDef` : `cluster-ready` (← `clusterAware`) et `temps réel`
 * (← `source.kind !== "snapshot"`). Le catalogue les affiche en chips/filtres.
 */
import type { IWidgetDef } from "./types";

/** Groupe (facette) d'un tag saisi. */
export type TagGroup = "domaine" | "nature";

/** Un tag du registre. `parent` = sous-tag rattaché à un tag du même groupe. */
export interface WidgetTag {
  id: string;
  label: string;
  group: TagGroup;
  parent?: string;
}

/** Registre ordonné des tags (thèmes + sous-thèmes + natures). */
export const WIDGET_TAGS: readonly WidgetTag[] = [
  // ── DOMAINE — thèmes de 1er niveau ──
  { id: "runtime", label: "Runtime & lancement", group: "domaine" },
  { id: "config", label: "Configuration", group: "domaine" },
  { id: "systeme", label: "Système & santé", group: "domaine" },
  { id: "orm", label: "Données / ORM", group: "domaine" },
  { id: "logs", label: "Logs", group: "domaine" },
  { id: "realtime", label: "Temps réel", group: "domaine" },
  { id: "cluster", label: "Cluster", group: "domaine" },
  { id: "erreurs", label: "Erreurs", group: "domaine" },
  { id: "securite", label: "Sécurité", group: "domaine" },
  { id: "ia", label: "IA", group: "domaine" },
  // ── DOMAINE — sous-thèmes « système » ──
  { id: "cpu", label: "CPU", group: "domaine", parent: "systeme" },
  { id: "memoire", label: "Mémoire", group: "domaine", parent: "systeme" },
  {
    id: "event-loop",
    label: "Event-loop",
    group: "domaine",
    parent: "systeme",
  },
  { id: "gc", label: "Garbage Collector", group: "domaine", parent: "systeme" },
  { id: "sante", label: "Santé", group: "domaine", parent: "systeme" },
  {
    id: "handles",
    label: "Ressources actives",
    group: "domaine",
    parent: "systeme",
  },
  { id: "identite", label: "Identité", group: "domaine", parent: "systeme" },
  // ── DOMAINE — sous-thèmes « ORM » ──
  { id: "orm-debit", label: "Débit", group: "domaine", parent: "orm" },
  {
    id: "orm-connecteurs",
    label: "Connecteurs",
    group: "domaine",
    parent: "orm",
  },
  // ── NATURE — type de bloc ──
  { id: "kpi", label: "KPI (valeur)", group: "nature" },
  { id: "graphe", label: "Graphe (courbe)", group: "nature" },
  { id: "indice", label: "Indice composite", group: "nature" },
  { id: "liste", label: "Liste / flux", group: "nature" },
  { id: "panneau", label: "Panneau", group: "nature" },
];

const BY_ID: Record<string, WidgetTag> = Object.fromEntries(
  WIDGET_TAGS.map((t) => [t.id, t]),
);

/** Résout un id de tag → définition (label, groupe, parent). */
export function getTag(id: string): WidgetTag | undefined {
  return BY_ID[id];
}

/** Tags d'un groupe donné (option `parent` pour ne prendre que les sous-tags). */
export function tagsOfGroup(group: TagGroup, parent?: string): WidgetTag[] {
  return WIDGET_TAGS.filter(
    (t) => t.group === group && (parent === undefined || t.parent === parent),
  );
}

/** Capacités DÉRIVÉES d'un bloc (jamais saisies → toujours synchrones du code). */
export interface WidgetCapabilities {
  /** Vue pod agrégée master (grille par worker) — `clusterAware`. */
  clusterReady: boolean;
  /** Alimenté par un canal live (≠ snapshot pur). */
  realtime: boolean;
}

/** Calcule les capacités d'un bloc depuis sa définition (source unique de vérité). */
export function widgetCapabilities(def: IWidgetDef): WidgetCapabilities {
  return {
    clusterReady: def.clusterAware === true,
    realtime: def.source.kind !== "snapshot",
  };
}
