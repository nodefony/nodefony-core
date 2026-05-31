/**
 * Sécurité et encodage des slugs de documentation.
 *
 * Le data plane LIT des fichiers `.md` sur disque → surface de **traversée de
 * répertoire** (path traversal). Règle de sécurité (cf
 * `feedback_security_rfc_rigor`) :
 *
 *  1. Le slug n'est JAMAIS concaténé brut dans un chemin FS. Le service garde,
 *     pour chaque fichier scanné, son chemin absolu RÉEL ; servir une page =
 *     retrouver l'entrée par **égalité de slug** dans la liste scannée, puis
 *     lire le chemin connu. Le slug est une CLÉ d'allowlist, pas un chemin.
 *  2. {@link isSafeSlug} est une garde **défense-en-profondeur** : on rejette
 *     tout slug suspect (segment `..`, séparateur de chemin, octet nul,
 *     caractère de contrôle) AVANT même de chercher dans l'allowlist.
 *
 * Schéma de slug (URL-safe, un seul segment de route) :
 *  - doc racine `docs/realtime/socket/01-x.md` → `root~realtime~socket~01-x`
 *  - doc module `<module>/docs/index.md`       → `mod~<module>~index`
 *
 * Le `/` du chemin devient `~` (le slug doit tenir dans UN segment de route
 * `/api/page/{slug}`). On NE reconstruit jamais le chemin depuis le slug.
 */

/** Caractères autorisés dans un slug : alphanum + `_` `-` `.` `~`. */
const SAFE_SLUG = /^[A-Za-z0-9_.~-]+$/;

/** Longueur maximale d'un slug (borne anti-abus, large mais finie). */
const MAX_SLUG_LENGTH = 512;

/**
 * Valide qu'un slug est sûr à manipuler (avant toute recherche/lecture).
 *
 * Rejette : chaîne vide, trop longue, segment `..`, présence de `/` `\` `\0`,
 * tout caractère hors charset autorisé.
 *
 * @param slug - slug brut reçu du client (déjà URL-décodé par le framework).
 * @returns `true` si le slug est sûr, `false` sinon.
 */
export function isSafeSlug(slug: string): boolean {
  if (typeof slug !== "string") return false;
  if (slug.length === 0 || slug.length > MAX_SLUG_LENGTH) return false;
  if (slug.includes("\0")) return false;
  if (!SAFE_SLUG.test(slug)) return false;
  // `..` interdit même encodé en segment `~` (anti-traversée par construction).
  if (slug.split("~").some((seg) => seg === "..")) return false;
  return true;
}

/** Source d'un fichier de doc : racine du projet ou un module. */
export type DocSource = { kind: "root" } | { kind: "module"; module: string };

/**
 * Construit le slug d'un fichier à partir de sa source et de son chemin
 * relatif (POSIX, sans `.md`). Inverse jamais utilisé (slug = clé, pas chemin).
 *
 * @param source - racine ou module propriétaire.
 * @param relPath - chemin relatif POSIX du `.md` (séparateur `/`).
 * @returns slug URL-safe.
 */
export function pathToSlug(source: DocSource, relPath: string): string {
  const clean = relPath
    .replace(/\\/g, "/")
    .replace(/\.md$/i, "")
    .replace(/\//g, "~");
  return source.kind === "root"
    ? `root~${clean}`
    : `mod~${sanitizeSegment(source.module)}~${clean}`;
}

/** Normalise un nom de module en segment de slug sûr (`@nodefony/x` → `x`). */
function sanitizeSegment(name: string): string {
  return name
    .replace(/^@[^/]+\//, "") // retire le scope npm `@nodefony/`
    .replace(/[^A-Za-z0-9_.-]/g, "-");
}
