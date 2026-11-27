/**
 * L'image du terminal de développement, calculée sans terminal : le journal
 * (une fenêtre de l'historique de la vue active), la ligne d'onglets quand il
 * y en a plusieurs, l'invite, la barre d'état — rendues en lignes, chacune
 * bornée à `columns - 1` colonnes. Cf ADR-0013 §3, §9 et §11.
 *
 * `renderFrame` est pur : il lit le modèle et rend `{ lines, cursor }` ; qui
 * possède le terminal écrit l'image en UNE écriture, de préférence par
 * {@link diffFrame} (seules les lignes qui ont changé).
 *
 * La fenêtre du journal est ANCRÉE sur une entrée (`seq`), pas sur un numéro
 * de ligne : des lignes qui arrivent, une éviction en tête ou un
 * redimensionnement ne la font pas glisser. Ancrée, elle signale ce qui est
 * arrivé dessous (« ↑ N nouvelles lignes — Fin »).
 */
import { fitToWidth, visibleWidth, wrapToWidth } from "../../runtime/textWidth";
import {
  layout as screenLayout,
  type IRegion,
  type TabsPlacement,
} from "./devLayout";
import { invertColumns, type ISelectionRange } from "./devSelection";
import type { ITabPalette } from "./tabPalette";
import { sanitizeTerminalText, type ITranscriptEntry } from "./devTranscript";
import {
  renderStatusBar,
  renderStatusBlock,
  type IStatusActivity,
  type IStartupView,
  type IStatusContext,
  type ScreenCharset,
} from "./startupScreen";

/** Où en est le serveur, du point de vue du superviseur. */
export type DevPhase =
  "booting" | "building" | "ready" | "restarting" | "crashed";

/** Ce que l'image lit de l'historique (`DevTranscript` le fournit). */
export interface ITranscriptReader {
  readonly length: number;
  readonly lastSeq: number;
  at(index: number): ITranscriptEntry | undefined;
  indexOf(seq: number): number;
  /** Entrées retenues dont le numéro dépasse `seq` — les numéros croissent sans se suivre. */
  countAfter(seq: number): number;
}

/**
 * Le bas de la fenêtre quand on a remonté le journal : l'entrée `seq`, dont
 * les `below` dernières lignes repliées sont cachées sous la fenêtre.
 */
export interface IScrollAnchor {
  readonly seq: number;
  readonly below: number;
}

/** La barre d'état : le bilan du serveur, s'il en a donné un, et la phase. */
export interface IFrameStatus {
  /** `null` tant que le serveur n'a rien dit. */
  readonly view: IStartupView | null;
  readonly context: IStatusContext;
  readonly phase: DevPhase;
  /**
   * Message passager (le résultat d'une copie) : dans le bloc du serveur
   * prêt, il prend la place de l'aide ; sinon il suit la phase.
   */
  readonly notice?: string | null;
  /**
   * Ce qu'on sait de l'activité en cours, au-delà de la phase : l'étape, sa
   * progression, la durée, l'image du tourniquet — et un problème qui
   * persiste serveur prêt (build en échec, serveur précédent conservé).
   */
  readonly activity?: {
    readonly step?: string;
    readonly progress?: { done: number; total: number };
    readonly elapsedMs?: number;
    readonly frame?: string;
    readonly issue?: string;
  };
}

/** L'invite (#538) : ses lignes et la position du curseur DANS ces lignes. */
export interface IFramePrompt {
  readonly lines: readonly string[];
  /**
   * Sa première ligne est le filet qui la sépare du dessus : l'image le
   * redessine raccordé aux barres de la ligne d'onglets quand celle-ci le
   * touche (aucune bande entre les deux).
   */
  readonly ruled?: boolean;
  readonly cursor: { row: number; column: number };
  /** Le focus est au journal : l'invite reste dessinée, son curseur masqué. */
  readonly hidden?: boolean;
}

/** L'issue d'un onglet dont le travail est fini (un sous-agent) : ✓ ou ✗. */
export type ViewOutcome = "ok" | "failed";

/** Un onglet, tel que sa ligne le montre. */
export interface IFrameTab {
  readonly title: string;
  /** Entrées arrivées depuis qu'on l'a quitté — `0` pour l'onglet actif. */
  readonly unseen: number;
  /** L'une d'elles vient d'une sortie d'erreur : le compteur passe au rouge. */
  readonly alert: boolean;
  /** Son travail est fini : ✓ ou ✗ devant le titre, jusqu'à sa fermeture. */
  readonly outcome?: ViewOutcome | null;
  /**
   * Son travail tourne : l'image courante du tourniquet, à la place de ✓/✗ —
   * un onglet muet pendant le démarrage d'une commande ressemblait à un figé.
   */
  readonly busy?: string;
  /**
   * Ouvert à la volée (une commande, un panneau), pas un onglet fixe
   * (serveur, Vite) : une ┃ marque la frontière des deux groupes.
   */
  readonly adHoc?: boolean;
}

/** La ligne d'onglets : les onglets dans l'ordre, et lequel est actif. */
export interface IFrameTabs {
  readonly items: readonly IFrameTab[];
  readonly active: number;
}

/** Une barre de la ligne d'onglets : sa colonne, et si c'est la frontière des groupes. */
export interface ITabJoint {
  readonly column: number;
  readonly heavy: boolean;
}

/**
 * Les colonnes d'une zone cliquable de la ligne, `[start, end)`, et le rang
 * de l'onglet qu'elle montre — un onglet, ou une marque de débordement
 * (`‹ +3`), qui montre le voisin caché le plus proche.
 */
export interface ITabSpan {
  readonly start: number;
  readonly end: number;
  readonly index: number;
}

/**
 * Une bande (menu, complétion, aide) telle que l'image la lit : la hauteur
 * qu'elle demande, et ses lignes pour le rectangle que la mise en page lui
 * donne (ADR-0013 §11).
 */
export interface IFrameBand {
  /**
   * Lignes demandées pour cette largeur (une bande se replie sur un écran
   * étroit) ; la mise en page les borne à un tiers de l'écran.
   *
   * @param width - colonnes disponibles.
   */
  height(width: number): number;
  /**
   * Ses lignes, au plus `region.height` ; chacune est bornée à
   * `region.width` par l'image.
   *
   * @param region - son rectangle.
   */
  render(region: IRegion): readonly string[];
}

/**
 * Un panneau à la place du journal (#538, D9) : ses lignes pour le rectangle
 * du journal, chacune déjà bornée à la largeur.
 */
export interface IFramePanel {
  /**
   * @param width - colonnes.
   * @param height - lignes du journal.
   * @returns exactement `height` lignes.
   */
  render(width: number, height: number): readonly string[];
}

