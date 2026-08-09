/**
 * Découverte des métadonnées d'un **serveur d'autorisation** tiers — RFC 8414 §3.
 *
 * Ce fichier ne parle à personne : il compose des URL et juge un document déjà
 * reçu. C'est délibéré — les trois règles qui comptent ici (l'ordre des points
 * bien connus, l'égalité stricte de l'émetteur, le refus d'un `jwks_uri`
 * douteux) sont exactement celles qu'on n'éprouverait jamais si elles vivaient
 * au milieu d'un appel réseau.
 *
 * @see references/mcp-2026-07-28/spec/basic/authorization/authorization-server-discovery.mdx
 */

/** Suffixe bien connu des métadonnées d'un serveur d'autorisation (RFC 8414 §3). */
const WELL_KNOWN_OAUTH = "/.well-known/oauth-authorization-server";

/** Suffixe bien connu d'OpenID Connect Discovery 1.0 (§4). */
const WELL_KNOWN_OIDC = "/.well-known/openid-configuration";

/**
 * Ce qu'on lit d'un document de métadonnées — deux champs, pas un de plus.
 *
 * Un serveur d'autorisation en publie une trentaine ; en accepter davantage
 * reviendrait à laisser un document distant décider de notre comportement.
 * Seuls l'émetteur (qu'on doit CONTRÔLER) et l'URL du jeu de clés nous servent :
 * ce module ne demande jamais de jeton, il en vérifie.
 */
export interface IIssuerMetadata {
  /** Identifiant de l'émetteur, tel que le document se le donne. */
  issuer: string;
  /** Où récupérer les clés publiques de signature. */
  jwksUri: string;
}

/**
 * Normalise et contrôle un identifiant d'émetteur (RFC 8414 §2).
 *
 * La RFC est explicite : c'est une URL **en `https`**, « with no query or
 * fragment components ». Les trois refus ci-dessous ne sont donc pas du zèle —
 * un émetteur porteur d'une requête ou d'un fragment ne peut pas servir à
 * composer une URL bien connue par insertion, et la comparaison d'égalité
 * stricte exigée par le §3.3 deviendrait un tirage au sort.
 *
 * `http` est refusé y compris en développement : les clés de signature arrivent
 * par ce canal, et un jeu de clés substitué en transit signe n'importe quel
 * jeton. Pour éprouver le mécanisme sans TLS, on injecte une implémentation de
 * `fetch` — pas un émetteur en clair.
 *
 * @param raw - identifiant tel qu'écrit en configuration
 * @returns l'émetteur normalisé, sans barre oblique terminale
 * @throws Error si l'identifiant ne peut pas servir d'émetteur
 */
export function canonicalIssuer(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `émetteur invalide : « ${raw} » — une URL absolue est attendue ` +
        `(ex. « https://auth.example.com/realms/mon-royaume »).`,
    );
  }
  if (url.protocol !== "https:") {
    throw new Error(
      `émetteur invalide : « ${raw} » — la RFC 8414 §2 exige le schéma https ` +
        `(les clés de signature transitent par ce canal).`,
    );
  }
  if (url.search || url.hash) {
    throw new Error(
      `émetteur invalide : « ${raw} » — la RFC 8414 §2 interdit une requête ou ` +
        `un fragment dans un identifiant d'émetteur.`,
    );
  }
  const composed = `${url.origin}${url.pathname}`;
  return composed.endsWith("/") ? composed.slice(0, -1) : composed;
}

/**
 * Compose, dans l'ORDRE NORMATIF, les URL où chercher les métadonnées.
 *
 * L'ordre n'est pas une préférence de goût : la spécification impose d'essayer
 * plusieurs points, et le premier document valide gagne. Un émetteur avec
 * chemin (multi-tenant) se découvre par **insertion** — placer le suffixe en
 * queue interrogerait le tenant, pas le serveur ; un émetteur sans chemin n'a
 * que deux formes possibles.
 *
 * @param issuer - émetteur déjà normalisé par {@link canonicalIssuer}
 * @returns les URL à essayer, dans l'ordre
 *
 * @example
 * ```ts
 * issuerMetadataUrls("https://auth.example.com/tenant1");
 * // → [".../.well-known/oauth-authorization-server/tenant1",
 * //    ".../.well-known/openid-configuration/tenant1",
 * //    ".../tenant1/.well-known/openid-configuration"]
 * ```
 */
