/**
 * L'aide de `nodefony create` — UNE page par type, dérivée de la spec.
 *
 * **Pourquoi une page par type.** `create app --help` rendait la page de
 * `create` en entier : sept types, soixante-dix-sept lignes, dont six septièmes
 * ne concernent pas la demande. C'est l'aide de la toute première commande
 * qu'on tape, et c'était la plus pauvre du CLI — quatre lignes de syntaxe
 * abrégée, aucun exemple complet, rien sur ce que la commande ÉCRIT.
 *
 * **Pourquoi dériver plutôt que rédiger.** Les drapeaux, leurs valeurs permises
 * et leurs défauts sont DÉJÀ déclarés par la spec du scaffold, qui sert aussi
 * le dialogue, Studio et `--describe-json`. Les recopier ici en ferait une
 * seconde source, et deux copies d'une même règle divergent en silence : un
 * moteur frontend ajouté à `spec.ts` serait absent de l'aide, sans un mot.
 * Ce module ne rédige donc que ce que la spec ne peut PAS dire — ce que le type
 * produit, et à quoi il sert.
 *
 * **La forme suit `man-pages(7)`**, comme toutes les pages du CLI : ce que ça
 * fait, comment on l'appelle, ce que ça écrit, les options, des exemples, les
 * codes de sortie. Le socle est {@link IUsagePage} ; il n'y a rien de propre
 * ici, et c'est voulu.
 *
 * @module
 */
import { getScaffoldSpec, flagFor, type IScaffoldQuestion } from "./spec";
import type { IUsageEntry, IUsagePage, IUsageSection } from "../usageReport";

/** Les types que `nodefony create` sait engendrer. */
export type TScaffoldType =
  "app" | "module" | "controller" | "service" | "front" | "entity" | "command";

/**
 * Ce qu'un type de scaffold est, et ce qu'il laisse sur le disque.
 *
 * La liste exacte des fichiers n'est PAS ici : `--dry-run` la rend, à jour par
 * construction. Une liste recopiée serait fausse au premier gabarit ajouté, et
 * c'est précisément le défaut que ce module existe pour ne pas reproduire.
 */
interface ITypeDoc {
  /** Ce que ça fait, en une ligne. */
  tagline: string;
  /** Les formes d'appel, `nodefony` compris. */
  synopsis: readonly string[];
  /** Ce que la commande produit — en intentions, jamais en liste de fichiers. */
  writes: readonly string[];
  /** Ce qu'il faut savoir avant d'appeler : où, dans quel état, avec quoi. */
  before?: string;
  /** Des exemples COMPLETS, copiables tels quels. */
  examples: readonly IUsageEntry[];
  /** Une section libre propre au type, insérée avant les options. */
  extra?: IUsageSection;
}

/**
 * Le vocabulaire de champs d'une entité — la seule grammaire que la spec ne
 * déclare pas, parce qu'elle vit dans les POSITIONNELS et non dans une option.
 */
const ENTITY_FIELDS: IUsageSection = {
  title: "LA GRAMMAIRE DES CHAMPS",
  lines: [
    "  nom:type[?|!][:index]        `?` facultatif · `!` requis · `:index` indexé",
    "  types  string(n) text int float bool json date uuid char(n) decimal(p,s)",
    "  liens  ref:<Entité>          une clé étrangère vers une autre entité",
    "  enum   status:enum(draft,published)",
    "  défaut views:int=0",
  ],
};

/**
 * Ce qui distingue chaque type — rédigé, parce qu'aucune spec ne le porte.
 *
 * 🔴 Ce qu'on n'écrit PAS ici : les drapeaux, leurs valeurs et leurs défauts.
 * Ils sont dérivés (cf {@link optionsFor}) ; les redire créerait la seconde
 * copie que ce module existe pour éviter.
 */
