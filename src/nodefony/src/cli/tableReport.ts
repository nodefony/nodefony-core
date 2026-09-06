/**
 * Un tableau de données rendu pour un TERMINAL — pur, et borné à sa largeur.
 *
 * 🔴 `console.table` rend toutes les colonnes à leur largeur naturelle, ajoute
 * un index, et entoure chaque valeur de guillemets. Mesuré sur ce dépôt :
 * `nodefony inspect routes` sortait des lignes de **900 colonnes**. Un tableau
 * plus large que l'écran n'est pas un tableau — le terminal le replie, chaque
 * ligne en occupe dix, et l'alignement qui justifiait la forme a disparu.
 *
 * Ce module ne connaît ni le terminal ni les données : la largeur lui est
 * DONNÉE, les colonnes sont dérivées des objets reçus. Il rend des lignes.
 *
 * @module
 */
import { createPalette, wrap, type IPalette } from "../kernel/checks/report";

/** Une ligne de données — les clés deviennent les colonnes. */
export type TableRow = Record<string, unknown>;

/** Le décor du rendu — tout ce que ce module refuse d'aller chercher. */
export interface ITableOptions {
  /** Largeur utile, déjà bornée. */
  width: number;
  /** `true` pour émettre des séquences ANSI. */
  color: boolean;
  /**
   * Colonnes à rendre, dans cet ordre. Par défaut : l'union des clés
   * rencontrées, dans l'ordre où elles apparaissent.
   */
  columns?: readonly string[];
}

/** En deçà, une colonne ne porte plus d'information — elle porte une ellipse. */
const MIN_COLUMN = 6;

/**
 * Au-delà, une colonne n'a pas besoin de plus pour se lire.
 *
 * Sert à décider si un jeu de colonnes TIENT : une colonne de chemins longs ne
 * réclame pas soixante caractères pour être utile, et la compter à sa largeur
 * naturelle ferait renoncer à des colonnes qui tenaient très bien.
 */
const USABLE_WIDTH = 28;

/** Ce qu'une cellule doit à son lecteur : lisible, jamais du JSON brut. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "oui" : "non";
  if (Array.isArray(value)) return value.map((v) => formatCell(v)).join(", ");
  if (typeof value === "object") {
    // Un objet imbriqué n'a pas sa place dans une cellule : on dit sa forme,
    // et `--json` reste la porte pour son contenu.
    const clés = Object.keys(value as object);
    return clés.length ? `{${clés.join(", ")}}` : "{}";
  }
  return String(value);
}

/** Tronque en gardant une marque de troncature — jamais en silence. */
function tronquer(text: string, width: number): string {
  if (text.length <= width) return text;
  return width <= 1 ? "…" : `${text.slice(0, width - 1)}…`;
}

/**
 * Les colonnes présentes dans les données, dans l'ordre de rencontre.
 *
 * @param rows - les lignes.
 * @returns les noms de colonnes, sans doublon.
 */
export function columnsOf(rows: readonly TableRow[]): string[] {
  const vues: string[] = [];
  for (const row of rows) {
    for (const clé of Object.keys(row)) {
      if (!vues.includes(clé)) vues.push(clé);
    }
  }
  return vues;
}

/**
 * Répartit la largeur disponible entre les colonnes.
 *
 * Chacune reçoit ce qu'elle demande tant que le total tient. Au-delà, on rogne
 * les PLUS LARGES d'abord, par paliers : rogner uniformément punirait une
 * colonne de six caractères autant qu'une de soixante, et c'est la première
 * qu'on rend illisible.
 *
 * @param requested - largeur idéale de chaque colonne.
 * @param available - place totale pour les contenus (séparateurs déduits).
 * @returns la largeur retenue pour chaque colonne, dans le même ordre.
 */
