/**
 * Contrat du **Nodefony Workspace** — bureau d'observabilité composable.
 *
 * Modèle **BUREAU LIBRE** (≠ grille figée) : chaque fenêtre flotte librement,
 * peut **chevaucher** les autres, avec un **ordre de profondeur** (z-order, clic =
 * au 1er plan). Coordonnées **responsives** : X + largeur en **fraction** de la
 * largeur du bureau (0..1) → s'adapte à la taille de l'écran ; Y + hauteur en
 * **pixels** → le bureau défile verticalement. Aimantation douce réglable (pas de
 * colonnes imposées). Un widget = une sonde déjà écrite, rendue réutilisable ;
 * le shell (`WidgetHost`) encode le pattern « sonde back + abonnement hub ».
 */
import type { ComponentType, PointerEvent as ReactPointerEvent } from "react";
import type { Icon } from "@tabler/icons-react";

/* ─── Géométrie du bureau libre (références, PAS une grille figée) ─────────── */

/** Référence migration : ancienne grille = 12 colonnes (1 col = 1/12 de large). */
export const REF_COLS = 12;
/** Référence migration : ancienne rangée = 64 px de haut. */
export const ROW_PX = 64;
/** Pas d'aimantation douce — bureau LIBRE (réglable, ~2 % de large / 8 px). */
export const SNAP_X = 1 / 48;
export const SNAP_Y = 8;
/** Bornes de taille d'une fenêtre. */
export const MIN_W = 1 / 6;
export const MIN_H = 96;
/** Gaps du pavage automatique (« Ranger ») : fraction (X) + px (Y). */
export const TILE_GAP_X = 0.008;
export const TILE_GAP_Y = 12;

/**
 * Poignée d'interaction pointeur (drag / resize) fournie par `WidgetGrid` à
 * `WidgetHost` — branchée via `setPointerCapture` (tous les `pointermove`/`up`
 * sont routés vers l'élément capteur → 0 event perdu, pas de listener `window`).
 */
export interface GridPointerHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

/** Familles de widgets (pour le catalogue + le filtrage). */
export type WidgetCategory =
  | "runtime"
  | "system"
  | "logs"
  | "orm"
  | "realtime"
  | "cluster"
  | "security"
  | "ai";

/** Libellés FR des catégories (catalogue, menus). */
export const WIDGET_CATEGORY_LABEL: Record<WidgetCategory, string> = {
  runtime: "Runtime & lancement",
  system: "Système & santé",
  logs: "Logs",
  orm: "Données / ORM",
  realtime: "Temps réel",
  cluster: "Cluster",
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
  /** Largeur courante de la fenêtre (équivalent colonnes 1-12, dérivé). */
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
  /**
   * Étiquettes de classement (ids du registre `tags.ts`) : DOMAINE (thème →
   * sous-thème) + NATURE (type de bloc). Les CAPACITÉS (cluster-ready, temps réel)
   * sont DÉRIVÉES (`clusterAware` / `source.kind`), jamais saisies ici → 0 dérive.
   */
  tags?: string[];
  source: WidgetSource;
  /** Le rendu change en cluster (résumé pod + grille worker, cf `ClusterView`). */
  clusterAware?: boolean;
  /** Taille par défaut à l'ajout — équivalent colonnes (1-12), converti en fraction. */
  defaultSpan: number;
  /** Colonnes minimales (équivalent). */
  minSpan: number;
  /** Hauteur par défaut — équivalent rangées (sinon 3), convertie en px. */
  defaultH?: number;
  /** Rangées minimales (sinon 2). */
  minH?: number;
  render: ComponentType<WidgetRenderProps<T>>;
}

/**
 * **Fenêtre** posée sur un bureau (clé = `widgetId`, 1 par bureau en v1).
 * Coordonnées : X + largeur en **fraction** (0..1) de la largeur, Y + hauteur en
 * **px**. `z` = ordre de profondeur (le plus grand est devant).
 */
export interface WidgetInstance {
  widgetId: string;
  /** X — fraction 0..1 de la largeur du bureau (responsive). */
  x: number;
  /** Y — pixels depuis le haut (le bureau défile). */
  y: number;
  /** Largeur — fraction 0..1 de la largeur. */
  w: number;
  /** Hauteur — pixels. */
  h: number;
  /** Ordre de profondeur (z-order). */
  z: number;
}

/**
 * **Graine** d'un widget dans un preset — taille en équivalent colonnes/rangées
 * (ancienne grille), convertie en fraction/px à la migration. Pas de position :
 * le preset est **pavé automatiquement** au chargement.
 */
export interface WidgetSeed {
  widgetId: string;
  /** Largeur en colonnes (1-12). */
  span?: number;
  /** Hauteur en rangées. */
  h?: number;
}

/** Un PRESET de bureau (graines, sans position — pavé au chargement). */
export interface WorkspacePreset {
  id: string;
  label: string;
  items: WidgetSeed[];
  /**
   * Layout EXACT optionnel — fenêtres positionnées (px/fraction + z) exportées d'un
   * vrai bureau. Si présent, il est utilisé TEL QUEL (aucun pavage auto) → le modèle
   * reproduit l'agencement à l'identique. Sinon `items` est pavé automatiquement.
   */
  layout?: WidgetInstance[];
}

/** Un bureau VIVANT = des fenêtres placées librement. */
export interface WorkspaceLayout {
  id: string;
  label: string;
  items: WidgetInstance[];
}
