/**
 * Le rapport de `nodefony doctor` tel qu'un HUMAIN le lit — rendu PUR.
 *
 * Ce module ne connaît ni le terminal, ni l'horloge, ni l'environnement : la
 * largeur, la couleur et l'instant lui sont DONNÉS, et il rend des lignes. Deux
 * raisons, et la seconde est la vraie.
 *
 * 1. Il devient éprouvable ailleurs que dans le terminal où il tourne —
 *    c'est-à-dire en intégration continue, où il n'y en a pas.
 * 2. Un rapport qui s'écrit au fil de l'eau ne peut pas se relire lui-même :
 *    impossible d'aligner une colonne sur le plus long titre, de regrouper deux
 *    contrôles qui partagent une raison, ou de compter ce qu'on vient d'écrire.
 *    Le rendu produit donc le document ENTIER avant qu'un seul octet ne sorte.
 *
 * ## Ce que la forme doit au lecteur
 *
 * Un diagnostic se lit en panne, souvent vite, parfois par quelqu'un qui ne
 * connaît pas le projet. Il répond donc dans cet ordre : **où** l'on regarde,
 * **l'état de chaque famille** d'un coup d'œil, le **détail** de ce qui ne va
 * pas, ce qui n'a **pas pu être regardé**, puis un bilan chiffré. Rien d'autre :
 * ce qui va bien ne se commente pas, et le bruit finit par masquer le signal.
 */
import path from "node:path";
import {
  accord,
  preventedChecks,
  controlesSautes,
  countFindings,
  creerPalette,
  FAMILLES,
  COUNTED_FAMILIES,
  isSubrule,
  titreSection,
  ligneSommaire,
  replier,
  separerGeste,
  surlignerCode,
  symbole,
  TITRES,
  type CheckFamily,
  type EtatSection,
  type IControleSaute,
  type ILigneSommaire,
  type IPalette,
} from "./report";
import { formatAge, lastBootFileFor, type ILastBoot } from "./lastBoot";
// Type SEUL : élidé à la compilation, donc aucune arête d'import à l'exécution
// entre la collecte et son rendu.
import type { ICheckReport } from "./runCheck";
import type { ILiveFinding } from "./live";
import type { ISurfaceFinding } from "./surface";

/** Le décor du rendu — tout ce que ce module refuse d'aller chercher lui-même. */
export interface IOptionsRendu {
  /** Largeur utile, déjà bornée. */
  largeur: number;
  /** `true` pour émettre des séquences ANSI. */
  couleur: boolean;
  /** Instant de référence, pour l'âge du dernier démarrage. */
  now: number;
  /** Le dossier d'où la commande a été lancée, s'il diffère de la racine. */
  lanceDepuis?: string;
  /** `true` si un contrôle sauté fait échouer la commande. */
  strict: boolean;
  /**
   * Durée de la collecte, en millisecondes — affichée au pied du rapport.
   *
   * Un diagnostic qui prend deux secondes et un diagnostic qui en prend
   * quarante ne se lisent pas pareil : le second dit que quelque chose rame,
   * et c'est souvent le premier symptôme.
   */
  dureeMs?: number;
  /**
   * L'environnement sous lequel les exigences ont été évaluées, s'il n'est pas
   * celui d'ici (`--env production`).
   *
   * ANNONCÉ en tête, jamais tu : un rapport qui réclame des variables de
   * production sans dire qu'il regarde la production se lit comme une panne du
   * poste — et l'on va corriger ce qui n'est pas cassé.
   */
  targetEnv?: string | null;
}

/** L'indentation du corps, alignée sous le titre des lignes à puce. */
/**
 * L'indentation du CONTENU d'un item.
 *
 * Le rendu tient sur une grille unique : un item commence colonne 4 (symbole ou
 * numéro), son contenu colonne 7. Trois indentations différentes cohabitaient,
 * et l'œil ne savait plus ce qui appartenait à quoi.
 */
const CORPS = "       ";

/** L'indentation d'un ITEM — symbole, numéro, titre. */
const ITEM = "    ";

/**
 * Au-delà de cette longueur, une commande occupe sa ligne SEULE.
 *
 * Elle cesse alors de fixer la colonne où s'aligne la glose des autres.
 */
const COLONNE_GESTE_MAX = 28;

/** Au-delà, une énumération cesse d'informer et se met à noyer le rapport. */
const PUCES_MAX = 3;

/**
 * Une énumération BORNÉE, qui dit combien elle a tu.
 *
 * Le bilan d'un démarrage peut porter huit modules écartés et quatre messages
 * critiques : quarante lignes qui repoussaient le reste du rapport hors de
 * l'écran. Les trois premières suffisent à reconnaître le motif ; le compte
 * total est déjà donné juste au-dessus, et le fichier de bilan porte le reste.
 *
 * @param items - les lignes à énumérer, déjà peintes.
 * @param p - la peinture.
 * @returns les puces, plus une mention du reste s'il y en a.
 */
function quelquesUnes(items: readonly string[], p: IPalette): string[] {
  const lignes = items
    .slice(0, PUCES_MAX)
    .map((texte) => `${CORPS}  · ${texte}`);
  const reste = items.length - PUCES_MAX;
  if (reste > 0) {
    lignes.push(p.discret(`${CORPS}  · … et ${accord(reste, "autre")}`));
  }
  return lignes;
}

/**
 * Un bilan de démarrage mérite d'être rapporté quand il porte une MAUVAISE
 * nouvelle.
 *
 * Un démarrage abouti, complet et sans brique manquante ne se commente pas :
 * l'afficher à chaque contrôle serait du bruit. Les avertissements seuls ne
 * suffisent pas non plus à déclencher — un boot de développement en produit
 * régulièrement.
 *
 * @param entry - le bilan lu.
 * @returns `true` s'il y a quelque chose à dire.
 */
export function meriteDEtreDit(entry: ILastBoot): boolean {
  return (
    entry.status === "failed" ||
    entry.healthy === false ||
    Boolean(entry.bricksSkipped?.length) ||
    Boolean(entry.errors)
  );
}

/**
 * Regroupe les contrôles sautés qui partagent la MÊME raison.
 *
 * Hors d'une application, quatre familles sont sautées pour un seul et même
 * motif. Les énumérer une par une répète quatre fois la même phrase et le même
 * geste : le lecteur croit à quatre problèmes distincts et cesse de lire avant
 * la fin. Une seule entrée, quatre titres, un geste.
 *
 * @param sautes - les contrôles sautés, dans l'ordre de lecture.
 * @returns un groupe par raison distincte, l'ordre du premier membre conservé.
 */