const TYPE_DOC: Record<TScaffoldType, ITypeDoc> = {
  app: {
    tagline:
      "engendre une application Nodefony complète, prête à démarrer — " +
      "hors de tout projet existant",
    synopsis: [
      "nodefony create app <nom> [options]",
      "nodefony create app <nom> --preset minimal --no-install",
    ],
    writes: [
      "le squelette d'une application autonome : manifeste de configuration, " +
        "catalogue des variables d'environnement, entrée du serveur, et son " +
        "outillage npm (build, tests, format, contrôles).",
      "en préréglage complet : la base de données et son ORM, la sécurité et " +
        "ses comptes, le temps réel, la console d'administration, l'infra " +
        "docker de développement et des tests de bout en bout.",
      "les instructions d'agent (`AGENTS.md`) et les pointeurs de skills — " +
        "puis, si des agents sont demandés, la déclaration de la porte MCP " +
        "(`.mcp.json`) chez chacun d'eux, par SA ligne de commande.",
      "le jeton d'accès à cette porte, quand l'application a pu être " +
        "installée et construite — son émission démarre l'application, donc " +
        "elle exige une base joignable. Sinon la commande le DIT, et le geste " +
        "reste `nodefony ai:mcp` puis `nodefony security:token --write`.",
      "la migration initiale du schéma, écrite ET appliquée, quand " +
        "l'installation et la construction ont pu avoir lieu.",
    ],
    before:
      "À lancer HORS d'un projet Nodefony : la commande crée son dossier. " +
      "Le dossier cible doit être vide, ou `--force`. L'installation des " +
      "dépendances et la première construction font partie de la génération — " +
      "`--no-install` les saute, et la migration initiale avec elles.",
    examples: [
      {
        term: "nodefony create app mon-app",
        text: "le préréglage complet, sqlite, aucun front — et ça démarre",
      },
      {
        term: "nodefony create app boutique --frontend vue --database postgres",
        text: "un front Vue 3 et un service PostgreSQL dans le compose docker",
      },
      {
        term: "nodefony create app api --preset minimal --no-install",
        text: "http et framework seuls, sans toucher au réseau",
      },
      {
        term: "nodefony create app demo --agents claude,cursor",
        text: "câble en plus la configuration de ces deux agents",
      },
      {
        term: "nodefony create app essai --dry-run",
        text: "le plan exact des fichiers, sans rien écrire",
      },
    ],
  },
  module: {
    tagline:
      "engendre un module dans une application existante — l'unité " +
      "fonctionnelle du framework, avec son espace de configuration",
    synopsis: ["nodefony create module <nom> [options]"],
    writes: [
      "un espace de travail `modules/<nom>` : sa classe de module, sa " +
        "configuration, son manifeste npm, et son inscription dans " +
        "l'application.",
      "selon les options : un controller, un service, et un front avec son " +
        "entrée Vite.",
    ],
    before:
      "À lancer DANS une application Nodefony. Le module est ajouté au " +
      "manifeste de l'application, et ses instructions d'agent régénérées.",
    examples: [
      {
        term: "nodefony create module blog --controller rest",
        text: "un module avec un controller REST et son service",
      },
      {
        term: 'nodefony create module paiement --no-service --description "TPE"',
        text: "un module nu, sans service",
      },
    ],
  },
  controller: {
    tagline:
      "engendre un controller et ses routes dans l'application ou un module",
    synopsis: ["nodefony create controller <Nom> [options]"],
    writes: [
      "une classe de controller décorée, ses routes, et le test qui les " +
        "interroge par HTTP réel.",
      "avec `--role` : l'habilitation de classe ET sa déclaration dans la " +
        "hiérarchie des rôles — l'administrateur en hérite sans qu'on ait à " +
        "la lui attribuer.",
    ],
    before: "À lancer DANS une application Nodefony.",
    examples: [
      {
        term: "nodefony create controller Facture --kind rest --route /api/factures",
        text: "un CRUD REST monté sur ce préfixe",
      },
      {
        term: "nodefony create controller Admin --role ROLE_COMPTA",
        text: "tout le controller réservé à cette habilitation",
      },
    ],
  },
  service: {
    tagline:
      "engendre un service injectable — la logique réutilisable, hors de " +
      "tout controller",
    synopsis: ["nodefony create service <Nom> [options]"],
    writes: [
      "une classe `@injectable` commentée, sans dépendance à un fichier de " +
        "configuration — écrite pour être imitée.",
      "avec `--entity` : le service est branché sur une entité par le patron " +
        "du framework (service CRUD abstrait + repository au constructeur), " +
        "pas par un registre tenu à la main.",
      "avec `--inject` : la dépendance est déclarée au CONSTRUCTEUR, jamais " +
        "récupérée depuis le conteneur au moment de s'en servir.",
    ],
    before: "À lancer DANS une application Nodefony.",
    examples: [
      {
        term: "nodefony create service Facturation --entity Facture",
        text: "lecture et écriture d'une entité par le patron du framework",
      },
      {
        term: "nodefony create service Relance --inject Facturation",
        text: "un service qui en consomme un autre, par injection",
      },
    ],
  },
  front: {
    tagline:
      "ajoute un front (et son entrée Vite) à une application ou un module " +
      "déjà générés",
    synopsis: ["nodefony create front [nom] --frontend <moteur> [options]"],
    writes: [
      "une entrée Vite, sa page et son montage — plus le câblage du service " +
        "frontend qui la sert en développement comme en production.",
      "le code métier ne dépend pas du moteur : la façade cliente est la même " +
        "d'un moteur à l'autre.",
    ],
    before:
      "À lancer DANS une application Nodefony. Plusieurs fronts peuvent " +
      "cohabiter — un par module, ou plusieurs dans la même application.",
    examples: [
      {
        term: "nodefony create front --frontend react --route /tableau",
        text: "un front React 19 monté sur cette route",
      },
      {
        term: "nodefony create front admin --frontend svelte --module blog",
        text: "un front Svelte 5 dans le module `blog`",
      },
    ],
  },
  entity: {
    tagline:
      "engendre une entité et sa ressource complète — repository, service, " +
      "controller et tests",
    synopsis: [
      "nodefony create entity <Nom> [champ…] [options]",
      'nodefony create entity <Nom> --fields "titre:string! vues:int"',
    ],
    writes: [
      "l'entité décorée et son repository, un service CRUD, un controller " +
        "REST et les tests qui l'interrogent par HTTP réel.",
      "l'entité seule avec `--no-service`, `--no-controller`, `--no-tests`.",
      "⚠️ elle n'écrit AUCUNE migration : le schéma appartient aux migrations, " +
        "et c'est `nodefony orm:generate` puis `orm:migrate` qui l'appliquent.",
    ],
    before:
      "À lancer DANS une application Nodefony qui déclare un ORM. Les champs " +
      "se donnent en positionnels, façon Rails ; `--fields` reste possible " +
      "pour un appel programmatique, et les positionnels l'emportent.",
    examples: [
      {
        term: "nodefony create entity Post titre:string! contenu:text vues:int",
        text: "une ressource REST complète, avec ses tests",
      },
      {
        term: "nodefony create entity Commande client:ref:User total:decimal(10,2)",
        text: "une clé étrangère et un décimal exact",
      },
      {
        term: 'nodefony create entity Event siteId:uuid path:string --index "siteId,path"',
        text: "un index composite — répétable, un par index",
      },
      {
        // ⚠️ Un exemple se COPIE : il ne se replie pas. Celui-ci s'arrête donc
        // à deux réglages, et le troisième (`--id-name`) est dans les options.
        term: "nodefony create entity Website nom:string --table website",
        text:
          "épouser une table EXISTANTE — avec `--column-case` et `--id-name` " +
          "pour son nommage ; les propriétés TS, elles, ne changent pas",
      },
    ],
    extra: ENTITY_FIELDS,
  },
  command: {
    tagline: "engendre une commande CLI dans une application ou un module",
    synopsis: ["nodefony create command <action> [options]"],
    writes: [
      "une classe de commande branchée sur une phase du cycle de vie, son " +
        "inscription, et le squelette de son action.",
      "le nom donné est l'ACTION : la commande vaut `<module>:<action>` — " +
        "`nodefony create command publish --module blog` donne `blog:publish`.",
    ],
    before: "À lancer DANS une application Nodefony.",
    examples: [
      {
        term: "nodefony create command publish --module blog",
        text: "la commande `blog:publish`, jouée quand l'application est prête",
      },
      {
        term: "nodefony create command purge --phase onRegister --service",
        text: "une commande jouée plus tôt, servie par un service dédié",
      },
    ],
  },
};

