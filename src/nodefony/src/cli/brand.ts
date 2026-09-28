/**
 * L'identité visuelle du terminal : le logo Nodefony (trois arcs emboîtés —
 * bleu, vert, bleu ciel) et le mot « nodefony », avec un encart d'informations.
 *
 * Tout est PRÉCALCULÉ : ces lignes sont des constantes, pas un appel à figlet.
 * Charger figlet et rendre une police coûtait ~14 ms à chaque démarrage (import
 * ~7 ms + rendu ~7 ms, mesuré) pour afficher toujours le même mot ; ici le rendu
 * n'est qu'une concaténation de quelques centaines de caractères.
 *
 * Les couleurs sont celles du MENU (cyan, gras, grisé) et les trois couleurs du
 * logo sont des couleurs de base du terminal : elles suivent le thème de chacun
 * et s'affichent partout, console Windows comprise.
 *
 * Le module est PUR : la largeur, la couleur et le jeu de caractères sont des
 * paramètres, ce qui rend chaque disposition éprouvable sans terminal.
 */

/** Le logo, tiré du PNG officiel en braille. 6 lignes × 8 colonnes. */
export const BRAND_LOGO: readonly string[] = [
  "   ⢀⡤⠖⠂ ",
  " ⣠⠞⢉⣤⠶⢛⠁",
  "⣸⡏⢠⣿⢁⣶⠟⠁",
  "⢻⣇⠸⣿⡈⢿⣄⡀",
  " ⠙⢦⣈⠻⢦⣌⡁",
  "   ⠉⠓⠦⣄ ",
];

/** Couleur de chaque caractère du logo : `b` arc extérieur bleu, `g` vert, `c` bleu ciel. */
export const BRAND_LOGO_COLORS: readonly string[] = [
  "   bbbb ",
  " bbbgggg",
  "bbgggccc",
  "bbgggccc",
  " bbbgggg",
  "   bbbb ",
];

/**
 * Le même logo en ASCII pur, pour une console dont la police n'a pas le braille
 * (Consolas, police par défaut de la console Windows classique).
 */
export const BRAND_LOGO_ASCII: readonly string[] = [
  "   ,--' ",
  " ,' ,-' ",
  "|  |  ( ",
  "|  |  ( ",
  " `. `-. ",
  "   `--. ",
];

export const BRAND_LOGO_ASCII_COLORS: readonly string[] = [
  "   bbbb ",
  " bb ggg ",
  "b  g  c ",
  "b  g  c ",
  " bb ggg ",
  "   bbbb ",
];

/** Le mot « nodefony » : police figlet Standard, lettres à pleine largeur, figé ici. */
export const BRAND_WORDMARK: readonly string[] = [
  "                      _           __                         ",
  "  _ __     ___     __| |   ___   / _|   ___    _ __    _   _ ",
  " | '_ \\   / _ \\   / _` |  / _ \\ | |_   / _ \\  | '_ \\  | | | |",
  " | | | | | (_) | | (_| | |  __/ |  _| | (_) | | | | | | |_| |",
  " |_| |_|  \\___/   \\__,_|  \\___| |_|    \\___/  |_| |_|  \\__, |",
  "                                                       |___/ ",
];

/** Jeu de caractères que le terminal sait afficher. */
export type BrandCharset = "unicode" | "ascii";

/** Une ligne de l'encart : une étiquette courte et sa valeur. */
export interface IBrandRow {
  label: string;
  value: string;
}

/** Ce que `renderBrand` compose. */
export interface IBrandOptions {
  /** Version affichée après « Nodefony », en grisé. */
  version?: string;
  /** Lignes sous le titre (quatre au plus tiennent à côté du dessin). */
  rows: readonly IBrandRow[];
  /** Largeur du terminal, en colonnes. */
  columns: number;
  /** Couleur autorisée (verdict de `resolveColorEnabled`). */
  color: boolean;
  /** Jeu de caractères ; `"ascii"` pour une console sans le braille. */
  charset: BrandCharset;
}

const RESET = "\x1b[0m";
const ARC_COLORS: Readonly<Record<string, string>> = {
  b: "\x1b[34m",
  g: "\x1b[32m",
  c: "\x1b[36m",
};
const GAP = "  ";
const PANEL_GAP = "   ";
const INDENT = "  ";
const LOGO_WIDTH = 8;
const WORD_WIDTH = (BRAND_WORDMARK[0] ?? "").length;
const ART_WIDTH = LOGO_WIDTH + GAP.length + WORD_WIDTH;