export function grouperParRaison(
  sautes: readonly IControleSaute[],
): { titres: string[]; reason: string; unlock?: string }[] {
  const groupes: { titres: string[]; reason: string; unlock?: string }[] = [];
  for (const saute of sautes) {
    const existant = groupes.find(
      (g) => g.reason === saute.reason && g.unlock === saute.unlock,
    );
    if (existant) existant.titres.push(saute.titre);
    else
      groupes.push({
        titres: [saute.titre],
        reason: saute.reason,
        unlock: saute.unlock,
      });
  }
  return groupes;
}

/**
 * Le document complet, ligne par ligne, sans retour chariot final.
 *
 * @param report - le diagnostic collecté.
 * @param opts - le décor de rendu (largeur, couleur, instant).
 * @returns les lignes à écrire, dans l'ordre.
 */
export function rendreRapport(
  report: ICheckReport,
  opts: IOptionsRendu,
): string[] {
  const { largeur, couleur, now, strict } = opts;
  const p = creerPalette(couleur);
  const lignes: string[] = [];
  const sautes = controlesSautes(report.execution);

  /** Ouvre une section : un titre, prolongé par un filet jusqu'au bord. */
  const section = (nom: string, teinte: (t: string) => string): void => {
    const { titre, filet: trait } = titreSection(nom, largeur);
    lignes.push("", teinte(p.fort(titre)) + p.discret(trait), "");
  };

  lignes.push(...enTete(report, opts, p));
  lignes.push(...bandeau(report, sautes, p));

  section("ÉTAT", (t) => t);
  lignes.push(...sommaire(report, p, largeur));

  const problemes = groupesDeManquements(report).filter(
    (g) => g.items.length > 0,
  );
  if (problemes.length > 0) {
    section("PROBLÈMES", p.echec);
    const totalProblemes = problemes.reduce((n, g) => n + g.items.length, 0);
    let numero = 0;
    for (const { titre, items } of problemes) {
      for (const item of items) {
        if (numero > 0) lignes.push("");
        lignes.push(
          ...blocProbleme(++numero, totalProblemes, titre, item, p, opts),
        );
      }
    }
  }

  if (sautes.length > 0) {
    // SYSTÉMATIQUE, y compris quand tout le reste est vert : un diagnostic muet
    // sur son angle mort se lit comme un quitus.
    section("NON CONTRÔLÉ", p.alerte);
    lignes.push(...blocsNonControles(sautes, p, opts));
    if (strict) {
      lignes.push("");
      // La phrase doit dire ce que le code de sortie fera VRAIMENT. Annoncer
      // « ça échoue » alors que la commande rend 0 — parce que les seuls
      // contrôles manquants n'ont pas été DEMANDÉS — apprend à ne plus croire
      // le bandeau, ce qui est pire que de ne rien annoncer.
      const empeches = preventedChecks(sautes);
      for (const l of replier(
        empeches.length > 0
          ? "mode strict : un contrôle EMPÊCHÉ fait échouer la commande."
          : // Deux raisons de ne pas peser, et la phrase les distingue : un
            // contrôle qu'on n'a pas DEMANDÉ n'est pas un contrôle qui
            // n'avait RIEN à examiner. Les confondre laisserait croire qu'il
            // suffit de demander pour obtenir un verdict.
            sautes.every((c) => c.notApplicable)
            ? "mode strict : ce qui manque ici n'avait rien à examiner — le " +
              "code de sortie n'en tient pas compte."
            : "mode strict : ce qui manque ici n'a pas été demandé, ou " +
              "n'avait rien à examiner — le code de sortie n'en tient pas " +
              "compte.",
        largeur,
        CORPS,
      )) {
        lignes.push(p.discret(l));
      }
    }
  }

  const ouvertures = surfaceOuverte(report, largeur, p);
  if (ouvertures.length > 0) {
    // Une INFORMATION, en teinte neutre : chacune de ces ouvertures est un
    // geste légitime. Ce que personne n'a jamais, c'est la LISTE — et c'est
    // ainsi qu'une route de mise au point reste ouverte en production.
    section("SURFACE OUVERTE", p.alerte);
    lignes.push(...ouvertures);
  }

  const retires = manquementsLive(report, "service-lost");
  if (retires.length > 0) {
    // Un RELEVÉ, pas un verdict — même esprit que « SURFACE OUVERTE ». Ce que
    // l'environnement visé retire est le plus souvent voulu : c'est à quoi
    // sert `policy: "dev"`. Le service rendu est de le VOIR avant de partir,
    // pas d'être accusé de l'avoir écrit.
    section("CE QUE L'ENVIRONNEMENT VISÉ RETIRE", p.alerte);
    for (const f of retires) {
      for (const [i, l] of replier(f.message, largeur, CORPS).entries()) {
        lignes.push(i === 0 ? `${ITEM}${p.alerte("—")}  ${l.trim()}` : l);
      }
    }
    lignes.push("");
    for (const l of replier(
      'Un module `policy: "dev"` est ÉCARTÉ là-bas : c\'est sa raison ' +
        "d'être, et ces lignes sont alors normales. À regarder seulement si " +
        "du code servi en production réclame l'un de ces services.",
      largeur - 4,
      "  ",
    )) {
      lignes.push(p.discret(l));
    }
  }

  const bilansParlants = report.lastBoots.filter(meriteDEtreDit);
  if (bilansParlants.length > 0) {
    // APRÈS les problèmes, et c'est un choix : un démarrage passé n'est pas un
    // manquement du code — c'est une trace. Placé avant, il repoussait le
    // premier vrai problème quarante lignes plus bas.
    section(
      bilansParlants.length > 1 ? "DERNIERS DÉMARRAGES" : "DERNIER DÉMARRAGE",
      p.alerte,
    );
    let premier = true;
    for (const demarrage of bilansParlants) {
      if (!premier) lignes.push("");
      premier = false;
      lignes.push(...dernierDemarrage(demarrage, now, p, largeur));
    }
  }

  const gestes = aFaireEnsuite(report, sautes);
  if (gestes.length > 0) {
    section("À FAIRE ENSUITE", p.geste);
    lignes.push(...listeDeGestes(gestes, p, largeur));
  }

  lignes.push("");
  lignes.push(...bilan(report, sautes, p, largeur, opts.dureeMs));
  lignes.push("");
  return lignes;
}