/**
 * Ce qu'une question ATTEND comme valeur, dans la colonne de gauche.
 *
 * @param question - la question déclarée par la spec.
 * @returns le drapeau et son argument, ou le seul drapeau pour un booléen.
 */
function termFor(question: IScaffoldQuestion): string {
  const flag = flagFor(question);
  if (question.type === "boolean") return flag;
  if (question.type === "list") return `${flag} <liste>`;
  if (question.choices && question.choices.length > 0) {
    return `${flag} <${question.choices.map((c) => c.value).join("|")}>`;
  }
  if (question.optionsFrom)
    return `${flag} <${question.optionsFrom.slice(0, -1)}>`;
  return `${flag} <valeur>`;
}

/**
 * Ce que l'option change, et ce qui se passe si on ne la donne pas.
 *
 * Le DÉFAUT est dit à chaque fois qu'il en existe un : c'est la question qu'on
 * se pose devant une option facultative, et une page qui l'omet oblige à
 * lancer la commande pour le découvrir.
 *
 * @param question - la question déclarée par la spec.
 * @returns une phrase, défaut compris.
 */
function textFor(question: IScaffoldQuestion): string {
  const parts = [question.label.replace(/\s*[:?]\s*$/u, "")];
  if (question.type === "boolean") {
    // 🔴 Le critère est le DÉFAUT DÉCLARÉ, jamais la forme du drapeau. Lire la
    // forme faisait annoncer « inactif par défaut » à `--controller`, dont le
    // défaut est vrai : une aide qui ment sur un défaut est pire qu'une aide
    // muette, puisqu'on la croit sans lancer la commande.
    parts.push(
      question.default === true ? "(actif par défaut)" : "(inactif par défaut)",
    );
  } else if (Array.isArray(question.default)) {
    if (question.default.length === 0) parts.push("(aucun par défaut)");
  } else if (question.default !== "") {
    parts.push(`(défaut : ${String(question.default)})`);
  }
  if (question.askIf === "hasCheckout") {
    parts.push("— seulement depuis un checkout du framework");
  }
  return parts.join(" ");
}