/** Tronque à `room` caractères visibles, avec « … » ; rien si la place manque. */
function clip(text: string, room: number): string {
  const chars = Array.from(text);
  if (chars.length <= room) return text;
  return room <= 1 ? "" : `${chars.slice(0, room - 1).join("")}…`;
}

/** Colore une ligne du logo : une séquence par changement de teinte, aucune sur un espace. */
function paintLogoLine(line: string, colors: string, color: boolean): string {
  if (!color) return line;
  let out = "";
  let current = "";
  let i = 0;
  for (const ch of line) {
    const code = ARC_COLORS[colors[i] ?? " "];
    if (code && code !== current) {
      out += code;
      current = code;
    }
    out += ch;
    i++;
  }
  return current ? out + RESET : out;
}

/**
 * Compose la bannière pour la largeur donnée.
 *
 * - large : logo, mot et encart côte à côte ;
 * - moyen : logo et mot, l'encart dessous ;
 * - étroit : le seul titre et l'encart — jamais une ligne coupée.
 *
 * @param options - version, lignes d'encart, largeur, couleur et jeu de caractères.
 * @returns le texte à écrire, encadré d'une ligne vide.
 */
export function renderBrand(options: IBrandOptions): string {
  const { color } = options;
  const bold = (s: string) => (color ? `\x1b[1m${s}${RESET}` : s);
  const dim = (s: string) => (color ? `\x1b[2m${s}${RESET}` : s);
  const boldCyan = (s: string) => (color ? `\x1b[1;36m${s}${RESET}` : s);

  const labelWidth = Math.max(0, ...options.rows.map((r) => r.label.length));
  const titleWidth =
    "Nodefony".length + (options.version ? options.version.length + 1 : 0);
  const panelWidth = Math.max(
    titleWidth,
    ...options.rows.map((r) => labelWidth + 2 + r.value.length),
  );
  // L'encart seul (sous le dessin, ou terminal étroit) : une valeur trop longue
  // est tronquée — une ligne repliée par le terminal casse l'alignement.
  const panelFor = (room: number) => [
    `${boldCyan("Nodefony")}${options.version ? ` ${dim(clip(options.version, room - 9))}` : ""}`,
    ...options.rows.map(
      (r) =>
        `${dim(r.label.padEnd(labelWidth))}  ${clip(r.value, room - labelWidth - 2)}`,
    ),
  ];
  const below = panelFor(options.columns - INDENT.length);

  if (options.columns < INDENT.length + ART_WIDTH) {
    return `\n${below.map((l) => INDENT + l).join("\n")}\n\n`;
  }

  const ascii = options.charset === "ascii";
  const logo = ascii ? BRAND_LOGO_ASCII : BRAND_LOGO;
  const logoColors = ascii ? BRAND_LOGO_ASCII_COLORS : BRAND_LOGO_COLORS;
  const art = logo.map(
    (line, i) =>
      `${paintLogoLine(line, logoColors[i] ?? "", color)}${GAP}${bold(BRAND_WORDMARK[i] ?? "")}`,
  );

  if (
    options.columns >=
    INDENT.length + ART_WIDTH + PANEL_GAP.length + panelWidth
  ) {
    // L'encart est centré verticalement sur le dessin.
    const panel = panelFor(panelWidth);
    const top = Math.max(0, Math.floor((art.length - panel.length) / 2));
    const lines = art.map((left, i) => {
      const right = panel[i - top];
      return right === undefined
        ? `${INDENT}${left}`
        : `${INDENT}${left}${PANEL_GAP}${right}`;
    });
    return `\n${lines.join("\n")}\n\n`;
  }
  return `\n${art.map((l) => INDENT + l).join("\n")}\n\n${below.map((l) => INDENT + l).join("\n")}\n\n`;
}

/**
 * Jeu de caractères à employer. Hors Windows, tout terminal courant a le braille.
 * Sous Windows, seuls Windows Terminal (`WT_SESSION`) et les terminaux intégrés
 * qui se déclarent (`TERM_PROGRAM`, VS Code en tête) sont garantis : la console
 * classique, en Consolas, afficherait des carrés vides. `NF_BANNER_ASCII=1`
 * force l'ASCII partout.
 *
 * @param platform - `process.platform` (injecté pour l'épreuve).
 * @param env - variables d'environnement.
 */
export function resolveBrandCharset(
  platform: string,
  env: Record<string, string | undefined>,
): BrandCharset {
  if (env.NF_BANNER_ASCII === "1") return "ascii";
  if (platform !== "win32") return "unicode";
  return env.WT_SESSION || env.TERM_PROGRAM ? "unicode" : "ascii";
}
