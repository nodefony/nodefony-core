/**
 * Rôle **serveur d'autorisation** — RFC 8414, les deux faces.
 *
 * On LIT les métadonnées d'un émetteur tiers (pour découvrir où sont ses clés)
 * et on PUBLIE les siennes (pour qu'un tiers découvre les nôtres). Les deux
 * faces partagent la même règle de composition de chemin ; les séparer les
 * ferait dériver en silence — un lecteur sondant là où l'émetteur ne sert pas
 * ne produit qu'un `404`, que chacun interprète comme « pas d'autorisation
 * ici ». Ici, la publication est la source et la lecture en dérive.
 *
 * Ce fichier ne parle à personne : il compose des URL, juge un document reçu et
 * compose un document à servir. C'est délibéré — les règles qui comptent
 * (l'ordre des points bien connus, l'égalité stricte de l'émetteur, le refus
 * d'un `jwks_uri` douteux) sont exactement celles qu'on n'éprouverait jamais si
 * elles vivaient au milieu d'un appel réseau.
 *
 * ⚠️ Volontairement au CŒUR, et non dans `@nodefony/security` : le module qui
 * expose les routes (`@nodefony/framework`) n'importe jamais `security`, et le
 * chemin bien connu doit rester écrit UNE fois pour les deux.
 *
 * @see references/rfc/ietf/rfc8414.txt
 * @see references/mcp-2026-07-28/spec/basic/authorization/authorization-server-discovery.mdx
 */

/** Suffixe bien connu des métadonnées d'un serveur d'autorisation (RFC 8414 §3). */
const WELL_KNOWN_OAUTH = "/.well-known/oauth-authorization-server";

/** Suffixe bien connu d'OpenID Connect Discovery 1.0 (§4). */
const WELL_KNOWN_OIDC = "/.well-known/openid-configuration";

/**
 * Chemin conventionnel où Nodefony publie son jeu de clés publiques.
 *
 * Le choix est LIBRE — un client ne le devine pas, il le lit dans le champ
 * `jwks_uri` du document de métadonnées. Deux raisons de le placer sous
 * `.well-known` quand même : c'est un espace réservé (RFC 8615), donc aucune
 * collision possible avec les routes de l'application ; et il ne comporte pas
 * de segment `api`, qui rangerait la route dans l'aire du pare-feu — or un jeu
 * de clés doit être lisible SANS authentification, sinon il ne sert à rien.
 */
export const JWKS_PATH = "/.well-known/jwks.json";

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
 * Compose le CHEMIN où PUBLIER ses métadonnées (RFC 8414 §3.1).
 *
 * La règle est une **insertion**, pas une concaténation : le suffixe bien connu
 * se place entre l'hôte et le chemin de l'émetteur, « any terminating "/" MUST
 * be removed before inserting ». Un émetteur porteur d'un chemin
 * (multi-tenant : « Using path components enables supporting multiple issuers
 * per host ») se publie donc SOUS ce chemin — servir à la racine reviendrait à
 * servir un document que personne ne demande.
 *
 * C'est cette fonction qui fait autorité : {@link issuerMetadataUrls}, côté
 * lecteur, en dérive. Les deux faces ne peuvent donc pas diverger.
 *
 * @param issuer - identifiant d'émetteur (canonique ou non)
 * @returns le chemin absolu à servir en `GET`
 *
 * @example
 * ```ts
 * authorizationServerMetadataPath("https://app.example");
 * // → "/.well-known/oauth-authorization-server"
 * authorizationServerMetadataPath("https://app.example/tenant1");
 * // → "/.well-known/oauth-authorization-server/tenant1"
 * ```
 */
export function authorizationServerMetadataPath(issuer: string): string {
  const { pathname } = new URL(canonicalIssuer(issuer));
  return pathname === "/" ? WELL_KNOWN_OAUTH : `${WELL_KNOWN_OAUTH}${pathname}`;
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
 * La première URL est celle que {@link authorizationServerMetadataPath} sert :
 * c'est ce qui garantit qu'une application Nodefony est découvrable par une
 * autre application Nodefony.
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
  const oauth = `${url.origin}${authorizationServerMetadataPath(issuer)}`;
  if (path === "") {
    return [oauth, `${url.origin}${WELL_KNOWN_OIDC}`];
  }
  return [
    oauth,
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
 * Le document que Nodefony PUBLIE — RFC 8414 §2, réduit à ce qui est vrai.
 *
 * Nodefony n'est pas un serveur d'autorisation OAuth : elle émet ses propres
 * jetons par son flux à elle, sans point d'autorisation ni point de jeton
 * RFC 6749. Ce document ne sert donc qu'à une chose — être **découvrable** :
 * dire qui l'on est, et où sont les clés qui valident nos signatures.
 */
export interface IAuthorizationServerMetadata {
  /** `issuer` — REQUIRED §2, https sans requête ni fragment. */
  issuer: string;
  /** `jwks_uri` — OPTIONAL §2, mais c'est la raison d'être du document ici. */
  jwks_uri: string;
  /**
   * `response_types_supported` — REQUIRED §2, **vide et c'est exact**.
   *
   * Le tableau vide n'est pas un remplissage : il ÉNONCE qu'aucun flux
   * d'autorisation n'existe ici. Omettre un champ requis laisserait un client
   * appliquer un défaut, c'est-à-dire supposer des capacités inexistantes.
   */
  response_types_supported: string[];
  /**
   * `grant_types_supported` — OPTIONAL §2, mais **obligatoire de fait**.
   *
   * « If omitted, the default value is ["authorization_code", "implicit"] » :
   * l'omettre annoncerait deux flux que cette application n'offre pas. Le
   * publier vide est la seule forme honnête.
   */
  grant_types_supported: string[];
}

/** De quoi composer le document — ce que l'application, seule, connaît. */
export interface IAuthorizationServerInput {
  /** Identifiant d'émetteur, tel qu'écrit en configuration. */
  issuer: string;
  /**
   * Chemin (ou URL absolue) du jeu de clés. Un chemin est résolu sur l'origine
   * de l'émetteur — un serveur ne peut pas connaître sa propre URL publique
   * autrement que par ce qu'on lui a écrit.
   */
  jwksPath?: string;
}

/**
 * Compose le document de métadonnées d'émetteur.
 *
 * @param input - ce que l'application déclare d'elle-même
 * @returns le document, prêt à sérialiser
 * @throws Error si l'émetteur ne peut pas servir d'identifiant RFC 8414 §2, ou
 *         si le jeu de clés n'est pas joignable en `https`
 */
export function buildAuthorizationServerMetadata(
  input: IAuthorizationServerInput,
): IAuthorizationServerMetadata {
  const issuer = canonicalIssuer(input.issuer);
  const jwksUri = new URL(input.jwksPath ?? JWKS_PATH, `${issuer}/`);
  if (jwksUri.protocol !== "https:") {
    throw new Error(
      `métadonnées d'émetteur : \`jwks_uri\` « ${jwksUri.href} » doit être ` +
        `en https (RFC 8414 §2).`,
    );
  }
  return {
    issuer,
    jwks_uri: jwksUri.href,
    response_types_supported: [],
    grant_types_supported: [],
  };
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
