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
import { creerPalette, replier, type IPalette } from "../kernel/checks/report";

/** Une ligne de données — les clés deviennent les colonnes. */
export type TableRow = Record<string, unknown>;

/** Le décor du rendu — tout ce que ce module refuse d'aller chercher. */
export interface ITableOptions {
  /** Largeur utile, déjà bornée. */
  largeur: number;
  /** `true` pour émettre des séquences ANSI. */
  couleur: boolean;
  /**
   * Colonnes à rendre, dans cet ordre. Par défaut : l'union des clés
   * rencontrées, dans l'ordre où elles apparaissent.
   */
  colonnes?: readonly string[];
}

/** En deçà, une colonne ne porte plus d'information — elle porte une ellipse. */
const MIN_COLONNE = 6;

/**
 * Au-delà, une colonne n'a pas besoin de plus pour se lire.
 *
 * Sert à décider si un jeu de colonnes TIENT : une colonne de chemins longs ne
 * réclame pas soixante caractères pour être utile, et la compter à sa largeur
 * naturelle ferait renoncer à des colonnes qui tenaient très bien.
 */
const LARGEUR_UTILE = 28;

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
function tronquer(texte: string, largeur: number): string {
  if (texte.length <= largeur) return texte;
  return largeur <= 1 ? "…" : `${texte.slice(0, largeur - 1)}…`;
}

/**
 * Les colonnes présentes dans les données, dans l'ordre de rencontre.
 *
 * @param rows - les lignes.
 * @returns les noms de colonnes, sans doublon.
 */
