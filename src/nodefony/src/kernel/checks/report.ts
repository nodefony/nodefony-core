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
import clc from "../../colors";

/** Le verdict d'une famille de contrôles, tel qu'il s'affiche. */
export type SectionState = "ok" | "echec" | "avertissement" | "non-controle";

/** Une famille de contrôles, résumée en une ligne du sommaire. */
export interface ISummaryLine {
  /** Nom lisible de la famille — « Câblage », « Fraîcheur du build ». */
  title: string;
  state: SectionState;
  /** Ce qui a été constaté, en quelques mots. */
  detail: string;
}

/**
 * L'ÉTAT D'EXÉCUTION d'une famille de contrôles — a-t-elle seulement eu lieu ?
 *
 * Un contrôle rend deux choses de nature différente : ce qu'il a trouvé, et
 * s'il a pu regarder. Les confondre est le mode de défaillance le plus coûteux
 * d'un outil de diagnostic — une liste de manquements vide se lit comme un
 * quitus, alors qu'elle peut ne signifier que « je n'ai rien pu ouvrir ». Ce
 * dépôt lui a déjà donné son nom : « un test sauté compte comme vert ».
 *
 * `reason` dit ce qui a empêché, `unlock` le geste qui rend le contrôle
 * possible — sans lui, le lecteur sait qu'il lui manque quelque chose sans
 * savoir quoi faire, et c'est ainsi qu'on apprend à ignorer un avertissement.
 */
export interface IExecution {
  /** `true` si le contrôle a réellement regardé. */
  ran: boolean;
  /** Ce qui l'a empêché — absent quand il a tourné. */
  reason?: string;
  /**
   * La même chose en trois mots, pour la colonne du sommaire.
   *
   * Une raison complète y serait tronquée par un `…` qui mange précisément
   * l'information qu'on venait chercher ; un « voir plus bas » répété sur
   * quatre lignes n'apprend rien. Deux formulations, chacune à sa place.
   */
  short?: string;
  /** Le geste qui le rend possible — absent quand il a tourné. */
  unlock?: string;
  /**
   * `true` quand ce contrôle n'a pas été DEMANDÉ, et non pas EMPÊCHÉ.
   *
   * 🔴 La distinction décide du code de sortie, et elle a été payée : l'étage 2
   * (`--live`) ne tourne que sur demande, puisqu'il exige un démarrage. Compté
   * comme un contrôle empêché, il faisait échouer `doctor` sous `CI` — c'est-à-
   * dire dans TOUTE chaîne automatisée, y compris celle qui contrôle une
   * application fraîchement générée, tant qu'elle n'ajoutait pas un boot
   * complet à sa commande.
   *
   * Ce qui ne change PAS : la famille reste affichée en « NON CONTRÔLÉ », avec
   * sa raison et son geste. Un contrôle non demandé n'est toujours pas un
   * quitus — il n'est simplement pas un manquement.
   */
  onDemand?: boolean;
  /**
   * `true` quand ce contrôle n'avait RIEN à examiner — et non pas quand
   * quelque chose l'en a empêché.
   *
   * 🔴 **Un contrôle sans matière n'est pas un contrôle bloqué.** La
   * distinction manquait, et vingt-deux des vingt-trois états « non exécuté »
   * du produit tombaient du mauvais côté : « aucune entité Drizzle dans cette
   * application », « aucun ORM chargé », « aucun module de sécurité chargé »,
   * « cette base ne se met pas à jour par des migrations » — autant d'états
   * parfaitement légitimes, comptés comme des empêchements. Une application
   * NEUVE échouait donc dans toute forge (`CI` arme `--strict` d'office), avec
   * un rapport qui écrivait « Rien à signaler parmi les 6 contrôles
   * effectués ».
   *
   * Le critère qui tranche : le contrôle a-t-il REGARDÉ et trouvé qu'il n'y
   * avait rien (sans objet), ou n'a-t-il pas pu regarder (empêché) ? « Le
   * manifeste n'a pas pu être lu » est un empêchement ; « il n'y a aucune
   * entité » ne l'est pas.
   *
   * Ce qui ne change PAS, comme pour {@link IExecution.onDemand} : la famille
   * reste affichée en « NON CONTRÔLÉ », avec sa raison et son geste. Elle
   * cesse seulement de compter comme un manquement de couverture.
   */
  notApplicable?: boolean;
}

