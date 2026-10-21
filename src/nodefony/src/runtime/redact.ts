/**
 * Redaction de secrets dans une ligne de texte (logs, SQL profilé, payloads).
 *
 * **Défense en profondeur, pas un contrôle d'accès** : la source de vérité reste
 * « ne pas logger de secret ». Cette passe masque les fuites résiduelles avant
 * d'exposer du texte hors du process (viewer de logs Studio, profiler dev, debug
 * bar). Pure et isomorphe (zéro dépendance Node) → utilisable serveur ET browser.
 *
 * Couvre quatre familles fréquentes :
 *  - paires clé/valeur JSON `"password":"x"` / `"token": x` ;
 *  - paires clé/valeur texte `password=x` / `Authorization: x` ;
 *  - schémas d'auth porteurs `Bearer <jwt>` / `Basic <b64>` ;
 *  - mots de passe d'URL `postgres://user:x@hôte` ({@link redactUrlCredentials}).
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

/**
 * Mot de passe d'une URL : `scheme://user:motdepasse@hôte`. Le mot de passe
 * court jusqu'au DERNIER `@` de l'autorité (quantificateur gourmand, borné par
 * `/ ? #` et l'espace) : un `@` non encodé dans le secret ne laisse rien fuir.
 */
const URL_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^\s/?#:@]*):([^\s/?#]*)@/gi;

/** Placeholder unique de remplacement. */
const MASK = "***";

/**
 * Masque le mot de passe de toute URL contenue dans `text` (`user:***@hôte`).
 *
 * La valeur se juge sur sa FORME, pas sur le nom de la clé qui la porte : une
 * URL de base posée sous `url`, `uri` ou `dsn` porte le mot de passe du compte,
 * et aucune liste de noms de clés ne la reconnaît. L'identifiant, l'hôte, le
 * port et la base restent lisibles — c'est ce qu'il faut pour diagnostiquer.
 *
 * @param text - texte ou valeur de configuration.
 * @returns le même texte, mots de passe d'URL remplacés par `***`.
 */
export function redactUrlCredentials(text: string): string {
  if (!text || !text.includes("://")) return text;
  return text.replace(URL_PASSWORD, `$1:${MASK}@`);
}

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
  return redactUrlCredentials(line)
    .replace(BEARER, `$1 ${MASK}`)
    .replace(JSON_PAIR, `$1"${MASK}"`)
    .replace(KV_PAIR, `$1$2${MASK}`);
}
