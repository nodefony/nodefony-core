import { createHash, randomBytes } from "node:crypto";
import { readJsonObjectBounded } from "./httpJson";

/**
 * Client **OAuth 2.0 / Authorization Code** minimal — la face cliente du protocole
 * dont Nodefony écrit déjà la face serveur (émetteur de jetons, métadonnées,
 * ressource protégée). Aucune dépendance : `node:crypto` pour l'entropie, `fetch`
 * pour l'échange.
 *
 * Posture OAuth 2.1 (RFC 9700) : Authorization Code seul, **PKCE S256** (RFC 7636)
 * quand le fournisseur le supporte, `state` anti-CSRF, jamais d'implicit ni de ROPC.
 *
 * @remarks Le flux vit sur un chemin FROID (un login humain) : les quelques
 * allocations et l'unique requête sortante n'entrent dans aucun chemin de requête.
 */

/**
 * Entropie tirée pour `state` et `code_verifier` : 32 octets, soit 43 caractères
 * en base64url — exactement la borne basse du `code_verifier` (RFC 7636 §4.1),
 * dont l'alphabet est inclus dans les caractères `unreserved` exigés.
 */
const ENTROPY_BYTES = 32;

/** Au-delà, la réponse d'un point de jeton n'est plus plausible — on refuse d'analyser. */
const MAX_TOKEN_RESPONSE_BYTES = 1024 * 1024;

/** Un serveur d'autorisation muet ne doit pas retenir la requête de login. */
const TOKEN_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Tire un `state` anti-CSRF (RFC 6749 §10.12, RFC 9700 §4.7) — 256 bits issus du
 * générateur cryptographique du système.
 */
export function generateState(): string {
  return randomBytes(ENTROPY_BYTES).toString("base64url");
}

/**
 * Tire un `code_verifier` PKCE (RFC 7636 §4.1) — 43 caractères de l'alphabet
 * `unreserved`, porteurs de 256 bits d'entropie.
 */
export function generateCodeVerifier(): string {
  return randomBytes(ENTROPY_BYTES).toString("base64url");
}

/**
 * Calcule le `code_challenge` de la méthode **S256** (RFC 7636 §4.2) :
 * `BASE64URL(SHA256(ASCII(code_verifier)))`.
 *
 * @remarks La méthode `plain` n'est jamais proposée — OAuth 2.1 et la RFC 9700
 * §2.1.1 l'excluent : elle ne protège pas d'un code intercepté.
 */
export function createCodeChallenge(codeVerifier: string): string {
  assertCodeVerifier(codeVerifier);
  return createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
}

/** Grammaire d'un `code_verifier` : 43 à 128 caractères `unreserved` (RFC 7636 §4.1). */
const CODE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;

/**
 * Refuse un `code_verifier` hors grammaire AVANT de s'en servir.
 *
 * @remarks Sans cette garde, un appelant qui fournit son propre secret (le
 * contrat l'autorise) obtiendrait un défi calculé sur une valeur que le serveur
 * d'autorisation rejettera plus tard : l'erreur sortirait au retour, sous la
 * forme d'un `invalid_grant` que rien ne relie à sa cause.
 *
 * @throws Error - la valeur ne respecte pas la grammaire de la RFC 7636 §4.1.
 */
function assertCodeVerifier(codeVerifier: string): void {
  if (!CODE_VERIFIER.test(codeVerifier)) {
    throw new Error(
      "code_verifier invalide : 43 à 128 caractères parmi [A-Za-z0-9-._~] (RFC 7636 §4.1).",
    );
  }
}

/**
 * Encode une valeur selon `application/x-www-form-urlencoded`, la forme qu'exige
 * l'authentification cliente HTTP Basic (RFC 6749 §2.3.1).
 */
function formUrlencode(value: string): string {
  return new URLSearchParams([["", value]]).toString().slice(1);
}

/**
 * Refus du serveur d'autorisation au point de jeton (RFC 6749 §5.2). Porte le
 * code `error` normalisé — la seule partie de la réponse sûre à journaliser.
 */
export class OAuth2RequestError extends Error {
  /** Code normalisé (`invalid_grant`, `invalid_client`, ...) — RFC 6749 §5.2. */
  readonly code: string;
  /** Description lisible fournie par le serveur, ou `null`. */
  readonly description: string | null;