/**
 * Le VERDICT, avant tout le reste.
 *
 * Il était en bas, et c'était le défaut le plus coûteux de ce rendu : la
 * question qu'on se pose en lançant `doctor` est « est-ce que ça va ? », et
 * elle n'obtenait sa réponse qu'après soixante lignes de détail. Un rapport se
 * lit en panne, souvent vite : il doit répondre à la première ligne, puis
 * justifier.
 *
 * @param report - le diagnostic.
 * @param sautes - les contrôles qui n'ont pas eu lieu.
 * @param p - la peinture.
 * @returns une ligne, plus une ligne vide.
 */
function bandeau(
  report: ICheckReport,
  sautes: readonly IControleSaute[],
  p: IPalette,
): string[] {
  const total = countFindings(report);
  const passes = nombreDeControlesPasses(report);
  if (total > 0) {
    // Les angles morts DANS le bandeau, et pas seulement plus bas : un lecteur
    // qui corrige le problème annoncé doit savoir, à la même seconde, que le
    // rapport n'a pas tout regardé — sinon il croira avoir tout vu.
    const angles =
      sautes.length > 0
        ? p.alerte(`   ${accord(sautes.length, "angle mort", "angles morts")}`)
        : "";
    return [
      p.echec(
        `  ${symbole("echec")}  ${p.fort(accord(total, "PROBLÈME").toUpperCase())}`,
      ) + angles,
    ];
  }
  if (passes === 0) {
    // Hors d'une application : « tout va bien » serait un quitus rendu sans
    // avoir rien ouvert.
    return [
      p.alerte(
        `  ${symbole("non-controle")}  ${p.fort("AUCUN CONTRÔLE N'A PU ÊTRE FAIT ICI")}`,
      ),
    ];
  }
  return [
    sautes.length > 0
      ? p.ok(`  ${symbole("ok")}  ${p.fort("RIEN À SIGNALER")}`) +
        p.alerte(`  (${accord(sautes.length, "angle mort", "angles morts")})`)
      : p.ok(`  ${symbole("ok")}  ${p.fort("RIEN À SIGNALER")}`),
  ];
}

/**
 * Un problème, rendu comme une erreur de compilateur.
 *
 * La forme vient de ce qui se fait de mieux dans un terminal : un numéro pour
 * s'y référer, le nom de la famille pour savoir DE QUOI on parle, une gouttière
 * qui relie visuellement le constat à son geste, et le geste seul sur sa ligne,
 * préfixé d'un chevron — c'est la seule chose qu'un lecteur pressé cherche, et
 * elle doit se copier sans attraper le reste de la phrase.
 *
 * @param numero - le rang du problème dans le rapport.
 * @param famille - le titre de la famille dont il vient.
 * @param item - le manquement (message, et le fichier qui le porte).
 * @param p - la peinture.
 * @param opts - le décor (largeur, couleur).
 * @returns les lignes du bloc.
 */
function blocProbleme(
  numero: number,
  total: number,
  famille: string,
  item: { message: string; file?: string },
  p: IPalette,
  opts: IOptionsRendu,
): string[] {
  const { largeur, couleur } = opts;
  const { constat, geste } = separerGeste(item.message);
  const lignes: string[] = [];
  // Le rang occupe la colonne du SYMBOLE des autres sections : une seule
  // largeur pour toute la grille, élargie seulement s'il y a dix problèmes.
  const rang = String(numero).padStart(String(total).length, " ");
  lignes.push(`${ITEM}${p.echec(p.fort(rang))}  ${p.fort(famille)}`);
  // La gouttière tient la colonne du texte : elle dit « ceci appartient encore
  // au problème ci-dessus », y compris après un repli de six lignes.
  const gouttiere = `${CORPS}${p.discret("│")} `;
  for (const l of replier(constat, largeur - 10, "")) {
    lignes.push(gouttiere + surlignerCode(l, p, couleur));
  }
  if (item.file) {
    // Un chemin ne se COUPE pas — coupé, il n'est plus copiable, et c'est
    // précisément ce qu'on vient chercher. Quand il ne tient pas derrière la
    // gouttière, il prend la ligne entière plutôt que de déborder du terminal.
    const derriereGouttiere = `${CORPS}│ ${item.file}`;
    lignes.push(
      derriereGouttiere.length <= largeur
        ? gouttiere + p.discret(item.file)
        : `${CORPS}${p.discret(item.file)}`,
    );
  }
  lignes.push(...ligneDeGeste(geste, p, largeur));
  return lignes;
}

/**
 * Les contrôles qui n'ont pas eu lieu, groupés par cause.
 *
 * @param sautes - les contrôles sautés.
 * @param p - la peinture.
 * @param opts - le décor.
 * @returns les lignes de la section.
 */
function blocsNonControles(
  sautes: readonly IControleSaute[],
  p: IPalette,
  opts: IOptionsRendu,
): string[] {
  const { largeur, couleur } = opts;
  const lignes: string[] = [];
  let premier = true;
  for (const groupe of grouperParRaison(sautes)) {
    if (!premier) lignes.push("");
    premier = false;
    // Quatre titres joints font vite soixante colonnes : cette ligne se replie
    // comme n'importe quelle autre, sinon elle déborde exactement dans le cas
    // où elle a le plus à dire.
    const [premierTitre, ...resteTitres] = replier(
      groupe.titres.join(", "),
      largeur - 8,
      "",
    );
    lignes.push(
      `${ITEM}${p.alerte(symbole("non-controle"))}  ${p.fort(premierTitre ?? "")}`,
    );
    for (const l of resteTitres) lignes.push(`${CORPS}${p.fort(l)}`);
    const gouttiere = `${CORPS}${p.discret("│")} `;
    for (const l of replier(groupe.reason, largeur - 10, "")) {
      lignes.push(gouttiere + p.alerte(surlignerCode(l, p, couleur)));
    }
    lignes.push(...ligneDeGeste(groupe.unlock, p, largeur));
  }
  return lignes;
}

/**
 * Le geste, seul sur sa ligne, sous un chevron.
 *
 * Les accents graves qui l'entourent dans le message SAUTENT : la ligne est
 * déjà désignée comme une commande par son chevron, et un accent grave collé
 * part avec la commande quand on la copie — puis le terminal se plaint d'un
 * fichier introuvable.
 *
 * @param geste - le geste, ou `undefined` s'il n'y en a pas.
 * @param p - la peinture.
 * @param largeur - largeur utile.
 * @returns les lignes, vides s'il n'y a pas de geste.
 */
