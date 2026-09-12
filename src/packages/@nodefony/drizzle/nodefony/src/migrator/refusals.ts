import type { IDrizzleConfig } from "../../interfaces/IDrizzleConfig";
import { action, MIGRATION_FORMAT_VERSION } from "./explain";
import type { IMigrationAction } from "./types";
import type { MigrationVerdictError } from "./types";
import { knownConnectors, MIGRATE_URL_ENV } from "./resolve";
import type { IConnectorResolution } from "./resolve";

/**
 * Les refus de RÉSOLUTION, rendus en VALEUR — la prose qu'un connecteur non
 * migrable mérite, sans supposer qui la lira.
 *
 * **Pourquoi ce fichier existe** : ces quatre messages étaient écrits dans la
 * commande, mêlés à l'écriture sur la sortie et au code de sortie. Ils ont
 * pourtant DEUX lecteurs — la ligne de commande, et le plan d'administration
 * qui alimente l'écran de la console. Les recopier de l'autre côté aurait posé
 * deux vérités sur la même question ; les laisser dans la commande aurait
 * obligé l'écran à réinventer les siennes, plus courtes, donc plus fausses.
 *
 * Aucune entrée-sortie ici, aucun style, aucun code de sortie : une fonction
 * reçoit une résolution et rend ce qu'il y a à en dire. C'est ce qui la rend
 * éprouvable sans base, sans kernel et sans terminal.
 */

/** Nom du module qui porte la configuration des connecteurs SQL. */
const MODULE_NAME = "drizzle";

/** Codes d'arrêt propres à la ligne de commande (l'applicateur a les siens). */
export type CommandFailureCode =
  /** Aucun connecteur de ce nom, nulle part. */
  | "NF_MIGRATE_UNKNOWN_CONNECTOR"
  /** Le connecteur existe, mais sa base ne se migre pas par fichiers. */
  | "NF_MIGRATE_NO_MIGRATIONS"
  | "NF_MIGRATE_URL_MISMATCH"
  /** Connecteur SQL enregistré, mais absent de la configuration du module. */
  | "NF_MIGRATE_NOT_CONFIGURED"
  /** Geste réservé au développement, demandé ailleurs. */
  | "NF_MIGRATE_NOT_DEVELOPMENT"
  /** La commande n'a pas pu joindre la base, ou a échoué à l'exécution. */
  | "NF_MIGRATE_UNAVAILABLE"
  /** Confirmation requise et non donnée. */
  | "NF_MIGRATE_CONFIRM_REQUIRED"
  /** La base porte des comptes : `--yes` ne suffit pas à les effacer. */
  | "NF_MIGRATE_RESET_HAS_ACCOUNTS"
  /** Des migrations en attente SUPPRIMENT des données, hors développement. */
  | "NF_MIGRATE_DESTRUCTIVE"
  /** Adopter TOUT graverait une affirmation fausse : la base ne suit pas. */
  | "NF_MIGRATE_BASELINE_AMBIGUOUS"
  /** Le nom de la migration manque, ou ne voyage pas sur les trois systèmes. */
  | "NF_GENERATE_NAME"
  /** Une entité enregistrée qu'aucun fichier découvert ne fournit. */
  | "NF_GENERATE_MISSING_ENTITY"
  /** Un fichier de l'application fournit une table qui appartient au framework. */
  | "NF_GENERATE_FRAMEWORK_TABLE"
  /** La migration produite DÉTRUIT des données, et personne ne l'a dit. */
  | "NF_GENERATE_DESTRUCTIVE"
  /** Rien à écrire, et pourtant la base ne porte pas le schéma déclaré. */
  | "NF_GENERATE_DATABASE_BEHIND"
  /** L'outil qui ÉCRIT les migrations n'est pas installé. */
  | "NF_GENERATE_TOOL_MISSING"
  /** L'outil de génération pose une question, et il n'y a pas de terminal. */
  | "NF_GENERATE_NEEDS_ANSWER"
  /** L'outil de génération s'est arrêté ; ce qu'il a dit est remonté tel quel. */
  | "NF_GENERATE_TOOL_FAILED"
  /** La lecture du schéma d'une base existante a échoué. */
  | "NF_INTROSPECT_FAILED"
  /** Le schéma initial serait écrit sur une base qui porte DÉJÀ ces tables. */
  | "NF_GENERATE_DATABASE_NOT_ADOPTED"
  /** L'adoption par lecture de la base, demandée alors qu'il existe déjà des migrations. */
  | "NF_MIGRATE_BASELINE_NOT_EMPTY"
  /** La table d'historique existe, mais ce n'est pas celle du framework. */
  | "NF_MIGRATE_HISTORY_FOREIGN";

