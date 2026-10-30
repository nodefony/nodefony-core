/**
 * Bornes temporelles qu'un jeton d'accès JWT DOIT porter : `exp` et `iat`
 * (RFC 9068 §2.2, l'un et l'autre REQUIRED).
 *
 * UNE règle pour les deux chemins de vérification — jeton de l'application
 * (`JwtAuthenticator`) et jeton d'un émetteur tiers (`RemoteJwtVerifier`). Sans
 * `exp`, une connexion ouverte avec le jeton n'a plus de borne propre : le
 * revalidateur d'une socket ne sait alors la fermer que par le store de
 * révocation, et une clé volée suffit à signer un accès éternel.
 */
export const REQUIRED_TIME_CLAIMS: readonly string[] = Object.freeze([
  "exp",
  "iat",
]);

/**
 * Tolérance d'horloge entre l'émetteur et ce serveur, en secondes : appliquée à
 * `exp`/`nbf` par jose, et à `iat` par {@link isIssuedInFuture}.
 */
export const CLOCK_TOLERANCE_S = 5;

/**
 * Le jeton se dit-il émis dans le futur, au-delà de la tolérance d'horloge ?
 *
 * jose ne contrôle `iat` que lorsqu'un âge maximal est imposé (`maxTokenAge`),
 * ce que Nodefony ne fait pas. Or un `iat` daté du futur rend inopérante la
 * révocation en masse (`invalidBefore`), qui compare `iat` à un seuil passé :
 * un jeton forgé à `iat = maintenant + 10 ans` ne serait jamais « émis avant ».
 *
 * @param payload - claims VÉRIFIÉS du jeton (signature déjà contrôlée)
 * @param nowS - instant présent, en secondes epoch
 * @param toleranceS - écart d'horloge admis, en secondes
 * @returns `true` si `iat` dépasse `nowS + toleranceS`
 */
export function isIssuedInFuture(
  payload: { readonly iat?: unknown },
  nowS: number,
  toleranceS: number,
): boolean {
  return typeof payload.iat === "number" && payload.iat > nowS + toleranceS;
}