/**
 * Les familles de contrôles de `doctor`, telles que le rapport les nomme.
 *
 * Nommées ici plutôt que dérivées d'un tableau : c'est cette clé qui voyage
 * dans le JSON, donc dans la CI et chez l'agent qui lit le rapport. Un nom de
 * famille est un contrat, pas un détail de rendu.
 */
export type DoctorFamily =
  | "freshness"
  | "readiness"
  | "envCatalog"
  /** Sous-règle de `readiness` — un `.env*.local` versionné, que seul git sait dire. */
  | "envTracked"
  | "deps"
  | "wiring"
  /** Ce qui est atteignable SANS authentification — inventaire, pas verdict. */
  | "surface"
  /** Les entités écrites pour un moteur que le connecteur n'est pas. */
  | "dialect"
  /** Les filets du projet — sont-ils seulement ARMÉS ? */
  | "guards"
  /** Étage 2 — l'état des migrations, que seule l'application démarrée sait. */
  | "migrations"
  /** Étage 2 — la cohérence des zones, née de la confrontation au boot. */
  | "firewall"
  /** Étage 2 — ce que l'environnement VISÉ fera disparaître (`--env`). */
  | "gating"
  /** Étage 3 — les scripts que le projet DÉCLARE, réellement lancés (`--deep`). */
  | "verify"
  /** Étage 3 — les paquets en retard : un CONSTAT, jamais un manquement. */
  | "outdated";

/**
 * Le nom lisible de chaque famille.
 *
 * Une table unique évite qu'un titre affiché dans le sommaire diffère de celui
 * de la section « non contrôlé » — deux libellés pour un même contrôle, et le
 * lecteur croit qu'il y en a deux.
 */
export const TITLES: Record<DoctorFamily, string> = {
  freshness: "Fraîcheur du build",
  readiness: "Prêt à démarrer",
  envCatalog: "Variables déclarées",
  envTracked: "Secrets hors de git",
  deps: "Dépendances",
  wiring: "Câblage",
  surface: "Surface ouverte",
  dialect: "Entités et dialecte",
  guards: "Gardes du projet",
  migrations: "Migrations de schéma",
  firewall: "Cohérence du firewall",
  gating: "Écart avec l'environnement visé",
  verify: "Gardes du projet, LANCÉES",
  outdated: "Paquets en retard",
};

/**
 * L'ordre de lecture des familles — celui du sommaire ET du détail.
 *
 * L'ordre n'est pas cosmétique : la fraîcheur d'abord, parce qu'un build en
 * retard rend faux tout ce qui suit ; puis ce qui empêche de démarrer, qui
 * explique souvent le reste.
 */
export const FAMILIES: readonly DoctorFamily[] = [
  "freshness",
  "readiness",
  "envCatalog",
  "envTracked",
  "deps",
  "wiring",
  "surface",
  "dialect",
  "guards",
  // L'étage 2 ferme la marche : il exige un boot, donc il n'est pas toujours
  // là — et ce qui se lit sur des fichiers doit rester en tête, parce que
  // c'est ce qui répond quand l'application ne démarre plus.
  "migrations",
  "firewall",
  "gating",
  // L'étage 3 après l'étage 2 : il LANCE des commandes, donc il coûte des
  // secondes là où tout le reste coûte des millisecondes. Ce qui est cher se
  // lit en dernier, et ne s'exécute que sur demande (`--deep`).
  "verify",
  "outdated",
];