/**
 * Ce que la découverte des entités a VU, au moment où la commande a refusé.
 *
 * **Pourquoi ce bloc existe.** Une migration se produit à partir des FICHIERS.
 * Quand l'un d'eux manque à l'appel — illisible, écrit pour un autre moteur, ou
 * n'exportant rien sous la configuration courante —, la table qu'il fournissait
 * disparaît du schéma déclaré, et l'outil de diff ne voit pas une découverte
 * amputée : il voit une table SUPPRIMÉE, et propose de la détruire. Le refus
 * qui s'ensuit nomme alors la base, qui n'y est pour rien.
 *
 * Sans ces faits, la correction naturelle — accepter la destruction, ou repartir
 * d'une base vide — détruit des données pour un défaut qui est dans le dossier
 * d'entités. C'est le seul endroit d'où l'on peut le voir.
 */
export interface IDiscoveryFacts {
  /** Fichiers d'entités examinés, toutes cibles confondues. */
  filesScanned: number;
  /** Tables de l'APPLICATION retenues pour le dialecte de ce connecteur. */
  tables: string[];
  /** Tables écartées : elles sont écrites pour un AUTRE moteur. */
  otherDialect: { table: string; dialect: string; file: string }[];
  /** Fichiers qui n'ont pas pu être importés, avec leur cause. */
  unreadable: { file: string; cause: string }[];
}

/** Ce qu'une commande écrit quand elle n'a PAS pu rendre un état. */
export interface ICommandFailure {
  formatVersion: typeof MIGRATION_FORMAT_VERSION;
  connector: string;
  exitCode: 1 | 2;
  /**
   * Présent ⇔ la commande n'a pas pu faire son travail. C'est le discriminant :
   * une sortie qui porte `verdict` est un état lu, une sortie qui porte `error`
   * est un arrêt. Aucune n'a jamais les deux.
   */
  error: {
    code: CommandFailureCode | MigrationVerdictError["verdict"]["code"];
    summary: string;
    meaning: string;
    nextActions: IMigrationAction[];
    /**
     * Ce que la découverte des entités a vu — présent sur les refus dont la
     * cause PEUT être un schéma déclaré amputé. Optionnel : un refus de
     * résolution n'a jamais découvert quoi que ce soit.
     */
    discovery?: IDiscoveryFacts;
  };
}

/** Ce qu'il y a à dire d'un connecteur sur lequel on ne peut pas travailler. */
export interface IResolutionRefusal {
  code: CommandFailureCode;
  /** Le fait constaté, en une phrase. */
  summary: string;
  /** Pourquoi c'est ainsi — la phrase qui évite la mauvaise correction. */
  meaning: string;
  /** Ce qu'il faut faire, du plus direct au plus assumé. */
  nextActions: IMigrationAction[];
  /**
   * Code de sortie que ce refus produit sur la ligne de commande.
   *
   * Il vit ICI et pas dans l'appelant : un refus de résolution qui vaudrait
   * `1` d'un côté et `2` de l'autre casserait les contrôles d'intégration
   * continue qui lisent ce chiffre, sans qu'aucun test ne le voie.
   */
  exitCode: 1 | 2;
}

/**
 * L'outil qui ÉCRIT les migrations n'est pas installé.
 *
 * Refus À PART, et c'est tout son intérêt : sans lui, cette cause tombait dans
 * le fourre-tout des commandes de migration, qui habille toute exception non
 * typée d'un `meaning` écrit pour la base injoignable. La charge utile portait
 * alors DEUX explications qui se contredisent — le fait disait « l'outil
 * manque », l'explication disait « vérifie que la base est démarrée » — et ses
 * deux gestes interrogeaient une base qui n'y était pour rien.
 *
 * @returns le refus, avec le geste qui répare.
 */
export function generationToolMissing(): IResolutionRefusal {
  return {
    code: "NF_GENERATE_TOOL_MISSING",
    summary:
      "L'outil qui écrit les migrations (`drizzle-kit`) n'est pas installé : rien n'a été écrit.",
    meaning:
      "Écrire une migration demande un outil de DÉVELOPPEMENT, que l'application déclare mais qui n'est pas dans « node_modules » — un `npm install` manque, ou l'installation s'est faite sans les dépendances de développement (`--omit=dev`). La base n'est pas en cause : appliquer des migrations, lui, ne réclame aucun outil tiers.",
    nextActions: [
      action("npm install"),
      action("npm install --save-dev drizzle-kit"),
    ],
    exitCode: 2,
  };
}

