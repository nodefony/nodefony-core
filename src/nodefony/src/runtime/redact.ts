/**
 * Redaction de secrets dans une ligne de texte (logs, SQL profilé, payloads).
 *
 * **Défense en profondeur, pas un contrôle d'accès** : la source de vérité reste
 * « ne pas logger de secret ». Cette passe masque les fuites résiduelles avant
 * d'exposer du texte hors du process (viewer de logs Studio, profiler dev, debug
 * bar). Pure et isomorphe (zéro dépendance Node) → utilisable serveur ET browser.
 *
 * Couvre trois familles fréquentes :
 *  - paires clé/valeur JSON `"password":"x"` / `"token": x` ;
 *  - paires clé/valeur texte `password=x` / `Authorization: x` ;
 *  - schémas d'auth porteurs `Bearer <jwt>` / `Basic <b64>`.
 *
 * Les regex sont compilées une fois (coût nul par appel hormis le `replace`).
 * Hors hot-path requête (admin plane / dev) — l'usage en boucle reste correct
 * mais préférer un appel par ligne.
 */

/** Clés dont la valeur est considérée sensible (insensible à la casse). */
const SENSITIVE_KEYS =
  "password|passwd|pwd|secret|client[_-]?secret|token|access[_-]?token|" +
  "refresh[_-]?token|id[_-]?token|api[_-]?key|x-api-key|authorization|" +
  "cookie|set-cookie|session[_-]?id|private[_-]?key";

/** JSON : `"key": "value"` ou `"key": value` → valeur masquée. */
const JSON_PAIR = new RegExp(
  `("(?:${SENSITIVE_KEYS})"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|[^\\s,}\\]]+)`,
  "gi",
);

/** Texte : `key=value` / `key: value` (avec ou sans quotes) → valeur masquée. */
const KV_PAIR = new RegExp(
  `\\b(${SENSITIVE_KEYS})(\\s*[:=]\\s*)("[^"]*"|'[^']*'|[^\\s,;]+)`,
  "gi",
);

/** Schémas d'auth porteurs : `Bearer <token>` / `Basic <b64>`. */
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,}/gi;

/** Placeholder unique de remplacement. */
const MASK = "***";

/**
 * Renvoie `line` avec les secrets connus masqués par `***`.
 *
 * Idempotent (re-rédiger une ligne déjà masquée ne change rien). Conserve la
 * structure (clés, ponctuation) pour que la ligne reste lisible/diffable.
 *
 * @param line - ligne de log/texte brute.
 * @returns la même ligne, valeurs sensibles remplacées par `***`.
 */
export function redactSecrets(line: string): string {
  if (!line) return line;
  // Ordre important : BEARER d'ABORD. Sinon `KV_PAIR` sur `authorization: Bearer
  // <jwt>` masque seulement le mot `Bearer` (1ʳᵉ valeur jusqu'à l'espace) et
  // laisse fuiter le token qui suit.
  return line
    .replace(BEARER, `$1 ${MASK}`)
    .replace(JSON_PAIR, `$1"${MASK}"`)
    .replace(KV_PAIR, `$1$2${MASK}`);
}
