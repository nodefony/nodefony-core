/**
 * Mise en forme du rapport de `nodefony doctor` — la partie qu'un HUMAIN lit.
 *
 * Un diagnostic se lit en panne, souvent vite, parfois par quelqu'un qui ne
 * connaît pas le projet. Une liste de croix en vrac oblige à tout parcourir
 * pour savoir s'il y a un problème, lequel, et par où commencer. La forme
 * porte donc trois choses, dans cet ordre : **où** l'on regarde, **l'état de
 * chaque famille de contrôles** d'un coup d'œil, puis le **détail** — et
 * seulement pour ce qui ne va pas.
 *
 * Les fonctions de ce module sont PURES : la largeur du terminal et les
 * couleurs sont injectées. C'est ce qui les rend éprouvables — une fonction
 * qui lit `process.stdout.columns` ne s'éprouve que dans le terminal où elle
 * tourne, c'est-à-dire jamais en intégration continue.
 */

/** Le verdict d'une famille de contrôles, tel qu'il s'affiche. */
export type EtatSection = "ok" | "echec" | "avertissement" | "non-controle";

/** Une famille de contrôles, résumée en une ligne du sommaire. */
export interface ILigneSommaire {
  /** Nom lisible de la famille — « Câblage », « Fraîcheur du build ». */
  titre: string;
  etat: EtatSection;
  /** Ce qui a été constaté, en quelques mots. */
  detail: string;
}

/** Un manquement, tel qu'il s'affiche dans le détail. */
export interface IDetailManquement {
  /** La phrase qui dit ce qui ne va pas. */
  message: string;
  /** Le fichier concerné, s'il y en a un. */
  file?: string;
}

/** Bornes de largeur : en deçà ça se chevauche, au-delà l'œil se perd. */
const LARGEUR_MIN = 48;
const LARGEUR_MAX = 96;

/**
 * La largeur de rendu, bornée.
 *
 * @param colonnes - largeur annoncée par le terminal, ou `undefined` quand la
 *   sortie n'en est pas un (redirection, journal de CI).
 * @returns une largeur toujours utilisable.
 */
export function largeurUtile(colonnes: number | undefined): number {
  if (!colonnes || !Number.isFinite(colonnes)) return 80;
  return Math.max(LARGEUR_MIN, Math.min(LARGEUR_MAX, Math.floor(colonnes)));
}

/** Le symbole d'un état — la seule chose qui reste quand la couleur est ôtée. */
export function symbole(etat: EtatSection): string {
  switch (etat) {
    case "ok":
      return "✓";
    case "echec":
      return "✗";
    case "avertissement":
      return "!";
    case "non-controle":
      return "—";
  }
}

/**
 * Une ligne de sommaire alignée : `  ✓  Titre········· détail`.
 *
 * L'alignement se calcule sur le titre le PLUS LONG du lot, jamais sur une
 * constante : une colonne figée déborde le jour où l'on ajoute « Fraîcheur du
 * build », et le rendu se met à sauter d'une ligne à l'autre.
 *
 * @param ligne - la famille à rendre.
 * @param largeurTitre - largeur de la colonne des titres.
 * @param largeur - largeur totale disponible.
 * @returns la ligne, sans retour chariot ni couleur.
 */
export function ligneSommaire(
  ligne: ILigneSommaire,
  largeurTitre: number,
  largeur: number,
): string {
  const titre = ligne.titre.padEnd(largeurTitre, " ");
  const prefixe = `  ${symbole(ligne.etat)}  ${titre}  `;
  const reste = largeur - prefixe.length;
  const detail =
    reste > 3 && ligne.detail.length > reste
      ? `${ligne.detail.slice(0, reste - 1)}…`
      : ligne.detail;
  return `${prefixe}${detail}`.trimEnd();
}

/**
 * Enveloppe un texte à la largeur donnée, en coupant aux espaces.
 *
 * Un message de diagnostic porte une phrase entière — chemin, cause, geste.
 * Laissée au terminal, elle se replie sans indentation et le geste se retrouve
 * collé à la marge, illisible au milieu du reste.
 *
 * @param texte - la phrase à replier.
 * @param largeur - largeur maximale d'une ligne, indentation comprise.
 * @param indent - le blanc posé devant chaque ligne.
 * @returns les lignes, prêtes à être écrites.
 */
export function replier(
  texte: string,
  largeur: number,
  indent: string,
): string[] {
  const utile = Math.max(20, largeur - indent.length);
  const lignes: string[] = [];
  let courante = "";
  for (const mot of texte.split(/\s+/u).filter(Boolean)) {
    if (courante === "") {
      courante = mot;
    } else if (courante.length + 1 + mot.length <= utile) {
      courante += ` ${mot}`;
    } else {
      lignes.push(indent + courante);
      courante = mot;
    }
  }
  if (courante !== "") lignes.push(indent + courante);
  return lignes;
}

/**
 * Sépare le CONSTAT du GESTE dans un message qui porte les deux.
 *
 * Les contrôles écrivent « … → `npm run build` » : la flèche est le signe
 * qu'un geste suit. Le rendre sur sa propre ligne le rend trouvable sans lire
 * la phrase — c'est la seule chose que le lecteur cherche vraiment quand il
 * est pressé.
 *
 * @param message - le message d'un contrôle.
 * @returns le constat, et le geste s'il y en a un.
 */
export function separerGeste(message: string): {
  constat: string;
  geste?: string;
} {
  const i = message.lastIndexOf("→");
  if (i === -1) return { constat: message.trim() };
  const geste = message.slice(i + 1).trim();
  const constat = message
    .slice(0, i)
    .trim()
    .replace(/[.,;:]$/u, "");
  return geste === "" ? { constat: message.trim() } : { constat, geste };
}

/** Un filet horizontal, pour séparer le sommaire du détail. */
export function filet(largeur: number): string {
  return `  ${"─".repeat(Math.max(10, largeur - 4))}`;
}

/**
 * Une durée en secondes, rendue lisible.
 *
 * « plus récent de 6359 s » demande un calcul mental au moment où le lecteur
 * en a le moins envie. Ce n'est pas une précision qu'on perd : personne ne
 * décide rien sur la seconde près à cette échelle.
 *
 * @param secondes - l'écart mesuré.
 * @returns « 12 s », « 4 min », « 1 h 46 », « 3 j ».
 */
export function duree(secondes: number): string {
  const s = Math.max(0, Math.round(secondes));
  if (s < 90) return `${s} s`;
  const minutes = Math.round(s / 60);
  if (minutes < 90) return `${minutes} min`;
  const heures = Math.floor(s / 3600);
  if (heures < 48) {
    const reste = Math.round((s % 3600) / 60);
    return reste === 0
      ? `${heures} h`
      : `${heures} h ${String(reste).padStart(2, "0")}`;
  }
  return `${Math.round(s / 86400)} j`;
}

/**
 * Accorde un nom avec son nombre — « 1 contrôle passé », « 2 contrôles passés ».
 *
 * Les parenthèses de repli (« contrôle(s) passé(s) ») sont le signe d'un
 * rapport écrit pour la machine ; celui-ci est lu par quelqu'un.
 *
 * @param n - la quantité.
 * @param singulier - la forme au singulier.
 * @param pluriel - la forme au pluriel, si elle ne s'obtient pas par un « s ».
 * @returns « 3 écarts ».
 */
export function accord(n: number, singulier: string, pluriel?: string): string {
  const mot = n > 1 ? (pluriel ?? `${singulier}s`) : singulier;
  return `${n} ${mot}`;
}
