/**
 * L'aide de `nodefony` telle qu'un HUMAIN — et un agent — la lisent : rendu PUR.
 *
 * Ce module ne connaît ni le terminal, ni commander : la largeur, les couleurs
 * et les commandes lui sont DONNÉES, et il rend des lignes. Deux raisons, et la
 * seconde est la vraie.
 *
 * 1. Il devient éprouvable ailleurs que dans le terminal où il tourne — donc en
 *    intégration continue, où il n'y en a pas.
 * 2. L'aide de commander groupe par ORIGINE du code (« Commands: », « Module
 *    drizzle »). C'est le seul axe qu'un programme sache dériver seul, et c'est
 *    pourquoi il existe — pas parce qu'il sert. Personne ne demande « qu'offre
 *    le module http ? » : on demande comment LANCER, ce qui CLOCHE, comment
 *    faire ÉVOLUER. L'humain balaie des titres, l'agent projette une intention
 *    sur une commande : c'est le même geste, donc un seul axe — et surtout pas
 *    une section « pour agent » en fin de page, qui dupliquerait les commandes
 *    en disant à l'humain que ceci n'est pas pour lui.
 *
 * @module
 */
import {
  createPalette,
  wrap,
  wrapList,
  sectionTitle,
  type IPalette,
} from "../kernel/checks/report";

/**
 * Les groupes d'intention, dans l'ordre de la JOURNÉE de travail.
 *
 * On lance, on regarde ce qui cloche, on fait évoluer — puis viennent les
 * domaines (base, comptes, front) et l'outillage. L'ordre est le contenu : il
 * répond avant qu'on ait lu les titres.
 */
export const HELP_GROUPS: readonly string[] = [
  "LANCER",
  "COMPRENDRE",
  "GÉNÉRER ET CONSTRUIRE",
  "BASE DE DONNÉES",
  "COMPTES ET SECRETS",
  "FRONT ET RÉSEAU",
  "AGENTS ET OUTILLAGE",
];

/**
 * Le libellé de chaque intention DANS LE MENU interactif.
 *
 * 🔴 Une seule taxonomie, deux rendus. Le menu s'adresse à quelqu'un qui hésite
 * (phrase, minuscules) et l'aide à quelqu'un qui balaie (titre, capitales) : les
 * libellés diffèrent, le CLASSEMENT non. Écrits séparément, ils divergeaient
 * déjà — une commande rangée sous « Comprendre » au menu et ailleurs dans
 * l'aide apprend au lecteur à ne se fier ni à l'un ni à l'autre.
 */
export const MENU_GROUP_LABELS: Record<string, string> = {
  LANCER: "Serveur",
  COMPRENDRE: "Comprendre",
  "GÉNÉRER ET CONSTRUIRE": "Faire évoluer",
  "BASE DE DONNÉES": "Base de données",
  "COMPTES ET SECRETS": "Comptes et secrets",
  "FRONT ET RÉSEAU": "Front et réseau",
  "AGENTS ET OUTILLAGE": "Outillage",
};

/**
 * L'ordre à l'intérieur d'un groupe, quand il ne doit rien au hasard.
 *
 * Dans COMPRENDRE, c'est l'ordre de la DÉCOUVERTE : la carte de visite dit où
 * l'on est, le diagnostic ce qui cloche, l'inspection ce qui tourne. Trier par
 * ordre alphabétique y mettrait `card` après `env` et ferait commencer par un
 * détail. Une commande absente de cette table passe après, par ordre
 * alphabétique — un module tiers ne peut pas être classé par nous.
 */
const ORDRE_DANS_GROUPE: Record<string, readonly string[]> = {
  LANCER: ["development", "production", "cluster", "status", "stop"],
  COMPRENDRE: ["card", "doctor", "inspect", "env", "symbols"],
  "GÉNÉRER ET CONSTRUIRE": ["create", "build", "install", "outdated"],
};