/**
 * Les SOUS-RÈGLES de `readiness` — des contrôles à part entière, mais qui ne
 * sont pas des familles.
 *
 * Elles ont besoin de leur propre état d'exécution (leur silence peut ne rien
 * prouver : catalogue illisible, pas de dépôt git), sans quoi elles seraient
 * affichées en vert alors qu'elles n'ont rien regardé. Mais les compter comme
 * familles gonflerait le bilan de contrôles que le sommaire n'affiche pas.
 *
 * Une seule liste, dont TOUT le reste se dérive : quand la deuxième sous-règle
 * est arrivée, la condition `f !== "envCatalog"` était écrite en dur à trois
 * endroits — le compteur du bilan, le filtre du sommaire, et le dédoublonnage
 * des contrôles sautés.
 */
export const SUBRULES: readonly DoctorFamily[] = ["envCatalog", "envTracked"];

/** `true` si cette famille est une sous-règle de `readiness`. */
export function isSubrule(family: DoctorFamily): boolean {
  return SUBRULES.includes(family);
}

/**
 * Les familles qui COMPTENT dans un bilan.
 *
 * Les sous-règles en sont exclues : ce sont des RÈGLES de `readiness`, pas des
 * familles à part — les compter donnerait un total qui ne colle pas aux lignes
 * affichées. Dérivée de {@link FAMILIES} et non réécrite : la liste avait été
 * recopiée en dur dans le compteur du bilan, et une famille ajoutée n'y entrait
 * pas.
 */
export const COUNTED_FAMILIES: readonly DoctorFamily[] = FAMILIES.filter(
  (f) => !isSubrule(f),
);

/** Un contrôle qui n'a PAS eu lieu, prêt à être rendu. */
export interface ISkippedCheck {
  family: DoctorFamily;
  title: string;
  reason: string;
  unlock?: string;
  /** Non DEMANDÉ plutôt qu'empêché — ne pèse pas sur le code de sortie. */
  onDemand?: boolean;
  /** SANS OBJET plutôt qu'empêché — ne pèse pas non plus. */
  notApplicable?: boolean;
}

/**
 * Parmi les contrôles sautés, ceux qui CONDAMNENT en mode strict.
 *
 * Un contrôle EMPÊCHÉ (on n'a pas pu regarder) est un manquement de couverture.
 * Deux cas ne le sont pas, et pour la même raison : le contrôle NON DEMANDÉ
 * (l'étage 2, qui exige un démarrage) et le contrôle SANS OBJET (il a regardé,
 * il n'y avait rien — aucune entité, aucun ORM, aucun module de sécurité).
 *
 * Les confondre faisait échouer `doctor` dans toute chaîne automatisée — `CI`
 * arme `--strict` d'office. D'abord pour l'étage 2, tant qu'on n'ajoutait pas
 * un boot complet à la commande ; puis, plus grave, pour toute application
 * NEUVE, qui n'a par construction ni entité ni base.
 *
 * Une seule implémentation, parce que le RENDU et le CODE DE SORTIE doivent
 * dire la même chose : un bandeau qui annonce un échec que la commande ne
 * produit pas apprend à ne plus croire le bandeau.
 *
 * @param skipped - les contrôles sautés, tels que `controlesSautes` les rend
 * @returns ceux qui pèsent sur le code de sortie en mode strict
 */
export function preventedChecks(
  skipped: readonly ISkippedCheck[],
): ISkippedCheck[] {
  return skipped.filter((s) => !s.onDemand && !s.notApplicable);
}

/**
 * Les contrôles qui n'ont PAS eu lieu, dans l'ordre de lecture du rapport.
 *
 * Fonction pure sur l'état d'exécution : c'est elle qui alimente à la fois le
 * rendu humain, le JSON et le code de sortie en mode strict. Les trois doivent
 * dire la même chose — un rapport humain qui tait ce que le JSON porte est
 * exactement le défaut que ce contrôle vient réparer.
 *
 * @param execution - l'état d'exécution de chaque famille.
 * @returns un élément par contrôle sauté, vide si tout a été regardé.
 */