function ligneDeGeste(
  geste: string | undefined,
  p: IPalette,
  largeur: number,
): string[] {
  if (!geste) return [];
  const propre = geste.replace(/`/gu, "").trim();
  return replier(propre, largeur - 10, "").map((l, i) =>
    i === 0
      ? `${CORPS}${p.geste("▸")} ${p.geste(l)}`
      : `${CORPS}  ${p.geste(l)}`,
  );
}

/** Un geste à faire, et ce qu'il ferme. */
interface IGeste {
  /** La commande, telle qu'on la tape. */
  commande: string;
  /** Ce que ce geste répare — pour choisir par quoi commencer. */
  pourquoi: string;
}

/**
 * Les gestes du rapport, DÉDOUBLONNÉS et ordonnés.
 *
 * C'est ce qui manquait le plus : les gestes étaient dispersés dans le détail,
 * chacun sous son problème, et le même `npm run build` pouvait apparaître trois
 * fois. Un lecteur qui veut agir devait relire tout le rapport pour reconstituer
 * la liste — et un agent, la deviner.
 *
 * L'ordre est celui des problèmes, puis des angles morts : ce qui EMPÊCHE
 * d'abord, ce qui MANQUE ensuite.
 *
 * @param report - le diagnostic.
 * @param sautes - les contrôles sautés.
 * @returns les gestes, sans doublon, dans l'ordre où les faire.
 */
export function aFaireEnsuite(
  report: ICheckReport,
  sautes: readonly IControleSaute[],
): IGeste[] {
  const gestes: IGeste[] = [];
  const vus = new Set<string>();
  const ajouter = (commande: string, pourquoi: string): void => {
    const propre = commande.replace(/^`|`$/gu, "").trim();
    if (propre === "" || vus.has(propre)) return;
    vus.add(propre);
    gestes.push({ commande: propre, pourquoi });
  };
  for (const { titre, items } of groupesDeManquements(report)) {
    for (const item of items) {
      const { geste } = separerGeste(item.message);
      if (geste) ajouter(geste, titre);
    }
  }
  for (const groupe of grouperParRaison(sautes)) {
    if (groupe.unlock) ajouter(groupe.unlock, groupe.titres.join(", "));
  }
  return gestes;
}

/**
 * Ce qu'un geste répare, rendu SOUS lui quand il ne tient pas à sa droite.
 *
 * @param pourquoi - la famille que ce geste referme.
 * @param marge - l'indentation, alignée sous la commande.
 * @param largeur - largeur utile du terminal.
 * @param p - la peinture.
 * @returns les lignes, repliées pour ne jamais déborder.
 */
function sousLeGeste(
  pourquoi: string,
  marge: string,
  largeur: number,
  p: IPalette,
): string[] {
  return replier(pourquoi, largeur - marge.length, "").map(
    (l) => marge + p.discret(l),
  );
}

/**
 * La liste des gestes, numérotée et alignée.
 *
 * @param gestes - les gestes, déjà dédoublonnés.
 * @param p - la peinture.
 * @param largeur - largeur utile.
 * @returns les lignes de la section.
 */
function listeDeGestes(
  gestes: readonly IGeste[],
  p: IPalette,
  largeur: number,
): string[] {
  // La colonne d'alignement s'ajuste sur les commandes COURTES seulement. Un
  // seul geste long (un `npm pkg set …` de soixante caractères) suffisait
  // sinon à repousser toutes les gloses hors de la largeur : le rappel perdait
  // d'un coup ce qu'il apprend, à cause d'une ligne qui n'en avait pas besoin.
  const courtes = gestes
    .map((g) => g.commande.length)
    .filter((n) => n <= COLONNE_GESTE_MAX);
  const colonne = courtes.length > 0 ? Math.max(...courtes) : 0;
  const lignes: string[] = [];
  for (const [i, g] of gestes.entries()) {
    const rang = String(i + 1).padStart(String(gestes.length).length, " ");
    const marge = ITEM + " ".repeat(rang.length + 2);
    const mesure = `${ITEM}${rang}  ${g.commande}`;
    // La glose ne s'affiche que si elle TIENT : coupée, elle ferait douter de
    // la commande elle-même, qui est la seule chose à copier ici.
    // Un geste trop long pour la colonne garde sa glose : elle passe sous lui,
    // jamais à la trappe. 🔴 La supprimer laissait des gestes qui ne sont pas
    // des commandes — une phrase — sans le moindre contexte : il fallait
    // remonter dans le rapport pour savoir de quoi ils parlaient, ce qui est
    // exactement ce que ce rappel existe pour éviter.
    const enDessous = g.commande.length > colonne;
    const glose = enDessous
      ? ""
      : `  ${" ".repeat(colonne - g.commande.length)}${g.pourquoi}`;
    if (mesure.length <= largeur) {
      const debut = `${ITEM}${p.discret(rang)}  ${p.geste(g.commande)}`;
      lignes.push(
        glose !== "" && mesure.length + glose.length <= largeur
          ? debut + p.discret(glose)
          : debut,
      );
      if (enDessous || mesure.length + glose.length > largeur) {
        lignes.push(...sousLeGeste(g.pourquoi, marge, largeur, p));
      }
      continue;
    }
    // Terminal étroit : la commande se replie sous elle-même plutôt que de
    // déborder. Elle reste donnée en ENTIER dans le bloc du problème — cette
    // liste est un rappel, pas la source.
    const [premiere, ...suite] = replier(
      g.commande,
      largeur - marge.length,
      "",
    );
    lignes.push(`${ITEM}${p.discret(rang)}  ${p.geste(premiere ?? "")}`);
    for (const l of suite) lignes.push(marge + p.geste(l));
    // Même règle qu'au-dessus : ce que ce geste répare se lit sous lui.
    lignes.push(...sousLeGeste(g.pourquoi, marge, largeur, p));
  }
  return lignes;
}

/**
 * L'en-tête : QUI est ausculté.
 *
 * Un rapport qui porte sur un autre dossier que celui qu'on croit se lit de
 * travers, dans les deux sens — et c'est le cas normal, puisque la cible est
 * l'APPLICATION et non le dossier où l'on a tapé.
 */
function enTete(
  report: ICheckReport,
  opts: IOptionsRendu,
  p: IPalette,
): string[] {
  const lignes = ["", `  ${p.fort("nodefony doctor")}`];
  const nom = report.appName;
  if (nom) lignes[1] += p.discret(` · ${nom}`);
  lignes.push(p.discret(`  ${report.root}`));
  if (opts.targetEnv) {
    lignes.push(
      p.alerte(`  exigences évaluées pour l'environnement ${opts.targetEnv}`),
    );
  }
  if (
    opts.lanceDepuis &&
    path.resolve(report.root) !== path.resolve(opts.lanceDepuis)
  ) {
    lignes.push(p.discret(`  lancé depuis ${opts.lanceDepuis}`));
  }
  lignes.push("");
  return lignes;
}

