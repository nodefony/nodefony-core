/**
 * Largeur VISIBLE d'un texte de terminal, en colonnes — pas en unités de code.
 *
 * Un émoji ou un idéogramme occupe deux colonnes, un accent combiné zéro, une
 * séquence de contrôle (couleur, hyperlien) zéro. Compter `string.length`
 * replie une ligne d'émojis que l'on croyait courte, et un effacement « en
 * remontant » rate alors sa cible. Cette fonction est la SEULE règle de
 * largeur du terminal de développement : barre d'état, repli à la largeur,
 * curseur de l'invite.
 *
 * Les graphèmes viennent d'`Intl.Segmenter` (un drapeau, un émoji à
 * modificateur de teinte ou une famille liée par ZWJ restent UN graphème).
 * La table des caractères larges suit la propriété Unicode East Asian Width
 * (`W` et `F`), celle que lisent les terminaux.
 */

/** Séquence CSI (`ESC [ … final`) : couleurs, effacements, déplacements. */
const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/y;
/** Séquence OSC (`ESC ] … BEL` ou `ESC ] … ESC \`) : hyperliens, titre. */
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/y;
/** Échappement à deux caractères (`ESC 7`, `ESC c`…). */
const ESC2 = /\x1b[ -~]/y;
/** Début de CSI coupé par la fin du texte (paramètres, pas encore de final). */
const CSI_PREFIX = /\x1b\[[0-?]*[ -/]*$/y;
/** Début d'OSC coupé par la fin du texte (pas encore de terminateur). */
const OSC_PREFIX = /\x1b\][^\x07\x1b]*\x1b?$/y;

/** Texte entièrement ASCII imprimable : la largeur est la longueur. */
const PLAIN_ASCII = /^[\x20-\x7e]*$/;
/** Graphème à présentation émoji par défaut (👍, 🔥, drapeaux…). */
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;
/** Pictogramme qui DEVIENT émoji suivi du sélecteur VS16 (`⚠️`). */
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
/** Graphème sans largeur : marques combinantes, format, contrôles. */
const ZERO_WIDTH = /^[\p{M}\p{Cf}\p{Cc}]+$/u;

/**
 * Plages Unicode à largeur double (East Asian Width `W`/`F`), triées, en
 * paires `[début, fin]` incluses. Les émojis à présentation émoji sont
 * reconnus à part, par leur propriété.
 */
const WIDE_RANGES: readonly number[] = [
  0x1100, 0x115f, 0x2329, 0x232a, 0x2e80, 0x303e, 0x3041, 0x33ff, 0x3400,
  0x4dbf, 0x4e00, 0x9fff, 0xa000, 0xa4cf, 0xa960, 0xa97f, 0xac00, 0xd7a3,
  0xf900, 0xfaff, 0xfe10, 0xfe19, 0xfe30, 0xfe6f, 0xff00, 0xff60, 0xffe0,
  0xffe6, 0x16fe0, 0x18cff, 0x1b000, 0x1b2ff, 0x1f200, 0x1f2ff, 0x20000,
  0x2fffd, 0x30000, 0x3fffd,
];

/**
 * Dit si un point de code occupe deux colonnes (table East Asian Width).
 *
 * @param cp - le point de code.
 * @returns `true` pour un caractère large.
 */
function isWideCodePoint(cp: number): boolean {
  if (cp < 0x1100) return false;
  // Recherche dichotomique sur les paires [début, fin].
  let lo = 0;
  let hi = WIDE_RANGES.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const start = WIDE_RANGES[mid * 2] ?? 0;
    const end = WIDE_RANGES[mid * 2 + 1] ?? 0;
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return true;
  }
  return false;
}

let segmenter: Intl.Segmenter | null = null;

/**
 * Découpe un texte sans séquence de contrôle en graphèmes.
 *
 * @param text - le texte.
 * @returns les graphèmes, dans l'ordre.
 */
function graphemes(text: string): Iterable<Intl.SegmentData> {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return segmenter.segment(text);
}

/**
 * Largeur d'UN graphème en colonnes : 0, 1 ou 2.
 *
 * @param grapheme - un graphème (cf `Intl.Segmenter`).
 * @returns sa largeur à l'écran.
 */
export function graphemeWidth(grapheme: string): 0 | 1 | 2 {
  const cp = grapheme.codePointAt(0) ?? 0;
  if (cp >= 0x20 && cp < 0x7f) return 1;
  if (ZERO_WIDTH.test(grapheme)) return 0;
  if (EMOJI_PRESENTATION.test(grapheme)) return 2;
  if (grapheme.includes("️") && PICTOGRAPHIC.test(grapheme)) return 2;
  return isWideCodePoint(cp) ? 2 : 1;
}

/**
 * Longueur de la séquence de contrôle qui commence à `index`, ou `0` s'il n'y
 * en a pas.
 *
 * @param text - le texte.
 * @param index - position d'un `ESC`.
 * @returns le nombre d'unités de code de la séquence.
 */
export function controlSequenceLength(text: string, index: number): number {
  for (const re of [CSI, OSC, ESC2]) {
    re.lastIndex = index;
    const match = re.exec(text);
    if (match) return match[0].length;
  }
  return 0;
}

/**
 * La séquence qui commence à `index` est-elle COUPÉE par la fin du texte ?
 * Un flux arrive par paquets : une séquence à cheval sur deux paquets doit
 * attendre la suite, sinon on la lirait comme un `ESC` isolé suivi de texte.
 *
 * @param text - le texte reçu jusqu'ici.
 * @param index - position d'un `ESC`.
 * @returns `true` si la fin du texte tombe au milieu de la séquence.
 */
