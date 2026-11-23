import type { TokenStatus } from "../../contracts/ITokenStore";

/**
 * Ce qu'il faut d'un jeton pour en déduire l'état — deux horodatages, rien de
 * plus. Volontairement structural : le store mémoire, le batch Redis et un test
 * s'en servent sans partager de type d'enregistrement.
 */
export interface ITokenLifetime {
  /** Instant de révocation, ou `null` si jamais révoqué. */
  readonly revokedAt: number | null;
  /** Échéance, ou `null` pour un jeton sans expiration. */
  readonly expiresAt: number | null;
}

/**
 * **La** définition de l'état d'un jeton — un seul exemplaire, pour les backends
 * qui évaluent en mémoire (store mémoire, filtrage inline d'un batch `SCAN`).
 *
 * L'ordre d'évaluation est significatif : **révoqué l'emporte sur expiré**. Une
 * clé révoquée puis arrivée à échéance reste « révoquée » — c'est l'acte
 * d'administration qui décrit ce qui s'est passé, pas l'écoulement du temps.
 *
 * Les backends SQL et Mongo n'appellent pas cette fonction (ils traduisent la
 * condition dans leur langage, sinon il faudrait rapatrier la collection pour la
 * filtrer) : c'est le banc de contrat partagé qui garantit qu'ils disent la même
 * chose qu'elle.
 *
 * @param token - les deux horodatages du jeton.
 * @param now - l'instant de référence (injecté : les tests ne dépendent pas de
 *   l'horloge réelle, et un store porte déjà la sienne).
 */
export function tokenStatusOf(token: ITokenLifetime, now: number): TokenStatus {
  if (token.revokedAt !== null) return "revoked";
  if (token.expiresAt !== null && token.expiresAt <= now) return "expired";
  return "active";
}

/**
 * **La** règle du seuil de révocation en masse : un artefact émis AVANT le seuil
 * de son porteur est mort, quel que soit son état propre.
 *
 * Le seuil (`ITokenStore.getInvalidBefore`) est posé par la cascade de
 * révocation d'un compte (suppression, désactivation, réinitialisation,
 * changement de mot de passe) sans toucher aux enregistrements : une clé tuée
 * ainsi garde `revokedAt === null`. Toute lecture qui dit « active » ou « compte
 * dans le plafond » doit donc passer ici, pas seulement l'authentification.
 *
 * Un instant d'émission INCONNU vaut 0 : il est antérieur à tout seuil. Un jeton
 * qui ne dit pas quand il a été émis ne survit pas à une révocation en masse.
 *
 * @param issuedAt - instant d'émission en ms (`createdAt`, `iat × 1000`), `null` si inconnu.
 * @param invalidBefore - seuil du porteur en ms, `null` s'il n'en a pas.
 * @returns `true` si l'artefact est tué par le seuil.
 */
export function issuedBeforeThreshold(
  issuedAt: number | null,
  invalidBefore: number | null,
): boolean {
  return invalidBefore !== null && (issuedAt ?? 0) < invalidBefore;
}

/**
 * `true` si le jeton correspond au filtre d'état demandé (`undefined` = tous).
 *
 * @param token - les deux horodatages du jeton.
 * @param status - l'état demandé, ou `undefined` pour ne pas filtrer.
 * @param now - l'instant de référence.
 */
export function matchesTokenStatus(
  token: ITokenLifetime,
  status: TokenStatus | undefined,
  now: number,
): boolean {
  return status === undefined || tokenStatusOf(token, now) === status;
}