/**
 * Le sommaire : l'état de chaque famille, d'un coup d'œil.
 *
 * C'est ce qui répond à « y a-t-il un problème, et où ? » sans rien lire
 * d'autre. **L'état d'EXÉCUTION prime toujours sur les trouvailles** : un
 * contrôle qui n'a rien regardé n'a rien trouvé, et l'afficher en vert est le
 * seul mensonge que ce sommaire ne doit jamais dire.
 */
function sommaire(
  report: ICheckReport,
  p: IPalette,
  largeur: number,
): string[] {
  const { freshness, readiness, wiring, findings, scanned, execution } = report;
  const etat = (n: number): EtatSection => (n > 0 ? "echec" : "ok");
  /**
   * Les familles qui REPORTING_ONLY au lieu d'accuser.
   *
   * 🔴 `gating` relève ce que l'environnement visé retire. Qu'un module
   * `policy: "dev"` disparaisse en production est sa raison d'être : le rendre
   * en `✗` faisait passer le fonctionnement NORMAL du produit pour un défaut,
   * et le geste qui suivait — « retire `policy: "dev"` » — aurait embarqué
   * l'outillage de développement en production.
   */
  const REPORTING_ONLY: ReadonlySet<CheckFamily> = new Set(["gating"]);
  const ligne = (
    famille: CheckFamily,
    n: number,
    detail: string,
  ): ILigneSommaire => {
    // Même garde que `controlesSautes` : un état absent se DIT, il ne se rend
    // pas en vert et ne fait pas lever le rapport.
    const exec = execution[famille] ?? { ran: false, short: "état absent" };
    return exec.ran
      ? {
          titre: TITRES[famille],
          etat:
            n > 0 && REPORTING_ONLY.has(famille) ? "avertissement" : etat(n),
          detail,
        }
      : {
          titre: TITRES[famille],
          etat: "non-controle",
          // Court ICI, complet dans la section dédiée : une raison tronquée
          // par un `…` cache justement ce qu'on aurait besoin de lire.
          detail: exec.short ?? "non contrôlé",
        };
  };
  const detail: Record<CheckFamily, { n: number; texte: string }> = {
    freshness: {
      n: freshness.findings.length,
      texte:
        freshness.findings.length > 0
          ? accord(freshness.findings.length, "écart")
          : "sources et build alignés",
    },
    readiness: {
      n: readiness.findings.length,
      texte:
        readiness.findings.length > 0
          ? accord(readiness.findings.length, "manquement")
          : "environnement, modules, ports",
    },
    // « Variables déclarées » est une RÈGLE de `readiness`, pas une famille à
    // part : elle n'apparaît que lorsqu'elle n'a pas pu jouer, sans quoi le
    // sommaire dirait deux fois la même chose.
    envCatalog: { n: 0, texte: "" },
    // Idem : ses manquements sont RAPPORTÉS par `readiness` (c'est sa liste),
    // et cette ligne n'existe que pour dire qu'on n'a pas pu regarder.
    envTracked: { n: 0, texte: "" },
    deps: {
      n: findings.length,
      texte:
        findings.length > 0
          ? `${accord(findings.length, "manquement")} sur ${accord(scanned, "paquet")}`
          : accord(scanned, "paquet"),
    },
    wiring: {
      n: wiring.findings.length,
      texte:
        wiring.findings.length > 0
          ? `${accord(wiring.findings.length, "manquement")} sur ${accord(wiring.scanned, "classe")}`
          : `${accord(wiring.scanned, "classe")} déclarée${wiring.scanned > 1 ? "s" : ""}`,
    },
    surface: {
      n: surfaceFindings(report, "public-area-covers-all").length,
      texte:
        surfaceFindings(report, "public-area-covers-all").length > 0
          ? "une zone publique couvre TOUT"
          : inventaireSurface(report),
    },
    dialect: {
      n: surfaceFindings(report, "entity-other-dialect").length,
      texte:
        surfaceFindings(report, "entity-other-dialect").length > 0
          ? `${accord(surfaceFindings(report, "entity-other-dialect").length, "entité")} hors dialecte`
          : `${accord(report.surface.entitiesScanned, "entité")} sur ${report.surface.dialect ?? "?"}`,
    },
    guards: {
      n: report.guards.findings.length,
      texte:
        report.guards.findings.length > 0
          ? `${accord(report.guards.findings.length, "garde")} décrochée${report.guards.findings.length > 1 ? "s" : ""}`
          : `${accord(report.guards.armed, "garde")} armée${report.guards.armed > 1 ? "s" : ""}`,
    },
    // Étage 2 : le compte vient des findings de CETTE famille, filtrés par leur
    // origine. Un manquement de migration ne doit pas grossir la ligne du
    // firewall — le sommaire perdrait sa seule vertu, dire OÙ regarder.
    migrations: {
      n: manquementsLive(report, "migrations-not-ok").length,
      texte:
        manquementsLive(report, "migrations-not-ok").length > 0
          ? accord(manquementsLive(report, "migrations-not-ok").length, "écart")
          : "schéma et historique alignés",
    },
    firewall: {
      n: manquementsLive(report, "firewall-config-invalid").length,
      texte:
        manquementsLive(report, "firewall-config-invalid").length > 0
          ? "configuration INVALIDE"
          : "zones et authentificateurs cohérents",
    },
    gating: {
      n: manquementsLive(report, "service-lost").length,
      texte:
        manquementsLive(report, "service-lost").length > 0
          ? accord(manquementsLive(report, "service-lost").length, "brique") +
            " perdue" +
            (manquementsLive(report, "service-lost").length > 1 ? "s" : "")
          : modulesEcartes(report).length > 0
            ? `${accord(modulesEcartes(report).length, "module")} écarté${modulesEcartes(report).length > 1 ? "s" : ""}, rien de perdu`
            : "rien ne disparaît",
    },
  };
  // L'ordre est celui de FAMILLES, le MÊME que la section « non contrôlé » plus
  // bas : deux ordres différents pour les mêmes contrôles, et le lecteur cesse
  // de faire le lien entre le sommaire et le détail.
  const lignes: ILigneSommaire[] = FAMILLES.filter(
    // Une sous-règle de `readiness` n'a pas de ligne à elle tant qu'elle a pu
    // jouer : le sommaire dirait deux fois la même chose. Elle n'apparaît que
    // pour ÉNONCER son angle mort — et seulement si la famille, elle, a bien
    // regardé (sinon le même trou serait compté deux fois).
    (f) =>
      !isSubrule(f) ||
      (!execution[f]?.ran && execution.readiness?.ran === true),
  ).map((f) => ligne(f, detail[f].n, detail[f].texte));

  const largeurTitre = Math.max(...lignes.map((l) => l.titre.length));
  return lignes.map((l) => {
    const teinte =
      l.etat === "echec" ? p.echec : l.etat === "ok" ? p.ok : p.alerte;
    return teinte(ligneSommaire(l, largeurTitre, largeur));
  });
}