/** Tout ce que l'image lit. */
export interface IFrameModel {
  readonly transcript: ITranscriptReader;
  /** `null` = en direct : la fenêtre suit la dernière entrée. */
  readonly anchor: IScrollAnchor | null;
  readonly status: IFrameStatus | null;
  /** Absente ou `null` : invite de hauteur 0. */
  readonly prompt?: IFramePrompt | null;
  readonly color: boolean;
  readonly charset: ScreenCharset;
  /** Les lignes de la marque (`brandMark`) pour le bloc d'état. */
  readonly mark: readonly string[];
  /** Cache des hauteurs repliées — à garder d'une image à l'autre. */
  readonly heights?: FrameHeights;
  /** La barre bornée de l'image précédente — à garder d'une image à l'autre. */
  readonly statusBar?: StatusBarCache;
  /**
   * Dernière entrée effacée par `ESC[2J` : en direct, rien d'antérieur ne
   * s'affiche — la page propre du serveur prêt. Remonter le journal la
   * dépasse, comme dans l'historique d'un terminal.
   */
  readonly floorSeq?: number;
  /**
   * La ligne en cours, pas encore terminée (l'indicateur de build) : en
   * direct, elle s'affiche sous la dernière entrée, comme dans un terminal.
   */
  readonly partial?: string;
  /** La sélection à surligner, normalisée (cf `selectionRange`). */
  readonly selection?: ISelectionRange | null;
  /**
   * La ligne d'onglets, en bas, collée à l'invite (ADR-0013 §11) — absente
   * ou `null` : pas de ligne, l'écran d'une seule vue.
   */
  readonly tabs?: IFrameTabs | null;
  /**
   * Les voiles de la ligne d'onglets, calculés sur le fond réel du terminal
   * (`tabPalette`) — absents ou nuls : la ligne reste sans fond.
   */
  readonly tabPalette?: ITabPalette | null;
  /** La bande ouverte, entre les onglets et l'invite — absente : hauteur 0. */
  readonly band?: IFrameBand | null;
  /** Un panneau occupe le rectangle du journal — absent : le journal. */
  readonly panel?: IFramePanel | null;
}

/**
 * D'où vient une ligne d'écran du journal : l'entrée, et la colonne visible
 * de sa ligne logique où commence ce morceau replié.
 */
export interface IRowOrigin {
  readonly seq: number;
  readonly column: number;
}

/** Dimensions du terminal. */
export interface IFrameSize {
  readonly columns: number;
  readonly rows: number;
}

/** Une image : exactement `rows` lignes, et le curseur s'il y a une invite. */
export interface IFrame {
  readonly lines: readonly string[];
  readonly cursor: { row: number; column: number } | null;
  /**
   * Une par ligne : son origine dans l'historique, `null` hors du journal
   * (indicateur, invite, barre, remplissage) — ce qui ramène un clic à une
   * cellule de l'historique.
   */
  readonly origins?: readonly (IRowOrigin | null)[];
  /** La ligne d'onglets à l'écran : sa ligne, et les colonnes de chaque onglet. */
  readonly tabs?: { readonly row: number; readonly spans: readonly ITabSpan[] };
  /** La bande à l'écran : sa première ligne et sa hauteur — ce qu'un clic teste. */
  readonly band?: { readonly row: number; readonly height: number };
  /**
   * La ligne de l'écran (depuis 0) qui porte la première ligne SAISIE de
   * l'invite, sous son filet — `-1` sans invite. Ce qu'un glisser y relit.
   */
  readonly promptRow?: number;
  /**
   * Les lignes du journal à l'écran, depuis le haut : la région que le
   * terminal peut faire défiler ({@link diffFrameScrolled}).
   */
  readonly journalRows?: number;
}

/** Une ligne à réécrire. */
export interface IFrameChange {
  readonly row: number;
  readonly text: string;
}

/** Effacement de ligne : utile en rendu en ligne, destructeur dans une image. */
const ERASE_IN_LINE = /\x1b\[[012]?K/g;

/** Libellé de la barre quand le serveur n'a pas (ou plus) de bilan à montrer. */
const PHASE_LABELS: Readonly<Record<DevPhase, string>> = {
  booting: "démarrage…",
  building: "construction…",
  ready: "prêt",
  restarting: "redémarrage…",
  crashed: "arrêté — en attente d'une modification",
};

/**
 * Borne chaque ligne repliée à `width` colonnes — ce que le repli ne garantit
 * pas sous deux colonnes, où un graphème large tient seul sur sa ligne.
 *
 * @returns le même tableau quand aucune ligne ne dépasse.
 */
function fitRows(lines: readonly string[], width: number): readonly string[] {
  // Un graphème fait au plus deux colonnes (`graphemeWidth` : 0 | 1 | 2) : dès
  // deux colonnes, le repli a déjà borné chaque ligne — ne pas la remesurer.
  if (width >= 2) return lines;
  let out: string[] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fitted = fitToWidth(line, width);
    if (fitted === line) continue;
    out ??= [...lines];
    out[i] = fitted;
  }
  return out ?? lines;
}

/**
 * Hauteurs repliées des entrées, mémoïsées pour UNE largeur : changer de
 * largeur invalide tout. De quoi faire défiler par lignes d'écran sans
 * replier tout l'historique à chaque geste.
 */
export class FrameHeights {
  #width = -1;
  readonly #heights = new Map<number, number>();
  // Lignes repliées des entrées de l'image précédente (`#shown`) et de
  // l'image en cours (`#showing`) : d'une image à l'autre, presque tout le
  // journal est le même, et le replier coûtait le tiers de l'image. Bornées
  // par l'écran, jamais par l'historique.
  #shown = new Map<number, readonly string[]>();
  #showing = new Map<number, readonly string[]>();

  /**
   * Replie une entrée affichée et retient sa hauteur ; une entrée de l'image
   * précédente n'est pas repliée de nouveau.
   *
   * @param entry - l'entrée.
   * @param width - largeur de repli, en colonnes.
   * @returns ses lignes repliées et bornées à `width`, à ne pas modifier.
   */
  lines(entry: ITranscriptEntry, width: number): readonly string[] {
    this.#reset(width);
    let lines = this.#showing.get(entry.seq) ?? this.#shown.get(entry.seq);
    lines ??= fitRows(this.#wrap(entry), width);
    this.#showing.set(entry.seq, lines);
    return lines;
  }

  /**
   * Clôt une image : seules les entrées qu'elle a affichées gardent leurs
   * lignes repliées pour la suivante.
   */
  endFrame(): void {
    const shown = this.#shown;
    this.#shown = this.#showing;
    shown.clear();
    this.#showing = shown;
  }

  /**
   * Hauteur repliée d'une entrée, calculée une seule fois par largeur.
   *
   * @param entry - l'entrée.
   * @param width - largeur de repli, en colonnes.
   * @returns le nombre de lignes d'écran.
   */
  height(entry: ITranscriptEntry, width: number): number {
    this.#reset(width);
    return this.#heights.get(entry.seq) ?? this.#wrap(entry).length;
  }

  /** Nombre de hauteurs retenues. */
  get size(): number {
    return this.#heights.size;
  }

  /**
   * Oublie les hauteurs des entrées évincées de l'historique.
   *
   * @param firstSeq - numéro de la plus ancienne entrée encore retenue.
   */
  prune(firstSeq: number): void {
    for (const seq of this.#heights.keys()) {
      if (seq < firstSeq) this.#heights.delete(seq);
    }
  }

  /** Replie une entrée à la largeur courante et retient sa hauteur. */
  #wrap(entry: ITranscriptEntry): readonly string[] {
    const lines = wrapToWidth(
      entry.text.replace(ERASE_IN_LINE, ""),
      this.#width,
    );
    this.#heights.set(entry.seq, lines.length);
    return lines;
  }

