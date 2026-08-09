/**
 * Lecture NON VÉRIFIÉE de l'émetteur d'un JWS compact.
 *
 * Sert à **choisir qui doit examiner un jeton**, jamais à décider de son sort.
 * Deux authenticators reconnaissent la même forme de credential — un
 * `Authorization: Bearer <jws>` — l'un pour les jetons que Nodefony a émis,
 * l'autre pour ceux d'un serveur d'autorisation tiers. Sans discriminant, le
 * premier listé dans la zone capture les deux et refuse la moitié des jetons :
 * l'ordre de la configuration deviendrait une décision de sécurité, et son
 * erreur ne se verrait qu'en production.
 *
 * ## Ce qui rend cette lecture sûre
 *
 * Rien de ce qui est lu ici ne devient une clé, une URL ou un algorithme. La
 * valeur ne sert qu'à sélectionner une entrée dans une liste **fermée**, écrite
 * en configuration ; le jeton est ensuite vérifié entièrement par
 * l'authenticator retenu, `iss` compris. Un attaquant qui ment sur `iss` ne
 * gagne donc que le droit d'être refusé par un autre maillon.
 *
 * La taille est bornée AVANT tout travail : `JSON.parse` sur une entrée non
 * fiable est le genre d'appel qu'on ne laisse pas grandir sans limite.
 */

/**
 * Plus grand jeton qu'on accepte de regarder (octets).
 *
 * Un jeton d'accès réaliste tient largement en deçà, y compris avec des rôles
 * et des groupes ; au-delà, refuser de décoder coûte moins cher que de
 * décoder pour refuser.
 */
const MAX_TOKEN_LENGTH = 8192;

/**
 * Rend le claim `iss` d'un JWS compact, sans vérifier quoi que ce soit.
 *
 * @param raw - le jeton brut, tel que présenté
 * @returns l'émetteur revendiqué, ou `null` si le jeton est trop gros, mal
 *          formé, ou ne revendique pas d'émetteur exploitable
 */
export function peekIssuer(raw: string): string | null {
  if (raw.length === 0 || raw.length > MAX_TOKEN_LENGTH) return null;
  const first = raw.indexOf(".");
  if (first <= 0) return null;
  const second = raw.indexOf(".", first + 1);
  // Le payload doit être non vide : `a..c` n'a rien à décoder.
  if (second <= first + 1) return null;
  try {
    const json = Buffer.from(
      raw.slice(first + 1, second),
      "base64url",
    ).toString("utf8");
    const claims: unknown = JSON.parse(json);
    if (typeof claims !== "object" || claims === null) return null;
    const iss = (claims as { iss?: unknown }).iss;
    return typeof iss === "string" && iss.length > 0 ? iss : null;
  } catch {
    // Base64 illisible, JSON invalide : le jeton ne revendique rien
    // d'exploitable. Ce n'est pas un refus — c'est une absence de réponse.
    return null;
  }
}

export default peekIssuer;