export function skippedChecks(
  execution: Record<DoctorFamily, IExecution>,
): ISkippedCheck[] {
  const skipped: ISkippedCheck[] = [];
  for (const family of FAMILIES) {
    // ⚠️ Un état ABSENT n'est pas un état « passé ». Le type l'interdit, mais un
    // rapport peut arriver d'ailleurs — un `--json` produit par une version qui
    // ne connaissait pas cette famille, relu par une version qui la connaît. Un
    // outil de DIAGNOSTIC ne doit jamais lever : c'est précisément l'outil qu'on
    // lance quand tout le reste est cassé.
    const state = execution[family] ?? {
      ran: false,
      reason:
        "ce rapport ne porte aucun état d'exécution pour cette famille — il a " +
        "probablement été produit par une autre version",
      short: "état absent",
    };
    if (state.ran) continue;
    // Une SOUS-RÈGLE de `readiness` : quand la famille entière a été sautée,
    // ses règles le sont forcément aussi, et l'annoncer une seconde fois ferait
    // compter deux angles morts là où il n'y en a qu'un. L'état brut, lui,
    // reste exact dans `execution` — c'est le RAPPORT qui dédoublonne, pas la
    // mesure.
    if (isSubrule(family) && !execution.readiness?.ran) continue;
    skipped.push({
      family,
      title: TITLES[family],
      ...(state.onDemand ? { onDemand: true } : {}),
      ...(state.notApplicable ? { notApplicable: true } : {}),
      reason: state.reason ?? "raison non précisée",
      unlock: state.unlock,
    });
  }
  return skipped;
}

/** Un manquement, tel qu'il s'affiche dans le détail. */
export interface IFindingDetail {
  /** La phrase qui dit ce qui ne va pas. */
  message: string;
  /** Le fichier concerné, s'il y en a un. */
  file?: string;
}

/**
 * La peinture du rapport, par RÔLE et non par couleur.
 *
 * Nommer `failure` plutôt que `red` laisse le choix de la teinte à un seul
 * endroit, et rend le rendu lisible sans connaître la palette. Surtout : c'est
 * une VALEUR injectée, donc un rapport se rend à l'identique sans couleur — ce
 * que le TSDoc de ce module promettait déjà sans que le code le tienne.
 */
export interface IPalette {
  /** Ce qu'on lit en premier : le nom de la commande, un titre de section. */
  strong(t: string): string;
  /** Ce qui accompagne sans réclamer l'attention : chemins, notes. */
  dim(t: string): string;
  /** Un contrôle passé. */
  ok(t: string): string;
  /** Un contrôle qui n'a pas eu lieu — ni bon ni mauvais, incomplet. */
  warning(t: string): string;
  /** Un manquement. */
  failure(t: string): string;
  /** Le geste à faire — la seule chose que cherche un lecteur pressé. */
  action(t: string): string;
}

/** Sans couleur, chaque rôle rend le texte tel quel. */
const PLAIN = (t: string): string => t;

/**
 * La peinture en vigueur pour ce rendu.
 *
 * @param color - `true` pour émettre des séquences ANSI.
 * @returns une palette : réelle, ou entièrement transparente.
 */
export function createPalette(color: boolean): IPalette {
  if (!color) {
    return {
      strong: PLAIN,
      dim: PLAIN,
      ok: PLAIN,
      warning: PLAIN,
      failure: PLAIN,
      action: PLAIN,
    };
  }
  return {
    strong: (t) => clc.bold(t),
    dim: (t) => clc.blackBright(t),
    ok: (t) => clc.green(t),
    warning: (t) => clc.yellow(t),
    failure: (t) => clc.red(t),
    action: (t) => clc.cyan(t),
  };
}