export function repartir(
  requested: readonly number[],
  available: number,
): number[] {
  const selected = [...requested];
  let total = selected.reduce((n, x) => n + x, 0);
  if (total <= available) return selected;
  // Tant qu'il faut rogner, on retire un caractère à la colonne la plus large.
  // Simple, et le résultat est celui qu'on attend : les colonnes courtes
  // restent intactes, les longues convergent vers une largeur commune.
  while (total > available) {
    let plusLarge = 0;
    for (let i = 1; i < selected.length; i++) {
      if ((selected[i] ?? 0) > (selected[plusLarge] ?? 0)) plusLarge = i;
    }
    if ((selected[plusLarge] ?? 0) <= MIN_COLUMN) break;
    selected[plusLarge] = (selected[plusLarge] ?? 0) - 1;
    total -= 1;
  }
  return selected;
}

/**
 * Rend les données en FICHES — une entrée par bloc `clé : valeur`.
 *
 * C'est le repli quand un tableau ne peut plus tenir : trop de colonnes, ou un
 * terminal trop étroit. Une fiche reste lisible à n'importe quelle largeur, là
 * où un tableau comprimé ne dit plus rien.
 *
 * @param rows - les lignes.
 * @param columns - les colonnes à rendre.
 * @param width - largeur utile.
 * @param p - la peinture.
 * @returns les lignes à écrire.
 */
function fiches(
  rows: readonly TableRow[],
  columns: readonly string[],
  width: number,
  p: IPalette,
): string[] {
  const lines: string[] = [];
  const col = Math.min(
    Math.max(...columns.map((c) => c.length)),
    Math.max(MIN_COLUMN, Math.floor(width / 3)),
  );
  for (const [i, row] of rows.entries()) {
    if (i > 0) lines.push("");
    for (const clé of columns) {
      const value = formatCell(row[clé]);
      lines.push(
        `  ${p.dim(tronquer(clé, col).padEnd(col))}  ${tronquer(
          value,
          Math.max(1, width - col - 4),
        )}`,
      );
    }
  }
  return lines;
}

/**
 * Le tableau, ligne par ligne, sans retour chariot final.
 *
 * @param rows - les données ; une clé absente d'une ligne rend une cellule vide.
 * @param opts - le décor (largeur, couleur, colonnes retenues).
 * @returns les lignes à écrire, dans l'ordre.
 */
export function renderTable(
  rows: readonly TableRow[],
  opts: ITableOptions,
): string[] {
  const { width, color } = opts;
  const p = createPalette(color);
  if (rows.length === 0) return [];
  const columns = opts.columns ? [...opts.columns] : columnsOf(rows);
  if (columns.length === 0) return [];

  // 🔴 La place se gagne d'abord en RETIRANT ce qui n'apprend rien, pas en
  // comprimant tout le monde. Une colonne dont toutes les lignes portent la
  // même valeur (`host` vide, `bypassFirewall` faux partout) coûte sa largeur
  // et ne distingue aucune ligne : c'est elle qui doit céder, pas le nom de la
  // route. Comprimer d'abord donnait huit colonnes de huit caractères, toutes
  // tronquées — un tableau qui tient dans l'écran sans plus rien dire.
  const { kept, constants, omitted } = elaguer(rows, columns, width);

  const cells = rows.map((row) => kept.map((clé) => formatCell(row[clé])));
  const requested = kept.map((clé, i) =>
    Math.max(clé.length, ...cells.map((c) => (c[i] ?? "").length)),
  );

  // 2 espaces entre colonnes, 2 de marge à gauche.
  const separators = 2 * (kept.length - 1) + 2;
  const available = width - separators;
  // Même comprimé au minimum, ça ne tient pas : le tableau cède la place aux
  // fiches plutôt que de rendre des colonnes d'une lettre.
  if (available < kept.length * MIN_COLUMN) {
    return fiches(rows, columns, width, p);
  }
  const selected = repartir(requested, available);
  const cols = kept;

  const line = (values: readonly string[], teinte: (t: string) => string) =>
    `  ${values
      .map((v, i) => tronquer(v, selected[i] ?? 0).padEnd(selected[i] ?? 0))
      .join("  ")
      .trimEnd()}`
      .replace(/^ {2}/u, "  ")
      .split("\n")
      .map((l) => teinte(l))
      .join("\n");

  const lines = [line(cols, p.strong)];
  // Un filet sous l'en-tête, de la largeur réellement occupée : il sépare sans
  // encadrer. Les bordures de `console.table` coûtaient trois caractères par
  // colonne — sur neuf colonnes, un quart de l'écran.
  const occupée = Math.min(
    width,
    selected.reduce((n, x) => n + x, 0) + separators,
  );
  lines.push(p.dim(`  ${"─".repeat(Math.max(0, occupée - 2))}`));
  for (const c of cells) lines.push(line(c, (t) => t));
  // Ce qui a été retiré se DIT, avec sa valeur : une colonne qu'on ne voit
  // plus et dont on ignore le contenu vaut moins qu'une colonne absente.
  const notes: string[] = [];
  if (constants.length) {
    notes.push(
      `identique partout : ${constants
        .map(({ clé, value }) => `${clé} = ${value}`)
        .join(" · ")}`,
    );
  }
  // Une colonne retirée se DIT, avec la porte qui la rend : une donnée
  // silencieusement absente vaut moins qu'une donnée absente et annoncée.
  if (omitted.length) {
    notes.push(`non affiché faute de place : ${omitted.join(" · ")} (--json)`);
  }
  for (const note of notes) {
    // Repliée, jamais tronquée : c'est elle qui dit ce qu'on ne voit PAS, et
    // une phrase coupée sur ce sujet précis laisse croire qu'on a tout vu.
    for (const l of wrap(note, width - 2, "")) {
      lines.push(p.dim(`  ${l}`));
    }
  }
  return lines;
}