/** Une commande, réduite à ce que l'aide doit en dire. */
export interface IHelpCommand {
  /** Le nom principal, tel qu'on le tape. */
  name: string;
  /** Ses alias, s'il en a — ils n'existent que si l'aide les montre. */
  aliases: readonly string[];
  /** Ce qu'elle fait, en une phrase. */
  description: string;
  /** Le groupe d'intention déclaré par la commande. */
  group?: string;
  /** Le module qui la porte, quand elle n'est pas intégrée. */
  module?: string;
  /**
   * Ce que la commande ACCEPTE, rendu sous elle en sous-ligne.
   *
   * DÉRIVÉ des `choices()` de commander, jamais réécrit : c'est ce qu'un agent
   * cherche (« quels sujets sait-il inspecter ? ») et ce qu'un humain devine
   * mal. Une liste recopiée ici divergerait au premier sujet ajouté.
   */
  accepts?: { label: string; values: readonly string[] };
}

/** Une option globale, telle que l'aide la montre. */
export interface IHelpOption {
  /** Les drapeaux, déjà composés (`-d, --debug`). */
  flags: string;
  description: string;
}

/** Tout ce que le rendu a besoin de savoir — et rien d'autre. */
export interface IHelpModel {
  /** La version affichée en tête, sans le `v`. */
  version: string;
  commands: readonly IHelpCommand[];
  globalOptions: readonly IHelpOption[];
  /** Les modules chargés, s'il y en a — absent hors d'une application. */
  modules?: readonly string[];
  /**
   * Ce que l'aide doit DIRE de la situation, quand elle n'est pas nominale :
   * hors d'une application, ou dans une application non installée.
   */
  note?: string;
  /** Le geste qui suit cette note (une commande à taper). */
  noteAction?: string;
  /** Les commandes qui répondent en JSON — la phrase de pied pour un agent. */
  jsonCommands?: readonly string[];
}

/** Le décor du rendu — tout ce que ce module refuse d'aller chercher. */
export interface IHelpRenderOptions {
  /** Largeur utile, déjà bornée. */
  largeur: number;
  /** `true` pour émettre des séquences ANSI. */
  couleur: boolean;
}

/**
 * Largeur maximale de la colonne des noms.
 *
 * 🔴 Plafonnée, et c'est tout l'écart avec commander : une seule commande
 * longue (`test-frontend-angular:build`) élargissait la colonne pour les
 * trente-huit autres, et l'aide devenait un mur de blanc. Au-delà, la
 * description passe SOUS le nom — un cas isolé ne coûte plus qu'à lui-même.
 */
const COLONNE_MAX = 24;

/** L'indentation d'une commande, sous le titre de son groupe. */
const ITEM = "    ";

/**
 * La place qui reste pour une description, une fois la colonne des noms posée.
 *
 * 🔴 Exportée pour qu'un GATE puisse s'y adosser au lieu de recopier le calcul.
 * La contrainte « une description tient sur une ligne » ne vaut que rapportée à
 * la colonne du moment, et celle-ci se DÉRIVE des commandes présentes : une
 * borne écrite en dur dans un test deviendrait fausse le jour où un nom plus
 * long élargit la colonne — le test resterait vert pendant que la page se
 * replie.
 *
 * @param commands - les commandes qui composent la page.
 * @param width - la largeur utile du terminal.
 * @returns le nombre de colonnes offertes à une description sur sa première ligne.
 */
export function descriptionWidth(
  commands: readonly IHelpCommand[],
  width: number,
): number {
  return width - ITEM.length - nameColumnWidth(commands) - 2;
}

/**
 * La largeur de la colonne des noms — UNE seule pour toute la page.
 *
 * Deux largeurs différentes selon le groupe feraient sauter l'œil d'un bloc à
 * l'autre. Les noms qui dépassent {@link COLONNE_MAX} sont écartés du calcul :
 * ils prennent leur propre ligne, et ne coûtent donc qu'à eux-mêmes.
 *
 * @param commands - les commandes qui composent la page.
 * @returns la largeur de la colonne de gauche.
 */
function nameColumnWidth(commands: readonly IHelpCommand[]): number {
  return Math.min(
    COLONNE_MAX,
    Math.max(
      0,
      ...commands
        .map((c) => nomAffiche(c).length)
        .filter((n) => n <= COLONNE_MAX),
    ),
  );
}

