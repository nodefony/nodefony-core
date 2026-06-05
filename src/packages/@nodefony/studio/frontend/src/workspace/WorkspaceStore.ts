import { makeAutoObservable } from "mobx";
import type { WidgetInstance, WorkspaceLayout } from "./types";
import { DEFAULT_WORKSPACE_ID, WORKSPACE_PRESETS } from "./presets";
import { getWidget } from "./registry";

const LAYOUTS_KEY = "nf.workspace.layouts";
const ACTIVE_KEY = "nf.workspace.active";
const SPAN_MIN = 2;
const SPAN_MAX = 12;

function clampSpan(n: number): number {
  if (Number.isNaN(n)) return 4;
  return Math.min(SPAN_MAX, Math.max(SPAN_MIN, Math.round(n)));
}

function clone(p: WorkspaceLayout): WorkspaceLayout {
  return { id: p.id, label: p.label, items: p.items.map((i) => ({ ...i })) };
}

/**
 * Bureau composable — layouts de widgets par métier, persistés localStorage
 * (`nf.workspace.*`). Seed depuis {@link WORKSPACE_PRESETS} ; les personnalisations
 * de l'utilisateur (overlay persisté) l'emportent au chargement. Migrera vers le data
 * plane par-utilisateur en P6 (symétrie `UiStore`).
 */
export class WorkspaceStore {
  layouts: Record<string, WorkspaceLayout> = {};
  activeId: string = DEFAULT_WORKSPACE_ID;

  constructor() {
    makeAutoObservable(this);
    this.load();
  }

  /** Le bureau actif (repli sur « Vierge » si l'id persisté a disparu). */
  get active(): WorkspaceLayout {
    return (
      this.layouts[this.activeId] ??
      this.layouts.blank ?? { id: "blank", label: "Vierge", items: [] }
    );
  }

  /** Liste ordonnée des bureaux (pour le sélecteur). */
  get layoutList(): WorkspaceLayout[] {
    return Object.values(this.layouts);
  }

  setActive(id: string): void {
    if (this.layouts[id]) {
      this.activeId = id;
      this.persist();
    }
  }

  hasWidget(widgetId: string): boolean {
    return this.active.items.some((i) => i.widgetId === widgetId);
  }

  addWidget(widgetId: string): void {
    const def = getWidget(widgetId);
    const layout = this.layouts[this.activeId];
    if (!def || !layout || layout.items.some((i) => i.widgetId === widgetId))
      return;
    layout.items.push({ widgetId, span: clampSpan(def.defaultSpan) });
    this.persist();
  }

  removeWidget(widgetId: string): void {
    const layout = this.layouts[this.activeId];
    if (!layout) return;
    layout.items = layout.items.filter((i) => i.widgetId !== widgetId);
    this.persist();
  }

  setSpan(widgetId: string, span: number): void {
    const it = this.layouts[this.activeId]?.items.find(
      (i) => i.widgetId === widgetId,
    );
    if (!it) return;
    it.span = clampSpan(span);
    this.persist();
  }

  /** Déplace un widget dans l'ordre du bureau (−1 gauche, +1 droite). */
  move(widgetId: string, dir: -1 | 1): void {
    const items = this.layouts[this.activeId]?.items;
    if (!items) return;
    const i = items.findIndex((x) => x.widgetId === widgetId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    const a = items[i];
    items[i] = items[j];
    items[j] = a;
    this.persist();
  }

  /** Réinitialise le bureau courant à son preset d'origine (perd les perso). */
  resetToPreset(): void {
    const preset = WORKSPACE_PRESETS.find((p) => p.id === this.activeId);
    if (!preset) return;
    this.layouts[this.activeId] = clone(preset);
    this.persist();
  }

  private load(): void {
    // 1. Seed depuis les presets (toujours présents, même sans rien de persisté).
    const seeded: Record<string, WorkspaceLayout> = {};
    for (const p of WORKSPACE_PRESETS) seeded[p.id] = clone(p);
    this.layouts = seeded;
    try {
      if (typeof localStorage === "undefined") return;
      const rawActive = localStorage.getItem(ACTIVE_KEY);
      if (rawActive && seeded[rawActive]) this.activeId = rawActive;
      const raw = localStorage.getItem(LAYOUTS_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      // 2. Overlay : les layouts persistés (perso utilisateur) écrasent le seed.
      for (const [id, layout] of Object.entries(
        parsed as Record<string, WorkspaceLayout>,
      )) {
        if (!layout || !Array.isArray(layout.items)) continue;
        const items: WidgetInstance[] = layout.items
          .filter((i) => i && typeof i.widgetId === "string")
          .map((i) => ({ widgetId: i.widgetId, span: clampSpan(i.span) }));
        seeded[id] = {
          id,
          label: layout.label ?? seeded[id]?.label ?? id,
          items,
        };
      }
      this.layouts = seeded;
    } catch {
      /* storage illisible — on repart sur les presets */
    }
  }

  private persist(): void {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(LAYOUTS_KEY, JSON.stringify(this.layouts));
      localStorage.setItem(ACTIVE_KEY, this.activeId);
    } catch {
      /* ignore */
    }
  }
}