  /** Une autre largeur rend toutes les hauteurs — et les lignes — fausses. */
  #reset(width: number): void {
    if (width === this.#width) return;
    this.#width = width;
    this.#heights.clear();
    this.#shown.clear();
    this.#showing.clear();
  }
}

/**
 * L'activité de la barre pour une phase — `undefined` serveur prêt sans
 * problème : la ligne d'état dit alors le verdict du bilan.
 */
function activityOf(status: IFrameStatus): IStatusActivity | undefined {
  const extra = status.activity ?? {};
  if (status.phase === "ready") {
    return extra.issue === undefined
      ? undefined
      : { label: extra.issue, tone: "warning" };
  }
  if (status.phase === "crashed") {
    return { label: PHASE_LABELS.crashed, tone: "failed" };
  }
  return {
    label: PHASE_LABELS[status.phase],
    tone: "busy",
    ...(extra.step === undefined ? {} : { step: extra.step }),
    ...(extra.progress === undefined ? {} : { progress: extra.progress }),
    ...(extra.elapsedMs === undefined ? {} : { elapsedMs: extra.elapsedMs }),
    ...(extra.frame === undefined ? {} : { frame: extra.frame }),
  };
}

/**
 * Les lignes de la barre d'état : le bloc (ou la ligne) du bilan quand le
 * serveur est prêt, sinon la phase.
 */
function statusLines(
  model: IFrameModel,
  size: IFrameSize,
  activity: IStatusActivity | undefined,
): readonly string[] {
  const status = model.status;
  if (status === null) return [];
  const { view, phase } = status;
  const context =
    activity === undefined ? status.context : { ...status.context, activity };
  const options = {
    color: model.color,
    columns: size.columns,
    rows: size.rows,
    charset: model.charset,
  };
  // Un bilan existe : la barre le GARDE pendant un build, un redémarrage, un
  // crash — seule sa ligne d'état dit l'activité. Elle survit au serveur.
  if (view !== null) return renderStatusBar(view, context, options, model.mark);
  // Pas encore de bilan : le bloc avec le logo dit déjà où l'on est.
  const early = renderStatusBlock(null, context, options, model.mark);
  if (early !== null) return early.map((line) => sanitizeTerminalText(line));
  const notice = status.notice ? ` · ${status.notice}` : "";
  const label = sanitizeTerminalText(
    `${status.context.project} · ${PHASE_LABELS[phase]}${notice}`,
  );
  return [model.color ? `\x1b[2m${label}\x1b[0m` : label];
}

/**
 * L'indicateur de ce qui est arrivé sous une fenêtre remontée.
 *
 * @param count - entrées postérieures à l'ancre.
 * @param model - couleur et jeu de caractères.
 * @returns la ligne.
 */
function unseenLine(count: number, model: IFrameModel): string {
  const ascii = model.charset === "ascii";
  const plural = count > 1 ? "s" : "";
  const text = `${ascii ? "^" : "↑"} ${count} nouvelle${plural} ligne${plural} ${ascii ? "-" : "—"} Fin`;
  return model.color ? `\x1b[7m ${text} \x1b[0m` : text;
}

/**
 * La ligne d'onglets (#538) — décidée sur maquette : en couleur, la ligne
 * sous un VOILE neutre (`ITabPalette.bar`), l'onglet actif en bleu de
 * sélection (`ITabPalette.active`), un trait bleu ▎ devant lui, son titre en
 * gras ; les autres atténués. L'état d'un onglet fini en tête (✓ vert, ✗
 * rouge), le numéro (la touche Alt+N) atténué, le compteur d'un onglet caché
 * atténué — rouge quand une erreur y est arrivée. Une barre │ après chaque
 * onglet, ┃ à la frontière des onglets fixes et des onglets ouverts à la
 * volée. Sans voile connu (`palette` nulle) : le même dessin, sans fond.
 * Sans couleur, l'actif entre crochets et un trait `│` après chaque onglet.
 * Trop large : une fenêtre autour de l'actif, bordée de `‹ +3` / `+2 ›` (un
 * onglet plus long que la ligne seul y reste, coupé par le terminal).
 *
 * @param tabs - les onglets.
 * @param model - couleur, jeu de caractères et voiles.
 * @param width - colonnes disponibles.
 * @returns la ligne, les zones cliquables avec l'onglet que chacune montre,
 *   et les colonnes de ses barres (`joints`), où le filet du dessous se raccorde.
 */