/**
 * Le nom d'une commande avec ses alias, tel qu'il se tape.
 *
 * @param cmd - la commande.
 * @returns `doctor|check`, ou le nom seul.
 */
function nomAffiche(cmd: IHelpCommand): string {
  return cmd.aliases.length ? `${cmd.name}|${cmd.aliases.join("|")}` : cmd.name;
}

/**
 * Range les commandes par groupe, dans l'ordre d'affichage.
 *
 * Les commandes sans groupe connu tombent sous leur MODULE — ce qui reste vrai
 * pour un module tiers, dont personne ici ne peut deviner l'intention. Sans
 * module ni groupe, elles ferment la marche sous « AUTRES ».
 *
 * @param commands - toutes les commandes connues.
 * @returns les groupes non vides, dans l'ordre de lecture.
 */
export function grouperCommandes(
  commands: readonly IHelpCommand[],
): { titre: string; commandes: IHelpCommand[] }[] {
  const par = new Map<string, IHelpCommand[]>();
  const ajouter = (titre: string, cmd: IHelpCommand): void => {
    const liste = par.get(titre);
    if (liste) liste.push(cmd);
    else par.set(titre, [cmd]);
  };
  for (const cmd of commands) {
    if (cmd.group && HELP_GROUPS.includes(cmd.group)) ajouter(cmd.group, cmd);
    else if (cmd.module) ajouter(`MODULE ${cmd.module.toUpperCase()}`, cmd);
    else ajouter("AUTRES", cmd);
  }

  const rang = (titre: string, cmd: IHelpCommand): number => {
    const ordre = ORDRE_DANS_GROUPE[titre];
    if (!ordre) return Number.POSITIVE_INFINITY;
    const at = ordre.indexOf(cmd.name);
    return at === -1 ? Number.POSITIVE_INFINITY : at;
  };
  const trier = (titre: string, liste: IHelpCommand[]): IHelpCommand[] =>
    [...liste].sort((a, b) => {
      const ra = rang(titre, a);
      const rb = rang(titre, b);
      return ra === rb ? a.name.localeCompare(b.name) : ra - rb;
    });

  const sortie: { titre: string; commandes: IHelpCommand[] }[] = [];
  // Les groupes d'intention d'abord, dans l'ordre déclaré — jamais celui de
  // première rencontre, qui est ce que commander applique et qui dépend donc de
  // l'ordre d'ENREGISTREMENT des commandes.
  for (const titre of HELP_GROUPS) {
    const liste = par.get(titre);
    if (liste) sortie.push({ titre, commandes: trier(titre, liste) });
  }
  const modules = [...par.keys()]
    .filter((t) => t.startsWith("MODULE "))
    .sort((a, b) => a.localeCompare(b));
  for (const titre of modules) {
    sortie.push({ titre, commandes: trier(titre, par.get(titre) ?? []) });
  }
  const autres = par.get("AUTRES");
  if (autres)
    sortie.push({ titre: "AUTRES", commandes: trier("AUTRES", autres) });
  return sortie;
}

/**
 * Une entrée à deux colonnes, qui ne déborde jamais.
 *
 * @param terme - la colonne de gauche (nom, drapeaux).
 * @param texte - la colonne de droite.
 * @param colonne - largeur de la colonne de gauche.
 * @param largeur - largeur utile.
 * @param p - la peinture.
 * @param teinte - le rôle de peinture de la colonne de gauche.
 * @returns une ou plusieurs lignes.
 */