/**
 * Faut-il colorer cette sortie ?
 *
 * Un rapport de diagnostic finit souvent dans un fichier ou un journal
 * d'intégration continue, où les séquences ANSI ne colorent rien et rendent le
 * texte illisible (`[33m` partout). La convention `NO_COLOR` est respectée
 * telle qu'elle est spécifiée : c'est sa PRÉSENCE qui compte, pas sa valeur.
 *
 * @param env - l'environnement, injecté.
 * @param isTerminal - `process.stdout.isTTY`, injecté.
 * @returns `true` s'il faut émettre des couleurs.
 */
export function shouldColorize(
  env: Record<string, string | undefined>,
  isTerminal: boolean,
): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
  return isTerminal;
}

/**
 * Découpe une phrase en unités INSÉCABLES pour le repli.
 *
 * Les messages de diagnostic portent des commandes entre accents graves
 * (`` `npm run build` ``), qui contiennent des espaces. Couper dessus laisserait
 * un accent grave orphelin en fin de ligne, et le lecteur ne saurait plus où
 * commence la commande à taper.
 *
 * @param text - la phrase.
 * @returns les unités, accents graves compris.
 */
export function unbreakableUnits(text: string): string[] {
  const units: string[] = [];
  let current = "";
  let inCode = false;
  for (const c of text) {
    if (c === "`") {
      inCode = !inCode;
      current += c;
      continue;
    }
    // ⚠️ Couper sur TOUT segment entre accents graves détacherait la ponctuation
    // qui le suit : `` `@entity`, `` deviendrait deux unités, que le repli
    // rejoindrait par un espace — « `@entity` , ». Une unité s'arrête à un
    // espace, et seulement à un espace HORS accents graves.
    if (!inCode && /\s/u.test(c)) {
      if (current !== "") units.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  if (current !== "") units.push(current);
  return units;
}

/**
 * Met en valeur ce qui est entre accents graves — une commande, un chemin.
 *
 * Sans couleur, les accents graves RESTENT : ils portent eux-mêmes
 * l'information « ceci se tape tel quel », et un journal de CI en a autant
 * besoin qu'un terminal. Avec couleur, ils s'effacent au profit de la teinte —
 * deux façons de dire la même chose, jamais les deux à la fois.
 *
 * @param text - la phrase, avec ses accents graves.
 * @param palette - la peinture en vigueur.
 * @param color - `true` si la palette colore réellement.
 * @returns la phrase prête à écrire.
 */
export function highlightCode(
  text: string,
  palette: IPalette,
  color: boolean,
): string {
  if (!color) return text;
  return text.replace(/`([^`]*)`/gu, (_, code: string) => palette.strong(code));
}

/**
 * Ce dont le COMPTE a besoin d'un rapport — ses listes, et rien d'autre.
 *
 * Structural exprès : il vit ici, dans le module sans dépendance, pour que le
 * rendu ET la commande comptent par la MÊME fonction. Le contraire a été
 * mesuré — deux additions écrites à deux endroits, dont une seule mise à jour
 * en ajoutant l'étage 2 : le sommaire affichait deux échecs pendant que le
 * bilan chiffré en annonçait un seul.
 */
export interface ICountableReport {
  findings: readonly unknown[];
  wiring: { findings: readonly unknown[] };
  readiness: { findings: readonly unknown[] };
  freshness: { findings: readonly unknown[] };
  surface: { findings: readonly unknown[] };
  guards: { findings: readonly unknown[] };
  /**
   * L'étage 2. Le `kind` est le SEUL champ typé ici, parce que le compte doit
   * distinguer un manquement d'un simple constat (`service-lost`) — et que ce
   * module ne veut rien savoir d'autre de la forme des trouvailles.
   */
  live?: { findings: readonly { kind: string }[] } | undefined;
}

/**
 * Le nombre total de manquements d'un rapport — le verdict, en UN endroit.
 *
 * @param report - le rapport, étage 2 greffé ou non
 * @returns la somme de toutes les familles, l'étage 2 compris
 */
export function countFindings(report: ICountableReport): number {
  return (
    report.findings.length +
    report.wiring.findings.length +
    report.readiness.findings.length +
    report.freshness.findings.length +
    report.surface.findings.length +
    report.guards.findings.length +
    // L'étage 2 pèse comme les autres : une migration en échec n'est pas une
    // information de second rang, c'est la panne qu'on vient chercher.
    //
    // 🔴 SAUF `service-lost`, qui n'est pas un manquement. Qu'un module
    // `policy: "dev"` — et le service qu'il porte — disparaisse en production
    // est sa RAISON D'ÊTRE. Ce contrôle ne sait pas distinguer la perte voulue
    // de celle qui casse : il faudrait pouvoir déclarer qu'un service est
    // requis là-bas, et rien ne le permet. Il informait donc en accusant, et
    // `doctor --env production` sortait en 1 sur une application saine.
    (report.live?.findings.filter((f) => f.kind !== "service-lost").length ?? 0)
  );
}

/** Bornes de largeur : en deçà ça se chevauche, au-delà l'œil se perd. */
const WIDTH_MIN = 48;
const WIDTH_MAX = 96;

/**
 * La largeur de rendu, bornée.
 *
 * @param columns - largeur annoncée par le terminal, ou `undefined` quand la
 *   sortie n'en est pas un (redirection, journal de CI).
 * @returns une largeur toujours utilisable.
 */
export function usableWidth(columns: number | undefined): number {
  if (!columns || !Number.isFinite(columns)) return 80;
  return Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, Math.floor(columns)));
}

/** Le symbole d'un état — la seule chose qui reste quand la couleur est ôtée. */
export function stateSymbol(state: SectionState): string {
  switch (state) {
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
 * @param line - la famille à rendre.
 * @param titleWidth - largeur de la colonne des titres.
 * @param width - largeur totale disponible.
 * @returns la ligne, sans retour chariot ni couleur.
 */
export function summaryLine(
  line: ISummaryLine,
  titleWidth: number,
  width: number,
): string {
  const prefixe = `    ${stateSymbol(line.state)}  ${line.title} `;
  // Les points de conduite mènent l'œil du titre à son détail. Sur une ligne
  // courte ils ne servent à rien ; sur un terminal large, sans eux, le regard
  // saute d'une ligne à l'autre et l'on lit le détail de la mauvaise famille.
  // +3 : même le titre le PLUS long garde des points de conduite, sinon sa
  // ligne est la seule sans guide et l'œil la lit comme une autre section.
  const detailColumn = 4 + 1 + 2 + titleWidth + 3;
  const conduite =
    detailColumn > prefixe.length
      ? `${POINT_DE_CONDUITE.repeat(detailColumn - prefixe.length - 1)} `
      : "";
  const debut = prefixe + conduite;
  const remainder = width - debut.length;
  const detail =
    remainder > 3 && line.detail.length > remainder
      ? `${line.detail.slice(0, remainder - 1)}…`
      : line.detail;
  return `${debut}${detail}`.trimEnd();
}

/** Le point qui relie un titre à son détail dans le sommaire. */
const POINT_DE_CONDUITE = "·";

/**
 * Un titre de section, prolongé par un filet jusqu'au bord.
 *
 * Le rendu séparait ses sections par un filet PLEIN, posé sur sa propre ligne
 * au-dessus du titre : trois lignes de décor pour annoncer une section, et le
 * titre y flottait sans lui appartenir. Prolonger le titre coûte une ligne au
 * lieu de trois, et dit à quoi le filet se rapporte.
 *
 * @param title - le titre, déjà en majuscules.
 * @param width - largeur utile.
 * @returns la ligne, sans couleur (l'appelant teinte le titre et le filet).
 */
export function sectionTitle(
  title: string,
  width: number,
): { title: string; divider: string } {
  const pose = `  ${title} `;
  const remaining = Math.max(0, width - pose.length - 2);
  return { title: `  ${title} `, divider: "─".repeat(remaining) };
}

/**
 * Enveloppe un texte à la largeur donnée, en coupant aux espaces.
 *
 * Un message de diagnostic porte une phrase entière — chemin, cause, geste.
 * Laissée au terminal, elle se replie sans indentation et le geste se retrouve
 * collé à la marge, illisible au milieu du reste.
 *
 * @param text - la phrase à replier.
 * @param width - largeur maximale d'une ligne, indentation comprise.
 * @param indent - le blanc posé devant chaque ligne.
 * @returns les lignes, prêtes à être écrites.
 */
export function wrap(text: string, width: number, indent: string): string[] {
  const usable = Math.max(20, width - indent.length);
  const lines: string[] = [];
  let current = "";
  for (const word of unbreakableUnits(text)) {
    if (current === "") {
      current = word;
    } else if (current.length + 1 + word.length <= usable) {
      current += ` ${word}`;
    } else {
      lines.push(indent + current);
      current = word;
    }
  }
  if (current !== "") lines.push(indent + current);
  return lines;
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
export function splitAction(message: string): {
  finding: string;
  action?: string;
} {
  const i = message.lastIndexOf("→");
  if (i === -1) return { finding: message.trim() };
  const action = message.slice(i + 1).trim();
  const finding = message
    .slice(0, i)
    .trim()
    .replace(/[.,;:]$/u, "");
  return action === ""
    ? { finding: message.trim() }
    : { finding: finding, action: action };
}

/** Un filet horizontal, pour séparer le sommaire du détail. */
export function divider(width: number): string {
  return `  ${"─".repeat(Math.max(10, width - 4))}`;
}

/**
 * Une durée en secondes, rendue lisible.
 *
 * « plus récent de 6359 s » demande un calcul mental au moment où le lecteur
 * en a le moins envie. Ce n'est pas une précision qu'on perd : personne ne
 * décide rien sur la seconde près à cette échelle.
 *
 * @param seconds - l'écart mesuré.
 * @returns « 12 s », « 4 min », « 1 h 46 », « 3 j ».
 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s} s`;
  const minutes = Math.round(s / 60);
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.floor(s / 3600);
  if (hours < 48) {
    const remainder = Math.round((s % 3600) / 60);
    return remainder === 0
      ? `${hours} h`
      : `${hours} h ${String(remainder).padStart(2, "0")}`;
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
 * @param singular - la forme au singulier.
 * @param plural - la forme au pluriel, si elle ne s'obtient pas par un « s ».
 * @returns « 3 écarts ».
 */
export function pluralize(
  n: number,
  singular: string,
  plural?: string,
): string {
  const word = n > 1 ? (plural ?? `${singular}s`) : singular;
  return `${n} ${word}`;
}

/**
 * Replie une énumération par UNITÉS, jamais au milieu d'un élément.
 *
 * 🔴 Un repli aux espaces met le séparateur en tête de ligne : `\s` avale
 * l'espace insécable qui entoure le point médian, et la ligne suivante commence
 * par « · ». Cette fonction ne coupe qu'ENTRE deux éléments.
 *
 * @param items - les éléments à énumérer.
 * @param width - largeur utile d'une ligne.
 * @returns les lignes, séparateur « · » compris.
 */
export function wrapList(items: readonly string[], width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const item of items) {
    const attempt = current ? `${current} · ${item}` : item;
    if (attempt.length <= width || !current) {
      current = attempt;
      continue;
    }
    lines.push(current);
    current = item;
  }
  if (current) lines.push(current);
  return lines;
}