  constructor(code: string, description: string | null) {
    super(description === null ? code : `${code}: ${description}`);
    this.name = "OAuth2RequestError";
    this.code = code;
    this.description = description;
  }
}

/**
 * Jetons rendus par le point de jeton (RFC 6749 §5.1), enveloppés pour qu'un champ
 * attendu mais absent lève une erreur NOMMÉE au lieu de propager un `undefined`
 * jusqu'au décodage du profil.
 */
export class OAuth2Tokens {
  /** Corps JSON brut de la réponse — donne accès aux extensions du fournisseur. */
  readonly data: Record<string, unknown>;

  constructor(data: Record<string, unknown>) {
    this.data = data;
  }

  #requireString(field: string): string {
    const value = this.data[field];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`Réponse du point de jeton sans champ « ${field} ».`);
    }
    return value;
  }

  /** Jeton d'accès (RFC 6749 §5.1). */
  accessToken(): string {
    return this.#requireString("access_token");
  }

  /** Type du jeton d'accès — `Bearer` en pratique (RFC 6750). */
  tokenType(): string {
    return this.#requireString("token_type");
  }

  /** Jeton d'identité OIDC (OpenID Connect Core §3.1.3.3). */
  idToken(): string {
    return this.#requireString("id_token");
  }

  /** `true` si le serveur a émis un jeton de rafraîchissement. */
  hasRefreshToken(): boolean {
    return typeof this.data.refresh_token === "string";
  }

  /** Jeton de rafraîchissement (RFC 6749 §1.5). */
  refreshToken(): string {
    return this.#requireString("refresh_token");
  }

  /** Durée de vie restante du jeton d'accès, en secondes. */
  accessTokenExpiresInSeconds(): number {
    const value = this.data.expires_in;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("Réponse du point de jeton sans champ « expires_in ».");
    }
    return value;
  }

  /** Instant d'expiration du jeton d'accès, dérivé de `expires_in`. */
  accessTokenExpiresAt(): Date {
    return new Date(Date.now() + this.accessTokenExpiresInSeconds() * 1000);
  }

  /** `true` si le serveur a annoncé les portées effectivement accordées. */
  hasScopes(): boolean {
    return typeof this.data.scope === "string";
  }

  /** Portées accordées, telles que le serveur les a annoncées (RFC 6749 §3.3). */
  scopes(): string[] {
    return this.#requireString("scope").split(" ");
  }
}

/** Points d'entrée d'un serveur d'autorisation et identité du client. */
export interface IOAuth2ClientOptions {
  /** Point d'autorisation (RFC 6749 §3.1) — où l'utilisateur est redirigé. */
  readonly authorizationEndpoint: string;
  /** Point de jeton (RFC 6749 §3.2) — où le code est échangé, de serveur à serveur. */
  readonly tokenEndpoint: string;
  /** Identifiant client délivré par le fournisseur. */
  readonly clientId: string;
  /** Secret client — vide pour un client public, qui s'authentifie alors par son seul `client_id`. */
  readonly clientSecret: string;
  /** URL de redirection exacte, telle qu'enregistrée chez le fournisseur (RFC 9700 §4.1). */
  readonly redirectUri: string;
  /**
   * Implémentation de `fetch` à employer — la voie pour éprouver l'échange sans
   * réseau, plutôt que de remplacer le `fetch` global du processus.
   */
  readonly fetch?: typeof globalThis.fetch;
  /** Délai d'attente de l'échange, en millisecondes. */
  readonly timeoutMs?: number;
}

/**
 * Client d'un serveur d'autorisation donné : construit l'URL d'autorisation puis
 * échange le code contre des jetons.
 *
 * Un exemplaire porte les endpoints DÉJÀ résolus — par découverte de métadonnées
 * ({@link discoverAuthorizationServer}) ou en dur pour un fournisseur qui n'en
 * publie pas (GitHub).
 */
export class OAuth2Client {
  readonly #options: IOAuth2ClientOptions;

  constructor(options: IOAuth2ClientOptions) {
    this.#options = options;
  }

