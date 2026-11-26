/**
 * Les teintes de la ligne d'onglets (#538) : un VOILE translucide, jamais un
 * aplat — la barre à peine posée sur le fond du terminal, l'onglet actif en
 * bleu de sélection. Un voile ne se calcule que sur le fond RÉEL : la sonde
 * le demande au terminal (OSC 11), on ne le devine jamais.
 *
 * Pur : ni terminal, ni environnement — la réponse de la sonde et la
 * profondeur de couleur sont passées par l'appelant.
 */

/** Une couleur, composantes de 0 à 255. */
export type Rgb = readonly [red: number, green: number, blue: number];

/** Les fonds de la ligne d'onglets, en paramètres SGR (`48;2;…` ou `48;5;…`). */
export interface ITabPalette {
  /** Toute la ligne : un voile neutre à peine posé. */
  readonly bar: string;
  /** L'onglet actif : le bleu de sélection, en voile. */
  readonly active: string;
}

/** La demande de la couleur de fond (OSC 11), terminée par BEL. */
export const BACKGROUND_QUERY = "\x1b]11;?\x07";

/** Le bleu de sélection que l'onglet actif pose en voile. */
const SELECTION_BLUE: Rgb = [36, 114, 200];
/** Part de blanc (fond sombre) ou de noir (fond clair) dans la barre. */
const BAR_TINT_DARK = 0.08;
const BAR_TINT_LIGHT = 0.06;
/** Part de bleu dans l'onglet actif — plus forte sur fond sombre, où il se voit moins. */
const ACTIVE_TINT_DARK = 0.32;
const ACTIVE_TINT_LIGHT = 0.2;
/** Profondeurs de couleur (`tty.WriteStream#getColorDepth`). */
const TRUE_COLOR_DEPTH = 24;
const PALETTE_256_DEPTH = 8;
/** Les niveaux du cube 6×6×6 de la palette xterm 256. */
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const;

const REPLY =
  /^\x1b\]11;(?:rgba?:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})(?:\/[0-9a-f]{1,4})?|#([0-9a-f]{6}))(?:\x07|\x1b\\)$/i;

/**
 * Lit la réponse du terminal à {@link BACKGROUND_QUERY} : `ESC ] 11 ;
 * rgb:RRRR/GGGG/BBBB` (une à quatre chiffres hexadécimaux par composante),
 * terminée par BEL ou ST ; `#rrggbb` aussi, que quelques terminaux rendent.
 *
 * @param bytes - la séquence entière, telle que le décodeur l'a rendue.
 * @returns la couleur, ou `null` si ce n'est pas une réponse de fond.
 */
export function parseBackgroundReply(bytes: string): Rgb | null {
  const match = REPLY.exec(bytes);
  if (match === null) return null;
  const hex = match[4];
  if (hex !== undefined) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }
  const scale = (part: string | undefined): number => {
    const digits = part ?? "0";
    return Math.round(
      (Number.parseInt(digits, 16) / (16 ** digits.length - 1)) * 255,
    );
  };
  return [scale(match[1]), scale(match[2]), scale(match[3])];
}

/**
 * Les teintes de la ligne d'onglets sur ce fond : en 24 bits si le terminal
 * les rend, sinon au plus proche de la palette 256.
 *
 * @param background - le fond rendu par la sonde, `null` sans réponse.
 * @param colorDepth - la profondeur du terminal (`getColorDepth()`).
 * @returns les teintes, ou `null` — fond inconnu ou 16 couleurs : la ligne
 *   reste sans fond, aucun voile n'est deviné.
 */
export function tabPalette(
  background: Rgb | null,
  colorDepth: number,
): ITabPalette | null {
  if (background === null || colorDepth < PALETTE_256_DEPTH) return null;
  const dark = luminance(background) < 0.5;
  const bar = dark
    ? mix([255, 255, 255], background, BAR_TINT_DARK)
    : mix([0, 0, 0], background, BAR_TINT_LIGHT);
  const active = mix(
    SELECTION_BLUE,
    background,
    dark ? ACTIVE_TINT_DARK : ACTIVE_TINT_LIGHT,
  );
  const sgr =
    colorDepth >= TRUE_COLOR_DEPTH
      ? (c: Rgb): string => `48;2;${c[0]};${c[1]};${c[2]}`
      : (c: Rgb, blue = false): string => `48;5;${nearest256(c, blue)}`;
  // En 256 couleurs, le bleu de sélection le plus proche est souvent un GRIS,
  // indiscernable de la barre : l’actif ne retient que des teintes bleues.
  return { bar: sgr(bar), active: sgr(active, true) };
}

/** `share` de `over` posé sur `base`, composante par composante. */
function mix(over: Rgb, base: Rgb, share: number): Rgb {
  return [
    Math.round(over[0] * share + base[0] * (1 - share)),
    Math.round(over[1] * share + base[1] * (1 - share)),
    Math.round(over[2] * share + base[2] * (1 - share)),
  ];
}

/** Luminance relative approchée (sRGB non linéarisé), de 0 à 1. */
function luminance(c: Rgb): number {
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
}

/**
 * L'index xterm 256 le plus proche : le cube 6×6×6 (16-231) ou la rampe de
 * gris (232-255), à la distance euclidienne ; `blue` : les seules teintes
 * où le bleu domine.
 */
function nearest256(c: Rgb, blue: boolean): number {
  let best = 16;
  let bestDistance = Number.POSITIVE_INFINITY;
  const consider = (index: number, r: number, g: number, b: number): void => {
    if (blue && (b <= r || b <= g)) return;
    const distance = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  };
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        consider(
          16 + 36 * r + 6 * g + b,
          CUBE_LEVELS[r] ?? 0,
          CUBE_LEVELS[g] ?? 0,
          CUBE_LEVELS[b] ?? 0,
        );
      }
    }
  }
  for (let i = 0; i < 24; i++) {
    const v = 8 + 10 * i;
    consider(232 + i, v, v, v);
  }
  return best;
}
