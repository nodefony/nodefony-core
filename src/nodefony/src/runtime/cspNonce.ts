/**
 * Convention de transmission du nonce CSP au navigateur (ADR-0024 §C2).
 *
 * Un document rendu par le framework annonce le nonce de sa réponse par
 * `<meta property="csp-nonce" nonce="…">` — la convention que lit déjà le
 * client de Vite (`@vite/client`, styles du rechargement à chaud) et que lit
 * `readCspNonce` (`nodefony/client`) pour tout `<style>` créé à l'exécution.
 * Module isomorphe : aucune dépendance au DOM ni à Node.
 */

/** Valeur de l'attribut `property` de la balise meta qui porte le nonce. */
export const CSP_NONCE_META_PROPERTY = "csp-nonce";

/**
 * Balise meta qui annonce le nonce CSP de la réponse au code du navigateur.
 *
 * Le nonce passe par l'attribut `nonce`, jamais par `content` : le navigateur
 * masque la valeur de l'attribut (« nonce hiding », HTML § nonce attributes) et
 * ne la livre qu'à la propriété `.nonce` — un sélecteur CSS injecté ne peut donc
 * pas la lire caractère par caractère.
 *
 * @param nonce - nonce base64 de la requête (`context.cspNonce`).
 * @returns la balise, ou une chaîne vide si le nonce est vide.
 */
export function cspNonceMetaTag(nonce: string): string {
  return nonce
    ? `<meta property="${CSP_NONCE_META_PROPERTY}" nonce="${nonce}">`
    : "";
}
