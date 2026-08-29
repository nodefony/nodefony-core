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
  /** Des migrations en attente SUPPRIMENT des données, hors développement. */
  | "NF_MIGRATE_DESTRUCTIVE"
  /** Le nom de la migration manque, ou ne voyage pas sur les trois systèmes. */
  | "NF_GENERATE_NAME"
  /** Un fichier d'entité refuse de s'importer : le schéma serait AMPUTÉ. */
  | "NF_GENERATE_UNREADABLE_ENTITY"
  /** Une entité enregistrée qu'aucun fichier découvert ne fournit. */
  | "NF_GENERATE_MISSING_ENTITY"
  /** Un fichier de l'application fournit une table qui appartient au framework. */
  | "NF_GENERATE_FRAMEWORK_TABLE"
  /** La migration produite DÉTRUIT des données, et personne ne l'a dit. */
  | "NF_GENERATE_DESTRUCTIVE";

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
    const liste =
      resolution.known.length > 0
        ? resolution.known.map((n) => `« ${n} »`).join(", ")
        : "aucun";
    return {
      code: "NF_MIGRATE_UNKNOWN_CONNECTOR",
      summary: `Aucun connecteur ne s'appelle « ${wanted} ». Ceux que cette application déclare : ${liste}.`,
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
        "Les deux ne peuvent pas être vraies en même temps : le SQL d'un dialecte ne s'applique pas avec le pilote d'un autre, et deviner laquelle des deux bases tu vises reviendrait à migrer la mauvaise en annonçant un succès. Soit la variable pointe la base du connecteur, soit c'est le connecteur qu'il faut choisir — la variable ne sert qu'à changer le COMPTE et l'hôte, jamais la nature de la base.",
      nextActions: [
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