export function isIncompleteControlSequence(
  text: string,
  index: number,
): boolean {
  if (index === text.length - 1) return true;
  for (const re of [CSI_PREFIX, OSC_PREFIX]) {
    re.lastIndex = index;
    if (re.test(text)) return true;
  }
  return false;
}

/**
 * Un morceau de texte vu par le terminal : une séquence de contrôle (largeur
 * nulle, recopiée telle quelle) ou un graphème avec sa largeur.
 */
export interface ITextUnit {
  readonly text: string;
  readonly width: 0 | 1 | 2;
  readonly control: boolean;
}

/**
 * Parcourt un texte unité par unité — séquences de contrôle et graphèmes —
 * sans rien allouer d'autre que les unités rendues.
 *
 * @param text - le texte, couleurs comprises.
 * @returns les unités, dans l'ordre.
 */
export function* textUnits(text: string): Generator<ITextUnit> {
  let i = 0;
  while (i < text.length) {
    const esc = text.indexOf("\x1b", i);
    const end = esc === -1 ? text.length : esc;
    if (end > i) {
      for (const { segment } of graphemes(text.slice(i, end))) {
        yield { text: segment, width: graphemeWidth(segment), control: false };
      }
      i = end;
      continue;
    }
    // Un ESC isolé (séquence tronquée) compte pour zéro et se recopie.
    const length = controlSequenceLength(text, i) || 1;
    yield { text: text.slice(i, i + length), width: 0, control: true };
    i += length;
  }
}

/**
 * Nombre de colonnes qu'occupe un texte dans un terminal.
 *
 * @param text - le texte, séquences de contrôle comprises (non comptées).
 * @returns la largeur en colonnes.
 */
export function visibleWidth(text: string): number {
  if (PLAIN_ASCII.test(text)) return text.length;
  let width = 0;
  for (const unit of textUnits(text)) width += unit.width;
  return width;
}

/**
 * Borne un texte à `max` colonnes. Trop large, il est coupé et finit par
 * `ellipsis` puis une remise à zéro des couleurs ; les séquences de contrôle
 * sont recopiées sans compter.
 *
 * @param text - le texte, couleurs comprises.
 * @param max - largeur maximale en colonnes.
 * @param ellipsis - marque de coupe (une colonne).
 * @returns le texte, au plus `max` colonnes.
 */
export function fitToWidth(text: string, max: number, ellipsis = "…"): string {
  if (visibleWidth(text) <= max) return text;
  const budget = Math.max(0, max - visibleWidth(ellipsis));
  let width = 0;
  let out = "";
  for (const unit of textUnits(text)) {
    if (unit.control) {
      out += unit.text;
      continue;
    }
    if (width + unit.width > budget) break;
    out += unit.text;
    width += unit.width;
  }
  // La fermeture d'un lien ouvert est tombée avec la fin coupée.
  return `${out}${ellipsis}\x1b[0m${openLink(out) === "" ? "" : LINK_CLOSE}`;
}

/** Une séquence SGR (couleur, style) : `ESC [ … m`. */
const SGR = /^\x1b\[[0-9;:]*m$/;

/** Un hyperlien OSC 8 : `ESC ] 8 ; params ; URI` puis `ESC \` ou BEL. */
const OSC8 = /^\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)(?:\x1b\\|\x07)$/;
/** Ferme l'hyperlien courant (URI vide). */
const LINK_CLOSE = "\x1b]8;;\x1b\\";

/**
 * L'hyperlien encore OUVERT à la fin d'un texte : la séquence qui l'a
 * ouvert, ou `""` s'il n'y en a pas (ou s'il a été refermé).
 */
function openLink(text: string): string {
  if (!text.includes("\x1b]8;")) return "";
  let link = "";
  for (const unit of textUnits(text)) {
    if (!unit.control) continue;
    const m = OSC8.exec(unit.text);
    if (m) link = (m[1] ?? "") === "" ? "" : unit.text;
  }
  return link;
}

/**
 * Replie un texte en lignes d'au plus `width` colonnes, sans couper un
 * graphème. La couleur active — et l'hyperlien OSC 8 ouvert — sont refermés
 * en fin de ligne et rouverts en tête de la suivante : une ligne repliée se
 * dessine seule, sans dépendre de celle du dessus, et un lien dont la fin
 * passe hors de l'écran ne reste pas ouvert sur tout ce qui suit.
 *
 * @param text - une ligne logique, couleurs comprises, sans `\n`.
 * @param width - largeur maximale en colonnes (au moins 1).
 * @returns les lignes repliées — au moins une, vide si le texte l'est.
 */
export function wrapToWidth(text: string, width: number): string[] {
  const max = Math.max(1, width);
  if (visibleWidth(text) <= max) return [text];
  const lines: string[] = [];
  let line = "";
  let used = 0;
  let style = "";
  let link = "";
  for (const unit of textUnits(text)) {
    if (unit.control) {
      line += unit.text;
      if (SGR.test(unit.text)) {
        style =
          unit.text === "\x1b[0m" || unit.text === "\x1b[m"
            ? ""
            : style + unit.text;
      } else {
        const m = OSC8.exec(unit.text);
        if (m) link = (m[1] ?? "") === "" ? "" : unit.text;
      }
      continue;
    }
    if (used + unit.width > max && used > 0) {
      lines.push(`${line}${style ? "\x1b[0m" : ""}${link ? LINK_CLOSE : ""}`);
      line = style + link;
      used = 0;
    }
    line += unit.text;
    used += unit.width;
  }
  lines.push(line);
  return lines;
}
