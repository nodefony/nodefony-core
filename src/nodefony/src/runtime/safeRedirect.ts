/**
 * Garde anti-redirection ouverte (CWE-601) — la SEULE du dépôt.
 *
 * Toute adresse de retour qui vient de la requête (`?from=`, un état gardé en
 * session) passe par ici avant de finir dans un `Location` ou un
 * `location.assign`. Fichier sans aucun import : il part aussi dans le bundle
 * navigateur de la page de connexion, qui revalide ce que le serveur lui a
 * transmis.
 */

/** Longueur maximale d'une adresse de retour acceptée. */
const MAX_REDIRECT_LENGTH = 2048;

// Origine factice qui sert de témoin : une valeur qui la quitte en étant
// résolue désigne un autre hôte, quelle que soit la façon de l'écrire.
const PROBE_ORIGIN = "http://redirect.invalid";

/**
 * Rend `value` si c'est un chemin LOCAL sûr, sinon `fallback`.
 *
 * Accepté : une chaîne qui commence par UN seul `/` et reste sur la même
 * origine une fois résolue. Refusé : `//hôte`, `/\hôte` (les navigateurs lisent
 * `\` comme `/`), un schéma (`https:`, `javascript:`), un hôte nu, tout
 * caractère de contrôle (un navigateur retire tabulations et retours à la
 * ligne d'une URL : `/\t/hôte` devient `//hôte`), et toute valeur de plus de
 * 2 048 caractères.
 *
 * @param value - l'adresse reçue, non typée à la frontière
 * @param fallback - l'adresse rendue quand `value` est refusée
 * @returns un chemin local, requête et fragment compris
 */
export function safeRedirectPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string") return fallback;
  if (value.length === 0 || value.length > MAX_REDIRECT_LENGTH) return fallback;
  if (value.charCodeAt(0) !== 0x2f) return fallback; // "/"
  const second = value.charCodeAt(1);
  if (second === 0x2f || second === 0x5c) return fallback; // "//" ou "/\"
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x5c) return fallback;
  }
  // Ceinture : ce que l'analyseur WHATWG en fait, et non ce qu'on croit lire.
  try {
    if (new URL(value, PROBE_ORIGIN).origin !== PROBE_ORIGIN) return fallback;
  } catch {
    return fallback;
  }
  return value;
}