/**
 * Les options d'un type, DÉRIVÉES de sa spec — jamais recopiées.
 *
 * `name` est écarté : c'est un positionnel (`create app mon-app`), le sujet de
 * la commande et non une option. C'est la seule exemption, et c'est la même que
 * celle du contrôle « une question qu'aucun flag ne sert est inatteignable ».
 *
 * @param type - le type de scaffold.
 * @returns une entrée par question, dans l'ordre de la spec.
 */
export function optionsFor(type: TScaffoldType): IUsageEntry[] {
  const [spec] = getScaffoldSpec(type);
  const byFlag = new Map<string, IUsageEntry>();
  for (const q of spec.questions) {
    if (q.key === "name") continue;
    const flag = flagFor(q);
    const existing = byFlag.get(flag);
    if (existing === undefined) {
      byFlag.set(flag, { term: termFor(q), text: textFor(q) });
      continue;
    }
    // 🔴 UN drapeau, UNE ligne. Deux questions peuvent légitimement partager le
    // même drapeau — `--service` de `create command` vaut `oui/non` seul et
    // nomme le service quand on lui donne une valeur. Les rendre séparément
    // affichait `--service` deux fois de suite, ce qui se lit comme un défaut
    // de l'outil et non comme une option à deux formes.
    byFlag.set(flag, {
      term: q.type === "boolean" ? existing.term : `${flag} [valeur]`,
      text: `${existing.text} — ou ${textFor(q).toLowerCase()}`,
    });
  }
  return [...byFlag.values()];
}

/**
 * Les options de la COMMANDE — celles qui pilotent la génération, pas le code
 * engendré, et que la spec du scaffold n'a donc aucune raison de porter.
 *
 * Elles ne valent pas partout : seuls les types qui installent des dépendances
 * connaissent `--no-install`, et seul `app` crée un dépôt git. Les servir à tous
 * ferait promettre à `create service` un drapeau qu'il refuse.
 */
const INSTALL_OPTION: IUsageEntry = {
  term: "--no-install",
  text: "n'installe pas les dépendances (et saute la construction qui suit)",
};

// ⚠️ PAS `--git-hooks` : la spec le porte déjà (question `advanced`, jamais
// posée en dialogue mais pilotée par ce drapeau). Le redire ici l'affichait
// DEUX FOIS — le doublon exact que la dérivation existe pour empêcher.
const GIT_OPTIONS: readonly IUsageEntry[] = [
  { term: "--no-git", text: "ne crée pas de dépôt git ni de premier commit" },
];

/** Les types dont la génération installe des dépendances. */
const INSTALLS: ReadonlySet<TScaffoldType> = new Set(["app", "module"]);