/**
 * Les manquements de l'étage 2 d'une espèce donnée.
 *
 * Le rapport porte UNE liste ; le sommaire et le détail la découpent par
 * famille. Filtrer ici plutôt que tenir deux listes évite qu'un jour l'une
 * contienne ce que l'autre ignore.
 *
 * @param report - le rapport, dont `live` peut être absent (aucun boot)
 * @param kind - l'espèce de manquement cherchée
 * @returns les manquements de cette espèce, vide si l'étage 2 n'a pas eu lieu
 */
function manquementsLive(
  report: ICheckReport,
  kind: ILiveFinding["kind"],
): ILiveFinding[] {
  return (report.live?.findings ?? []).filter((f) => f.kind === kind);
}

/** Au-delà, la liste cesse d'informer et devient un mur — le reste se demande. */
const OUVERTURES_MONTREES = 12;

/** Le libellé de chaque espèce d'ouverture, tel qu'il se lit. */
const OUVERTURE_LIBELLE: Record<string, string> = {
  "bypass-firewall": "@BypassFirewall",
  anonymous: "@Anonymous",
  "bypass-option": "bypassFirewall: true",
  "public-area": "zone publique",
};

/**
 * L'inventaire de ce qui est atteignable SANS authentification.
 *
 * Rendu en INFORMATION, jamais en verdict : `@BypassFirewall` sur une sonde de
 * vivacité est exactement ce qu'il faut écrire. Le service rendu est de les
 * voir ENSEMBLE, ce qu'aucun outil ne fait aujourd'hui.
 *
 * La liste est BORNÉE : au-delà d'une douzaine de lignes elle cesse d'informer,
 * et le rapport entier devient illisible. Le compte exact reste dit, et le
 * reste s'obtient par `--json` — un rapport qui tronque doit dire où trouver
 * ce qu'il a coupé.
 */
function surfaceOuverte(
  report: ICheckReport,
  largeur: number,
  p: IPalette,
): string[] {
  const ouvertures = report.surface.openings;
  if (ouvertures.length === 0) return [];
  const lignes: string[] = [];
  for (const o of ouvertures.slice(0, OUVERTURES_MONTREES)) {
    const libelle = OUVERTURE_LIBELLE[o.kind] ?? o.kind;
    const quoi = o.what ? `${libelle} ${o.what}` : libelle;
    for (const [i, l] of replier(quoi, largeur, CORPS).entries()) {
      lignes.push(i === 0 ? `${ITEM}${p.alerte("—")}  ${l.trim()}` : l);
    }
    lignes.push(p.discret(`${CORPS}${o.file}`));
  }
  const reste = ouvertures.length - OUVERTURES_MONTREES;
  if (reste > 0) {
    lignes.push("");
    lignes.push(
      p.discret(
        `${CORPS}… et ${accord(reste, "autre")} — la liste complète : ` +
          `nodefony doctor --json`,
      ),
    );
  }
  return lignes;
}

/**
 * Les manquements de surface d'une espèce donnée.
 *
 * Le contrôle porte UNE liste ; le sommaire et le détail la découpent par
 * famille. Filtrer ici plutôt que tenir deux listes évite qu'un jour l'une
 * contienne ce que l'autre ignore.
 */
function surfaceFindings(
  report: ICheckReport,
  kind: ISurfaceFinding["kind"],
): ISurfaceFinding[] {
  return report.surface.findings.filter((f) => f.kind === kind);
}

/**
 * L'inventaire de la surface ouverte, en une ligne.
 *
 * Chaque ouverture est LÉGITIME prise isolément — un `@BypassFirewall` sur une
 * sonde de vivacité, une zone publique sur les pages d'accueil. Ce que
 * personne n'a jamais, c'est le COMPTE : c'est ainsi qu'une route de mise au
 * point reste ouverte en production. La ligne le donne sans accuser.
 */
function inventaireSurface(report: ICheckReport): string {
  const routes = report.surface.openings.filter(
    (o) => o.kind !== "public-area",
  ).length;
  const zones = report.surface.openings.length - routes;
  if (routes === 0 && zones === 0) return "rien d'ouvert sans authentification";
  const parts: string[] = [];
  if (routes > 0)
    parts.push(`${accord(routes, "route")} ouverte${routes > 1 ? "s" : ""}`);
  if (zones > 0)
    parts.push(`${accord(zones, "zone")} publique${zones > 1 ? "s" : ""}`);
  return parts.join(", ");
}

/**
 * Les modules que l'environnement visé écarte — une INFORMATION.
 *
 * Elle ne devient jamais un manquement : retirer un module `policy: "dev"` en
 * production est le comportement NORMAL, et un contrôle qui crie sur le cas
 * sain apprend à être ignoré. Elle sert à la ligne du sommaire, qui distingue
 * « rien ne disparaît » de « des modules partent, mais rien n'est perdu ».
 */
function modulesEcartes(report: ICheckReport): readonly { module: string }[] {
  return report.live?.gatedModules ?? [];
}