function entree(
  terme: string,
  texte: string,
  colonne: number,
  largeur: number,
  p: IPalette,
  teinte: (t: string) => string,
  accepts?: { label: string; values: readonly string[] },
): string[] {
  // Un mot ne se coupe JAMAIS — un nom de commande coupé en deux ne se cherche
  // plus. S'il ne tient pas dans la colonne de droite, c'est l'INDENTATION qui
  // cède : la description repart sous le nom, à la marge minimale.
  const plusLongMot = Math.max(0, ...texte.split(" ").map((m) => m.length));
  const alignee = `${ITEM}${" ".repeat(colonne + 2)}`;
  const marge = largeur - alignee.length >= plusLongMot ? alignee : `${ITEM}  `;
  // Un terme plus long que la colonne prend sa ligne : la description suit
  // dessous. C'est le cas isolé qui paie son coût, pas toute la page.
  const lignes: string[] = [];
  if (terme.length > colonne) {
    lignes.push(`${ITEM}${teinte(terme)}`);
    for (const l of wrap(texte, largeur - marge.length, "")) {
      lignes.push(marge + p.dim(l));
    }
  } else {
    const pad = " ".repeat(colonne - terme.length);
    const [premiere, ...suite] = wrap(texte, largeur - marge.length, "");
    lignes.push(`${ITEM}${teinte(terme)}${pad}  ${p.dim(premiere ?? "")}`);
    for (const l of suite) lignes.push(marge + p.dim(l));
  }
  if (accepts?.values.length) {
    lignes.push(...valeurs(accepts, marge, largeur, p));
  }
  return lignes;
}

/**
 * Ce qu'une commande ACCEPTE, aligné SOUS sa description.
 *
 * 🔴 Aligné sous la description, jamais rejeté à gauche derrière une flèche :
 * l'œil suit une colonne, et une puce exotique à mi-hauteur casse précisément
 * celle qu'il vient d'établir. Les valeurs se lisent alors comme la suite de la
 * phrase — ce qu'elles sont —, et leur continuation s'aligne sous la première
 * valeur plutôt que sous le libellé.
 *
 * @param accepts - le libellé de l'argument et ses valeurs.
 * @param marge - l'indentation de la description.
 * @param largeur - largeur utile.
 * @param p - la peinture.
 * @returns les lignes de l'énumération.
 */
function valeurs(
  accepts: { label: string; values: readonly string[] },
  marge: string,
  largeur: number,
  p: IPalette,
): string[] {
  const prefixe = `${accepts.label} : `;
  const dispo = largeur - marge.length - prefixe.length;
  // Trop étroit pour aligner sous le libellé : l'énumération repart à la marge,
  // sur ses propres lignes. Une valeur coupée en deux ne se cherche plus.
  if (dispo < 12) {
    const sortie = [marge + p.dim(prefixe.trimEnd())];
    for (const l of wrapList([...accepts.values], largeur - marge.length)) {
      sortie.push(marge + p.dim(l));
    }
    return sortie;
  }
  return wrapList([...accepts.values], dispo).map((l, i) =>
    i === 0
      ? marge + p.dim(prefixe + l)
      : marge + " ".repeat(prefixe.length) + p.dim(l),
  );
}

/**
 * L'aide complète, ligne par ligne, sans retour chariot final.
 *
 * @param model - ce qu'il y a à dire.
 * @param opts - le décor (largeur, couleur).
 * @returns les lignes à écrire, dans l'ordre.
 */
