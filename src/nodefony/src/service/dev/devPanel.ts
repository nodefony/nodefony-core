/**
 * Le panneau à rubriques de l'écran de développement (#538, D9) : une
 * DONNÉE — des rubriques, chacune faite de titres, de lignes clé/valeur, de
 * texte et de tableaux — et UN rendu. L'aide et `/status` en sont deux
 * instances ; une commande du CLI rendra le sien depuis son résultat.
 *
 * Pur : ni terminal, ni horloge. `DevTerminal` l'ouvre dans un onglet à la
 * volée et lui passe les touches ; ce module ne sait que dessiner un
 * rectangle et déplacer son curseur.
 */
import { fitToWidth, visibleWidth, wrapToWidth } from "../../runtime/textWidth";
import type { IFramePanel } from "./devFrame";
import type { InputEvent } from "./inputDecoder";
import type { ScreenCharset } from "./startupScreen";

/** Une ligne d'une rubrique — union discriminée, forme stable. */
export type PanelRow =
  /** Un intertitre : une ligne vide le sépare de ce qui précède. */
  | { readonly kind: "heading"; readonly text: string }
  /** Une clé et sa valeur ; une valeur longue passe à la ligne SOUS sa colonne. */
  | { readonly kind: "entry"; readonly key: string; readonly value: string }
  /** Un paragraphe, replié à la largeur. */
  | { readonly kind: "text"; readonly text: string }
  /** Un tableau : en-tête, puis lignes ; une cellule trop large est coupée. */
  | {
      readonly kind: "table";
      readonly head: readonly string[];
      readonly rows: readonly (readonly string[])[];
    };

/** Une rubrique : son titre dans la ligne des rubriques, et ses lignes. */
export interface IPanelPage {
  readonly title: string;
  readonly rows: readonly PanelRow[];
}

/** Un panneau : son onglet (identifiant, libellé) et ses rubriques. */
export interface IPanelSpec {
  /** Identifiant stable de l'onglet (`help`, `status`). */
  readonly id: string;
  /** Le libellé de l'onglet. */
  readonly label: string;
  /** Au moins une rubrique. */
  readonly pages: readonly IPanelPage[];
}

/** Ce que le panneau fait d'une touche. */
export type PanelVerdict = "handled" | "close" | "pass";

/** Largeur au plus de la colonne des clés, et d'une colonne de tableau. */
const KEY_MAX = 30;
const CELL_MAX = 28;
/** Lignes défilées par un cran de molette. */
const WHEEL_STEP = 3;

/**
 * Le curseur d'un panneau ouvert : rubrique affichée et défilement. Champs
 * posés au constructeur (forme stable) ; le corps replié de la rubrique est
 * gardé pour la largeur où il a été calculé — un panneau ne change pas
 * d'une image à l'autre, seule la fenêtre bouge.
 */
export class PanelCursor implements IFramePanel {
  page = 0;
  scroll = 0;
  /** Hauteur du corps à la dernière image — PgUp/PgDn s'en servent. */
  room = 1;
  #bodyPage = -1;
  #bodyWidth = -1;
  #body: readonly string[] = [];

  constructor(
    readonly spec: IPanelSpec,
    readonly paint: IPanelPaint,
  ) {}

  /**
   * Les lignes de la rubrique affichée, repliées à `width`, calculées une
   * fois par couple (rubrique, largeur).
   *
   * @param width - colonnes du rectangle.
   */
  body(width: number): readonly string[] {
    if (this.#bodyPage !== this.page || this.#bodyWidth !== width) {
      const page = this.spec.pages[this.page];
      this.#body = page === undefined ? [] : pageLines(page, width, this.paint);
      this.#bodyPage = this.page;
      this.#bodyWidth = width;
    }
    return this.#body;
  }

  /**
   * Ses lignes pour un rectangle — {@link renderPanel}.
   *
   * @param width - colonnes.
   * @param height - lignes.
   */
  render(width: number, height: number): readonly string[] {
    return renderPanel(this, width, height);
  }