/** Les familles de manquements, dans l'ordre où elles se lisent. */
function groupesDeManquements(
  report: ICheckReport,
): { titre: string; items: { message: string; file?: string }[] }[] {
  // La fraîcheur d'abord : un build en retard rend faux tout ce qui suit — une
  // classe « non câblée » peut l'être dans le dist et pas dans les sources
  // qu'on vient d'éditer. Puis ce qui empêche de DÉMARRER : une variable
  // absente explique souvent le reste.
  return [
    { titre: TITRES.freshness, items: report.freshness.findings },
    { titre: TITRES.readiness, items: report.readiness.findings },
    { titre: TITRES.deps, items: report.findings },
    { titre: TITRES.wiring, items: report.wiring.findings },
    {
      titre: TITRES.surface,
      items: surfaceFindings(report, "public-area-covers-all"),
    },
    {
      titre: TITRES.dialect,
      items: surfaceFindings(report, "entity-other-dialect"),
    },
    { titre: TITRES.guards, items: report.guards.findings },
    // L'étage 2 en dernier : il n'existe que sur une application qui a démarré,
    // et le geste qu'il propose vient du PRODUCTEUR — il est rendu tel quel,
    // sous le constat, parce qu'une commande à taper se copie.
    {
      titre: TITRES.migrations,
      items: manquementsLive(report, "migrations-not-ok").map((f) => ({
        message: f.action ? `${f.message}\n  → ${f.action}` : f.message,
      })),
    },
    {
      titre: TITRES.firewall,
      items: manquementsLive(report, "firewall-config-invalid").map((f) => ({
        message: f.message,
      })),
    },
    // `gating` n'est PAS ici : ce qu'il relève n'est pas un problème, et il a
    // sa propre section (« CE QUE L'ENVIRONNEMENT VISÉ RETIRE »).
  ];
}

/**
 * QUI a démarré, en toutes lettres.
 *
 * « Le dernier démarrage a ÉCHOUÉ » désignait le serveur quel que soit le
 * coupable : un `nodefony inspect` lancé sans son environnement produisait la
 * même phrase, et envoyait chercher là où il n'y a rien. Nommer le profil ET
 * la commande donne les deux choses qui manquaient — qui accuser, et quoi
 * relancer pour reproduire.
 *
 * @param entry - le bilan.
 * @returns « `nodefony inspect` (console) », ou « Le dernier démarrage ».
 */
export function qui(entry: ILastBoot): string {
  const profil =
    entry.profile === "console"
      ? "console"
      : entry.profile === "cluster"
        ? "maître de cluster"
        : entry.profile === "server"
          ? "serveur"
          : "";
  if (!entry.command && !profil) return "Le dernier démarrage";
  if (!entry.command) return `Le dernier démarrage (${profil})`;
  return `\`nodefony ${entry.command}\`${profil ? ` (${profil})` : ""}`;
}

/**
 * Le bilan du dernier démarrage, quand il a une mauvaise nouvelle à donner.
 *
 * Placé haut, parce que c'est l'information la plus utile de tout le rapport
 * quand elle existe : celui qui lance `doctor` sur une application qui ne
 * démarre plus cherche exactement ça, et la faire suivre une liste de
 * manquements de câblage reviendrait à la cacher.
 *
 * Il n'entre PAS dans le code de sortie : `doctor` contrôle le CODE, l'état
 * d'un démarrage est un fait d'exécution, souvent déjà réparé au moment où on
 * lit.
 */
function dernierDemarrage(
  entry: ILastBoot,
  now: number,
  p: IPalette,
  largeur: number,
): string[] {
  const lignes: string[] = [];
  const age = formatAge(entry.timestamp, now);
  const etat: EtatSection =
    entry.status === "failed" ? "echec" : "avertissement";
  /**
   * Un couple « libellé — valeur », la valeur repliée SOUS elle-même.
   *
   * Une cause de démarrage échoué fait couramment trois cents caractères
   * (message d'erreur, URL de connecteur, cause native). Laissée sur une seule
   * ligne, elle déborde le terminal et se replie sur la marge : la moitié du
   * message se retrouve alignée avec les libellés, et on ne distingue plus ce
   * qui est un champ de ce qui est du texte.
   */
  const champ = (nom: string, valeur: string): string[] => {
    // Assez large pour le PLUS LONG libellé (« briques ignorées », 16), plus
    // une colonne de respiration : en deçà, un libellé long colle sa valeur et
    // la colonne saute d'une ligne à l'autre.
    const colonne = 18;
    const indent = CORPS + " ".repeat(colonne);
    const lignesValeur = replier(valeur, largeur, indent);
    // Un chemin ou une URL ne se coupe PAS (le couper le rendrait incopiable).
    // Sur un terminal étroit, la colonne d'alignement ne laisse alors pas assez
    // de place : la valeur passe SOUS son libellé plutôt que de déborder.
    const deborde = lignesValeur.some((l) => l.length > largeur);
    if (deborde) {
      return [
        `${CORPS}${p.discret(nom)}`,
        ...replier(valeur, largeur, `${CORPS}  `),
      ];
    }
    const [premiere, ...suite] = lignesValeur;
    return [
      `${CORPS}${p.discret(nom.padEnd(colonne, " "))}${(premiere ?? "").trimStart()}`,
      ...suite,
    ];
  };

  /** Le titre du bloc, replié comme n'importe quelle autre phrase. */
  const titre = (texte: string, teinte: (t: string) => string): string[] => {
    const [premiere, ...suite] = replier(texte, largeur, CORPS);
    return [
      teinte(`${ITEM}${symbole(etat)}  ${(premiere ?? "").trimStart()}`),
      ...suite.map(teinte),
    ];
  };

  if (entry.status === "failed") {
    lignes.push(...titre(`${qui(entry)} a ÉCHOUÉ (${age})`, p.echec));
    lignes.push(...champ("phase atteinte", entry.phase ?? "inconnue"));
    lignes.push(...champ("environnement", entry.environment));
    if (entry.error) {
      lignes.push(
        ...champ("cause", `${entry.error.name}: ${entry.error.message}`),
      );
      if (entry.error.exitCode !== undefined) {
        lignes.push(...champ("code de sortie", String(entry.error.exitCode)));
      }
    }
  } else {
    // Le cas que personne ne diagnostique : ça DÉMARRE, donc ça a l'air sain.
    lignes.push(
      ...titre(
        `${qui(entry)} a abouti mais il MANQUE des briques (${age})`,
        p.alerte,
      ),
    );
    lignes.push(...champ("environnement", entry.environment));
    if (entry.healthy === false) {
      lignes.push(
        ...champ(
          "verdict",
          p.echec("un profil serveur a fini SANS aucun serveur en écoute"),
        ),
      );
    }
  }

  if (entry.bricksSkipped?.length) {
    lignes.push(
      ...champ("briques ignorées", String(entry.bricksSkipped.length)),
    );
    lignes.push(
      ...quelquesUnes(
        entry.bricksSkipped.map(
          (b) =>
            `${b.module}${b.phase ? p.discret(` (${b.phase})`) : ""} — ${b.reason}`,
        ),
        p,
      ),
    );
  }
  if (entry.bricksGated?.length) {
    // VOLONTAIRE — mais un module écarté en silence se diagnostique comme un
    // module perdu, et on cherche longtemps un défaut qui n'existe pas.
    lignes.push(...champ("écartées exprès", String(entry.bricksGated.length)));
    lignes.push(
      ...quelquesUnes(
        entry.bricksGated.map((b) => `${b.module} — ${b.reason}`),
        p,
      ),
    );
  }
  if (entry.warnings || entry.errors) {
    lignes.push(
      ...champ(
        "journal du boot",
        `${accord(entry.warnings ?? 0, "avertissement")}, ${accord(entry.errors ?? 0, "erreur")}`,
      ),
    );
  }
  if (entry.criticals?.length) {
    // Le compte disait qu'il s'était passé quelque chose ; ceci dit QUOI.
    const montres = entry.criticals.slice(0, PUCES_MAX);
    for (const message of montres) {
      // La suite s'aligne SOUS le texte, pas sous la puce : une deuxième ligne
      // rendue à la même colonne que le `·` se lit comme un deuxième message.
      const [premiere, ...suite] = replier(message, largeur, `${CORPS}    `);
      lignes.push(p.echec(`${CORPS}  · ${(premiere ?? "").trimStart()}`));
      for (const l of suite) lignes.push(p.echec(l));
    }
    const reste = entry.criticals.length - montres.length;
    if (reste > 0) {
      lignes.push(p.discret(`${CORPS}  · … et ${accord(reste, "autre")}`));
    }
  }
  if (entry.remediation) {
    for (const l of replier(`→ ${entry.remediation}`, largeur, CORPS)) {
      lignes.push(p.geste(l));
    }
  }
  // SON fichier, pas celui du serveur : avec deux bilans affichés, un
  // chemin unique enverrait lire le mauvais.
  lignes.push(...champ("bilan complet", lastBootFileFor(entry.profile)));
  return lignes;
}