/**
 * Sortie d'un outil tiers, prête à être citée dans une explication.
 *
 * Elle est indentée pour se distinguer de la prose qui l'entoure, et BORNÉE par
 * la fin : une pile d'appels se termine par ce qui a cassé, jamais par ce qui a
 * démarré. La troncature s'ANNONCE — une sortie coupée en silence fait chercher
 * une cause dans la moitié qu'on n'a pas montrée.
 *
 * @param output - sortie complète de l'outil (standard puis erreur).
 * @param maxLines - nombre de lignes conservées, depuis la fin.
 * @returns le bloc cité, ou une phrase disant qu'il n'y avait rien.
 */
export function formatToolOutput(output: string, maxLines = 40): string {
  const lines = output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return "  (l'outil n'a rien écrit du tout)";
  }
  const kept = lines.slice(-maxLines);
  const head =
    kept.length < lines.length
      ? [`  […] ${lines.length - kept.length} ligne(s) plus haut, non citées`]
      : [];
  return [...head, ...kept.map((line) => `  ${line}`)].join("\n");
}

/**
 * L'outil de génération pose une QUESTION, et aucun terminal n'y répond.
 *
 * C'est le cas d'une colonne qui disparaît pendant qu'une autre apparaît :
 * renommage (les données suivent) ou suppression puis ajout (les données sont
 * perdues) — l'outil ne peut pas le deviner, et il a raison de demander.
 *
 * @param label - ce qui était généré, tel qu'on le cite à l'utilisateur.
 * @param replay - la commande à rejouer dans un terminal interactif.
 * @returns le refus, prêt pour la ligne de commande comme pour l'écran.
 */
export function generationNeedsAnswer(
  label: string,
  replay: string,
): IResolutionRefusal {
  return {
    code: "NF_GENERATE_NEEDS_ANSWER",
    summary: `Un RENOMMAGE probable a été détecté sur ${label}, et il faut trancher — rien n'a été écrit.`,
    meaning:
      "Une colonne disparaît et une autre apparaît : c'est soit un renommage — les données SUIVENT —, " +
      "soit une suppression puis un ajout — les données sont PERDUES. L'outil ne peut pas deviner " +
      "l'intention, il pose donc la question, et il n'y a pas de terminal ici pour y répondre. " +
      "La base n'est pas en cause : elle n'a même pas été interrogée. " +
      "⚠️ Après avoir répondu « renamed », RELIRE le fichier produit : quand une colonne est renommée " +
      "ET que son type change, l'outil n'écrit que le renommage et oublie le changement de type " +
      "(drizzle-orm#3826).",
    nextActions: [action(replay)],
    exitCode: 2,
  };
}

/**
 * L'outil de génération s'est arrêté, et ce qu'il a dit est remonté TEL QUEL.
 *
 * 🔴 Ne JAMAIS remplacer sa sortie par une hypothèse. Le fourre-tout des
 * commandes de migration explique tout par une base injoignable ou des droits
 * manquants : sur un schéma qui retire une colonne, les deux sont FAUX, et ils
 * envoient vérifier une base qui répond très bien pendant que la cause est dans
 * le fichier d'entité qu'on vient d'éditer. Un message d'erreur est cru PARCE
 * QU'il est précis.
 *
 * @param label - ce qui était généré, tel qu'on le cite à l'utilisateur.
 * @param status - code de sortie observé (il vaut `0` même en échec).
 * @param output - sortie complète de l'outil.
 * @returns le refus, prêt pour la ligne de commande comme pour l'écran.
 */
export function generationFailed(
  label: string,
  status: number | null,
  output: string,
): IResolutionRefusal {
  return {
    code: "NF_GENERATE_TOOL_FAILED",
    summary: `La génération n'a pas eu lieu sur ${label} — rien n'a été écrit.`,
    meaning:
      `Ne rien conclure du code de sortie : l'outil rend 0 même en échec (observé : ${status ?? "aucun"}). ` +
      `Ce qu'il a dit, mot pour mot :\n\n${formatToolOutput(output)}\n\n` +
      "La base n'est PAS en cause, et ce n'est pas une question de droits : écrire une migration ne " +
      "l'interroge pas. La comparaison se fait entre les ENTITÉS déclarées et les instantanés des " +
      "migrations déjà écrites — c'est donc du côté du schéma déclaré qu'il faut regarder.",
    nextActions: [action("nodefony inspect entities")],
    exitCode: 2,
  };
}