  /**
   * Applique une touche : ←→ changent de rubrique, ↑↓ PgUp PgDn Début Fin
   * et la molette défilent, Échap referme. Le reste passe — la frappe va à
   * l'invite de l'onglet.
   *
   * @param event - l'évènement décodé.
   * @returns ce qu'il en a fait.
   */
  handle(event: InputEvent): PanelVerdict {
    if (event.kind === "wheel") {
      this.scroll += event.direction === "up" ? -WHEEL_STEP : WHEEL_STEP;
      return "handled";
    }
    if (event.kind !== "key" || event.ctrl || event.alt) return "pass";
    const key = event.key;
    if (key === "escape") return "close";
    if (key === "left" || key === "right") {
      const last = this.spec.pages.length - 1;
      const next = Math.max(
        0,
        Math.min(last, this.page + (key === "left" ? -1 : 1)),
      );
      if (next !== this.page) {
        this.page = next;
        this.scroll = 0;
      }
      return "handled";
    }
    if (key === "home") this.scroll = 0;
    else if (key === "end") this.scroll = Number.MAX_SAFE_INTEGER;
    else if (key === "up") this.scroll -= 1;
    else if (key === "down") this.scroll += 1;
    else if (key === "pageup") this.scroll -= this.room;
    else if (key === "pagedown") this.scroll += this.room;
    else return "pass";
    return "handled";
  }
}

/** Couleur et jeu de caractères d'un panneau. */
export interface IPanelPaint {
  readonly color: boolean;
  readonly charset: ScreenCharset;
}

/**
 * Le panneau dans son rectangle : la ligne des rubriques, un filet, le corps
 * défilé, puis le pied (gestes et position). Le défilement est borné ICI :
 * le curseur peut déborder, l'image jamais.
 *
 * @param cursor - le panneau et sa position.
 * @param width - colonnes.
 * @param height - lignes (au moins 1).
 * @returns exactement `height` lignes, chacune au plus `width` colonnes.
 */
export function renderPanel(
  cursor: PanelCursor,
  width: number,
  height: number,
): string[] {
  const paint = painter(cursor.paint.color);
  const ascii = cursor.paint.charset === "ascii";
  const out: string[] = [];
  if (height <= 0 || width <= 0) return out;
  out.push(pageTabs(cursor, width, paint, ascii));
  if (height >= 2) out.push(paint("2", (ascii ? "-" : "─").repeat(width)));
  const room = Math.max(0, height - 3);
  cursor.room = Math.max(1, room);
  const body = cursor.body(width);
  cursor.scroll = Math.max(
    0,
    Math.min(cursor.scroll, Math.max(0, body.length - room)),
  );
  for (let i = 0; i < room; i++) out.push(body[cursor.scroll + i] ?? "");
  if (height >= 3) {
    const parts: string[] = [];
    if (cursor.spec.pages.length > 1) {
      parts.push(`${ascii ? "gauche droite" : "←→"} rubrique`);
    }
    if (body.length > room) {
      const end = Math.min(body.length, cursor.scroll + room);
      parts.push(
        `${ascii ? "haut bas" : "↑↓"} défiler (${cursor.scroll + 1}–${end} / ${body.length})`,
      );
    }
    parts.push("Échap fermer");
    const foot = parts.join(" · ");
    out.push(paint("2", fitToWidth(foot, width, ascii ? "~" : "…")));
  }
  return out.slice(0, height);
}

type Painter = (code: string, text: string) => string;

/** Le pinceau SGR — l'identité sans couleur. */
function painter(color: boolean): Painter {
  return color
    ? (code, text) => `\x1b[${code}m${text}\x1b[0m`
    : (_code, text) => text;
}

/** Complète `text` d'espaces jusqu'à `width` colonnes visibles. */
function padTo(text: string, width: number): string {
  const missing = width - visibleWidth(text);
  return missing > 0 ? text + " ".repeat(missing) : text;
}