function tabsLine(
  tabs: IFrameTabs,
  model: IFrameModel,
  width: number,
): { text: string; spans: ITabSpan[]; joints: ITabJoint[] } {
  const ascii = model.charset === "ascii";
  const dot = ascii ? "*" : "·";
  const light = ascii ? "|" : "│";
  const heavy = ascii ? "|" : "┃";
  const count = tabs.items.length;
  const palette = model.color ? (model.tabPalette ?? null) : null;
  const bar = palette === null ? "" : `\x1b[${palette.bar}m`;
  const labels: string[] = [];
  const counters: string[] = [];
  const widths = new Uint32Array(count);
  let total = 0;
  for (let i = 0; i < count; i++) {
    const tab = tabs.items[i];
    const label = sanitizeTerminalText(tab?.title ?? "");
    const counter =
      tab !== undefined && tab.unseen > 0 ? ` ${dot}${tab.unseen}` : "";
    labels.push(label);
    counters.push(counter);
    // Trait ou blanc, état, numéro, blanc, titre, compteur, blanc, barre.
    widths[i] =
      1 +
      (tab?.outcome || tab?.busy ? 2 : 0) +
      String(i + 1).length +
      1 +
      visibleWidth(label) +
      visibleWidth(counter) +
      2;
    total += widths[i] ?? 0;
  }
  // Trop large : une fenêtre autour de l'actif, élargie tant qu'elle tient,
  // et une marque de chaque côté qui compte les onglets cachés (`‹ +3`).
  let lo = 0;
  let hi = count - 1;
  if (total > width && count > 1) {
    const active = Math.min(Math.max(tabs.active, 0), count - 1);
    const left = (hidden: number): number =>
      hidden === 0 ? 0 : String(hidden).length + 6;
    lo = active;
    hi = active;
    let used = widths[active] ?? 0;
    for (;;) {
      let grew = false;
      const right = widths[hi + 1];
      if (
        right !== undefined &&
        used + right + left(lo) + left(count - hi - 2) <= width
      ) {
        hi++;
        used += right;
        grew = true;
      }
      const before = lo > 0 ? (widths[lo - 1] ?? 0) : -1;
      if (
        before !== -1 &&
        used + before + left(lo - 1) + left(count - hi - 1) <= width
      ) {
        lo--;
        used += before;
        grew = true;
      }
      if (!grew) break;
    }
  }
  const faint = (text: string): string =>
    model.color ? `\x1b[2m${text}\x1b[22m` : text;
  let text = bar;
  let column = 0;
  const spans: ITabSpan[] = [];
  const joints: ITabJoint[] = [];
  if (lo > 0) {
    const mark = ` ${ascii ? "<" : "‹"} +${lo} `;
    spans.push({ start: 0, end: mark.length, index: lo - 1 });
    text += overflowMark(mark, tabs.items, 0, lo, model) + bar + faint(light);
    column = mark.length;
    joints.push({ column, heavy: false });
    column += 1;
  }
  for (let i = lo; i <= hi; i++) {
    const tab = tabs.items[i];
    const label = labels[i] ?? "";
    const counter = counters[i] ?? "";
    const stride = widths[i] ?? 0;
    const active = i === tabs.active;
    spans.push({ start: column, end: column + stride - 1, index: i });
    const outcome = tab?.outcome ?? null;
    const glyph =
      outcome === "ok"
        ? ascii
          ? "+ "
          : "✓ "
        : outcome === "failed"
          ? ascii
            ? "x "
            : "✗ "
          : tab?.busy
            ? `${tab.busy} `
            : "";
    if (!model.color) {
      const body = `${glyph}${i + 1} ${label}${counter}`;
      text += active ? `[${body}]` : ` ${body} `;
    } else {
      const state =
        glyph === ""
          ? ""
          : `\x1b[${outcome === "ok" ? "32" : outcome === "failed" ? "31" : "36"}m${glyph}\x1b[39m`;
      if (active) {
        const own = palette === null ? "" : `\x1b[${palette.active}m`;
        text += `${own}\x1b[34m${ascii ? "|" : "▎"}\x1b[39m${state}${faint(String(i + 1))} \x1b[1m${label}\x1b[22m ${bar}`;
      } else {
        const unseen =
          counter === ""
            ? ""
            : tab?.alert === true
              ? `\x1b[31m${counter}\x1b[39m`
              : faint(counter);
        text += ` ${state}${faint(`${i + 1} ${label}`)}${unseen} `;
      }
    }
    column += stride - 1;
    // La barre qui suit : ┃ à la frontière des onglets fixes et des autres.
    const boundary =
      tab?.adHoc !== true && tabs.items[i + 1]?.adHoc === true && i < hi;
    text += faint(boundary ? heavy : light);
    joints.push({ column, heavy: boundary });
    column += 1;
  }
  if (hi < count - 1) {
    const hidden = count - 1 - hi;
    const mark = ` +${hidden} ${ascii ? ">" : "›"} `;
    spans.push({ start: column, end: column + mark.length, index: hi + 1 });
    text += overflowMark(mark, tabs.items, hi + 1, count, model) + bar;
    column += mark.length;
  }
  if (palette !== null) {
    // Le voile court jusqu'au bout de la ligne.
    text += `${" ".repeat(Math.max(0, width - column))}\x1b[0m`;
  } else if (model.color && !text.endsWith("\x1b[0m")) {
    text += "\x1b[0m";
  }
  return { text, spans, joints };
}

/**
 * Le filet sous la ligne d'onglets, raccordé à ses barres : ┴ sous une │,
 * ┸ sous la ┃ de la frontière des groupes.
 *
 * @param width - colonnes du filet.
 * @param joints - les colonnes des barres (`tabsLine`).
 * @param model - couleur et jeu de caractères.
 * @returns le filet.
 */
function joinedRule(
  width: number,
  joints: readonly ITabJoint[],
  model: IFrameModel,
): string {
  const ascii = model.charset === "ascii";
  let rule = "";
  let next = 0;
  for (const joint of joints) {
    if (joint.column >= width || joint.column < next) continue;
    rule += (ascii ? "-" : "─").repeat(joint.column - next);
    rule += ascii ? "+" : joint.heavy ? "┸" : "┴";
    next = joint.column + 1;
  }
  rule += (ascii ? "-" : "─").repeat(Math.max(0, width - next));
  return model.color ? `\x1b[2m${rule}\x1b[0m` : rule;
}

/**
 * Une marque de débordement : en rouge si un onglet qu'elle cache a reçu une
 * erreur, en gras s'il a reçu des lignes — un compteur caché reste vu.
 */
function overflowMark(
  mark: string,
  items: readonly IFrameTab[],
  from: number,
  to: number,
  model: IFrameModel,
): string {
  if (!model.color) return mark;
  let alert = false;
  let unseen = false;
  for (let i = from; i < to; i++) {
    const tab = items[i];
    if (tab === undefined) continue;
    if (tab.alert) alert = true;
    if (tab.unseen > 0) unseen = true;
  }
  if (alert) return `\x1b[1;31m${mark}\x1b[0m`;
  return unseen ? `\x1b[1m${mark}\x1b[0m` : `\x1b[2m${mark}\x1b[0m`;
}

/** Les lignes du journal et, en parallèle, leur origine. */
interface IJournalRows {
  lines: string[];
  origins: (IRowOrigin | null)[];
}

/**
 * Les origines des lignes repliées d'une entrée : la colonne visible où
 * commence chacune. Une entrée d'une ligne commence en 0 — le cas courant ne
 * mesure rien.
 */
function wrappedOrigins(seq: number, lines: readonly string[]): IRowOrigin[] {
  if (lines.length === 1) return [{ seq, column: 0 }];
  const out: IRowOrigin[] = [];
  let column = 0;
  for (const line of lines) {
    out.push({ seq, column });
    column += visibleWidth(line);
  }
  return out;
}

/**
 * Les `height` lignes du journal, de haut en bas, avec leur origine dans
 * l'historique — complétées par le bas en direct, par le haut remonté.
 */