/**
 * La lecture du schéma d'une base existante a échoué.
 *
 * Contrairement à la génération, celle-ci INTERROGE la base : une base muette
 * ou des droits insuffisants sont ici des explications légitimes.
 *
 * @param label - ce qui était lu, tel qu'on le cite à l'utilisateur.
 * @param status - code de sortie observé.
 * @param output - sortie complète de l'outil.
 * @returns le refus, prêt pour la ligne de commande comme pour l'écran.
 */
export function introspectFailed(
  label: string,
  status: number | null,
  output: string,
): IResolutionRefusal {
  return {
    code: "NF_INTROSPECT_FAILED",
    summary: `La lecture du schéma de ${label} a échoué — rien n'a été écrit.`,
    meaning:
      `Code de sortie : ${status ?? "aucun"}. Ce que l'outil a dit, mot pour mot :\n\n` +
      `${formatToolOutput(output)}\n\n` +
      "Cette étape-ci, contrairement à la génération, INTERROGE la base : une base qui ne répond pas, " +
      "ou un compte sans le droit de lire le catalogue, sont des explications plausibles — la sortie " +
      "ci-dessus tranche.",
    nextActions: [action("nodefony inspect config --json")],
    exitCode: 2,
  };
}

/**
 * Erreur portant un {@link IResolutionRefusal} déjà composé.
 *
 * Elle existe pour que la CAUSE porte son propre remède jusqu'à la sortie de la
 * commande : reconnaître une cause au texte de son message serait une garde qui
 * se casse au premier reformulage.
 */
export class MigrationToolError extends Error {
  /**
   * @param refusal - refus complet, seule source de la décision.
   */
  constructor(readonly refusal: IResolutionRefusal) {
    super(refusal.summary);
    this.name = "MigrationToolError";
  }
}

/**
 * Le module qui porte les connecteurs n'est pas chargé par l'application.
 *
 * @returns le refus, prêt pour la ligne de commande comme pour l'écran.
 */
export function moduleAbsent(): IResolutionRefusal {
  return {
    code: "NF_MIGRATE_UNAVAILABLE",
    summary: `Le module « @nodefony/${MODULE_NAME} » n'est pas chargé par cette application : il n'y a aucun connecteur SQL à migrer.`,
    meaning:
      "Les migrations sont portées par le module qui déclare les connecteurs. Sans lui, la commande n'a ni base, ni fichiers, ni historique à consulter.",
    nextActions: [action("nodefony inspect modules")],
    exitCode: 2,
  };
}

/**
 * Le connecteur est une base SQL, mais la configuration du module ne le déclare
 * pas — cas d'un ORM construit directement dans du code.
 *
 * ⚠️ Ne JAMAIS lui répondre « ne porte pas de migrations » : c'est faux d'un
 * connecteur SQL, et un message faux publié est appris par les scripts qui le
 * lisent.
 *
 * @param connector - nom du connecteur.
 * @param driver - base sous-jacente, telle que l'ORM la nomme.
 * @returns le refus, prêt pour la ligne de commande comme pour l'écran.
 */
export function notConfigured(
  connector: string,
  driver: string,
): IResolutionRefusal {
  return {
    code: "NF_MIGRATE_NOT_CONFIGURED",
    summary: `Le connecteur « ${connector} » est bien une base SQL (${driver}), mais il n'est pas déclaré dans la configuration de « @nodefony/${MODULE_NAME} » : il n'y a ni fichiers ni coordonnées pour lire son état.`,
    meaning:
      "Un connecteur créé directement dans du code (un banc de test, un module qui instancie son ORM lui-même) est enregistré au moment où il se connecte, mais l'état des migrations se lit dans la configuration — c'est elle qui porte le dossier des fichiers et le mode de schéma. Déclare-le dans `connectors` pour pouvoir le suivre.",
    nextActions: [action("nodefony inspect config --json")],
    exitCode: 2,
  };
}

/**
 * Traduit une résolution qui n'est PAS `ready` en refus lisible.
 *
 * @param wanted - nom demandé par l'appelant.
 * @param resolution - ce que la résolution a rendu.
 * @param config - configuration validée du module (nomme les connecteurs réels).
 * @returns le refus correspondant, jamais `null` : chaque cas a sa prose.
 */