/**
 * La ligne des rubriques : la fenêtre la plus large qui tient autour de la
 * rubrique active, bordée de `‹ +N` / `+N ›` quand d'autres débordent.
 */
function pageTabs(
  cursor: PanelCursor,
  width: number,
  paint: Painter,
  ascii: boolean,
): string {
  const pages = cursor.spec.pages;
  const chip = (i: number): number => visibleWidth(pages[i]?.title ?? "") + 3;
  // Place gardée pour les deux bornes (`‹ +NN ` et ` +NN ›`).
  const MARKS = 12;
  let lo = cursor.page;
  let hi = cursor.page;
  let used = chip(cursor.page);
  for (let grew = true; grew;) {
    grew = false;
    if (hi + 1 < pages.length && used + chip(hi + 1) + MARKS <= width) {
      used += chip(++hi);
      grew = true;
    }
    if (lo > 0 && used + chip(lo - 1) + MARKS <= width) {
      used += chip(--lo);
      grew = true;
    }
  }
  const chips: string[] = [];
  if (lo > 0) chips.push(paint("2", `${ascii ? "<" : "‹"} +${lo}`));
  for (let i = lo; i <= hi; i++) {
    const title = ` ${pages[i]?.title ?? ""} `;
    chips.push(i === cursor.page ? paint("1;7", title) : title);
  }
  if (hi < pages.length - 1) {
    chips.push(paint("2", `+${pages.length - 1 - hi} ${ascii ? ">" : "›"}`));
  }
  return fitToWidth(chips.join(" "), width, ascii ? "~" : "…");
}

/** Les lignes d'une rubrique, repliées à `width`, sans souci de hauteur. */
function pageLines(
  page: IPanelPage,
  width: number,
  options: IPanelPaint,
): string[] {
  const paint = painter(options.color);
  const ellipsis = options.charset === "ascii" ? "~" : "…";
  let keyWidth = 0;
  for (const row of page.rows) {
    if (row.kind === "entry") {
      keyWidth = Math.max(keyWidth, visibleWidth(row.key));
    }
  }
  keyWidth = Math.min(keyWidth, KEY_MAX, Math.floor(width / 3));
  const out: string[] = [];
  for (const row of page.rows) {
    switch (row.kind) {
      case "heading":
        if (out.length > 0) out.push("");
        out.push(paint("1", fitToWidth(row.text, width, ellipsis)));
        break;
      case "text":
        for (const part of wrapToWidth(row.text, Math.max(1, width - 2))) {
          out.push(`  ${part}`);
        }
        break;
      case "entry": {
        const indent = 2 + keyWidth + 2;
        const key = padTo(fitToWidth(row.key, keyWidth, ellipsis), keyWidth);
        const parts = wrapToWidth(row.value, Math.max(10, width - indent));
        parts.forEach((part, i) => {
          out.push(
            i === 0
              ? `  ${paint("1;36", key)}  ${part}`
              : `${" ".repeat(indent)}${part}`,
          );
        });
        break;
      }
      case "table": {
        const columns = row.head.length;
        const widths: number[] = [];
        for (let c = 0; c < columns; c++) {
          let w = visibleWidth(row.head[c] ?? "");
          for (const cells of row.rows) {
            w = Math.max(w, visibleWidth(cells[c] ?? ""));
          }
          widths.push(Math.min(CELL_MAX, w));
        }
        const line = (cells: readonly string[]): string =>
          "  " +
          widths
            .map((w, c) => padTo(fitToWidth(cells[c] ?? "", w, ellipsis), w))
            .join("  ")
            .trimEnd();
        out.push(paint("1", fitToWidth(line(row.head), width, ellipsis)));
        for (const cells of row.rows) {
          out.push(fitToWidth(line(cells), width, ellipsis));
        }
        break;
      }
    }
  }
  return out;
}