/**
 * Écarte les colonnes qui ne DISTINGUENT rien, quand la place manque.
 *
 * Une colonne constante sur l'ensemble des lignes coûte sa largeur et
 * n'apprend rien qu'une phrase ne dise mieux. On ne la retire pourtant que si
 * le tableau ne tient pas sans cela : sur un écran large, tout se voit, et
 * cacher une donnée qu'on aurait pu montrer serait un choix à la place du
 * lecteur.
 *
 * @param rows - les lignes.
 * @param columns - toutes les colonnes candidates.
 * @param width - largeur utile.
 * @returns les colonnes gardées, et celles retirées avec leur valeur unique.
 */
function elaguer(
  rows: readonly TableRow[],
  columns: readonly string[],
  width: number,
): {
  kept: string[];
  constants: { clé: string; value: string }[];
  omitted: string[];
} {
  const request = (clé: string): number =>
    Math.max(clé.length, ...rows.map((r) => formatCell(r[clé]).length));
  const fits = (list: readonly string[]): boolean =>
    list.reduce((n, clé) => n + Math.min(request(clé), USABLE_WIDTH), 0) +
      2 * (list.length - 1) +
      2 <=
    width;

  if (fits(columns)) {
    return { kept: [...columns], constants: [], omitted: [] };
  }

  // 1. Les colonnes qui ne DISTINGUENT rien cèdent en premier : une valeur
  //    unique sur toutes les lignes coûte sa largeur et n'apprend rien qu'une
  //    phrase ne dise mieux. La PREMIÈRE colonne reste quoi qu'il arrive —
  //    c'est l'identité de la ligne.
  const constants: { clé: string; value: string }[] = [];
  let remaining: string[] = [];
  for (const clé of columns) {
    const values = new Set(rows.map((r) => formatCell(r[clé])));
    if (values.size === 1 && remaining.length > 0) {
      constants.push({ clé, value: [...values][0] ?? "" });
      continue;
    }
    remaining.push(clé);
  }

  // 2. Si ça ne suffit pas, ce sont les DERNIÈRES qui cèdent. L'ordre des clés
  //    est celui du producteur, et un producteur nomme d'abord ce qui compte :
  //    pour une route, `name` et `path` avant `host` et `bypassFirewall`. Une
  //    heuristique « garder les plus variées » ferait mieux sur le papier et
  //    perdrait `methods`, que personne ne veut perdre.
  const omitted: string[] = [];
  while (remaining.length > 1 && !fits(remaining)) {
    const last = remaining.at(-1) as string;
    omitted.unshift(last);
    remaining = remaining.slice(0, -1);
  }
  return { kept: remaining, constants: constants, omitted: omitted };
}
