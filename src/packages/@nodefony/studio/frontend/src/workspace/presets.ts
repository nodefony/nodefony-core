/**
 * Presets de bureaux par métier — remplacent les dashboards codés en dur. Un preset =
 * un layout de DÉPART ({ span = colonnes, h = rangées }) ; l'utilisateur personnalise
 * ensuite (changements persistés). `widgetId` absent du registry = ignoré au rendu.
 *
 * `roles` filtre la VISIBILITÉ du bureau dans le sélecteur (un admin voit tout) :
 * un simple utilisateur ne doit pas tomber sur un bureau rempli de widgets admin.
 * Bureaux sans `roles` (« Mon compte », « Vierge ») = visibles par tous.
 */
import type { WorkspacePreset } from "./types";
// `roleNames` et NON `roles` : ce module est atteint au top-level depuis les
// stores (`RootStore` → `WorkspaceStore` → ici), et `roles.ts` importe les
// stores — y passer refermerait un cycle d'imports.
import { VIEW_ROLES, isVisibleForRoles } from "../auth/roleNames";

export const WORKSPACE_PRESETS: readonly WorkspacePreset[] = [
  {
    // Template SELF-SERVICE — bureau par défaut d'un simple utilisateur.
    // Profil + mes clés + mes sessions (tous self-service). Visible tous.
    id: "account",
    label: "Mon compte",
    items: [
      { widgetId: "account.profile", span: 6, h: 4 },
      { widgetId: "account.apikeys", span: 6, h: 3 },
      { widgetId: "account.sessions", span: 6, h: 3 },
    ],
  },
  {
    id: "dev",
    label: "Développeur",
    roles: VIEW_ROLES.dev,
    items: [
      { widgetId: "runtime.mode", span: 6, h: 4 },
      { widgetId: "system.info", span: 6, h: 4 },
      { widgetId: "system.git", span: 4, h: 3 },
      { widgetId: "system.uptime", span: 4, h: 3 },
      { widgetId: "system.cpu", span: 4, h: 4 },
      { widgetId: "system.heap", span: 4, h: 4 },
      { widgetId: "system.eventloop", span: 4, h: 4 },
      { widgetId: "orm.health", span: 6, h: 4 },
      { widgetId: "logs.live", span: 6, h: 5 },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    roles: VIEW_ROLES.admin,
    items: [
      { widgetId: "runtime.mode", span: 6, h: 4 },
      { widgetId: "runtime.modes", span: 6, h: 4 },
      { widgetId: "system.health", span: 6, h: 3 },
      { widgetId: "orm.health", span: 6, h: 4 },
      { widgetId: "realtime.hub", span: 6, h: 4 },
      { widgetId: "realtime.channels", span: 6, h: 4 },
    ],
  },
  {
    // Bureau « Supervision » — layout EXACT exporté d'un vrai bureau (fenêtres libres,
    // reproduit à l'identique, pas de pavage auto). Fusion de l'ex-« Superviseur ».
    // La page reste accessible (`/nodefony/supervision`) ; ceci est le MODÈLE du « + ».
    id: "supervision",
    label: "Supervision",
    roles: VIEW_ROLES.ops,
    items: [],
    layout: [
      // Santé du framework — pleine largeur, en haut.
      { widgetId: "supervision.health", x: 0, y: 0, w: 1, h: 216, z: 10 },
      // Petites cards KPI : Mode · Event-loop · CPU · Heap.
      { widgetId: "runtime.mode", x: 0, y: 228, w: 0.2917, h: 208, z: 2 },
      {
        widgetId: "system.eventloop",
        x: 0.2997,
        y: 228,
        w: 0.2083,
        h: 208,
        z: 3,
      },
      { widgetId: "system.cpu", x: 0.516, y: 228, w: 0.2292, h: 208, z: 4 },
      { widgetId: "system.heap", x: 0.7532, y: 228, w: 0.2292, h: 208, z: 5 },
      // Gros graphes pleine largeur.
      { widgetId: "supervision.correlation", x: 0, y: 448, w: 1, h: 312, z: 9 },
      { widgetId: "orm.flow", x: 0, y: 772, w: 1, h: 320, z: 7 },
      { widgetId: "supervision.gc", x: 0, y: 1104, w: 1, h: 384, z: 8 },
    ],
  },
  {
    // Thème SYSTÈME — santé + ressources + identité du process (pavé auto ; à
    // affiner puis re-exporter en `layout` exact comme Supervision).
    id: "systeme",
    label: "Système",
    roles: VIEW_ROLES.devops,
    items: [
      { widgetId: "supervision.health", span: 12, h: 6 },
      { widgetId: "system.cpu", span: 4, h: 4 },
      { widgetId: "system.heap", span: 4, h: 4 },
      { widgetId: "system.eventloop", span: 4, h: 4 },
      { widgetId: "supervision.correlation", span: 6, h: 5 },
      { widgetId: "supervision.gc", span: 6, h: 6 },
      { widgetId: "system.info", span: 6, h: 4 },
      { widgetId: "runtime.mode", span: 6, h: 4 },
    ],
  },
  {
    // Thème CONFIGURATION & LANCEMENT — statique (snapshot).
    id: "config",
    label: "Configuration",
    roles: VIEW_ROLES.dev,
    items: [
      { widgetId: "runtime.mode", span: 6, h: 4 },
      { widgetId: "runtime.modes", span: 6, h: 4 },
      { widgetId: "runtime.vite", span: 4, h: 4 },
      { widgetId: "system.info", span: 8, h: 4 },
      { widgetId: "system.git", span: 6, h: 3 },
      { widgetId: "system.uptime", span: 6, h: 3 },
    ],
  },
  {
    // Thème LOGS — flux live + fond de panier + canaux + alertes.
    id: "logs",
    label: "Logs",
    roles: VIEW_ROLES.devops,
    items: [
      { widgetId: "logs.live", span: 12, h: 7 },
      { widgetId: "logs.backplane", span: 12, h: 5 },
      { widgetId: "supervision.alerts", span: 6, h: 4 },
      { widgetId: "realtime.channels", span: 6, h: 4 },
    ],
  },
  {
    // Thème MÉMOIRE — heap V8 (espaces), ressources actives, GC, corrélation.
    id: "memoire",
    label: "Mémoire",
    roles: VIEW_ROLES.devops,
    items: [
      { widgetId: "supervision.memory", span: 8, h: 6 },
      { widgetId: "supervision.handles", span: 4, h: 6 },
      { widgetId: "supervision.gc", span: 12, h: 6 },
      { widgetId: "system.heap", span: 6, h: 4 },
      { widgetId: "supervision.correlation", span: 6, h: 5 },
    ],
  },
  {
    // Thème ERREURS — taux d'erreurs + alertes + flux de logs (messages).
    id: "erreurs",
    label: "Erreurs",
    roles: VIEW_ROLES.devops,
    items: [
      { widgetId: "supervision.errors", span: 6, h: 5 },
      { widgetId: "supervision.alerts", span: 6, h: 5 },
      { widgetId: "logs.live", span: 12, h: 7 },
    ],
  },
  { id: "blank", label: "Vierge", items: [] },
];

/** Rôles requis pour voir un bureau preset (un bureau custom/user inconnu = tous). */
export function presetRolesFor(id: string): string[] | undefined {
  return WORKSPACE_PRESETS.find((p) => p.id === id)?.roles;
}

/** Un bureau (preset ou custom) est-il visible pour ces rôles ? (admin voit tout). */
export function isWorkspaceVisible(id: string, roles: string[]): boolean {
  return isVisibleForRoles(presetRolesFor(id), roles);
}

/** Bureau par défaut générique (dev) — un user retombe sur « account » via le filtre. */
export const DEFAULT_WORKSPACE_ID = "account";
