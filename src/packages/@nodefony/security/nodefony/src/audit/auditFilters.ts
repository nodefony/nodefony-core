import type { IFilterSpec } from "nodefony";
import type { AuditCategory, AuditOutcome } from "../../contracts/IAuditEvent";

/**
 * **Le vocabulaire de filtre du journal d'audit**, en noms PUBLICS — ceux qu'un
 * auditeur écrit dans l'URL (`?category=authz&outcome=denied&since=…`).
 *
 * Les deux énumérations y sont écrites en toutes lettres, et
 * {@link AUDIT_FILTER_VOCABULARY_IS_COMPLETE} vérifie **à la compilation**
 * qu'elles couvrent exactement `AuditCategory` et `AuditOutcome`.
 *
 * Ce contrôle n'est pas décoratif : la liste qu'il remplace avait DÉJÀ dérivé.
 * Un `Set` recopié à la main dans le data plane portait dix catégories quand le
 * type en déclarait onze — `?category=config` tombait donc hors de l'allowlist,
 * était ignoré en silence, et l'auditeur recevait le journal ENTIER en croyant
 * lire les seules mutations de configuration. Une liste recopiée ne diverge
 * jamais bruyamment.
 *
 * `actor`, `action` et `requestId` restent des chaînes libres : ce sont des
 * identifiants produits à l'exécution, aucune allowlist ne peut les connaître.
 * `since`/`until` sont des horodatages en millisecondes (bornes incluses).
 */
export const AUDIT_FILTERS = {
  /** Famille d'événement — la liste EST le type `AuditCategory`. */
  category: [
    "auth",
    "authz",
    "token",
    "session",
    "oauth",
    "webauthn",
    "csrf",
    "cors",
    "ws",
    "webhook",
    "config",
  ],
  /** Issue — `denied` est le signal d'accès non autorisé. */
  outcome: ["success", "failure", "denied"],
  /** Identité de l'acteur (égalité stricte). */
  actor: "string",
  /** Nom de l'action auditée (égalité stricte). */
  action: "string",
  /** Corrèle toutes les traces d'une même requête. */
  requestId: "string",
  /** Borne basse, horodatage en millisecondes. */
  since: "int",
  /** Borne haute, horodatage en millisecondes. */
  until: "int",
} as const satisfies IFilterSpec;

/**
 * Vrai si les deux ensembles sont EXACTEMENT les mêmes, `never` sinon — donc
 * inassignable depuis `true`, donc erreur de compilation.
 *
 * Les deux sens comptent, et pour des raisons différentes : une valeur en trop
 * dans la liste ouvrirait un filtre qu'aucun store ne sait honorer ; une valeur
 * manquante ferait refuser en 400 une catégorie parfaitement légitime — le
 * contraire du silence d'origine, mais tout aussi faux.
 */
type SameValues<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never;

/**
 * Preuve **à la compilation** que le vocabulaire ci-dessus est exactement celui
 * des types du contrat. Elle remplace la discipline humaine « penser à mettre
 * les deux à jour », qui avait échoué en silence.
 */
export const AUDIT_FILTER_VOCABULARY_IS_COMPLETE: [
  SameValues<(typeof AUDIT_FILTERS.category)[number], AuditCategory>,
  SameValues<(typeof AUDIT_FILTERS.outcome)[number], AuditOutcome>,
] = [true, true];
