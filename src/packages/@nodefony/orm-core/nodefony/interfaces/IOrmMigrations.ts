/**
 * L'état des migrations d'un connecteur, vu du CŒUR — la forme que tout ORM
 * capable de migrer doit rendre, quel que soit son pilote.
 *
 * **Pourquoi cette vue existe ici et pas dans le module qui migre** : l'URL
 * d'administration est générique (`/nodefony/orm/api/migrations?connector=…`),
 * et son écran l'est aussi. Si la forme appartenait au pilote SQL, le premier
 * autre ORM à porter des migrations obligerait à réécrire l'écran — ou pire, à
 * en ajouter un second qui dirait presque la même chose.
 *
 * Ce que la vue fixe : le cœur NEUTRE (verdict, sources, gestes) et rien
 * d'autre. Tout ce qui est propre à un pilote vit sous `driver`, dont la forme
 * n'est pas décrite ici — un consommateur générique n'a pas à la connaître, et
 * un `jq` d'utilisateur ne doit pas avoir gravé un chemin qui passe par le nom
 * d'un pilote.
 *
 * ⚠️ Ce n'est PAS une seconde définition du rapport : c'est sa vue minimale. Le
 * producteur reste le module qui migre, et un test de conformité chez lui
 * prouve que son objet est assignable à cette interface. Recopier ses champs
 * ici en ferait deux contrats à maintenir, dont un mentirait.
 */

/** Une commande à taper, telle que le produit la propose. */
export interface IOrmMigrationAction {
  /** La ligne complète, prête à copier. */
  command: string;
  /** Ses arguments, pour qui l'exécute au lieu de l'afficher. */
  args: string[];
}

/** Une migration, telle que l'historique et les fichiers la décrivent. */
export interface IOrmMigrationEntry {
  /** Identifiant immuable une fois publié. */
  tag: string;
  /** Où en est cette migration pour CE connecteur. */
  status: string;
  /** Déploiement qui l'a portée — groupe les migrations d'un même passage. */
  runId?: string | undefined;
  /** Quand elle a été appliquée — absent tant qu'elle ne l'est pas. */
  appliedAt?: number | undefined;
  /** Ce qui l'a appliquée, tel que l'historique l'a retenu. */
  appliedBy?: string | undefined;
  /** Durée d'application, en millisecondes. */
  durationMs?: number | undefined;
  /** Motif de l'échec, quand elle a échoué. */
  error?: string | undefined;
}

/** Les migrations d'une origine — le framework, l'application, un module. */
export interface IOrmMigrationSource {
  /** Nom de l'origine, tel qu'il s'affiche. */
  name: string;
  /** Combien sont passées. */
  applied: number;
  /** Combien restent à appliquer. */
  pending: number;
  /** Combien ont échoué. */
  failed: number;
  /** Ses migrations, dans l'ordre d'application. */
  entries: IOrmMigrationEntry[];
}

/** L'état complet, cœur neutre — la charge utile de l'écran et de `--json`. */
export interface IOrmMigrationStatus {
  /**
   * Version du format, pour qu'un lecteur sache ce qu'il lit — un ENTIER, qui
   * ne s'incrémente que sur une rupture.
   */
  formatVersion: number;
  /** Connecteur observé. */
  connector: string;
  /** Situation d'ensemble (`ok`, `pending`, `divergent`, `failed`…). */
  verdict: string;
  /** Le fait constaté, en une phrase. */
  summary: string;
  /** Ce qu'il faut faire, du plus direct au plus assumé. */
  nextActions: IOrmMigrationAction[];
  /** Une origine par entrée. */
  sources: IOrmMigrationSource[];
  /** Tout ce qui est propre au pilote, et rien d'autre ailleurs. */
  driver: { kind: string; [key: string]: unknown };
}

/**
 * Ce qu'un ORM répond quand il ne PEUT pas rendre d'état.
 *
 * La même forme que l'arrêt publié par la ligne de commande : un écran qui
 * reçoit ceci doit MONTRER l'empêchement, jamais un tableau vide qui ressemble
 * à « tout va bien ».
 */
export interface IOrmMigrationFailure {
  formatVersion: number;
  connector: string;
  error: {
    /** Code stable — les scripts le lisent. */
    code: string;
    summary: string;
    meaning: string;
    nextActions: IOrmMigrationAction[];
  };
}

/** Une migration en attente, avec le SQL qu'elle exécuterait. */
export interface IOrmPendingMigration {
  /** Origine — le framework, l'application, un module. */
  source: string;
  /** Identité immuable une fois publiée. */
  tag: string;
  /** Les instructions, dans l'ordre d'exécution. */
  statements: string[];
}

/**
 * Ce qui S'APPLIQUERAIT — le plan, avec son SQL.
 *
 * Sert la confirmation avant application : un geste qui modifie un schéma ne
 * se confirme pas sur une promesse, il se confirme sur ce qu'il va exécuter.
 */
export interface IOrmMigrationPlan {
  formatVersion: number;
  connector: string;
  pending: IOrmPendingMigration[];
}

/** Ce qu'une application a fait — ou l'empêchement qui l'a arrêtée. */
export interface IOrmMigrationApplied {
  formatVersion: number;
  connector: string;
  /** Identifiant du passage — groupe les migrations d'un même déploiement. */
  runId: string;
  /** Ce qui a été appliqué, dans l'ordre. */
  applied: { source: string; tag: string; executionMs: number }[];
}

/** L'état, ou l'empêchement — jamais les deux. */
export type IOrmMigrationReply = IOrmMigrationStatus | IOrmMigrationFailure;

/** Le plan, ou l'empêchement. */
export type IOrmMigrationPlanReply = IOrmMigrationPlan | IOrmMigrationFailure;

/** Le compte rendu d'application, ou l'empêchement. */
export type IOrmMigrationApplyReply =
  IOrmMigrationApplied | IOrmMigrationFailure;

/**
 * Y a-t-il un empêchement plutôt qu'un état ?
 *
 * @param reply - ce que l'ORM a rendu.
 * @returns `true` si c'est un empêchement.
 */
export function isMigrationFailure(
  reply: IOrmMigrationReply | IOrmMigrationPlanReply | IOrmMigrationApplyReply,
): reply is IOrmMigrationFailure {
  return "error" in reply;
}
