import type { IFrameSize } from "./devFrame";

/** Ce qu'une région de l'écran affiche. */
export type RegionKind = "tabs" | "gap" | "view" | "band" | "prompt" | "bar";

/**
 * Un rectangle de l'écran du superviseur, en coordonnées absolues (ligne et
 * colonne comptées depuis 0, en haut à gauche).
 */
export interface IRegion {
  readonly kind: RegionKind;
  readonly row: number;
  readonly column: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Où vit la ligne d'onglets : en haut de l'écran, ou en bas, juste au-dessus
 * de la bande et de l'invite qu'elle commande. `none` : aucune ligne propre
 * (une seule vue, ou des onglets rendus DANS la ligne de l'invite).
 */
export type TabsPlacement = "top" | "bottom" | "none";

/**
 * Ce que la mise en page doit placer — des HAUTEURS demandées, jamais du
 * contenu : la mise en page ne lit ni historique ni barre.
 */
export interface ILayoutState {
  readonly tabs: TabsPlacement;
  /** Lignes demandées par la bande ouverte (menu, complétion), 0 sans bande. */
  readonly band: number;
  /** Lignes de l'invite. */
  readonly prompt: number;
  /** Lignes de la barre d'état. */
  readonly bar: number;
}

/** Part maximale de l'écran qu'une bande peut prendre : un tiers. */
const BAND_SHARE = 3;

/**
 * Lignes vides entre la ligne d'onglets et la vue : le journal ne colle pas
 * aux onglets, quel que soit l'onglet montré.
 */
const TABS_GAP = 1;

/**
 * Calcule les régions de l'écran du superviseur — fonction PURE, rendue en
 * liste PLATE de rectangles disjoints (ADR-0013 §11).
 *
 * Une seule vue occupe la zone centrale : changer d'onglet change toute la
 * zone, jamais une partie. Quand la hauteur manque, la priorité part du bas :
 * la barre, puis l'invite, puis la bande, puis les onglets ; la marge entre
 * onglets et vue ({@link TABS_GAP}) cède avant la vue, qui garde au moins une
 * ligne, et prend ce qui reste. Sans onglets ni bande, le résultat est exactement les trois
 * zones de l'écran d'avant : journal (la vue), invite, barre.
 *
 * La largeur utile est `columns - 1` : la dernière colonne reste vide, pour
 * qu'aucun terminal ne replie une ligne pleine (même règle que `renderFrame`).
 *
 * @param size - dimensions du terminal.
 * @param state - placement des onglets et hauteurs demandées.
 * @returns les régions de hauteur non nulle, de haut en bas.
 */
export function layout(size: IFrameSize, state: ILayoutState): IRegion[] {
  const rows = Math.max(0, Math.floor(size.rows));
  const width = Math.max(1, Math.floor(size.columns) - 1);
  let free = rows;
  const take = (wanted: number): number => {
    const got = Math.max(0, Math.min(Math.floor(wanted), free));
    free -= got;
    return got;
  };
  const bar = take(state.bar);
  const prompt = take(state.prompt);
  const band = take(Math.min(state.band, Math.floor(rows / BAND_SHARE)));
  const tabs = take(state.tabs === "none" ? 0 : 1);
  const gap = tabs > 0 && free > TABS_GAP ? take(TABS_GAP) : 0;
  const view = free;

  const heights: [RegionKind, number][] =
    state.tabs === "top"
      ? [
          ["tabs", tabs],
          ["gap", gap],
          ["view", view],
          ["band", band],
          ["prompt", prompt],
          ["bar", bar],
        ]
      : [
          ["view", view],
          ["gap", gap],
          ["tabs", tabs],
          ["band", band],
          ["prompt", prompt],
          ["bar", bar],
        ];
  const regions: IRegion[] = [];
  let row = 0;
  for (const [kind, height] of heights) {
    if (height > 0) regions.push({ kind, row, column: 0, width, height });
    row += height;
  }
  return regions;
}
