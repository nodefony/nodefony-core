/**
 * Presets de bureaux par métier — remplacent les dashboards codés en dur
 * (`auth/dashboards.ts`). Un preset = un layout de DÉPART ; l'utilisateur personnalise
 * ensuite (ses changements persistés l'emportent au chargement). Les `widgetId`
 * absents du registry sont ignorés au rendu (défensif).
 */
import type { WorkspaceLayout } from "./types";

export const WORKSPACE_PRESETS: readonly WorkspaceLayout[] = [
  {
    id: "dev",
    label: "Développeur",
    items: [
      { widgetId: "runtime.mode", span: 6 },
      { widgetId: "system.info", span: 6 },
      { widgetId: "system.cpu", span: 4 },
      { widgetId: "system.heap", span: 4 },
      { widgetId: "system.eventloop", span: 4 },
      { widgetId: "orm.health", span: 6 },
      { widgetId: "logs.live", span: 6 },
    ],
  },
  {
    id: "supervisor",
    label: "Superviseur",
    items: [
      { widgetId: "system.health", span: 6 },
      { widgetId: "realtime.hub", span: 6 },
      { widgetId: "system.cpu", span: 4 },
      { widgetId: "system.heap", span: 4 },
      { widgetId: "system.eventloop", span: 4 },
      { widgetId: "logs.live", span: 12 },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    items: [
      { widgetId: "runtime.mode", span: 6 },
      { widgetId: "system.health", span: 6 },
      { widgetId: "orm.health", span: 6 },
      { widgetId: "realtime.hub", span: 6 },
    ],
  },
  { id: "blank", label: "Vierge", items: [] },
];

export const DEFAULT_WORKSPACE_ID = "dev";
