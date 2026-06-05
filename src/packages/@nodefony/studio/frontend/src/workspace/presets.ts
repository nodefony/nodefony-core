/**
 * Presets de bureaux par métier — remplacent les dashboards codés en dur. Un preset =
 * un layout de DÉPART ({ span = colonnes, h = rangées }) ; l'utilisateur personnalise
 * ensuite (changements persistés). `widgetId` absent du registry = ignoré au rendu.
 */
import type { WorkspaceLayout } from "./types";

export const WORKSPACE_PRESETS: readonly WorkspaceLayout[] = [
  {
    id: "dev",
    label: "Développeur",
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
    id: "supervisor",
    label: "Superviseur",
    items: [
      { widgetId: "system.health", span: 5, h: 3 },
      { widgetId: "supervision.alerts", span: 7, h: 4 },
      { widgetId: "system.cpu", span: 4, h: 4 },
      { widgetId: "system.heap", span: 4, h: 4 },
      { widgetId: "system.eventloop", span: 4, h: 4 },
      { widgetId: "realtime.hub", span: 6, h: 4 },
      { widgetId: "cluster.workers", span: 6, h: 4 },
      { widgetId: "logs.live", span: 12, h: 5 },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    items: [
      { widgetId: "runtime.mode", span: 6, h: 4 },
      { widgetId: "runtime.modes", span: 6, h: 4 },
      { widgetId: "system.health", span: 6, h: 3 },
      { widgetId: "orm.health", span: 6, h: 4 },
      { widgetId: "realtime.hub", span: 6, h: 4 },
      { widgetId: "realtime.channels", span: 6, h: 4 },
    ],
  },
  { id: "blank", label: "Vierge", items: [] },
];

export const DEFAULT_WORKSPACE_ID = "dev";