/**
 * La dernière ligne — celle qu'on retient.
 *
 * Elle doit rester VRAIE dans les trois situations, y compris la plus piégeuse :
 * quand aucun contrôle n'a pu tourner. « Rien à signaler · 0 contrôle passé »
 * s'y lisait comme un succès alors que rien n'avait été regardé.
 */
function bilan(
  report: ICheckReport,
  sautes: readonly IControleSaute[],
  p: IPalette,
  largeur: number,
  dureeMs?: number,
): string[] {
  // ⚠️ La MÊME fonction que le code de sortie et que le serveur MCP. Recompter
  // ici a produit un bilan qui contredisait le sommaire juste au-dessus.
  const total = countFindings(report);
  const passes = nombreDeControlesPasses(report);

  /**
   * Un segment du bilan : ce qu'il MESURE, et ce qui s'AFFICHE.
   *
   * Les deux diffèrent dès qu'il y a de la couleur — une séquence ANSI compte
   * pour zéro colonne mais pour plusieurs caractères. Mesurer la version peinte
   * ferait passer une ligne courte pour trop longue, et l'inverse.
   */
  const seg = (texte: string, teinte: (t: string) => string) => ({
    mesure: texte,
    peint: teinte(texte),
  });

  const segments: { mesure: string; peint: string }[] = [];
  if (total > 0) {
    segments.push(seg(accord(total, "manquement"), p.echec));
    segments.push(
      // « effectué », jamais « passé » : ce compte est celui des familles qui
      // ont REGARDÉ, manquements compris. Dire « 7 contrôles passés » à côté
      // de « 1 manquement » faisait annoncer huit familles là où il y en a
      // sept, et laissait croire que la fautive avait réussi.
      seg(accord(passes, "contrôle effectué", "contrôles effectués"), (t) => t),
    );
  } else if (passes === 0) {
    // Hors d'une application : dire « rien à signaler » serait un quitus rendu
    // sans avoir rien ouvert.
    segments.push(seg("Aucun contrôle n'a pu être fait ici", p.alerte));
  } else {
    const exceptions =
      report.exceptions > 0
        ? ` (${accord(report.exceptions, "exception")} déclarée${report.exceptions > 1 ? "s" : ""})`
        : "";
    const phrase =
      sautes.length > 0
        ? `Rien à signaler parmi les ${accord(passes, "contrôle effectué", "contrôles effectués")}`
        : `Rien à signaler sur ${accord(passes, "contrôle", "contrôles")}`;
    segments.push({
      mesure: phrase + exceptions,
      peint: p.ok(phrase) + p.discret(exceptions),
    });
  }
  if (sautes.length > 0) {
    segments.push(
      seg(accord(sautes.length, "non contrôlé", "non contrôlés"), p.alerte),
    );
  }
  if (dureeMs !== undefined) {
    const texte =
      dureeMs < 1000
        ? `${Math.round(dureeMs)} ms`
        : `${(dureeMs / 1000).toFixed(1)} s`;
    segments.push(seg(texte, p.discret));
  }

  // Sur un terminal étroit, les segments s'EMPILENT au lieu de déborder. Une
  // dernière ligne coupée par le terminal est celle qu'on retient de travers.
  const surUneLigne = `  ${segments.map((s) => s.mesure).join(" · ")}`;
  if (surUneLigne.length <= largeur) {
    return [`  ${segments.map((s) => s.peint).join(" · ")}`];
  }
  return segments.map((s) => `  ${s.peint}`);
}

/** Combien de familles ont réellement regardé — la moitié utile du bilan. */
function nombreDeControlesPasses(report: ICheckReport): number {
  let n = 0;
  // Dérivé de la source unique : une famille ajoutée est comptée sans qu'on ait
  // à y penser — la liste écrite en dur ici ignorait l'étage 2.
  for (const famille of COUNTED_FAMILIES) {
    if (report.execution[famille]?.ran) n++;
  }
  return n;
}