export function colonnesDe(rows: readonly TableRow[]): string[] {
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
 * @param demandes - largeur idéale de chaque colonne.
 * @param disponible - place totale pour les contenus (séparateurs déduits).
 * @returns la largeur retenue pour chaque colonne, dans le même ordre.
 */
export function repartir(
  demandes: readonly number[],
  disponible: number,
): number[] {
  const retenues = [...demandes];
  let total = retenues.reduce((n, x) => n + x, 0);
  if (total <= disponible) return retenues;
  // Tant qu'il faut rogner, on retire un caractère à la colonne la plus large.
  // Simple, et le résultat est celui qu'on attend : les colonnes courtes
  // restent intactes, les longues convergent vers une largeur commune.
  while (total > disponible) {
    let plusLarge = 0;
    for (let i = 1; i < retenues.length; i++) {
      if ((retenues[i] ?? 0) > (retenues[plusLarge] ?? 0)) plusLarge = i;
    }
    if ((retenues[plusLarge] ?? 0) <= MIN_COLONNE) break;
    retenues[plusLarge] = (retenues[plusLarge] ?? 0) - 1;
    total -= 1;
  }
  return retenues;
}

/**
 * Rend les données en FICHES — une entrée par bloc `clé : valeur`.
 *
 * C'est le repli quand un tableau ne peut plus tenir : trop de colonnes, ou un
 * terminal trop étroit. Une fiche reste lisible à n'importe quelle largeur, là
 * où un tableau comprimé ne dit plus rien.
 *
 * @param rows - les lignes.
 * @param colonnes - les colonnes à rendre.
 * @param largeur - largeur utile.
 * @param p - la peinture.
 * @returns les lignes à écrire.
 */
function fiches(
  rows: readonly TableRow[],
  colonnes: readonly string[],
  largeur: number,
  p: IPalette,
): string[] {
  const lignes: string[] = [];
  const col = Math.min(
    Math.max(...colonnes.map((c) => c.length)),
    Math.max(MIN_COLONNE, Math.floor(largeur / 3)),
  );
  for (const [i, row] of rows.entries()) {
    if (i > 0) lignes.push("");
    for (const clé of colonnes) {
      const valeur = formatCell(row[clé]);
      lignes.push(
        `  ${p.discret(tronquer(clé, col).padEnd(col))}  ${tronquer(
          valeur,
          Math.max(1, largeur - col - 4),
        )}`,
      );
    }
  }
  return lignes;
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
  const { largeur, couleur } = opts;
  const p = creerPalette(couleur);
  if (rows.length === 0) return [];
  const colonnes = opts.colonnes ? [...opts.colonnes] : colonnesDe(rows);
  if (colonnes.length === 0) return [];

  // 🔴 La place se gagne d'abord en RETIRANT ce qui n'apprend rien, pas en
  // comprimant tout le monde. Une colonne dont toutes les lignes portent la
  // même valeur (`host` vide, `bypassFirewall` faux partout) coûte sa largeur
  // et ne distingue aucune ligne : c'est elle qui doit céder, pas le nom de la
  // route. Comprimer d'abord donnait huit colonnes de huit caractères, toutes
  // tronquées — un tableau qui tient dans l'écran sans plus rien dire.
  const { gardees, constantes, omises } = elaguer(rows, colonnes, largeur);

  const cellules = rows.map((row) =>
    gardees.map((clé) => formatCell(row[clé])),
  );
  const demandes = gardees.map((clé, i) =>
    Math.max(clé.length, ...cellules.map((c) => (c[i] ?? "").length)),
  );

  // 2 espaces entre colonnes, 2 de marge à gauche.
  const separateurs = 2 * (gardees.length - 1) + 2;
  const disponible = largeur - separateurs;
  // Même comprimé au minimum, ça ne tient pas : le tableau cède la place aux
  // fiches plutôt que de rendre des colonnes d'une lettre.
  if (disponible < gardees.length * MIN_COLONNE) {
    return fiches(rows, colonnes, largeur, p);
  }
  const retenues = repartir(demandes, disponible);
  const colonnes_ = gardees;

  const ligne = (valeurs: readonly string[], teinte: (t: string) => string) =>
    `  ${valeurs
      .map((v, i) => tronquer(v, retenues[i] ?? 0).padEnd(retenues[i] ?? 0))
      .join("  ")
      .trimEnd()}`
      .replace(/^ {2}/u, "  ")
      .split("\n")
      .map((l) => teinte(l))
      .join("\n");

  const lignes = [ligne(colonnes_, p.fort)];
  // Un filet sous l'en-tête, de la largeur réellement occupée : il sépare sans
  // encadrer. Les bordures de `console.table` coûtaient trois caractères par
  // colonne — sur neuf colonnes, un quart de l'écran.
  const occupée = Math.min(
    largeur,
    retenues.reduce((n, x) => n + x, 0) + separateurs,
  );
  lignes.push(p.discret(`  ${"─".repeat(Math.max(0, occupée - 2))}`));
  for (const c of cellules) lignes.push(ligne(c, (t) => t));
  // Ce qui a été retiré se DIT, avec sa valeur : une colonne qu'on ne voit
  // plus et dont on ignore le contenu vaut moins qu'une colonne absente.
  const notes: string[] = [];
  if (constantes.length) {
    notes.push(
      `identique partout : ${constantes
        .map(({ clé, valeur }) => `${clé} = ${valeur}`)
        .join(" · ")}`,
    );
  }
  // Une colonne retirée se DIT, avec la porte qui la rend : une donnée
  // silencieusement absente vaut moins qu'une donnée absente et annoncée.
  if (omises.length) {
    notes.push(`non affiché faute de place : ${omises.join(" · ")} (--json)`);
  }
  for (const note of notes) {
    // Repliée, jamais tronquée : c'est elle qui dit ce qu'on ne voit PAS, et
    // une phrase coupée sur ce sujet précis laisse croire qu'on a tout vu.
    for (const l of replier(note, largeur - 2, "")) {
      lignes.push(p.discret(`  ${l}`));
    }
  }
  return lignes;
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
 * @param colonnes - toutes les colonnes candidates.
 * @param largeur - largeur utile.
 * @returns les colonnes gardées, et celles retirées avec leur valeur unique.
 */
function elaguer(
  rows: readonly TableRow[],
  colonnes: readonly string[],
  largeur: number,
): {
  gardees: string[];
  constantes: { clé: string; valeur: string }[];
  omises: string[];
} {
  const demande = (clé: string): number =>
    Math.max(clé.length, ...rows.map((r) => formatCell(r[clé]).length));
  const tient = (liste: readonly string[]): boolean =>
    liste.reduce((n, clé) => n + Math.min(demande(clé), LARGEUR_UTILE), 0) +
      2 * (liste.length - 1) +
      2 <=
    largeur;

  if (tient(colonnes)) {
    return { gardees: [...colonnes], constantes: [], omises: [] };
  }

  // 1. Les colonnes qui ne DISTINGUENT rien cèdent en premier : une valeur
  //    unique sur toutes les lignes coûte sa largeur et n'apprend rien qu'une
  //    phrase ne dise mieux. La PREMIÈRE colonne reste quoi qu'il arrive —
  //    c'est l'identité de la ligne.
  const constantes: { clé: string; valeur: string }[] = [];
  let restantes: string[] = [];
  for (const clé of colonnes) {
    const valeurs = new Set(rows.map((r) => formatCell(r[clé])));
    if (valeurs.size === 1 && restantes.length > 0) {
      constantes.push({ clé, valeur: [...valeurs][0] ?? "" });
      continue;
    }
    restantes.push(clé);
  }

  // 2. Si ça ne suffit pas, ce sont les DERNIÈRES qui cèdent. L'ordre des clés
  //    est celui du producteur, et un producteur nomme d'abord ce qui compte :
  //    pour une route, `name` et `path` avant `host` et `bypassFirewall`. Une
  //    heuristique « garder les plus variées » ferait mieux sur le papier et
  //    perdrait `methods`, que personne ne veut perdre.
  const omises: string[] = [];
  while (restantes.length > 1 && !tient(restantes)) {
    const derniere = restantes.at(-1) as string;
    omises.unshift(derniere);
    restantes = restantes.slice(0, -1);
  }
  return { gardees: restantes, constantes, omises };
}