function journalLines(
  model: IFrameModel,
  heights: FrameHeights,
  width: number,
  height: number,
): IJournalRows {
  const out: string[] = [];
  const origins: (IRowOrigin | null)[] = [];
  if (height <= 0) return { lines: out, origins };
  const transcript = model.transcript;
  const first = transcript.at(0);
  if (first) {
    let index = transcript.length - 1;
    let below = 0;
    let fromTop = false;
    if (model.anchor !== null && model.anchor.seq <= transcript.lastSeq) {
      const at = transcript.indexOf(model.anchor.seq);
      if (at === -1)
        fromTop = true; // ancre évincée : on montre le plus ancien
      else {
        index = at;
        below = model.anchor.below;
      }
    }
    if (fromTop) {
      for (let i = 0; i < transcript.length && out.length < height; i++) {
        const entry = transcript.at(i);
        if (!entry) continue;
        const lines = heights.lines(entry, width);
        out.push(...lines);
        origins.push(...wrappedOrigins(entry.seq, lines));
      }
      out.length = Math.min(out.length, height);
      origins.length = out.length;
    } else {
      const floor =
        model.anchor === null
          ? (model.floorSeq ?? -1)
          : Number.NEGATIVE_INFINITY;
      // En direct, la ligne en cours prend le bas du journal.
      const tail =
        model.anchor === null && model.partial
          ? fitRows(
              wrapToWidth(model.partial.replace(ERASE_IN_LINE, ""), width),
              width,
            )
          : [];
      const budget = Math.max(0, height - tail.length);
      for (let i = index; i >= 0 && out.length < budget; i--) {
        const entry = transcript.at(i);
        if (!entry) continue;
        if (entry.seq <= floor) break;
        let lines = heights.lines(entry, width);
        if (i === index && below > 0) {
          lines = lines.slice(0, Math.max(1, lines.length - below));
        }
        out.unshift(...lines);
        origins.unshift(...wrappedOrigins(entry.seq, lines));
      }
      if (out.length > budget) {
        out.splice(0, out.length - budget);
        origins.splice(0, origins.length - budget);
      }
      for (const line of tail.slice(-height)) {
        out.push(line);
        origins.push(null);
      }
    }
  }
  heights.endFrame();
  // En direct, une page courte s'écrit DEPUIS LE HAUT, comme dans un
  // terminal : alignée en bas, la page propre du serveur prêt naissait collée
  // à la barre puis sautait en haut quand le bilan la remplissait.
  const live = model.anchor === null;
  while (out.length < height) {
    if (live) {
      out.push("");
      origins.push(null);
    } else {
      out.unshift("");
      origins.unshift(null);
    }
  }
  return { lines: out, origins };
}

/**
 * Surligne la part sélectionnée d'une ligne du journal.
 *
 * @param line - la ligne d'écran.
 * @param origin - son origine dans l'historique.
 * @param range - la sélection normalisée.
 * @returns la ligne, surlignée là où la sélection la couvre.
 */
function highlightRow(
  line: string,
  origin: IRowOrigin,
  range: ISelectionRange,
): string {
  const { start, end } = range;
  if (origin.seq < start.seq || origin.seq > end.seq) return line;
  const from =
    origin.seq === start.seq ? Math.max(0, start.column - origin.column) : 0;
  const to =
    origin.seq === end.seq
      ? end.column - origin.column
      : Number.POSITIVE_INFINITY;
  return to > from ? invertColumns(line, from, to) : line;
}

/** La répartition des lignes entre les zones — une seule source. */
interface IFrameLayout {
  rows: number;
  /** Largeur de repli : `columns - 1`. */
  width: number;
  heights: FrameHeights;
  bar: readonly string[];
  promptLines: readonly string[];
  indicator: string[];
  /** La marge vide entre la vue et la ligne d'onglets (zéro ou une ligne). */
  gapLines: readonly string[];
  /** La ligne d'onglets (zéro ou une), et les colonnes de chaque onglet. */
  tabLines: readonly string[];
  tabSpans: readonly ITabSpan[];
  /** Les lignes de la bande, exactement la hauteur que la mise en page lui donne. */
  bandLines: readonly string[];
  journalHeight: number;
}

/**
 * La barre d'état de l'image, bornée à `width` — rejouée depuis le cache du
 * modèle tant que rien de ce qu'elle affiche n'a changé.
 */
function statusBar(
  model: IFrameModel,
  size: IFrameSize,
  width: number,
): readonly string[] {
  const activity = model.status === null ? undefined : activityOf(model.status);
  const kept = model.statusBar?.lookup(model, size, activity);
  if (kept !== undefined) return kept;
  const cache = model.statusBar;
  const composed = statusLines(model, size, activity);
  // Recomposée, la barre ne remesure que ses lignes CHANGÉES : le filet et la
  // marque, presque tout en non-ASCII, coûtaient le segmenteur à chaque
  // graduation (#903).
  const lines = composed.map(
    (line, index) =>
      cache?.fittedLine(index, line, width) ??
      fitToWidth(line.replace(ERASE_IN_LINE, ""), width),
  );
  cache?.store(model, size, activity, lines, composed, width);
  return lines;
}

/** Mêmes champs, mêmes valeurs (`===`) — un niveau, sans descendre. */
function sameFields(a: object | undefined, b: object | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  let count = 0;
  for (const key in a) {
    count++;
    const left: unknown = Reflect.get(a, key);
    const right: unknown = Reflect.get(b, key);
    if (left !== right) return false;
  }
  return count === Object.keys(b).length;
}

/**
 * La barre d'état bornée de l'image précédente, rejouée tant que rien de ce
 * qu'elle affiche n'a changé. Le statut est reconstruit à chaque image
 * (horloge, toupie) : la comparaison porte donc sur ses CHAMPS, et sur
 * l'activité telle que la barre la lit — serveur prêt, la toupie et le temps
 * écoulé n'y figurent pas, et la barre se rejoue d'une image à l'autre.
 */
export class StatusBarCache {
  #status: IFrameStatus | null = null;
  #activity: IStatusActivity | undefined = undefined;
  #color = false;
  #charset: IFrameModel["charset"] | null = null;
  #mark: readonly string[] | null = null;
  #columns = -1;
  #rows = -1;
  #lines: readonly string[] = [];
  #composed: readonly string[] = [];
  #width = -1;

