import { makeAutoObservable } from "mobx";
import type { WidgetInstance, WorkspaceLayout, WorkspacePreset } from "./types";
import { MIN_H, MIN_W, REF_COLS, ROW_PX, SNAP_X, SNAP_Y } from "./types";
import { DEFAULT_WORKSPACE_ID, WORKSPACE_PRESETS } from "./presets";
import { getWidget } from "./registry";
import { autoTile, clamp, snap, type TileInput } from "./grid";

// v2 : modèle BUREAU LIBRE (fenêtres px/fraction + z-order). L'ancienne clé v1
// (grille en cellules) est volontairement ignorée → repart des presets migrés.
const LAYOUTS_KEY = "nf.workspace.layouts.v2";
const ACTIVE_KEY = "nf.workspace.active";

/** Largeur de widget (fraction) bornée. */
function clampW(w: number): number {
  return clamp(Number.isFinite(w) ? w : 0.33, MIN_W, 1);
}
/** Hauteur de widget (px) bornée. */
function clampHpx(h: number): number {
  return Math.max(MIN_H, Number.isFinite(h) ? Math.round(h) : 3 * ROW_PX);
}

/** Convertit les graines d'un preset (colonnes/rangées) en fenêtres pavées (px/fraction). */
function migratePreset(p: WorkspacePreset): WorkspaceLayout {
  const tiles = autoTile(
    p.items.map((s) => ({
      id: s.widgetId,
      w: clampW((s.span ?? 4) / REF_COLS),
      h: clampHpx((s.h ?? 3) * ROW_PX),
    })),
  );
  return {
    id: p.id,
    label: p.label,
    items: tiles.map((t, i) => ({
      widgetId: t.id,
      x: t.x,
      y: t.y,
      w: t.w,
      h: t.h,
      z: i + 1,
    })),
  };
}

/** Normalise une fenêtre persistée (bornes + arrondis). */
function normInstance(i: WidgetInstance): WidgetInstance {
  return {
    widgetId: i.widgetId,
    x: clamp(i.x, 0, 1),
    y: Math.max(0, Math.round(i.y)),
    w: clampW(i.w),
    h: clampHpx(i.h),
    z: i.z,
  };
}

/** Une fenêtre persistée est-elle au format v2 (fraction + z) ? */
function isInstance(i: unknown): i is WidgetInstance {
  const o = i as Record<string, unknown>;
  return (
    !!o &&
    typeof o.widgetId === "string" &&
    typeof o.x === "number" &&
    typeof o.y === "number" &&
    typeof o.w === "number" &&
    typeof o.h === "number" &&
    typeof o.z === "number"
  );
}

