/**
 * grid.ts — **géométrie pure** du bureau libre (modèle fenêtres flottantes).
 *
 * Aucune dépendance React/MobX. Coordonnées : X + largeur en **fraction** (0..1)
 * de la largeur du bureau, Y + hauteur en **px**. Le bureau AUTORISE le
 * chevauchement (z-order) → pas d'anti-collision permanente ; ces helpers servent
 * à l'**aimantation douce** (snap), aux **bornes** et au **pavage à la demande**
 * (« Ranger »), pas à contraindre le placement libre.
 */
import { TILE_GAP_X, TILE_GAP_Y } from "./types";

/** Arrondit `v` au pas `step` le plus proche (aimantation). `step<=0` → inchangé. */
export function snap(v: number, step: number): number {
  if (step <= 0) return v;
  return Math.round(v / step) * step;
}

/** Borne `v` dans `[lo, hi]`. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Une fenêtre à paver : largeur en fraction, hauteur en px. */
export interface TileInput {
  id: string;
  w: number;
  h: number;
}

/** Résultat du pavage : position fraction (x) + px (y) + tailles. */
export interface TilePlaced {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * **Pavage automatique** (« Ranger » + migration des presets) : range les
 * fenêtres de gauche à droite, **retour à la ligne** quand la largeur dépasse 1,
 * hauteur de rangée = la plus haute de la rangée. Conserve l'ordre fourni, 0
 * chevauchement, 0 trou horizontal. Largeur bornée à 1 (pleine largeur max).
 */
export function autoTile(items: TileInput[]): TilePlaced[] {
  const out: TilePlaced[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const it of items) {
    const w = clamp(it.w, 0.05, 1);
    // Retour à la ligne si la fenêtre ne tient plus sur la rangée courante.
    if (x > 0 && x + w > 1 + 1e-6) {
      x = 0;
      y += rowH + TILE_GAP_Y;
      rowH = 0;
    }
    out.push({ id: it.id, x, y, w, h: it.h });
    x += w + TILE_GAP_X;
    rowH = Math.max(rowH, it.h);
  }
  return out;
}
