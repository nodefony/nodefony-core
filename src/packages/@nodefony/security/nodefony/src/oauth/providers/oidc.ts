import type * as Jose from "jose";
import type { IOAuthProfile } from "@nodefony/user";
import type { IOAuthProvider } from "../../../contracts/IOAuthProvider";
import type { IOAuthProviderContext } from "../oauthProviderRegistry";
import { OAuth2Client, type OAuth2Tokens } from "../oauth2Client";
import {
  discoverAuthorizationServer,
  type IDiscoveryOptions,
} from "../metadata";

/**
 * Client d'un fournisseur **OIDC avec PKCE** — surface structurelle que
 * {@link OAuth2Client} remplit, et qu'un test peut remplacer par un double sans
 * réseau.
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
  /** Nom du fournisseur (`"google"`, `"keycloak"`...) — porté dans le profil. */
  readonly name: string;
  /** Client déjà construit sur les points d'entrée du fournisseur. */
  readonly client: IOidcPkceClient;
  /** Émetteur attendu (claim `iss`, anti-mix-up RFC 9207). */
  readonly issuer: string;
  /**
   * `true` si l'émetteur ANNONCE le paramètre `iss` — son absence devient alors
   * un refus. Défaut `false` : on ne peut pas exiger ce qui n'a pas été promis.
   */
  readonly issParameterSupported?: boolean;
  /** Identifiant client — l'audience que l'ID token DOIT porter. */
  readonly clientId: string;
  /** Décodage des claims de l'ID token — synchrone ou non. */
  readonly decodeIdToken: (idToken: string) => object | Promise<object>;
  /** Scopes par défaut si la config n'en précise aucun. */
  readonly defaultScopes?: string[];
}

const DEFAULT_OIDC_SCOPES = ["openid", "profile", "email"];

/**
 * Lit les claims d'un ID token SANS vérifier sa signature.
 *
 * @remarks C'est ce qu'autorise OpenID Connect Core §3.1.3.7 dans le flux
 * *Authorization Code* : le jeton vient d'être reçu du point de jeton, sur un
 * canal TLS direct et authentifié — il n'a traversé ni le navigateur ni un tiers.
 * `jose` est chargé paresseusement, comme partout ailleurs dans ce module : il
 * n'entre jamais dans le coût du boot.
 */
async function decodeIdTokenClaims(idToken: string): Promise<object> {
  const jose = (await import("jose")) as typeof Jose;
  return jose.decodeJwt(idToken);
}

/**
 * Éprouve les claims OBLIGATOIRES d'un ID token (OpenID Connect Core §3.1.3.7).
 *
 * @remarks La SIGNATURE n'est pas vérifiée — le jeton vient d'être reçu du point
 * de jeton sur un canal TLS direct, ce que la norme admet explicitement. Mais les
 * autres exigences du même paragraphe ne coûtent aucun réseau et ferment de vrais
 * écarts : un jeton d'un autre émetteur (point 2), délivré à une autre
 * application (point 3), ou périmé (point 9), n'a rien à faire ici.
 *
 * @throws Error - un claim obligatoire est absent, discordant ou périmé.
 */
function assertIdTokenClaims(
  claims: Record<string, unknown>,
  opts: IOidcProviderOptions,
): void {
  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    throw new Error(`${opts.name}: ID token sans claim 'sub'.`);
  }
  if (claims.iss !== opts.issuer) {
    throw new Error(
      `${opts.name}: ID token émis par « ${String(claims.iss)} », attendu « ${opts.issuer} ».`,
    );
  }
  const aud = claims.aud;
  const addressed =
    aud === opts.clientId ||
    (Array.isArray(aud) && aud.includes(opts.clientId));
  if (!addressed) {
    throw new Error(`${opts.name}: ID token délivré à une autre application.`);
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) {
    throw new Error(`${opts.name}: ID token périmé ou sans 'exp'.`);
  }
}

/**
 * Fabrique un {@link IOAuthProvider} **générique OIDC** — couvre TOUT fournisseur
 * OpenID Connect sans code spécifique : le profil se lit toujours pareil (claims
 * standard `sub`/`email`/`email_verified`/`name` de l'ID token).
 *
 * PKCE S256 systématique (RFC 7636) ; le profil vient de l'ID token obtenu du
 * point de jeton via TLS.
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
    issuerPolicy: {
      issuer: opts.issuer,
      requireIssParameter: opts.issParameterSupported === true,
    },
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
      const claims = (await opts.decodeIdToken(tokens.idToken())) as Record<
        string,
        unknown
      >;
      assertIdTokenClaims(claims, opts);
      const sub = claims.sub as string;
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

/** Réglages d'un fournisseur OIDC découvert. */
export interface IDiscoveredOidcOptions extends IDiscoveryOptions {
  /** Émetteur ; à défaut, celui de la configuration de l'application. */
  readonly issuer?: string;
}

/**
 * Construit un fournisseur OIDC **en demandant ses points d'entrée à l'émetteur**
 * (RFC 8414 / OpenID Connect Discovery) — aucune URL n'est écrite en dur.
 *
 * C'est ce qui permet d'enregistrer n'importe quel fournisseur OpenID Connect sans
 * écrire une ligne de code : seul son émetteur le distingue.
 *
 * @param name - nom sous lequel le fournisseur est configuré.
 * @param options - émetteur explicite, transport injectable, délai d'attente.
 * @throws Error - émetteur absent, découverte impossible, ou serveur annonçant ne
 *   pas supporter PKCE S256 alors que ce fournisseur l'exige.
 */
export async function createDiscoveredOidcProvider(
  name: string,
  ctx: IOAuthProviderContext,
  options: IDiscoveredOidcOptions = {},
): Promise<IOAuthProvider> {
  const effectiveIssuer = options.issuer ?? ctx.issuer;
  if (!effectiveIssuer) {
    throw new Error(
      `OAuth provider "${name}" : config "issuer" requise (URL de l'émetteur OIDC).`,
    );
  }
  const metadata = await discoverAuthorizationServer(effectiveIssuer, options);
  // Une liste annoncée SANS S256 est une information positive du serveur : lui
  // envoyer quand même un `code_challenge` donnerait l'illusion de PKCE.
  if (
    metadata.codeChallengeMethodsSupported !== null &&
    !metadata.codeChallengeMethodsSupported.includes("S256")
  ) {
    throw new Error(
      `OAuth provider "${name}" : l'émetteur « ${effectiveIssuer} » n'annonce pas PKCE S256 (RFC 7636).`,
    );
  }
  return createOidcProvider({
    name,
    // L'émetteur retenu est celui CANONISÉ par la découverte, pas la chaîne de
    // configuration : c'est lui que le claim `iss` et le paramètre `iss` du
    // retour devront égaler.
    issuer: metadata.issuer,
    issParameterSupported: metadata.issParameterSupported,
    clientId: ctx.clientId,
    decodeIdToken: decodeIdTokenClaims,
    client: new OAuth2Client({
      authorizationEndpoint: metadata.authorizationEndpoint,
      tokenEndpoint: metadata.tokenEndpoint,
      clientId: ctx.clientId,
      clientSecret: ctx.clientSecret,
      redirectUri: ctx.redirectUri,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
    }),
  });
}