export function renderHelp(
  model: IHelpModel,
  opts: IHelpRenderOptions,
): string[] {
  const { largeur, couleur } = opts;
  const p = createPalette(couleur);
  const lignes: string[] = [];

  // L'en-tête tient sur UNE ligne quand la largeur le permet, sinon la
  // baseline passe dessous. Elle faisait 73 colonnes : sur un terminal étroit
  // — celui d'un conteneur, d'une CI, d'un panneau latéral — la première ligne
  // de l'aide était déjà celle qui cassait.
  const marque = `⬢ Nodefony${model.version ? ` v${model.version}` : ""}`;
  const baseline = "framework fullstack Node.js — HTTP · WS · ORM · IA";
  const peint = `  ${p.strong("⬢ Nodefony")}${
    model.version ? ` ${p.dim(`v${model.version}`)}` : ""
  }`;
  if (`  ${marque}   ${baseline}`.length <= largeur) {
    lignes.push(`${peint}   ${p.dim(baseline)}`);
  } else if (`  ${baseline}`.length <= largeur) {
    // Sur sa propre ligne. Elle n'est JAMAIS repliée : elle énumère avec des
    // points médians, et un repli aux espaces en mettrait un en tête de ligne.
    lignes.push(peint, `  ${p.dim(baseline)}`);
  } else {
    // Trop étroit même pour elle : c'est de l'ornement, il cède la place.
    lignes.push(peint);
  }
  lignes.push("");
  for (const [terme, valeur] of [
    ["usage :", "nodefony <commande> [options]"],
    ["aide d'une commande :", "nodefony <commande> --help"],
  ] as const) {
    const une = `  ${terme} ${valeur}`;
    lignes.push(
      une.length <= largeur
        ? `  ${p.dim(terme)} ${valeur}`
        : `  ${p.dim(terme)}`,
    );
    if (une.length > largeur) lignes.push(`    ${valeur}`);
  }

  const groupes = grouperCommandes(model.commands);
  const colonne = nameColumnWidth(model.commands);

  const section = (titre: string): void => {
    const { title: t, divider: filet } = sectionTitle(titre, largeur);
    lignes.push("", p.strong(t) + p.dim(filet), "");
  };

  for (const groupe of groupes) {
    section(groupe.titre);
    for (const cmd of groupe.commandes) {
      // Ce que la commande accepte est rendu PAR `entree`, sous la description :
      // là où le lecteur rencontre la commande, jamais dans une section
      // séparée réservée aux agents.
      lignes.push(
        ...entree(
          nomAffiche(cmd),
          cmd.description,
          colonne,
          largeur,
          p,
          p.action,
          cmd.accepts,
        ),
      );
    }
  }

  if (model.globalOptions.length > 0) {
    section("OPTIONS GLOBALES");
    const colOpt = Math.min(
      COLONNE_MAX,
      Math.max(0, ...model.globalOptions.map((o) => o.flags.length)),
    );
    for (const opt of model.globalOptions) {
      lignes.push(
        ...entree(opt.flags, opt.description, colOpt, largeur, p, p.strong),
      );
    }
  }

  if (model.modules && model.modules.length > 0) {
    lignes.push(
      "",
      `  ${p.strong(`Modules chargés (${model.modules.length})`)}`,
    );
    for (const l of wrapList([...model.modules], largeur - 2)) {
      lignes.push(`  ${p.dim(l)}`);
    }
  }

  if (model.note) {
    lignes.push("");
    for (const l of wrap(model.note, largeur - 4, "")) {
      lignes.push(`  ${p.warning("!")} ${p.dim(l)}`);
    }
    if (model.noteAction) {
      lignes.push(
        `  ${p.dim("Pour commencer :")} ${p.action(model.noteAction)}`,
      );
    }
  }

  if (model.jsonCommands && model.jsonCommands.length > 0) {
    lignes.push("");
    const prefixe = "  Réponse machine (--json) :";
    // Le libellé et la liste ne partagent une ligne QUE si la liste y tient.
    // Alignée sous un préfixe de 28 colonnes, elle débordait sur un terminal
    // étroit — et la première chose qu'un agent lit était cassée.
    const dispo = largeur - prefixe.length - 1;
    const plies = wrapList([...model.jsonCommands], Math.max(dispo, 1));
    const large = plies.every((l) => l.length <= dispo);
    if (large) {
      for (const [i, l] of plies.entries()) {
        lignes.push(
          i === 0
            ? `${p.dim(prefixe)} ${p.dim(l)}`
            : `${" ".repeat(prefixe.length + 1)}${p.dim(l)}`,
        );
      }
    } else {
      lignes.push(p.dim(prefixe));
      for (const l of wrapList([...model.jsonCommands], largeur - 4)) {
        lignes.push(`    ${p.dim(l)}`);
      }
    }
  }

  // Le pied nomme les DEUX portes de documentation, et la page de manuel
  // d'abord : elle est hors ligne, déjà installée avec le paquet, et personne
  // ne devine qu'elle existe.
  lignes.push("");
  for (const [terme, valeur] of [
    ["Manuel :", "man nodefony"],
    ["Docs :", "nodefony.github.io/nodefony-core"],
  ] as const) {
    lignes.push(`  ${p.dim(terme)} ${valeur}`);
  }
  return lignes;
}
