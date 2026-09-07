import {
  canonicalIssuer,
  issuerMetadataUrls,
  validateIssuerMetadata,
} from "nodefony";
import { readJsonObjectBounded } from "./httpJson";

/**
 * **Découverte des métadonnées d'un serveur d'autorisation** (RFC 8414) — la face
 * CLIENTE de la règle que le cœur porte déjà.
 *
 * C'est ce qui remplace, à soi seul, une classe par fournisseur : les points
 * d'entrée ne sont plus écrits en dur, ils sont demandés à l'émetteur. Ajouter un
 * fournisseur OIDC (Microsoft Entra, Auth0, Okta, Authentik...) ne demande donc
 * PLUS de code : son seul émetteur suffit.
 *
 * @remarks **Ce module ne réimplémente RIEN de la RFC 8414.** La normalisation de
 * l'émetteur (`canonicalIssuer`), l'ordre normatif des URL bien connues
 * (`issuerMetadataUrls`) et l'égalité stricte du §3.3 (`validateIssuerMetadata`)
 * vivent dans `nodefony` — la même implémentation sert à PUBLIER nos métadonnées
 * et à LIRE celles d'autrui, sans quoi les deux faces divergeraient en silence.
 * Il n'ajoute que le transport : requête bornée, et lecture des deux points
 * d'entrée dont le flux *Authorization Code* a besoin.
 */

/** Un émetteur muet ne doit pas retenir la requête de login. */
const DISCOVERY_TIMEOUT_MS = 10_000;

/** Au-delà, le document n'est plus un document de métadonnées — on refuse de lire. */
const MAX_METADATA_BYTES = 1024 * 1024;

/**
 * Points d'entrée retenus d'un serveur d'autorisation — le sous-ensemble dont le
 * flux *Authorization Code* a besoin (RFC 8414 §2).
 *
 * @remarks Le nom dit **ce qu'on a découvert chez autrui**, à ne pas confondre
 * avec `IAuthorizationServerMetadata` du cœur, qui décrit le document que Nodefony
 * PUBLIE (champs bruts de la RFC).
 */
export interface IDiscoveredAuthorizationServer {
  /** Émetteur canonique, vérifié identique à celui interrogé (RFC 8414 §3.3). */
  readonly issuer: string;
  /** Point d'autorisation (RFC 6749 §3.1). */
  readonly authorizationEndpoint: string;
  /** Point de jeton (RFC 6749 §3.2). */
  readonly tokenEndpoint: string;
  /** Jeu de clés de signature — la porte d'une future vérification d'ID token. */
  readonly jwksUri: string;
  /** Méthodes PKCE annoncées (RFC 7636), ou `null` si le serveur n'en publie aucune. */
  readonly codeChallengeMethodsSupported: string[] | null;
  /**
   * `true` si le serveur ANNONCE émettre le paramètre `iss` dans sa réponse
   * d'autorisation (RFC 9207 §2.3). Absent du document ⇒ `false` : on ne peut
   * alors pas exiger ce qu'il n'a pas promis.
   */
  readonly issParameterSupported: boolean;
}

/** Réglages de la découverte — l'injection de `fetch` est la voie pour éprouver sans TLS. */
export interface IDiscoveryOptions {
  /**
   * Implémentation de `fetch` à employer.
   *
   * @remarks C'est ce que prescrit le cœur pour éprouver le mécanisme sans TLS :
   * un émetteur en clair est refusé (RFC 8414 §2), on injecte donc le transport
   * plutôt que d'affaiblir la règle.
   */
  readonly fetch?: typeof globalThis.fetch;
  /** Délai d'attente par URL candidate, en millisecondes. */
  readonly timeoutMs?: number;
}

async function fetchMetadataDocument(
  url: string,
  options: IDiscoveryOptions,
): Promise<Record<string, unknown>> {
  const call = options.fetch ?? globalThis.fetch;
  const response = await call(url, {
    headers: { Accept: "application/json", "User-Agent": "nodefony" },
    // Un document de métadonnées ne se suit pas ailleurs : l'URL bien connue est
    // dérivée de l'émetteur, une redirection en changerait l'origine sans un mot.
    redirect: "error",
    signal: AbortSignal.timeout(options.timeoutMs ?? DISCOVERY_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${url} → HTTP ${response.status}`);
  }
  return readJsonObjectBounded(response, MAX_METADATA_BYTES, url);
}

function requireEndpoint(
  document: Record<string, unknown>,
  field: string,
  issuer: string,
): string {
  const value = document[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `métadonnées de « ${issuer} » : champ « ${field} » absent (RFC 8414 §2).`,
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `métadonnées de « ${issuer} » : « ${field} » n'est pas une URL.`,
    );
  }
  if (url.protocol !== "https:") {
    throw new Error(
      `métadonnées de « ${issuer} » : « ${field} » doit être en https.`,
    );
  }
  return value;
}

/**
 * Interroge un serveur d'autorisation et rend ses points d'entrée.
 *
 * Les URL candidates sont celles du cœur (`issuerMetadataUrls`, ordre normatif
 * RFC 8414 §3.1 : insertion oauth → insertion oidc → ajout oidc), et la réponse
 * est CONFRONTÉE à l'émetteur demandé par `validateIssuerMetadata` (§3.3). C'est
 * cette garde qui empêche un émetteur détourné d'imposer ses propres points
 * d'entrée — la même attaque que le paramètre `iss` couvre au retour (RFC 9207).
 *
 * @param rawIssuer - identifiant d'émetteur tel qu'écrit en configuration.
 * @param options - transport injectable et délai d'attente.
 * @returns Les points d'entrée, prêts pour `OAuth2Client`.
 * @throws Error - émetteur mal formé, document introuvable, incomplet, ou `issuer` discordant.
 */
export async function discoverAuthorizationServer(
  rawIssuer: string,
  options: IDiscoveryOptions = {},
): Promise<IDiscoveredAuthorizationServer> {
  const issuer = canonicalIssuer(rawIssuer);
  const failures: string[] = [];
  for (const candidate of issuerMetadataUrls(issuer)) {
    let document: Record<string, unknown>;
    try {
      document = await fetchMetadataDocument(candidate, options);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    // Le document a répondu : à partir d'ici toute anomalie est FATALE — se
    // rabattre sur l'URL suivante masquerait un document hostile derrière un 404.
    const identity = validateIssuerMetadata(document, issuer);
    const methods = document.code_challenge_methods_supported;
    return {
      issuer: identity.issuer,
      jwksUri: identity.jwksUri,
      authorizationEndpoint: requireEndpoint(
        document,
        "authorization_endpoint",
        issuer,
      ),
      tokenEndpoint: requireEndpoint(document, "token_endpoint", issuer),
      codeChallengeMethodsSupported: Array.isArray(methods)
        ? methods.filter((m): m is string => typeof m === "string")
        : null,
      issParameterSupported:
        document.authorization_response_iss_parameter_supported === true,
    };
  }
  throw new Error(
    `métadonnées introuvables pour « ${issuer} » — ${failures.join(" ; ")}`,
  );
}