export function issuerMetadataUrls(issuer: string): string[] {
  const url = new URL(issuer);
  const path = url.pathname === "/" ? "" : url.pathname;
  if (path === "") {
    return [
      `${url.origin}${WELL_KNOWN_OAUTH}`,
      `${url.origin}${WELL_KNOWN_OIDC}`,
    ];
  }
  return [
    `${url.origin}${WELL_KNOWN_OAUTH}${path}`,
    `${url.origin}${WELL_KNOWN_OIDC}${path}`,
    `${url.origin}${path}${WELL_KNOWN_OIDC}`,
  ];
}

/**
 * Juge un document de métadonnées reçu.
 *
 * ⭐ **L'égalité stricte de l'émetteur est la garde centrale** (RFC 8414 §3.3,
 * OIDC Discovery §4.3) : sans elle, un document servi par `attaquant.example`
 * qui se déclare `"issuer": "https://honnête.example"` serait accepté, et ses
 * clés vérifieraient des jetons au nom de l'émetteur légitime. La comparaison
 * est faite sur la forme canonique des DEUX côtés — une barre oblique
 * terminale ne doit ni faire échouer un document valide, ni servir à faire
 * passer deux identifiants pour un seul.
 *
 * Le `jwks_uri` est exigé en `https` mais **pas sur l'origine de l'émetteur** :
 * des émetteurs majeurs servent légitimement leurs clés ailleurs (Google publie
 * `accounts.google.com` et ses clés sur `www.googleapis.com`). La garde qui
 * compte est en amont — le document vient d'un émetteur déclaré en
 * configuration, jamais d'une valeur lue dans un jeton.
 *
 * @param document - le document tel que reçu (JSON déjà analysé)
 * @param expectedIssuer - émetteur canonique utilisé pour composer l'URL
 * @returns les deux champs retenus
 * @throws Error si le document ne peut pas être utilisé
 */
export function validateIssuerMetadata(
  document: unknown,
  expectedIssuer: string,
): IIssuerMetadata {
  if (typeof document !== "object" || document === null) {
    throw new Error("métadonnées d'émetteur : document JSON attendu.");
  }
  const doc = document as Record<string, unknown>;
  const issuer = doc.issuer;
  if (typeof issuer !== "string" || issuer.length === 0) {
    throw new Error("métadonnées d'émetteur : champ `issuer` absent.");
  }
  let declared: string;
  try {
    declared = canonicalIssuer(issuer);
  } catch {
    throw new Error(
      `métadonnées d'émetteur : « ${issuer} » n'est pas un identifiant valide.`,
    );
  }
  if (declared !== canonicalIssuer(expectedIssuer)) {
    throw new Error(
      `métadonnées d'émetteur : le document déclare « ${declared} » alors ` +
        `qu'il a été demandé à « ${expectedIssuer} ». RFC 8414 §3.3 impose ` +
        `l'égalité — un document qui parle au nom d'un autre est rejeté.`,
    );
  }
  const jwksUri = doc.jwks_uri;
  if (typeof jwksUri !== "string" || jwksUri.length === 0) {
    throw new Error(
      "métadonnées d'émetteur : champ `jwks_uri` absent — sans jeu de clés, " +
        "aucune signature ne peut être vérifiée.",
    );
  }
  let keys: URL;
  try {
    keys = new URL(jwksUri);
  } catch {
    throw new Error(
      `métadonnées d'émetteur : \`jwks_uri\` « ${jwksUri} » n'est pas une URL.`,
    );
  }
  if (keys.protocol !== "https:") {
    throw new Error(
      `métadonnées d'émetteur : \`jwks_uri\` « ${jwksUri} » doit être en https.`,
    );
  }
  return { issuer: declared, jwksUri: keys.href };
}

/**
 * Extrait les scopes accordés d'une charge utile de jeton d'accès.
 *
 * Deux formes coexistent dans le parc réel : `scope`, chaîne séparée par des
 * espaces (RFC 8693 §4.1, RFC 9068 §2.2 — la forme normalisée), et `scp`,
 * tableau, qu'emploient plusieurs fournisseurs majeurs. Ignorer la seconde
 * ferait apparaître comme « sans aucun droit » des jetons parfaitement valides,
 * et pousserait à contourner la vérification des scopes plutôt qu'à la
 * corriger.
 *
 * @param payload - charge utile d'un jeton DÉJÀ vérifié
 * @returns les scopes, éventuellement vides — jamais `undefined`
 */
export function extractScopes(payload: Record<string, unknown>): string[] {
  const scope = payload.scope;
  if (typeof scope === "string") {
    return scope.split(" ").filter((s) => s.length > 0);
  }
  const scp = payload.scp;
  if (Array.isArray(scp)) {
    return scp.filter(
      (s): s is string => typeof s === "string" && s.length > 0,
    );
  }
  return [];
}
