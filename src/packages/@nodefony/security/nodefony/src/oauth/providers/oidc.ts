import type { OAuth2Tokens } from "arctic";
import type { IOAuthProfile } from "@nodefony/user";
import type { IOAuthProvider } from "../../../contracts/IOAuthProvider";

/**
 * Client `arctic` minimal d'un fournisseur **OIDC avec PKCE** — surface
 * structurelle commune à `Google`, `MicrosoftEntraId`, `Auth0`, `Okta`,
 * `KeyCloak`... (une instance arctic de ces classes est assignable telle quelle).
 */
export interface IOidcPkceClient {
  createAuthorizationURL(
    state: string,
    codeVerifier: string,
    scopes: string[],
  ): URL;
  validateAuthorizationCode(
    code: string,
    codeVerifier: string,
  ): Promise<OAuth2Tokens>;
}

/** Paramètres d'un fournisseur OIDC générique. */
export interface IOidcProviderOptions {
  /** Nom du fournisseur (`"google"`, `"microsoft"`...) — porté dans le profil. */
  readonly name: string;
  /** Instance `arctic` (déjà construite avec les secrets). */
  readonly client: IOidcPkceClient;
  /** Émetteur attendu (claim `iss`, anti-mix-up RFC 9207). */
  readonly issuer: string;
  /** `arctic.decodeIdToken` (injecté — arctic est chargé paresseusement). */
  readonly decodeIdToken: (idToken: string) => object;
  /** Scopes par défaut si la config n'en précise aucun. */
  readonly defaultScopes?: string[];
}

const DEFAULT_OIDC_SCOPES = ["openid", "profile", "email"];

/**
 * Fabrique un {@link IOAuthProvider} **générique OIDC** — couvre TOUT fournisseur
 * OpenID Connect sans code spécifique : le profil se lit toujours pareil (claims
 * standard `sub`/`email`/`email_verified`/`name` de l'ID token). Ajouter un
 * fournisseur OIDC = une entrée de quelques lignes (nom + classe arctic + issuer),
 * pas un fichier.
 *
 * PKCE S256 systématique (RFC 7636) ; le profil vient de l'ID token signé obtenu
 * du token endpoint via TLS (décodage suffisant en code flow, RFC 8725).
 */
export function createOidcProvider(opts: IOidcProviderOptions): IOAuthProvider {
  const requireVerifier = (codeVerifier: string | null): string => {
    if (codeVerifier === null) {
      throw new Error(`${opts.name}: code_verifier requis (PKCE OIDC).`);
    }
    return codeVerifier;
  };
  return {
    usesPkce: true,
    expectedIssuer: opts.issuer,
    defaultScopes: opts.defaultScopes ?? DEFAULT_OIDC_SCOPES,
    createAuthorizationURL(state, codeVerifier, scopes) {
      return opts.client.createAuthorizationURL(
        state,
        requireVerifier(codeVerifier),
        scopes,
      );
    },
    validateAuthorizationCode(code, codeVerifier) {
      return opts.client.validateAuthorizationCode(
        code,
        requireVerifier(codeVerifier),
      );
    },
    async fetchProfile(tokens: OAuth2Tokens): Promise<IOAuthProfile> {
      const claims = opts.decodeIdToken(tokens.idToken()) as Record<
        string,
        unknown
      >;
      const sub = claims.sub;
      if (typeof sub !== "string" || sub.length === 0) {
        throw new Error(`${opts.name}: ID token sans claim 'sub'.`);
      }
      return {
        provider: opts.name,
        providerId: sub,
        email: typeof claims.email === "string" ? claims.email : null,
        emailVerified: claims.email_verified === true,
        name: typeof claims.name === "string" ? claims.name : null,
        raw: claims,
      };
    },
  };
}