  /**
   * Construit l'URL d'autorisation (RFC 6749 §4.1.1). Le `code_challenge` S256 est
   * ajouté dès qu'un `codeVerifier` est fourni.
   *
   * @param state - valeur anti-CSRF à retrouver au retour.
   * @param codeVerifier - secret PKCE, ou `null` pour un fournisseur sans PKCE.
   * @param scopes - portées demandées ; aucune n'est ajoutée d'office.
   */
  createAuthorizationURL(
    state: string,
    codeVerifier: string | null,
    scopes: string[],
  ): URL {
    const url = new URL(this.#options.authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.#options.clientId);
    url.searchParams.set("redirect_uri", this.#options.redirectUri);
    url.searchParams.set("state", state);
    if (scopes.length > 0) {
      url.searchParams.set("scope", scopes.join(" "));
    }
    if (codeVerifier !== null) {
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("code_challenge", createCodeChallenge(codeVerifier));
    }
    return url;
  }

  /**
   * Échange le code d'autorisation contre des jetons (RFC 6749 §4.1.3), de serveur
   * à serveur — le secret client ne quitte jamais ce canal.
   *
   * @param code - code reçu sur l'URL de redirection.
   * @param codeVerifier - secret PKCE de l'étape 1, ou `null`.
   * @throws OAuth2RequestError - le serveur a refusé, en nommant la cause (RFC 6749 §5.2).
   * @throws Error - réponse inintelligible, hors gabarit ou serveur injoignable.
   */
  async validateAuthorizationCode(
    code: string,
    codeVerifier: string | null,
  ): Promise<OAuth2Tokens> {
    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("code", code);
    body.set("redirect_uri", this.#options.redirectUri);
    if (codeVerifier !== null) {
      body.set("code_verifier", codeVerifier);
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      // GitHub rend du `x-www-form-urlencoded` tant qu'on ne réclame pas du JSON.
      Accept: "application/json",
      "User-Agent": "nodefony",
    };
    if (this.#options.clientSecret.length > 0) {
      headers.Authorization = `Basic ${this.#basicCredentials()}`;
    } else {
      // Client public : pas d'authentification, l'identité passe dans le corps
      // (RFC 6749 §4.1.3). Elle ne s'y ajoute PAS quand Basic est employé — un
      // serveur strict refuse alors les deux voies à la fois.
      body.set("client_id", this.#options.clientId);
    }

    const call = this.#options.fetch ?? globalThis.fetch;
    const response = await call(this.#options.tokenEndpoint, {
      method: "POST",
      headers,
      body: body.toString(),
      // Une redirection est refusée : un POST redirigé est rejoué en GET sans son
      // corps, et l'en-tête `Authorization` porte le secret client.
      redirect: "error",
      signal: AbortSignal.timeout(
        this.#options.timeoutMs ?? TOKEN_REQUEST_TIMEOUT_MS,
      ),
    });
    const data = await readJsonObjectBounded(
      response,
      MAX_TOKEN_RESPONSE_BYTES,
      `point de jeton (HTTP ${response.status})`,
    );
    // Un refus se lit sur le champ `error`, pas sur le statut : GitHub rend 200
    // sur un code déjà consommé.
    if (typeof data.error === "string") {
      throw new OAuth2RequestError(
        data.error,
        typeof data.error_description === "string"
          ? data.error_description
          : null,
      );
    }
    if (!response.ok) {
      throw new Error(`Point de jeton en échec (HTTP ${response.status}).`);
    }
    return new OAuth2Tokens(data);
  }

  // L'authentification `client_secret_basic` encode chaque moitié en
  // `application/x-www-form-urlencoded` AVANT le base64 (RFC 6749 §2.3.1 et son
  // annexe B) — sans quoi un secret contenant `:` ou `+` casse l'analyse côté
  // serveur. Ce n'est PAS `encodeURIComponent` (RFC 3986) : l'espace devient `+`,
  // et `~` est échappé.
  #basicCredentials(): string {
    const id = formUrlencode(this.#options.clientId);
    const secret = formUrlencode(this.#options.clientSecret);
    return Buffer.from(`${id}:${secret}`, "utf8").toString("base64");
  }
}
