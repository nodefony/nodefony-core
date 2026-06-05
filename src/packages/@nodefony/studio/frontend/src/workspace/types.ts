/**
 * Contrat du **Nodefony Workspace** — bureau d'observabilité composable.
 *
 * Un widget = une sonde déjà écrite (CPU, santé, ORM, logs, hub…) rendue réutilisable.
 * Le shell (`WidgetHost`) encode UNE fois le pattern « sonde back + abonnement hub »
 * (snapshot 1er paint + live conditionnel ref-compté). Cf `docs/workspace.md`.
 */
import type { ComponentType } from "react";
import type { Icon } from "@tabler/icons-react";

/** Familles de widgets (pour le catalogue + le filtrage). */
export type WidgetCategory =
  | "runtime"
  | "system"
  | "logs"
  | "orm"
  | "realtime"
  | "security"
  | "ai";

/** Libellés FR des catégories (catalogue, menus). */
export const WIDGET_CATEGORY_LABEL: Record<WidgetCategory, string> = {
  runtime: "Runtime & lancement",
  system: "Système & santé",
  logs: "Logs",
  orm: "Données / ORM",
  realtime: "Temps réel",
  security: "Sécurité",
  ai: "IA",
};

/** HTTP one-shot (snapshot). */
export interface WidgetSourceSnapshot {
  kind: "snapshot";
  endpoint: string;
}
/** Canal realtime (live pur). */
export interface WidgetSourceLive {
  kind: "live";
  channel: string;
}
/** Snapshot pour le 1er paint + canal live (LE patron sonde+hub). */
export interface WidgetSourceHybrid {
  kind: "hybrid";
  endpoint: string;
  channel: string;
}
export type WidgetSource =
  | WidgetSourceSnapshot
  | WidgetSourceLive
  | WidgetSourceHybrid;

/**
 * Contexte transverse fourni par le shell à CHAQUE widget, calculé une seule fois
 * au niveau du bureau. `cluster`/`instanceCount` dérivent de `realtime:health`
 * (agrégée par le master — la seule source juste en cluster, cf doc §4).
 */
export interface WidgetRuntimeContext {
  /** Temps réel actif (`ui.realtimeLive`). */
  live: boolean;
  /** Topologie cluster (> 1 worker). */
  cluster: boolean;
  /** Nombre de workers (1 en mono). */
  instanceCount: number;
  /** Rôles de l'utilisateur (filtrage catalogue). */
  roles: string[];
}

/** Données + état livrés au rendu d'un widget par le `WidgetHost`. */
export interface WidgetData<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** La donnée courante vient-elle du flux live (vs snapshot) ? */
  fromLive: boolean;
  reload: () => void;
}

/** Props reçues par le composant de rendu d'un widget. */
export interface WidgetRenderProps<T = unknown> {
  source: WidgetData<T>;
  ctx: WidgetRuntimeContext;
  /** Largeur courante de la tuile (colonnes 1-12). */
  span: number;
}

/** Définition d'un widget (entrée du catalogue). */
export interface IWidgetDef<T = unknown> {
  id: string;
  title: string;
  description: string;
  category: WidgetCategory;
  icon: Icon;
  /** Visible seulement si l'utilisateur a ≥1 de ces rôles ; vide/absent = tous. */
  roles?: string[];
  source: WidgetSource;
  /** Le rendu change en cluster (résumé pod + grille worker, cf `ClusterView`). */
  clusterAware?: boolean;
  /** Colonnes par défaut à l'ajout (1-12). */
  defaultSpan: number;
  /** Colonnes minimales. */
  minSpan: number;
  render: ComponentType<WidgetRenderProps<T>>;
}

/** Instance d'un widget posée sur un bureau (clé = `widgetId`, 1 par bureau en v1). */
export interface WidgetInstance {
  widgetId: string;
  span: number;
}

/** Un bureau = un layout ordonné de widgets. */
export interface WorkspaceLayout {
  id: string;
  label: string;
  items: WidgetInstance[];
}
