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
  pluralize,
  preventedChecks,
  skippedChecks,
  countFindings,
  createPalette,
  FAMILIES,
  COUNTED_FAMILIES,
  isSubrule,
  sectionTitle,
  summaryLine,
  wrap,
  splitAction,
  highlightCode,
  stateSymbol,
  TITLES,
  type DoctorFamily,
  type SectionState,
  type ISkippedCheck,
  type ISummaryLine,
  type IPalette,
} from "./report";
import { formatAge, lastBootFileFor, type ILastBoot } from "./lastBoot";
// Type SEUL : élidé à la compilation, donc aucune arête d'import à l'exécution
// entre la collecte et son rendu.
import type { IDoctorReport } from "./runDoctor";
import type { ILiveFinding } from "./live";
import type { ISurfaceFinding } from "./surface";

/** Le décor du rendu — tout ce que ce module refuse d'aller chercher lui-même. */
export interface IRenderOptions {
  /** Largeur utile, déjà bornée. */
  width: number;
  /** `true` pour émettre des séquences ANSI. */
  color: boolean;
  /** Instant de référence, pour l'âge du dernier démarrage. */
  now: number;
  /** Le dossier d'où la commande a été lancée, s'il diffère de la racine. */
  launchedFrom?: string;
  /** `true` si un contrôle sauté fait échouer la commande. */
  strict: boolean;
  /**
   * Durée de la collecte, en millisecondes — affichée au pied du rapport.
   *
   * Un diagnostic qui prend deux secondes et un diagnostic qui en prend
   * quarante ne se lisent pas pareil : le second dit que quelque chose rame,
   * et c'est souvent le premier symptôme.
   */
  durationMs?: number;
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
const BODY = "       ";

/** L'indentation d'un ITEM — symbole, numéro, titre. */
const ITEM = "    ";

/**
 * Au-delà de cette longueur, une commande occupe sa ligne SEULE.
 *
 * Elle cesse alors de fixer la colonne où s'aligne la glose des autres.
 */
const ACTION_COLUMN_MAX = 28;

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
function firstFew(items: readonly string[], p: IPalette): string[] {
  const lines = items.slice(0, PUCES_MAX).map((text) => `${BODY}  · ${text}`);
  const remainder = items.length - PUCES_MAX;
  if (remainder > 0) {
    lines.push(p.dim(`${BODY}  · … et ${pluralize(remainder, "autre")}`));
  }
  return lines;
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
export function worthReporting(entry: ILastBoot): boolean {
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
 * @param skipped - les contrôles sautés, dans l'ordre de lecture.
 * @returns un groupe par raison distincte, l'ordre du premier membre conservé.
 */
export function groupByReason(
  skipped: readonly ISkippedCheck[],
): { titles: string[]; reason: string; unlock?: string }[] {
  const groups: { titles: string[]; reason: string; unlock?: string }[] = [];
  for (const check of skipped) {
    const existing = groups.find(
      (g) => g.reason === check.reason && g.unlock === check.unlock,
    );
    if (existing) existing.titles.push(check.title);
    else
      groups.push({
        titles: [check.title],
        reason: check.reason,
        unlock: check.unlock,
      });
  }
  return groups;
}

/**
 * Le document complet, ligne par ligne, sans retour chariot final.
 *
 * @param report - le diagnostic collecté.
 * @param opts - le décor de rendu (largeur, couleur, instant).
 * @returns les lignes à écrire, dans l'ordre.
 */
export function renderReport(
  report: IDoctorReport,
  opts: IRenderOptions,
): string[] {
  const { width, color, now, strict } = opts;
  const p = createPalette(color);
  const lines: string[] = [];
  const skipped = skippedChecks(report.execution);

  /** Ouvre une section : un titre, prolongé par un filet jusqu'au bord. */
  const section = (name: string, teinte: (t: string) => string): void => {
    const { title, divider: trait } = sectionTitle(name, width);
    lines.push("", teinte(p.strong(title)) + p.dim(trait), "");
  };

  lines.push(...enTete(report, opts, p));
  lines.push(...bandeau(report, skipped, p));

  section("ÉTAT", (t) => t);
  lines.push(...renderSummary(report, p, width));

  const problems = findingGroups(report).filter((g) => g.items.length > 0);
  if (problems.length > 0) {
    section("PROBLÈMES", p.failure);
    const totalProblems = problems.reduce((n, g) => n + g.items.length, 0);
    let index = 0;
    for (const { title, items } of problems) {
      for (const item of items) {
        if (index > 0) lines.push("");
        lines.push(
          ...problemBlock(++index, totalProblems, title, item, p, opts),
        );
      }
    }
  }

  if (skipped.length > 0) {
    // SYSTÉMATIQUE, y compris quand tout le reste est vert : un diagnostic muet
    // sur son angle mort se lit comme un quitus.
    section("NON CONTRÔLÉ", p.warning);
    lines.push(...uncheckedBlocks(skipped, p, opts));
    if (strict) {
      lines.push("");
      // La phrase doit dire ce que le code de sortie fera VRAIMENT. Annoncer
      // « ça échoue » alors que la commande rend 0 — parce que les seuls
      // contrôles manquants n'ont pas été DEMANDÉS — apprend à ne plus croire
      // le bandeau, ce qui est pire que de ne rien annoncer.
      const empeches = preventedChecks(skipped);
      for (const l of wrap(
        empeches.length > 0
          ? "mode strict : un contrôle EMPÊCHÉ fait échouer la commande."
          : // Deux raisons de ne pas peser, et la phrase les distingue : un
            // contrôle qu'on n'a pas DEMANDÉ n'est pas un contrôle qui
            // n'avait RIEN à examiner. Les confondre laisserait croire qu'il
            // suffit de demander pour obtenir un verdict.
            skipped.every((c) => c.notApplicable)
            ? "mode strict : ce qui manque ici n'avait rien à examiner — le " +
              "code de sortie n'en tient pas compte."
            : "mode strict : ce qui manque ici n'a pas été demandé, ou " +
              "n'avait rien à examiner — le code de sortie n'en tient pas " +
              "compte.",
        width,
        BODY,
      )) {
        lines.push(p.dim(l));
      }
    }
  }

  const openings = openSurface(report, width, p);
  if (openings.length > 0) {
    // Une INFORMATION, en teinte neutre : chacune de ces ouvertures est un
    // geste légitime. Ce que personne n'a jamais, c'est la LISTE — et c'est
    // ainsi qu'une route de mise au point reste ouverte en production.
    section("SURFACE OUVERTE", p.warning);
    lines.push(...openings);
  }

  const retires = manquementsLive(report, "service-lost");
  if (retires.length > 0) {
    // Un RELEVÉ, pas un verdict — même esprit que « SURFACE OUVERTE ». Ce que
    // l'environnement visé retire est le plus souvent voulu : c'est à quoi
    // sert `policy: "dev"`. Le service rendu est de le VOIR avant de partir,
    // pas d'être accusé de l'avoir écrit.
    section("CE QUE L'ENVIRONNEMENT VISÉ RETIRE", p.warning);
    for (const f of retires) {
      for (const [i, l] of wrap(f.message, width, BODY).entries()) {
        lines.push(i === 0 ? `${ITEM}${p.warning("—")}  ${l.trim()}` : l);
      }
    }
    lines.push("");
    for (const l of wrap(
      'Un module `policy: "dev"` est ÉCARTÉ là-bas : c\'est sa raison ' +
        "d'être, et ces lignes sont alors normales. À regarder seulement si " +
        "du code servi en production réclame l'un de ces services.",
      width - 4,
      "  ",
    )) {
      lines.push(p.dim(l));
    }
  }

  const tellingSummaries = report.lastBoots.filter(worthReporting);
  if (tellingSummaries.length > 0) {
    // APRÈS les problèmes, et c'est un choix : un démarrage passé n'est pas un
    // manquement du code — c'est une trace. Placé avant, il repoussait le
    // premier vrai problème quarante lignes plus bas.
    section(
      tellingSummaries.length > 1 ? "DERNIERS DÉMARRAGES" : "DERNIER DÉMARRAGE",
      p.warning,
    );
    let premier = true;
    for (const startup of tellingSummaries) {
      if (!premier) lines.push("");
      premier = false;
      lines.push(...lastStartup(startup, now, p, width));
    }
  }

  const actions = nextActions(report, skipped);
  if (actions.length > 0) {
    section("À FAIRE ENSUITE", p.action);
    lines.push(...actionList(actions, p, width));
  }

  lines.push("");
  lines.push(...footer(report, skipped, p, width, opts.durationMs));
  lines.push("");
  return lines;
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
 * @param skipped - les contrôles qui n'ont pas eu lieu.
 * @param p - la peinture.
 * @returns une ligne, plus une ligne vide.
 */
function bandeau(
  report: IDoctorReport,
  skipped: readonly ISkippedCheck[],
  p: IPalette,
): string[] {
  const total = countFindings(report);
  const passes = passedCheckCount(report);
  if (total > 0) {
    // Les angles morts DANS le bandeau, et pas seulement plus bas : un lecteur
    // qui corrige le problème annoncé doit savoir, à la même seconde, que le
    // rapport n'a pas tout regardé — sinon il croira avoir tout vu.
    const angles =
      skipped.length > 0
        ? p.warning(
            `   ${pluralize(skipped.length, "angle mort", "angles morts")}`,
          )
        : "";
    return [
      p.failure(
        `  ${stateSymbol("echec")}  ${p.strong(pluralize(total, "PROBLÈME").toUpperCase())}`,
      ) + angles,
    ];
  }
  if (passes === 0) {
    // Hors d'une application : « tout va bien » serait un quitus rendu sans
    // avoir rien ouvert.
    return [
      p.warning(
        `  ${stateSymbol("non-controle")}  ${p.strong("AUCUN CONTRÔLE N'A PU ÊTRE FAIT ICI")}`,
      ),
    ];
  }
  return [
    skipped.length > 0
      ? p.ok(`  ${stateSymbol("ok")}  ${p.strong("RIEN À SIGNALER")}`) +
        p.warning(
          `  (${pluralize(skipped.length, "angle mort", "angles morts")})`,
        )
      : p.ok(`  ${stateSymbol("ok")}  ${p.strong("RIEN À SIGNALER")}`),
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
 * @param index - le rang du problème dans le rapport.
 * @param family - le titre de la famille dont il vient.
 * @param item - le manquement (message, et le fichier qui le porte).
 * @param p - la peinture.
 * @param opts - le décor (largeur, couleur).
 * @returns les lignes du bloc.
 */
function problemBlock(
  index: number,
  total: number,
  family: string,
  item: { message: string; file?: string },
  p: IPalette,
  opts: IRenderOptions,
): string[] {
  const { width, color } = opts;
  const { finding, action } = splitAction(item.message);
  const lines: string[] = [];
  // Le rang occupe la colonne du SYMBOLE des autres sections : une seule
  // largeur pour toute la grille, élargie seulement s'il y a dix problèmes.
  const rang = String(index).padStart(String(total).length, " ");
  lines.push(`${ITEM}${p.failure(p.strong(rang))}  ${p.strong(family)}`);
  // La gouttière tient la colonne du texte : elle dit « ceci appartient encore
  // au problème ci-dessus », y compris après un repli de six lignes.
  const gutter = `${BODY}${p.dim("│")} `;
  for (const l of wrap(finding, width - 10, "")) {
    lines.push(gutter + highlightCode(l, p, color));
  }
  if (item.file) {
    // Un chemin ne se COUPE pas — coupé, il n'est plus copiable, et c'est
    // précisément ce qu'on vient chercher. Quand il ne tient pas derrière la
    // gouttière, il prend la ligne entière plutôt que de déborder du terminal.
    const behindGutter = `${BODY}│ ${item.file}`;
    lines.push(
      behindGutter.length <= width
        ? gutter + p.dim(item.file)
        : `${BODY}${p.dim(item.file)}`,
    );
  }
  lines.push(...actionLine(action, p, width));
  return lines;
}

/**
 * Les contrôles qui n'ont pas eu lieu, groupés par cause.
 *
 * @param skipped - les contrôles sautés.
 * @param p - la peinture.
 * @param opts - le décor.
 * @returns les lignes de la section.
 */
function uncheckedBlocks(
  skipped: readonly ISkippedCheck[],
  p: IPalette,
  opts: IRenderOptions,
): string[] {
  const { width, color } = opts;
  const lines: string[] = [];
  let premier = true;
  for (const group of groupByReason(skipped)) {
    if (!premier) lines.push("");
    premier = false;
    // Quatre titres joints font vite soixante colonnes : cette ligne se replie
    // comme n'importe quelle autre, sinon elle déborde exactement dans le cas
    // où elle a le plus à dire.
    const [firstTitle, ...otherTitles] = wrap(
      group.titles.join(", "),
      width - 8,
      "",
    );
    lines.push(
      `${ITEM}${p.warning(stateSymbol("non-controle"))}  ${p.strong(firstTitle ?? "")}`,
    );
    for (const l of otherTitles) lines.push(`${BODY}${p.strong(l)}`);
    const gutter = `${BODY}${p.dim("│")} `;
    for (const l of wrap(group.reason, width - 10, "")) {
      lines.push(gutter + p.warning(highlightCode(l, p, color)));
    }
    lines.push(...actionLine(group.unlock, p, width));
  }
  return lines;
}

/**
 * Le geste, seul sur sa ligne, sous un chevron.
 *
 * Les accents graves qui l'entourent dans le message SAUTENT : la ligne est
 * déjà désignée comme une commande par son chevron, et un accent grave collé
 * part avec la commande quand on la copie — puis le terminal se plaint d'un
 * fichier introuvable.
 *
 * @param action - le geste, ou `undefined` s'il n'y en a pas.
 * @param p - la peinture.
 * @param width - largeur utile.
 * @returns les lignes, vides s'il n'y a pas de geste.
 */
function actionLine(
  action: string | undefined,
  p: IPalette,
  width: number,
): string[] {
  if (!action) return [];
  const cleaned = action.replace(/`/gu, "").trim();
  return wrap(cleaned, width - 10, "").map((l, i) =>
    i === 0
      ? `${BODY}${p.action("▸")} ${p.action(l)}`
      : `${BODY}  ${p.action(l)}`,
  );
}

/** Un geste à faire, et ce qu'il ferme. */
interface IAction {
  /** La commande, telle qu'on la tape. */
  command: string;
  /** Ce que ce geste répare — pour choisir par quoi commencer. */
  why: string;
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
 * @param skipped - les contrôles sautés.
 * @returns les gestes, sans doublon, dans l'ordre où les faire.
 */
export function nextActions(
  report: IDoctorReport,
  skipped: readonly ISkippedCheck[],
): IAction[] {
  const actions: IAction[] = [];
  const vus = new Set<string>();
  const add = (command: string, why: string): void => {
    const cleaned = command.replace(/^`|`$/gu, "").trim();
    if (cleaned === "" || vus.has(cleaned)) return;
    vus.add(cleaned);
    actions.push({ command: cleaned, why: why });
  };
  for (const { title, items } of findingGroups(report)) {
    for (const item of items) {
      const { action } = splitAction(item.message);
      if (action) add(action, title);
    }
  }
  for (const group of groupByReason(skipped)) {
    if (group.unlock) add(group.unlock, group.titles.join(", "));
  }
  return actions;
}

/**
 * Ce qu'un geste répare, rendu SOUS lui quand il ne tient pas à sa droite.
 *
 * @param why - la famille que ce geste referme.
 * @param indent - l'indentation, alignée sous la commande.
 * @param width - largeur utile du terminal.
 * @param p - la peinture.
 * @returns les lignes, repliées pour ne jamais déborder.
 */
function underAction(
  why: string,
  indent: string,
  width: number,
  p: IPalette,
): string[] {
  return wrap(why, width - indent.length, "").map((l) => indent + p.dim(l));
}

/**
 * La liste des gestes, numérotée et alignée.
 *
 * @param actions - les gestes, déjà dédoublonnés.
 * @param p - la peinture.
 * @param width - largeur utile.
 * @returns les lignes de la section.
 */
function actionList(
  actions: readonly IAction[],
  p: IPalette,
  width: number,
): string[] {
  // La colonne d'alignement s'ajuste sur les commandes COURTES seulement. Un
  // seul geste long (un `npm pkg set …` de soixante caractères) suffisait
  // sinon à repousser toutes les gloses hors de la largeur : le rappel perdait
  // d'un coup ce qu'il apprend, à cause d'une ligne qui n'en avait pas besoin.
  const shortLengths = actions
    .map((g) => g.command.length)
    .filter((n) => n <= ACTION_COLUMN_MAX);
  const column = shortLengths.length > 0 ? Math.max(...shortLengths) : 0;
  const lines: string[] = [];
  for (const [i, g] of actions.entries()) {
    const rang = String(i + 1).padStart(String(actions.length).length, " ");
    const indent = ITEM + " ".repeat(rang.length + 2);
    const measure = `${ITEM}${rang}  ${g.command}`;
    // La glose ne s'affiche que si elle TIENT : coupée, elle ferait douter de
    // la commande elle-même, qui est la seule chose à copier ici.
    // Un geste trop long pour la colonne garde sa glose : elle passe sous lui,
    // jamais à la trappe. 🔴 La supprimer laissait des gestes qui ne sont pas
    // des commandes — une phrase — sans le moindre contexte : il fallait
    // remonter dans le rapport pour savoir de quoi ils parlaient, ce qui est
    // exactement ce que ce rappel existe pour éviter.
    const overflows = g.command.length > column;
    const glose = overflows
      ? ""
      : `  ${" ".repeat(column - g.command.length)}${g.why}`;
    if (measure.length <= width) {
      const debut = `${ITEM}${p.dim(rang)}  ${p.action(g.command)}`;
      lines.push(
        glose !== "" && measure.length + glose.length <= width
          ? debut + p.dim(glose)
          : debut,
      );
      if (overflows || measure.length + glose.length > width) {
        lines.push(...underAction(g.why, indent, width, p));
      }
      continue;
    }
    // Terminal étroit : la commande se replie sous elle-même plutôt que de
    // déborder. Elle reste donnée en ENTIER dans le bloc du problème — cette
    // liste est un rappel, pas la source.
    const [premiere, ...suite] = wrap(g.command, width - indent.length, "");
    lines.push(`${ITEM}${p.dim(rang)}  ${p.action(premiere ?? "")}`);
    for (const l of suite) lines.push(indent + p.action(l));
    // Même règle qu'au-dessus : ce que ce geste répare se lit sous lui.
    lines.push(...underAction(g.why, indent, width, p));
  }
  return lines;
}

/**
 * L'en-tête : QUI est ausculté.
 *
 * Un rapport qui porte sur un autre dossier que celui qu'on croit se lit de
 * travers, dans les deux sens — et c'est le cas normal, puisque la cible est
 * l'APPLICATION et non le dossier où l'on a tapé.
 */
function enTete(
  report: IDoctorReport,
  opts: IRenderOptions,
  p: IPalette,
): string[] {
  const lines = ["", `  ${p.strong("nodefony doctor")}`];
  const name = report.appName;
  if (name) lines[1] += p.dim(` · ${name}`);
  lines.push(p.dim(`  ${report.root}`));
  if (opts.targetEnv) {
    lines.push(
      p.warning(`  exigences évaluées pour l'environnement ${opts.targetEnv}`),
    );
  }
  if (
    opts.launchedFrom &&
    path.resolve(report.root) !== path.resolve(opts.launchedFrom)
  ) {
    lines.push(p.dim(`  lancé depuis ${opts.launchedFrom}`));
  }
  lines.push("");
  return lines;
}

/**
 * Le sommaire : l'état de chaque famille, d'un coup d'œil.
 *
 * C'est ce qui répond à « y a-t-il un problème, et où ? » sans rien lire
 * d'autre. **L'état d'EXÉCUTION prime toujours sur les trouvailles** : un
 * contrôle qui n'a rien regardé n'a rien trouvé, et l'afficher en vert est le
 * seul mensonge que ce sommaire ne doit jamais dire.
 */
function renderSummary(
  report: IDoctorReport,
  p: IPalette,
  width: number,
): string[] {
  const { freshness, readiness, wiring, findings, scanned, execution } = report;
  const state = (n: number): SectionState => (n > 0 ? "echec" : "ok");
  /**
   * Les familles qui REPORTING_ONLY au lieu d'accuser.
   *
   * 🔴 `gating` relève ce que l'environnement visé retire. Qu'un module
   * `policy: "dev"` disparaisse en production est sa raison d'être : le rendre
   * en `✗` faisait passer le fonctionnement NORMAL du produit pour un défaut,
   * et le geste qui suivait — « retire `policy: "dev"` » — aurait embarqué
   * l'outillage de développement en production.
   */
  const REPORTING_ONLY: ReadonlySet<DoctorFamily> = new Set(["gating"]);
  const line = (
    family: DoctorFamily,
    n: number,
    detail: string,
  ): ISummaryLine => {
    // Même garde que `skippedChecks` : un état absent se DIT, il ne se rend
    // pas en vert et ne fait pas lever le rapport.
    const exec = execution[family] ?? { ran: false, short: "état absent" };
    return exec.ran
      ? {
          title: TITLES[family],
          state:
            n > 0 && REPORTING_ONLY.has(family) ? "avertissement" : state(n),
          detail,
        }
      : {
          title: TITLES[family],
          state: "non-controle",
          // Court ICI, complet dans la section dédiée : une raison tronquée
          // par un `…` cache justement ce qu'on aurait besoin de lire.
          detail: exec.short ?? "non contrôlé",
        };
  };
  const detail: Record<DoctorFamily, { n: number; text: string }> = {
    freshness: {
      n: freshness.findings.length,
      text:
        freshness.findings.length > 0
          ? pluralize(freshness.findings.length, "écart")
          : "sources et build alignés",
    },
    readiness: {
      n: readiness.findings.length,
      text:
        readiness.findings.length > 0
          ? pluralize(readiness.findings.length, "manquement")
          : "environnement, modules, ports",
    },
    // « Variables déclarées » est une RÈGLE de `readiness`, pas une famille à
    // part : elle n'apparaît que lorsqu'elle n'a pas pu jouer, sans quoi le
    // sommaire dirait deux fois la même chose.
    envCatalog: { n: 0, text: "" },
    // Idem : ses manquements sont RAPPORTÉS par `readiness` (c'est sa liste),
    // et cette ligne n'existe que pour dire qu'on n'a pas pu regarder.
    envTracked: { n: 0, text: "" },
    deps: {
      n: findings.length,
      text:
        findings.length > 0
          ? `${pluralize(findings.length, "manquement")} sur ${pluralize(scanned, "paquet")}`
          : pluralize(scanned, "paquet"),
    },
    wiring: {
      n: wiring.findings.length,
      text:
        wiring.findings.length > 0
          ? `${pluralize(wiring.findings.length, "manquement")} sur ${pluralize(wiring.scanned, "classe")}`
          : `${pluralize(wiring.scanned, "classe")} déclarée${wiring.scanned > 1 ? "s" : ""}`,
    },
    surface: {
      n: surfaceFindings(report, "public-area-covers-all").length,
      text:
        surfaceFindings(report, "public-area-covers-all").length > 0
          ? "une zone publique couvre TOUT"
          : inventaireSurface(report),
    },
    dialect: {
      n: surfaceFindings(report, "entity-other-dialect").length,
      text:
        surfaceFindings(report, "entity-other-dialect").length > 0
          ? `${pluralize(surfaceFindings(report, "entity-other-dialect").length, "entité")} hors dialecte`
          : `${pluralize(report.surface.entitiesScanned, "entité")} sur ${report.surface.dialect ?? "?"}`,
    },
    guards: {
      n: report.guards.findings.length,
      text:
        report.guards.findings.length > 0
          ? `${pluralize(report.guards.findings.length, "garde")} décrochée${report.guards.findings.length > 1 ? "s" : ""}`
          : armedGuards(report.guards.armed, report.guards.armedNames),
    },
    // Étage 3 — les scripts LANCÉS. Un script absent ne compte pas : c'est
    // `guards` qui répond de sa présence, et le dire deux fois ferait porter un
    // seul manquement par deux lignes, avec deux gestes différents.
    verify: {
      // 🔴 `timeout` NE COMPTE PAS comme un manquement. Il ne dit rien du
      // projet : il dit que NOTRE borne était trop courte — un contrôle
      // EMPÊCHÉ, au même titre qu'un registre npm qui ne répond pas. Le
      // compter en rouge, c'est accuser le mesuré d'un défaut de l'instrument,
      // et c'est ainsi qu'on apprend à ne plus croire un rapport.
      n: (report.deep?.steps ?? []).filter((s) => s.outcome === "failed")
        .length,
      text: (() => {
        const steps = report.deep?.steps ?? [];
        const failed = steps.filter((s) => s.outcome === "failed");
        const interrupted = steps.filter((s) => s.outcome === "timeout");
        if (failed.length > 0)
          return (
            failed.map((s) => s.step).join(", ") +
            " en échec" +
            (interrupted.length > 0
              ? ` (+ ${interrupted.length} interrompu(s) par la borne)`
              : "")
          );
        if (interrupted.length > 0)
          return (
            interrupted.map((s) => s.step).join(", ") +
            " interrompu(s) par la borne — NON CONTRÔLÉ, pas en échec"
          );
        const passes = steps.filter((s) => s.outcome === "passed");
        return passes.length > 0
          ? `${passes.map((s) => s.step).join(", ")} au vert`
          : "aucun script à lancer";
      })(),
    },
    // 🔴 `outdated` ne compte JAMAIS de manquement : un paquet en retard n'est
    // pas un défaut de l'application. C'est une information — celle qu'on veut
    // avant de publier, et qui n'a rien à faire dans un code de sortie. La
    // famille est déclarée REPORTING_ONLY plus haut, qui la rend en
    // avertissement plutôt qu'en échec.
    outdated: {
      n: report.deep?.outdated?.packages.length ?? 0,
      text: (() => {
        const retard = report.deep?.outdated;
        if (!retard) return "non interrogé";
        const n = retard.packages.length;
        if (n === 0) return "tout est à jour";
        const majeurs = retard.packages.filter(
          (pkg) => pkg.severity === "major",
        ).length;
        return majeurs > 0
          ? `${pluralize(n, "paquet")} en retard, dont ${majeurs} majeure${majeurs > 1 ? "s" : ""}`
          : `${pluralize(n, "paquet")} en retard`;
      })(),
    },
    // Étage 2 : le compte vient des findings de CETTE famille, filtrés par leur
    // origine. Un manquement de migration ne doit pas grossir la ligne du
    // firewall — le sommaire perdrait sa seule vertu, dire OÙ regarder.
    migrations: {
      n: manquementsLive(report, "migrations-not-ok").length,
      text:
        manquementsLive(report, "migrations-not-ok").length > 0
          ? pluralize(
              manquementsLive(report, "migrations-not-ok").length,
              "écart",
            )
          : "schéma et historique alignés",
    },
    firewall: {
      n: manquementsLive(report, "firewall-config-invalid").length,
      text:
        manquementsLive(report, "firewall-config-invalid").length > 0
          ? "configuration INVALIDE"
          : "zones et authentificateurs cohérents",
    },
    gating: {
      n: manquementsLive(report, "service-lost").length,
      text:
        manquementsLive(report, "service-lost").length > 0
          ? pluralize(
              manquementsLive(report, "service-lost").length,
              "brique",
            ) +
            " perdue" +
            (manquementsLive(report, "service-lost").length > 1 ? "s" : "")
          : modulesEcartes(report).length > 0
            ? `${pluralize(modulesEcartes(report).length, "module")} écarté${modulesEcartes(report).length > 1 ? "s" : ""}, rien de perdu`
            : "rien ne disparaît",
    },
  };
  // L'ordre est celui de FAMILLES, le MÊME que la section « non contrôlé » plus
  // bas : deux ordres différents pour les mêmes contrôles, et le lecteur cesse
  // de faire le lien entre le sommaire et le détail.
  const lines: ISummaryLine[] = FAMILIES.filter(
    // Une sous-règle de `readiness` n'a pas de ligne à elle tant qu'elle a pu
    // jouer : le sommaire dirait deux fois la même chose. Elle n'apparaît que
    // pour ÉNONCER son angle mort — et seulement si la famille, elle, a bien
    // regardé (sinon le même trou serait compté deux fois).
    (f) =>
      !isSubrule(f) ||
      (!execution[f]?.ran && execution.readiness?.ran === true),
  ).map((f) => line(f, detail[f].n, detail[f].text));

  const titleWidth = Math.max(...lines.map((l) => l.title.length));
  return lines.map((l) => {
    const teinte =
      l.state === "echec" ? p.failure : l.state === "ok" ? p.ok : p.warning;
    return teinte(summaryLine(l, titleWidth, width));
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
  report: IDoctorReport,
  kind: ILiveFinding["kind"],
): ILiveFinding[] {
  return (report.live?.findings ?? []).filter((f) => f.kind === kind);
}

/** Au-delà, la liste cesse d'informer et devient un mur — le reste se demande. */
const OPENINGS_SHOWN = 12;

/** Le libellé de chaque espèce d'ouverture, tel qu'il se lit. */
const OPENING_LABEL: Record<string, string> = {
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
function openSurface(
  report: IDoctorReport,
  width: number,
  p: IPalette,
): string[] {
  const openings = report.surface.openings;
  if (openings.length === 0) return [];
  const lines: string[] = [];
  for (const o of openings.slice(0, OPENINGS_SHOWN)) {
    const label = OPENING_LABEL[o.kind] ?? o.kind;
    const quoi = o.what ? `${label} ${o.what}` : label;
    for (const [i, l] of wrap(quoi, width, BODY).entries()) {
      lines.push(i === 0 ? `${ITEM}${p.warning("—")}  ${l.trim()}` : l);
    }
    lines.push(p.dim(`${BODY}${o.file}`));
  }
  const remainder = openings.length - OPENINGS_SHOWN;
  if (remainder > 0) {
    lines.push("");
    lines.push(
      p.dim(
        `${BODY}… et ${pluralize(remainder, "autre")} — la liste complète : ` +
          `nodefony doctor --json`,
      ),
    );
  }
  return lines;
}

/**
 * Les manquements de surface d'une espèce donnée.
 *
 * Le contrôle porte UNE liste ; le sommaire et le détail la découpent par
 * famille. Filtrer ici plutôt que tenir deux listes évite qu'un jour l'une
 * contienne ce que l'autre ignore.
 */
function surfaceFindings(
  report: IDoctorReport,
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
function inventaireSurface(report: IDoctorReport): string {
  const routes = report.surface.openings.filter(
    (o) => o.kind !== "public-area",
  ).length;
  const zones = report.surface.openings.length - routes;
  if (routes === 0 && zones === 0) return "rien d'ouvert sans authentification";
  const parts: string[] = [];
  if (routes > 0)
    parts.push(`${pluralize(routes, "route")} ouverte${routes > 1 ? "s" : ""}`);
  if (zones > 0)
    parts.push(`${pluralize(zones, "zone")} publique${zones > 1 ? "s" : ""}`);
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
function modulesEcartes(report: IDoctorReport): readonly { module: string }[] {
  return report.live?.gatedModules ?? [];
}

/**
 * Ce que dit la ligne « Gardes du projet » quand tout est armé — les NOMS.
 *
 * 🔴 « 5 gardes armées » se lit comme un quitus et n'apprend rien : le lecteur
 * ne sait ni ce qui est gardé, ni si la garde qu'il croit posée en fait partie.
 * Le compte agrégeait en plus deux natures sans le dire — des scripts du
 * manifeste (`typecheck`, `verify`) et des règles du linter.
 *
 * La ligne du sommaire est étroite : on nomme donc autant de gardes que la
 * place le permet, et l'on DIT combien restent. Un « +3 » est une information ;
 * une liste tronquée par un `…` muet en serait la caricature.
 *
 * @param armed - le nombre total de gardes constatées.
 * @param names - leurs noms, dans l'ordre où le contrôle les a rencontrées.
 * @returns le texte de la ligne.
 */
function armedGuards(armed: number, names: readonly string[]): string {
  if (armed === 0) return "aucune garde armée";
  // Pas de noms (rapport ancien, ou décor partiel) : on rend le compte seul
  // plutôt que d'affirmer une liste vide.
  if (names.length === 0)
    return `${pluralize(armed, "garde")} armée${armed > 1 ? "s" : ""}`;
  const PLACE = 3;
  const shown = names.slice(0, PLACE);
  const remainder = names.length - shown.length;
  return remainder > 0 ? `${shown.join(", ")} +${remainder}` : shown.join(", ");
}

/** Les familles de manquements, dans l'ordre où elles se lisent. */ /** Les familles de manquements, dans l'ordre où elles se lisent. */
function findingGroups(
  report: IDoctorReport,
): { title: string; items: { message: string; file?: string }[] }[] {
  // La fraîcheur d'abord : un build en retard rend faux tout ce qui suit — une
  // classe « non câblée » peut l'être dans le dist et pas dans les sources
  // qu'on vient d'éditer. Puis ce qui empêche de DÉMARRER : une variable
  // absente explique souvent le reste.
  return [
    { title: TITLES.freshness, items: report.freshness.findings },
    { title: TITLES.readiness, items: report.readiness.findings },
    { title: TITLES.deps, items: report.findings },
    { title: TITLES.wiring, items: report.wiring.findings },
    {
      title: TITLES.surface,
      items: surfaceFindings(report, "public-area-covers-all"),
    },
    {
      title: TITLES.dialect,
      items: surfaceFindings(report, "entity-other-dialect"),
    },
    { title: TITLES.guards, items: report.guards.findings },
    // Étage 3 — le script LANCÉ qui a échoué, avec sa première ligne utile.
    // Sans ce groupe, le sommaire comptait le manquement et la section des
    // problèmes ne le montrait pas : le rapport disait OÙ regarder sans jamais
    // dire QUOI, ce qui oblige à relancer la commande à la main — exactement
    // le geste que cet étage existe pour éviter.
    {
      title: TITLES.verify,
      items: (report.deep?.steps ?? [])
        .filter((st) => st.outcome === "failed" || st.outcome === "timeout")
        .map((st) => ({
          message:
            st.outcome === "timeout"
              ? // Un dépassement de borne n'a pas « échoué » : il n'a pas eu
                // lieu. Le geste n'est donc pas « corrige ton projet » mais
                // « donne-lui le temps, ou lance-le toi-même ».
                `\`npm run ${st.step}\` n'a PAS pu être contrôlé — interrompu par la borne ` +
                `après ${Math.round(st.ms / 1000)} s` +
                `\n  → lance-le seul, sans borne : \`npm run ${st.step}\``
              : `\`npm run ${st.step}\` a échoué (${Math.round(st.ms / 1000)} s)` +
                (st.detail ? ` :\n  ${st.detail}` : "") +
                `\n  → relance-le seul pour voir la sortie entière : \`npm run ${st.step}\``,
        })),
    },
    // L'étage 2 en dernier : il n'existe que sur une application qui a démarré,
    // et le geste qu'il propose vient du PRODUCTEUR — il est rendu tel quel,
    // sous le constat, parce qu'une commande à taper se copie.
    {
      title: TITLES.migrations,
      items: manquementsLive(report, "migrations-not-ok").map((f) => ({
        message: f.action ? `${f.message}\n  → ${f.action}` : f.message,
      })),
    },
    {
      title: TITLES.firewall,
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
  const profile =
    entry.profile === "console"
      ? "console"
      : entry.profile === "cluster"
        ? "maître de cluster"
        : entry.profile === "server"
          ? "serveur"
          : "";
  if (!entry.command && !profile) return "Le dernier démarrage";
  if (!entry.command) return `Le dernier démarrage (${profile})`;
  return `\`nodefony ${entry.command}\`${profile ? ` (${profile})` : ""}`;
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
function lastStartup(
  entry: ILastBoot,
  now: number,
  p: IPalette,
  width: number,
): string[] {
  const lines: string[] = [];
  const age = formatAge(entry.timestamp, now);
  const state: SectionState =
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
  const field = (name: string, value: string): string[] => {
    // Assez large pour le PLUS LONG libellé (« briques ignorées », 16), plus
    // une colonne de respiration : en deçà, un libellé long colle sa valeur et
    // la colonne saute d'une ligne à l'autre.
    const column = 18;
    const indent = BODY + " ".repeat(column);
    const valueLines = wrap(value, width, indent);
    // Un chemin ou une URL ne se coupe PAS (le couper le rendrait incopiable).
    // Sur un terminal étroit, la colonne d'alignement ne laisse alors pas assez
    // de place : la valeur passe SOUS son libellé plutôt que de déborder.
    const deborde = valueLines.some((l) => l.length > width);
    if (deborde) {
      return [`${BODY}${p.dim(name)}`, ...wrap(value, width, `${BODY}  `)];
    }
    const [premiere, ...suite] = valueLines;
    return [
      `${BODY}${p.dim(name.padEnd(column, " "))}${(premiere ?? "").trimStart()}`,
      ...suite,
    ];
  };

  /** Le titre du bloc, replié comme n'importe quelle autre phrase. */
  const title = (text: string, teinte: (t: string) => string): string[] => {
    const [premiere, ...suite] = wrap(text, width, BODY);
    return [
      teinte(`${ITEM}${stateSymbol(state)}  ${(premiere ?? "").trimStart()}`),
      ...suite.map(teinte),
    ];
  };

  if (entry.status === "failed") {
    lines.push(...title(`${qui(entry)} a ÉCHOUÉ (${age})`, p.failure));
    lines.push(...field("phase atteinte", entry.phase ?? "inconnue"));
    lines.push(...field("environnement", entry.environment));
    if (entry.error) {
      lines.push(
        ...field("cause", `${entry.error.name}: ${entry.error.message}`),
      );
      if (entry.error.exitCode !== undefined) {
        lines.push(...field("code de sortie", String(entry.error.exitCode)));
      }
    }
  } else {
    // Le cas que personne ne diagnostique : ça DÉMARRE, donc ça a l'air sain.
    lines.push(
      ...title(
        `${qui(entry)} a abouti mais il MANQUE des briques (${age})`,
        p.warning,
      ),
    );
    lines.push(...field("environnement", entry.environment));
    if (entry.healthy === false) {
      lines.push(
        ...field(
          "verdict",
          p.failure("un profil serveur a fini SANS aucun serveur en écoute"),
        ),
      );
    }
  }

  if (entry.bricksSkipped?.length) {
    lines.push(
      ...field("briques ignorées", String(entry.bricksSkipped.length)),
    );
    lines.push(
      ...firstFew(
        entry.bricksSkipped.map(
          (b) =>
            `${b.module}${b.phase ? p.dim(` (${b.phase})`) : ""} — ${b.reason}`,
        ),
        p,
      ),
    );
  }
  if (entry.bricksGated?.length) {
    // VOLONTAIRE — mais un module écarté en silence se diagnostique comme un
    // module perdu, et on cherche longtemps un défaut qui n'existe pas.
    lines.push(...field("écartées exprès", String(entry.bricksGated.length)));
    lines.push(
      ...firstFew(
        entry.bricksGated.map((b) => `${b.module} — ${b.reason}`),
        p,
      ),
    );
  }
  if (entry.warnings || entry.errors) {
    lines.push(
      ...field(
        "journal du boot",
        `${pluralize(entry.warnings ?? 0, "avertissement")}, ${pluralize(entry.errors ?? 0, "erreur")}`,
      ),
    );
  }
  if (entry.criticals?.length) {
    // Le compte disait qu'il s'était passé quelque chose ; ceci dit QUOI.
    const shown = entry.criticals.slice(0, PUCES_MAX);
    for (const message of shown) {
      // La suite s'aligne SOUS le texte, pas sous la puce : une deuxième ligne
      // rendue à la même colonne que le `·` se lit comme un deuxième message.
      const [premiere, ...suite] = wrap(message, width, `${BODY}    `);
      lines.push(p.failure(`${BODY}  · ${(premiere ?? "").trimStart()}`));
      for (const l of suite) lines.push(p.failure(l));
    }
    const remainder = entry.criticals.length - shown.length;
    if (remainder > 0) {
      lines.push(p.dim(`${BODY}  · … et ${pluralize(remainder, "autre")}`));
    }
  }
  if (entry.remediation) {
    for (const l of wrap(`→ ${entry.remediation}`, width, BODY)) {
      lines.push(p.action(l));
    }
  }
  // SON fichier, pas celui du serveur : avec deux bilans affichés, un
  // chemin unique enverrait lire le mauvais.
  lines.push(...field("bilan complet", lastBootFileFor(entry.profile)));
  return lines;
}

/**
 * La dernière ligne — celle qu'on retient.
 *
 * Elle doit rester VRAIE dans les trois situations, y compris la plus piégeuse :
 * quand aucun contrôle n'a pu tourner. « Rien à signaler · 0 contrôle passé »
 * s'y lisait comme un succès alors que rien n'avait été regardé.
 */
function footer(
  report: IDoctorReport,
  skipped: readonly ISkippedCheck[],
  p: IPalette,
  width: number,
  durationMs?: number,
): string[] {
  // ⚠️ La MÊME fonction que le code de sortie et que le serveur MCP. Recompter
  // ici a produit un bilan qui contredisait le sommaire juste au-dessus.
  const total = countFindings(report);
  const passes = passedCheckCount(report);

  /**
   * Un segment du bilan : ce qu'il MESURE, et ce qui s'AFFICHE.
   *
   * Les deux diffèrent dès qu'il y a de la couleur — une séquence ANSI compte
   * pour zéro colonne mais pour plusieurs caractères. Mesurer la version peinte
   * ferait passer une ligne courte pour trop longue, et l'inverse.
   */
  const seg = (text: string, teinte: (t: string) => string) => ({
    measure: text,
    peint: teinte(text),
  });

  const segments: { measure: string; peint: string }[] = [];
  if (total > 0) {
    segments.push(seg(pluralize(total, "manquement"), p.failure));
    segments.push(
      // « effectué », jamais « passé » : ce compte est celui des familles qui
      // ont REGARDÉ, manquements compris. Dire « 7 contrôles passés » à côté
      // de « 1 manquement » faisait annoncer huit familles là où il y en a
      // sept, et laissait croire que la fautive avait réussi.
      seg(
        pluralize(passes, "contrôle effectué", "contrôles effectués"),
        (t) => t,
      ),
    );
  } else if (passes === 0) {
    // Hors d'une application : dire « rien à signaler » serait un quitus rendu
    // sans avoir rien ouvert.
    segments.push(seg("Aucun contrôle n'a pu être fait ici", p.warning));
  } else {
    const exceptions =
      report.exceptions > 0
        ? ` (${pluralize(report.exceptions, "exception")} déclarée${report.exceptions > 1 ? "s" : ""})`
        : "";
    const phrase =
      skipped.length > 0
        ? `Rien à signaler parmi les ${pluralize(passes, "contrôle effectué", "contrôles effectués")}`
        : `Rien à signaler sur ${pluralize(passes, "contrôle", "contrôles")}`;
    segments.push({
      measure: phrase + exceptions,
      peint: p.ok(phrase) + p.dim(exceptions),
    });
  }
  if (skipped.length > 0) {
    segments.push(
      seg(
        pluralize(skipped.length, "non contrôlé", "non contrôlés"),
        p.warning,
      ),
    );
  }
  if (durationMs !== undefined) {
    const text =
      durationMs < 1000
        ? `${Math.round(durationMs)} ms`
        : `${(durationMs / 1000).toFixed(1)} s`;
    segments.push(seg(text, p.dim));
  }

  // Sur un terminal étroit, les segments s'EMPILENT au lieu de déborder. Une
  // dernière ligne coupée par le terminal est celle qu'on retient de travers.
  const oneLine = `  ${segments.map((s) => s.measure).join(" · ")}`;
  if (oneLine.length <= width) {
    return [`  ${segments.map((s) => s.peint).join(" · ")}`];
  }
  return segments.map((s) => `  ${s.peint}`);
}

/** Combien de familles ont réellement regardé — la moitié utile du bilan. */
function passedCheckCount(report: IDoctorReport): number {
  let n = 0;
  // Dérivé de la source unique : une famille ajoutée est comptée sans qu'on ait
  // à y penser — la liste écrite en dur ici ignorait l'étage 2.
  for (const family of COUNTED_FAMILIES) {
    if (report.execution[family]?.ran) n++;
  }
  return n;
}