/** Les options COMMUNES à tous les types — celles que la spec ne porte pas. */
const SHARED_OPTIONS: readonly IUsageEntry[] = [
  { term: "--dir <chemin>", text: "dossier cible (défaut : ./<nom>)" },
  { term: "-f, --force", text: "accepte un dossier cible non vide" },
  {
    term: "-y, --yes",
    text: "prend les défauts de la spec, sans poser de question",
  },
  { term: "-n, --dry-run", text: "le plan des fichiers, sans rien écrire" },
  {
    term: "--answers-json <f>",
    text: "réponses en JSON (`-` = entrée standard) ; les drapeaux l'emportent",
  },
  {
    term: "--describe-json",
    text: "questions, valeurs permises et défauts en JSON — la porte MACHINE",
  },
];

/** Les codes de sortie, communs à tous les types. */
const EXIT_CODES: readonly IUsageEntry[] = [
  {
    term: "70",
    text: "l'installation ou la construction a échoué (EX_SOFTWARE)",
  },
  { term: "73", text: "le dossier cible ne peut pas être créé (EX_CANTCREAT)" },
];

/**
 * La page d'aide d'UN type de scaffold.
 *
 * @param type - le type demandé.
 * @returns la page, au format partagé par toutes les commandes du CLI.
 */
export function usagePageFor(type: TScaffoldType): IUsagePage {
  const doc = TYPE_DOC[type];
  const sections: IUsageSection[] = [
    { title: "CE QUE ÇA ÉCRIT", bullets: doc.writes },
  ];
  if (doc.before)
    sections.push({ title: "AVANT D'APPELER", paragraph: doc.before });
  if (doc.extra) sections.push(doc.extra);
  return {
    command: `nodefony create ${type}`,
    tagline: doc.tagline,
    synopsis: doc.synopsis,
    sections,
    options: [
      ...optionsFor(type),
      ...(INSTALLS.has(type) ? [INSTALL_OPTION] : []),
      ...(type === "app" ? GIT_OPTIONS : []),
      ...SHARED_OPTIONS,
    ],
    examples: doc.examples,
    exitCodes: EXIT_CODES,
    footer:
      `Sans drapeau dans un terminal, les questions sont posées une à une, ` +
      `puis un récapitulatif s'affiche avant d'écrire quoi que ce soit. ` +
      `\`nodefony create ${type} --dry-run\` donne le plan exact des fichiers.`,
  };
}

/**
 * Le CATALOGUE — `nodefony create --help`, sans type.
 *
 * Il ne redit PAS les options de chaque type : il nomme les sept, dit ce que
 * chacun produit en une ligne, et renvoie à sa page. Une page catalogue qui
 * détaille tout est une page que personne ne lit — c'était le défaut d'avant.
 *
 * @returns la page du catalogue.
 */
export function usageCatalog(): IUsagePage {
  const types = Object.keys(TYPE_DOC) as TScaffoldType[];
  return {
    command: "nodefony create",
    tagline:
      "engendre du code conforme au framework — et l'aide de chaque type dit " +
      "ce qu'il écrit",
    // ⚠️ PAS la liste des sept types ici : elle fait 94 caractères, donc elle
    // déborde tout terminal — et elle est juste en dessous, en colonne, avec
    // ce que chacun engendre.
    synopsis: [
      "nodefony create <type> [nom] [options]",
      "nodefony create <type> --help",
      "nodefony create --describe-json",
    ],
    sections: [
      {
        title: "LES TYPES",
        entries: types.map((t) => ({
          term: t,
          text: TYPE_DOC[t].tagline,
        })),
      },
      {
        title: "POUR EN SAVOIR PLUS",
        paragraph:
          "Chaque type a sa page : `nodefony create app --help` dit ce que " +
          "`create app` écrit, ce que chaque option change et ce que rendent " +
          "ses codes de sortie. `--describe-json` rend la même chose à une " +
          "machine, contexte du projet compris.",
      },
    ],
    options: SHARED_OPTIONS,
    examples: [
      {
        term: "nodefony create app mon-app",
        text: "une application neuve, hors de tout projet",
      },
      {
        term: "nodefony create entity Post titre:string contenu:text",
        text: "une entité, son repository, son controller et ses tests",
      },
      {
        term: "nodefony create app --help",
        text: "tout ce que `create app` accepte, et ce qu'il produit",
      },
    ],
    exitCodes: EXIT_CODES,
    footer:
      "Sans drapeau dans un terminal, la commande passe en mode interactif : " +
      "les questions du type demandé, puis un récapitulatif avant d'écrire.",
  };
}