export function describeResolutionRefusal(
  wanted: string,
  resolution: Exclude<IConnectorResolution, { kind: "ready" }>,
  config: IDrizzleConfig,
): IResolutionRefusal {
  const premier = knownConnectors(config)[0] ?? "default";
  if (resolution.kind === "unknown") {
    const list =
      resolution.known.length > 0
        ? resolution.known.map((n) => `« ${n} »`).join(", ")
        : "aucun";
    return {
      code: "NF_MIGRATE_UNKNOWN_CONNECTOR",
      summary: `Aucun connecteur ne s'appelle « ${wanted} ». Ceux que cette application déclare : ${list}.`,
      meaning:
        "Le nom attendu est celui d'une clé de `connectors` dans la configuration, pas un nom de base ni un dialecte. Sans `--connector`, la commande travaille sur « default ».",
      nextActions: [
        action("nodefony orm:migrate:status"),
        action("nodefony inspect config --json"),
      ],
      exitCode: 2,
    };
  }
  if (resolution.kind === "url-mismatch") {
    // 🔴 Le faux succès de déploiement, fermé ici.
    //
    // La variable était ignorée en silence quand le connecteur était sqlite :
    // un travail de migration posait l'URL de production, la commande migrait
    // une base locale éphémère, et rendait « ✓ appliqué » avec le code du
    // succès. Les exemplaires démarraient ensuite sur une base jamais migrée.
    const vise =
      resolution.urlDialect === null
        ? "une base que cette commande ne sait pas lire"
        : `une base ${resolution.urlDialect}`;
    return {
      code: "NF_MIGRATE_URL_MISMATCH",
      summary: `${MIGRATE_URL_ENV} désigne ${vise}, alors que le connecteur « ${wanted} » est déclaré en ${resolution.dialect}. Rien n'a été appliqué.`,
      meaning:
        "Les deux ne peuvent pas être vraies en même temps : le SQL d'un dialecte ne s'applique pas avec le pilote d'un autre, et deviner laquelle des deux bases tu vises reviendrait à migrer la mauvaise en annonçant un succès. Soit la variable pointe la base du connecteur, soit c'est le connecteur qu'il faut choisir — la variable ne sert qu'à changer le COMPTE et l'hôte, jamais la nature de la base. Sous PowerShell, retirer la variable s'écrit `Remove-Item Env:" +
        MIGRATE_URL_ENV +
        "`.",
      // 🔴 Le premier geste doit CHANGER l'état. Le statut honore la même
      // variable : tant qu'elle est posée, il rend ce refus à l'identique — un
      // cycle pour qui exécute le premier geste sans lire la prose. Le geste
      // qui débloque est de retirer la variable, et il n'était écrit nulle
      // part ailleurs que dans une phrase.
      nextActions: [
        action(`unset ${MIGRATE_URL_ENV}`),
        action(`nodefony orm:migrate:status --connector ${wanted}`),
        action("nodefony inspect config --json"),
      ],
      exitCode: 2,
    };
  }
  // 🔴 DEUX causes, DEUX messages — les confondre publie une phrase FAUSSE.
  //
  // Vécu sur cette application même : un connecteur SQL créé en direct par un
  // banc (hors configuration du module) recevait « ne gère pas de migrations
  // de schéma ». C'est un connecteur SQLite : il en gère parfaitement, il
  // manque seulement ses coordonnées de connexion. La conception l'interdit
  // explicitement — un message faux, une fois publié, est appris par les
  // scripts qui le lisent.
  if (resolution.sqlLike) {
    return {
      code: "NF_MIGRATE_NOT_CONFIGURED",
      summary: `Le connecteur « ${wanted} » est bien une base SQL (${resolution.driver}), mais il n'est pas déclaré dans la configuration de « @nodefony/${MODULE_NAME} » : la commande n'a pas ses coordonnées de connexion.`,
      meaning:
        "Un connecteur créé directement dans du code (un banc de test, un module qui instancie son ORM lui-même) est enregistré au moment où il se connecte, mais la commande, elle, lit la configuration — c'est elle qui porte le fichier ou l'URL, et un secret ne se lit pas dans un objet déjà connecté. Déclare-le dans `connectors` pour pouvoir le migrer.",
      nextActions: [
        action("nodefony inspect config --json"),
        action(`nodefony orm:migrate:status --connector ${premier}`),
      ],
      exitCode: 2,
    };
  }
  return {
    code: "NF_MIGRATE_NO_MIGRATIONS",
    summary: `Le connecteur « ${wanted} » est porté par ${resolution.owner}, dont la base ne se met pas à jour par des migrations de schéma.`,
    meaning:
      "Les migrations par fichiers versionnés sont une mécanique SQL. Les autres bases résorbent l'écart entre le code et le schéma autrement — la question est la même, la réponse n'est pas la même. Aucune commande ne peut migrer ce connecteur aujourd'hui.",
    nextActions: [action(`nodefony orm:migrate:status --connector ${premier}`)],
    exitCode: 2,
  };
}