  /**
   * Les lignes retenues, si la barre de cette image est la même.
   *
   * @param model - le modèle de l'image.
   * @param size - dimensions du terminal.
   * @param activity - l'activité lue par la barre (`activityOf`).
   * @returns les lignes bornées, ou `undefined` s'il faut recomposer.
   */
  lookup(
    model: IFrameModel,
    size: IFrameSize,
    activity: IStatusActivity | undefined,
  ): readonly string[] | undefined {
    if (
      size.columns !== this.#columns ||
      size.rows !== this.#rows ||
      model.color !== this.#color ||
      model.charset !== this.#charset ||
      model.mark !== this.#mark ||
      !sameFields(activity, this.#activity)
    ) {
      return undefined;
    }
    const a = model.status;
    const b = this.#status;
    if (a === b) return this.#lines;
    if (a === null || b === null) return undefined;
    return a.view === b.view &&
      a.phase === b.phase &&
      a.notice === b.notice &&
      sameFields(a.context, b.context)
      ? this.#lines
      : undefined;
  }

  /**
   * La ligne bornée de l'image précédente à ce rang, si sa composition et la
   * largeur n'ont pas changé : la barre recomposée ne remesure qu'ainsi ce qui
   * a bougé.
   *
   * @param index - le rang de la ligne dans la barre.
   * @param composed - la ligne composée, avant bornage.
   * @param width - la largeur de la barre.
   * @returns la ligne bornée retenue, ou `undefined` s'il faut la mesurer.
   */
  fittedLine(
    index: number,
    composed: string,
    width: number,
  ): string | undefined {
    return width === this.#width && this.#composed[index] === composed
      ? this.#lines[index]
      : undefined;
  }

  /**
   * Retient la barre composée pour les images suivantes.
   *
   * @param model - le modèle de l'image.
   * @param size - dimensions du terminal.
   * @param activity - l'activité lue par la barre.
   * @param lines - les lignes bornées.
   * @param composed - les mêmes lignes avant bornage.
   * @param width - la largeur de la barre.
   */
  store(
    model: IFrameModel,
    size: IFrameSize,
    activity: IStatusActivity | undefined,
    lines: readonly string[],
    composed: readonly string[],
    width: number,
  ): void {
    this.#status = model.status;
    this.#activity = activity;
    this.#color = model.color;
    this.#charset = model.charset;
    this.#mark = model.mark;
    this.#columns = size.columns;
    this.#rows = size.rows;
    this.#lines = lines;
    this.#composed = composed;
    this.#width = width;
  }
}

/** Sans onglets : rien à allouer à chaque image. */
const NO_TAB_LINES: readonly string[] = [];
/** La marge d'une ligne sous la vue : partagée, aucune allocation par image. */
const ONE_GAP_LINE: readonly string[] = Object.freeze([""]);

/** Les lignes vides d'une marge de `height` lignes. */
function gapLinesOf(height: number): readonly string[] {
  if (height <= 0) return NO_TAB_LINES;
  return height === 1 ? ONE_GAP_LINE : Array.from({ length: height }, () => "");
}
const NO_TAB_SPANS: readonly ITabSpan[] = [];

/** La dernière mise en page et ses entrées : une image sur l'autre, elles ne changent pas. */
const lastLayout = {
  rows: -1,
  columns: -1,
  tabs: "none" as TabsPlacement,
  band: -1,
  prompt: -1,
  bar: -1,
  regions: [] as readonly IRegion[],
};

/**
 * `screenLayout`, recalculée seulement quand une de ses entrées change : la
 * fonction est PURE, et en rafale chaque image lui redemandait les mêmes
 * rectangles (un tableau et cinq objets par image, mesuré au banc #896).
 */
function layoutOnce(
  size: IFrameSize,
  tabs: TabsPlacement,
  band: number,
  prompt: number,
  bar: number,
): readonly IRegion[] {
  const last = lastLayout;
  if (
    last.rows !== size.rows ||
    last.columns !== size.columns ||
    last.tabs !== tabs ||
    last.band !== band ||
    last.prompt !== prompt ||
    last.bar !== bar
  ) {
    last.rows = size.rows;
    last.columns = size.columns;
    last.tabs = tabs;
    last.band = band;
    last.prompt = prompt;
    last.bar = bar;
    last.regions = screenLayout(size, { tabs, band, prompt, bar });
  }
  return last.regions;
}

/**
 * Les lignes de l'invite bornées à `width`, par OBJET d'invite : son
 * producteur rend le même objet tant que rien ne change (`#promptFrame`), le
 * réajustement — le filet, tout non-ASCII, payait le segmenteur à chaque
 * image — n'a donc lieu qu'une fois.
 */
const fittedPrompts = new WeakMap<
  IFramePrompt,
  { width: number; lines: readonly string[] }
>();

function fittedPromptLines(
  prompt: IFramePrompt | null | undefined,
  width: number,
): readonly string[] {
  if (prompt === null || prompt === undefined) return NO_TAB_LINES;
  const kept = fittedPrompts.get(prompt);
  if (kept?.width === width) return kept.lines;
  const lines = prompt.lines.map((line) =>
    fitToWidth(line.replace(ERASE_IN_LINE, ""), width),
  );
  fittedPrompts.set(prompt, { width, lines });
  return lines;
}

function frameLayout(model: IFrameModel, size: IFrameSize): IFrameLayout {
  const rows = Math.max(0, Math.floor(size.rows));
  const width = Math.max(1, Math.floor(size.columns) - 1);
  const heights = model.heights ?? new FrameHeights();
  const first = model.transcript.at(0);
  if (first && heights.size > 2 * model.transcript.length + 64) {
    heights.prune(first.seq);
  }
  const bar = statusBar(model, size, width);
  let promptLines = fittedPromptLines(model.prompt, width);
  // Un COMPTE d'entrées, jamais une différence de numéros : quand plusieurs
  // canaux partagent la numérotation, deux lignes d'un anneau ne se suivent pas.
  const unseen =
    model.anchor === null ? 0 : model.transcript.countAfter(model.anchor.seq);
  const indicator = unseen > 0 ? [unseenLine(unseen, model)] : [];
  const tabs = model.tabs ? tabsLine(model.tabs, model, width) : null;
  // Les hauteurs viennent de la mise en page (`devLayout.ts`), seule source :
  // la barre, l'invite puis les onglets d'abord, la vue prend le reste ;
  // l'indicateur est DANS la vue. Négatif quand la hauteur manque — tout
  // lecteur borne à 0.
  const regions = layoutOnce(
    size,
    tabs === null ? "none" : "bottom",
    model.band?.height(width) ?? 0,
    promptLines.length,
    bar.length,
  );
  let view: IRegion | undefined;
  let bandLines: readonly string[] = NO_TAB_LINES;
  let gapLines: readonly string[] = NO_TAB_LINES;
  for (const region of regions) {
    if (region.kind === "view") view = region;
    else if (region.kind === "gap") gapLines = gapLinesOf(region.height);
    else if (region.kind === "band" && model.band) {
      // Toujours la hauteur donnée : une bande courte ne rend pas de lignes au
      // journal, une bande trop longue ne pousse pas l'invite.
      const drawn = model.band.render(region);
      const fixed: string[] = [];
      for (let i = 0; i < region.height; i++) fixed.push(drawn[i] ?? "");
      bandLines = fixed;
    }
  }
  const journalHeight = (view?.height ?? 0) - indicator.length;
  // Le filet de l'invite touche la ligne d'onglets : il se raccorde à ses barres.
  if (
    tabs !== null &&
    bandLines.length === 0 &&
    model.prompt?.ruled === true &&
    promptLines.length > 0
  ) {
    const joined = [joinedRule(width, tabs.joints, model)];
    for (let i = 1; i < promptLines.length; i++) {
      joined.push(promptLines[i] ?? "");
    }
    promptLines = joined;
  }
  return {
    rows,
    width,
    heights,
    bar,
    promptLines,
    indicator,
    gapLines,
    tabLines: tabs === null ? NO_TAB_LINES : [tabs.text],
    tabSpans: tabs === null ? NO_TAB_SPANS : tabs.spans,
    bandLines,
    journalHeight,
  };
}

/**
 * Nombre de lignes d'écran que l'image donne au journal — la page de PgUp
 * et PgDn.
 *
 * @param model - le modèle de l'image.
 * @param size - dimensions du terminal.
 * @returns la hauteur du journal, `0` s'il n'a pas de place.
 */
export function frameJournalRows(model: IFrameModel, size: IFrameSize): number {
  return Math.max(0, frameLayout(model, size).journalHeight);
}

/** Bas de la fenêtre : une entrée (par son index) et ses lignes cachées. */
interface IPosition {
  index: number;
  below: number;
}

/**
 * Le bas de la fenêtre quand elle montre les plus anciennes lignes, ou `null`
 * si tout l'historique tient dans la fenêtre (rien à faire défiler).
 */
function topPosition(
  transcript: ITranscriptReader,
  heights: FrameHeights,
  width: number,
  rows: number,
): IPosition | null {
  let above = 0;
  for (let index = 0; index < transcript.length; index++) {
    const entry = transcript.at(index);
    if (!entry) continue;
    const height = heights.height(entry, width);
    if (above + height >= rows) return { index, below: above + height - rows };
    above += height;
  }
  return null;
}

/**
 * Le haut de l'historique, mesuré sur la mise en page d'une fenêtre REMONTÉE :
 * elle porte l'indicateur des lignes du dessous, donc une ligne de journal de
 * moins qu'en direct — calculé sur le direct, le haut cacherait la première.
 */
function scrolledTop(
  model: IFrameModel,
  size: IFrameSize,
): { top: IPosition | null; layout: IFrameLayout } {
  const layout = frameLayout(
    { ...model, anchor: { seq: Number.NEGATIVE_INFINITY, below: 0 } },
    size,
  );
  const top = topPosition(
    model.transcript,
    layout.heights,
    layout.width,
    Math.max(0, layout.journalHeight),
  );
  return { top, layout };
}

/** `a` est-il plus ancien que `b` (plus haut dans l'historique) ? */
function isOlder(a: IPosition, b: IPosition): boolean {
  return a.index < b.index || (a.index === b.index && a.below > b.below);
}

/** Une position devenue ancre — `null` si elle est le direct. */
function toAnchor(
  transcript: ITranscriptReader,
  position: IPosition,
): IScrollAnchor | null {
  const entry = transcript.at(position.index);
  if (!entry) return null;
  if (position.index === transcript.length - 1 && position.below === 0) {
    return null;
  }
  return { seq: entry.seq, below: position.below };
}

/**
 * Fait défiler la fenêtre du journal de `delta` lignes d'écran : vers le haut
 * (les plus anciennes) si `delta > 0`, vers le bas sinon. Bornée en haut par
 * la première ligne de l'historique ; redescendue jusqu'en bas, elle revient
 * au direct (`null`).
 *
 * @param model - le modèle de l'image (historique, ancre courante, cache).
 * @param size - dimensions du terminal.
 * @param delta - lignes d'écran ; positif = remonter.
 * @returns la nouvelle ancre, `null` = en direct.
 */
export function scrollAnchor(
  model: IFrameModel,
  size: IFrameSize,
  delta: number,
): IScrollAnchor | null {
  const transcript = model.transcript;
  if (transcript.length === 0 || delta === 0) return model.anchor;
  const { top, layout } = scrolledTop(model, size);
  const { width, heights } = layout;
  if (top === null) return null;
  let position: IPosition = { index: transcript.length - 1, below: 0 };
  if (model.anchor !== null) {
    const index = transcript.indexOf(model.anchor.seq);
    position = index === -1 ? { ...top } : { index, below: model.anchor.below };
  }
  position.below += delta;
  if (delta > 0) {
    while (position.index >= 0) {
      const entry = transcript.at(position.index);
      const height = entry ? heights.height(entry, width) : 1;
      if (position.below < height) break;
      position.below -= height;
      position.index--;
    }
    if (position.index < 0 || isOlder(position, top)) position = top;
  } else {
    while (position.below < 0) {
      position.index++;
      const entry = transcript.at(position.index);
      if (!entry) return null;
      position.below += heights.height(entry, width);
    }
  }
  return toAnchor(transcript, position);
}

/**
 * L'ancre qui montre les plus anciennes lignes de l'historique (touche Début).
 *
 * @param model - le modèle de l'image.
 * @param size - dimensions du terminal.
 * @returns l'ancre, ou `null` si tout tient dans la fenêtre.
 */
export function topAnchor(
  model: IFrameModel,
  size: IFrameSize,
): IScrollAnchor | null {
  const { top } = scrolledTop(model, size);
  return top === null ? null : toAnchor(model.transcript, top);
}

/**
 * Le panneau dans le rectangle du journal : aucune ligne n'a d'origine dans
 * l'historique (rien à sélectionner, aucun clic n'y vise une entrée).
 */
function panelRows(
  panel: IFramePanel,
  width: number,
  height: number,
): IJournalRows {
  const lines = height > 0 ? [...panel.render(width, height)] : [];
  return { lines, origins: Array.from({ length: lines.length }, () => null) };
}

/**
 * Calcule l'image du terminal.
 *
 * @param model - historique, ancre, barre, invite, rendu.
 * @param size - dimensions du terminal.
 * @returns exactement `rows` lignes, aucune plus large que `columns - 1`
 *   colonnes, et le curseur (sur l'invite) ou `null`.
 */
export function renderFrame(model: IFrameModel, size: IFrameSize): IFrame {
  const {
    rows,
    width,
    heights,
    bar,
    promptLines,
    indicator,
    gapLines,
    tabLines,
    tabSpans,
    bandLines,
    journalHeight,
  } = frameLayout(model, size);
  const prompt = model.prompt ?? null;
  const journal =
    model.panel === undefined || model.panel === null
      ? journalLines(model, heights, width, journalHeight)
      : panelRows(model.panel, width, journalHeight);
  const all = [
    ...journal.lines,
    ...indicator,
    ...gapLines,
    ...tabLines,
    ...bandLines,
    ...promptLines,
    ...bar,
  ];
  const allOrigins = [
    ...journal.origins,
    ...Array.from(
      {
        length:
          indicator.length +
          gapLines.length +
          tabLines.length +
          bandLines.length +
          promptLines.length +
          bar.length,
      },
      () => null,
    ),
  ];
  // Trop bas pour tout : la barre et l'invite gagnent, par le bas.
  const cut = Math.max(0, all.length - rows);
  const origins = allOrigins.slice(cut);
  const range = model.selection ?? null;
  // Le journal arrive déjà borné (`fitRows`, une fois par entrée) : seuls
  // l'indicateur, l'invite et la barre se réajustent à chaque image.
  // La barre aussi (`statusBar`, une fois tant qu'elle ne change pas).
  const journalRows = Math.max(0, journal.lines.length - cut);
  const barStart = all.length - cut - bar.length;
  // L'invite arrive bornée (`fittedPromptLines`, une fois par objet d'invite).
  const promptStart = barStart - promptLines.length;
  const lines = all.slice(cut).map((line, row) => {
    const fitted =
      row < journalRows || row >= promptStart
        ? line
        : fitToWidth(line.replace(ERASE_IN_LINE, ""), width);
    const origin = origins[row] ?? null;
    return range === null || origin === null
      ? fitted
      : highlightRow(fitted, origin, range);
  });
  let cursor: IFrame["cursor"] = null;
  if (prompt !== null && prompt.hidden !== true) {
    const top = lines.length - bar.length - promptLines.length;
    const row = top + prompt.cursor.row;
    if (row >= 0 && row < lines.length) {
      cursor = { row, column: Math.min(prompt.cursor.column, width) };
    }
  }
  // La première ligne de l'invite APRÈS son filet : ce qu'un clic y relit.
  const promptRow =
    prompt !== null && promptLines.length > 0
      ? promptStart + (prompt.ruled === true ? 1 : 0)
      : -1;
  const tabRow =
    journal.lines.length + indicator.length + gapLines.length - cut;
  const bandRow = tabRow + tabLines.length;
  const hasTabs = tabLines.length > 0 && tabRow >= 0;
  const hasBand = bandLines.length > 0 && bandRow >= 0;
  // Un littéral par cas : une forme fixe chacun, et le cas courant (ni
  // onglets ni bande) n'alloue rien de plus que l'image.
  if (!hasTabs && !hasBand)
    return { lines, cursor, origins, journalRows, promptRow };
  const band = { row: bandRow, height: bandLines.length };
  if (!hasTabs) return { lines, cursor, origins, journalRows, promptRow, band };
  const tabs = { row: tabRow, spans: tabSpans };
  return hasBand
    ? { lines, cursor, origins, journalRows, promptRow, tabs, band }
    : { lines, cursor, origins, journalRows, promptRow, tabs };
}

/**
 * Les lignes à réécrire pour passer d'une image à la suivante.
 *
 * @param previous - l'image à l'écran, ou `null` (premier dessin).
 * @param next - l'image à dessiner.
 * @returns les lignes changées ; TOUTES si la hauteur a changé.
 */
export function diffFrame(
  previous: IFrame | null,
  next: IFrame,
): IFrameChange[] {
  const changes: IFrameChange[] = [];
  const full = previous === null || previous.lines.length !== next.lines.length;
  next.lines.forEach((text, row) => {
    if (full || previous.lines[row] !== text) changes.push({ row, text });
  });
  return changes;
}

/** Le passage d'une image à la suivante, défilement du journal compris. */
export interface IFrameDiff {
  /**
   * De combien la région du journal défile AVANT les écritures : `> 0` vers
   * le haut (`SU`, des lignes arrivent en direct), `< 0` vers le bas (`SD`,
   * on remonte dans l'historique), `0` sans défilement.
   */
  readonly shift: number;
  /** Les lignes à réécrire, une fois le défilement fait. */
  readonly changes: IFrameChange[];
}

const NO_SHIFT = 0;

/**
 * De combien le journal a glissé d'une image à l'autre, lu sur les origines
 * (`seq`, colonne), uniques par ligne : la ligne du haut de la nouvelle image
 * retrouvée plus bas dans l'ancienne (vers le haut), ou l'inverse (vers le
 * bas). `0` quand rien ne se retrouve. Le choix ne touche que le COÛT : le
 * diff compare ensuite à ce que l'écran montre après le défilement.
 */
function journalShift(
  previous: readonly (IRowOrigin | null)[],
  next: readonly (IRowOrigin | null)[],
  rows: number,
): number {
  const top = next[0] ?? null;
  if (top !== null) {
    for (let row = 1; row < rows; row++) {
      const origin = previous[row] ?? null;
      if (origin?.seq === top.seq && origin.column === top.column) return row;
    }
  }
  const oldTop = previous[0] ?? null;
  if (oldTop !== null) {
    for (let row = 1; row < rows; row++) {
      const origin = next[row] ?? null;
      if (origin?.seq === oldTop.seq && origin.column === oldTop.column) {
        return -row;
      }
    }
  }
  return NO_SHIFT;
}

/**
 * Comme {@link diffFrame}, mais le terminal fait défiler la région du journal
 * quand c'est moins cher : seules les lignes neuves s'écrivent, au lieu de
 * tout le journal (ADR-0013, amendement #903, D2). Une ligne libérée par le
 * défilement compte pour vide — l'appelant remet les attributs avant.
 *
 * @param previous - l'image à l'écran, ou `null` (premier dessin).
 * @param next - l'image à dessiner.
 * @returns le défilement à faire, puis les lignes à réécrire — le défilement
 *   n'est retenu que s'il réécrit MOINS de lignes que sans lui.
 */
export function diffFrameScrolled(
  previous: IFrame | null,
  next: IFrame,
): IFrameDiff {
  const rows = next.journalRows ?? 0;
  if (
    previous === null ||
    previous.lines.length !== next.lines.length ||
    previous.journalRows !== rows ||
    rows < 2 ||
    previous.origins === undefined ||
    next.origins === undefined
  ) {
    return { shift: NO_SHIFT, changes: diffFrame(previous, next) };
  }
  const shift = journalShift(previous.origins, next.origins, rows);
  if (shift === NO_SHIFT) {
    return { shift, changes: diffFrame(previous, next) };
  }
  const before = previous.lines;
  const after = next.lines;
  // Deux comptes sans rien allouer, puis la liste du moins cher.
  let plain = 0;
  let scrolled = 0;
  for (let row = 0; row < rows; row++) {
    const text = after[row];
    if (before[row] !== text) plain++;
    const from = row + shift;
    if ((from >= 0 && from < rows ? before[from] : "") !== text) scrolled++;
  }
  if (scrolled >= plain) {
    return { shift: NO_SHIFT, changes: diffFrame(previous, next) };
  }
  const changes: IFrameChange[] = [];
  for (let row = 0; row < after.length; row++) {
    const text = after[row] ?? "";
    let shown: string | undefined;
    if (row < rows) {
      const from = row + shift;
      shown = from >= 0 && from < rows ? before[from] : "";
    } else shown = before[row];
    if (shown !== text) changes.push({ row, text });
  }
  return { shift, changes };
}