/**
 * Bureau composable — **fenêtres flottantes** (placement libre + chevauchement +
 * z-order), persistées localStorage (`nf.workspace.*`). Seed depuis
 * {@link WORKSPACE_PRESETS} (migrés cols→px) ; les personnalisations (overlay v2)
 * l'emportent. Migrera vers le data plane par-utilisateur en P6 (symétrie `UiStore`).
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

  /** z-order le plus élevé du bureau actif (0 si vide). */
  private topZ(items: WidgetInstance[]): number {
    return items.reduce((m, i) => Math.max(m, i.z), 0);
  }

  /**
   * Ajoute une fenêtre : taille par défaut du widget (cols/rangées → fraction/px),
   * posée **sous** le contenu existant (n'en recouvre aucun), au 1er plan (z max+1).
   */
  addWidget(widgetId: string): void {
    const def = getWidget(widgetId);
    const layout = this.layouts[this.activeId];
    if (!def || !layout || layout.items.some((i) => i.widgetId === widgetId))
      return;
    const w = clampW((def.defaultSpan ?? 4) / REF_COLS);
    const h = clampHpx((def.defaultH ?? 3) * ROW_PX);
    const bottom = layout.items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
    layout.items.push({
      widgetId,
      x: 0,
      y: layout.items.length ? bottom + SNAP_Y : 0,
      w,
      h,
      z: this.topZ(layout.items) + 1,
    });
    this.persist();
  }

  removeWidget(widgetId: string): void {
    const layout = this.layouts[this.activeId];
    if (!layout) return;
    layout.items = layout.items.filter((i) => i.widgetId !== widgetId);
    this.persist();
  }

  /** Déplace une fenêtre (placement LIBRE : chevauchement permis) + aimantation douce. */
  moveTo(widgetId: string, x: number, y: number): void {
    const it = this.layouts[this.activeId]?.items.find(
      (i) => i.widgetId === widgetId,
    );
    if (!it) return;
    it.x = clamp(snap(x, SNAP_X), 0, 1 - it.w);
    it.y = Math.max(0, snap(y, SNAP_Y));
    this.persist();
  }

  /** Redimensionne une fenêtre (aimantation douce + bornes ; reste dans le cadre). */
  setSize(widgetId: string, w: number, h: number): void {
    const it = this.layouts[this.activeId]?.items.find(
      (i) => i.widgetId === widgetId,
    );
    if (!it) return;
    it.w = clampW(snap(w, SNAP_X));
    it.h = clampHpx(snap(h, SNAP_Y));
    it.x = Math.min(it.x, 1 - it.w);
    this.persist();
  }

  /** Passe une fenêtre au PREMIER PLAN (z-order) — appelé au focus (clic). */
  bringToFront(widgetId: string): void {
    const items = this.layouts[this.activeId]?.items;
    const it = items?.find((i) => i.widgetId === widgetId);
    if (!items || !it) return;
    const top = this.topZ(items);
    if (it.z === top) return; // déjà devant → 0 écriture
    it.z = top + 1;
    this.persist();
  }

  /**
   * « Ranger » (Clean Up des OS) : aligne TOUT sur la grille — pavage automatique
   * dans l'ordre de lecture courant (rangée puis colonne). Conserve les tailles.
   */
  tidy(): void {
    const layout = this.layouts[this.activeId];
    if (!layout || !layout.items.length) return;
    const order = [...layout.items].sort((a, b) => a.y - b.y || a.x - b.x);
    const tiles: TileInput[] = order.map((i) => ({
      id: i.widgetId,
      w: i.w,
      h: i.h,
    }));
    const byId = new Map(autoTile(tiles).map((t) => [t.id, t] as const));
    order.forEach((it, i) => {
      const t = byId.get(it.widgetId);
      if (t) {
        it.x = t.x;
        it.y = t.y;
        it.z = i + 1;
      }
    });
    this.persist();
  }

  /** Réinitialise le bureau courant à son preset d'origine (si c'en est un). */
  resetToPreset(): void {
    const preset = WORKSPACE_PRESETS.find((p) => p.id === this.activeId);
    if (!preset) return;
    this.layouts[this.activeId] = migratePreset(preset);
    this.persist();
  }

  /* ─── Gestion des bureaux (modèles prédéfinis + création/renommage…) ────── */

  /** Modèles prédéfinis nommés (pour l'ajout rapide « + »). */
  get templates(): { id: string; label: string }[] {
    return WORKSPACE_PRESETS.map((p) => ({ id: p.id, label: p.label }));
  }

  private uniqueId(): string {
    let id = `ws_${Date.now().toString(36)}`;
    while (this.layouts[id]) id += "x";
    return id;
  }

  /** Nom unique : « Base », puis « Base 2 », « Base 3 »… */
  private uniqueLabel(base: string): string {
    const used = new Set(Object.values(this.layouts).map((l) => l.label));
    if (!used.has(base)) return base;
    let n = 2;
    while (used.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  /** Crée un bureau (vierge, ou seedé d'un modèle prédéfini) et l'active. */
  createWorkspace(templateId?: string): string {
    const tpl = templateId
      ? WORKSPACE_PRESETS.find((p) => p.id === templateId)
      : null;
    const id = this.uniqueId();
    const label = this.uniqueLabel(tpl?.label ?? "Bureau");
    const items = tpl ? migratePreset(tpl).items : [];
    this.layouts[id] = { id, label, items };
    this.activeId = id;
    this.persist();
    return id;
  }

  /** Renomme un bureau (nom vide ignoré). */
  renameWorkspace(id: string, label: string): void {
    const l = this.layouts[id];
    const name = label.trim();
    if (!l || !name) return;
    l.label = name;
    this.persist();
  }

  /** Supprime un bureau (garde toujours au moins un bureau). */
  deleteWorkspace(id: string): void {
    if (Object.keys(this.layouts).length <= 1 || !this.layouts[id]) return;
    delete this.layouts[id];
    if (this.activeId === id) this.activeId = Object.keys(this.layouts)[0];
    this.persist();
  }

  /** Duplique un bureau (copie des fenêtres) et l'active. */
  duplicateWorkspace(id: string): void {
    const src = this.layouts[id];
    if (!src) return;
    const nid = this.uniqueId();
    this.layouts[nid] = {
      id: nid,
      label: this.uniqueLabel(`${src.label} (copie)`),
      items: src.items.map((i) => ({ ...i })),
    };
    this.activeId = nid;
    this.persist();
  }

  private load(): void {
    // Persistance AUTORITAIRE : si l'utilisateur a déjà des bureaux (v2), ils
    // font foi (création/suppression/renommage collent). Les presets ne sont que
    // des MODÈLES pour le « + » — ils ne sont semés qu'au tout premier lancement.
    try {
      if (typeof localStorage !== "undefined") {
        const raw = localStorage.getItem(LAYOUTS_KEY);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            const out: Record<string, WorkspaceLayout> = {};
            for (const [id, layout] of Object.entries(
              parsed as Record<string, WorkspaceLayout>,
            )) {
              if (!layout || !Array.isArray(layout.items)) continue;
              out[id] = {
                id,
                label: layout.label ?? id,
                items: layout.items.filter(isInstance).map(normInstance),
              };
            }
            if (Object.keys(out).length) {
              this.layouts = out;
              const a = localStorage.getItem(ACTIVE_KEY);
              this.activeId = a && out[a] ? a : Object.keys(out)[0];
              return;
            }
          }
        }
      }
    } catch {
      /* storage illisible — on repart sur les presets */
    }
    // Premier lancement : semer depuis les presets (migrés cols→px).
    const seeded: Record<string, WorkspaceLayout> = {};
    for (const p of WORKSPACE_PRESETS) seeded[p.id] = migratePreset(p);
    this.layouts = seeded;
    if (!seeded[this.activeId])
      this.activeId = Object.keys(seeded)[0] ?? DEFAULT_WORKSPACE_ID;
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
