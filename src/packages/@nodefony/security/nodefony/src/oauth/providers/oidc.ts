import type { IOAuthProfile } from "@nodefony/user";
import type {
  ILogoutTokenClaims,
  IOAuthProvider,
} from "../../../contracts/IOAuthProvider";
import { RemoteJwtVerifier } from "../../token/RemoteJwtVerifier";
import type { IOAuthProviderContext } from "../oauthProviderRegistry";
import {
  OAuth2Client,
  type IAuthorizationRequest,
  type ITokenRequest,
  type OAuth2Tokens,
} from "../oauth2Client";
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
  createAuthorizationURL(request: IAuthorizationRequest): URL;
  validateAuthorizationCode(request: ITokenRequest): Promise<OAuth2Tokens>;
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
  /**
   * Point de déconnexion du fournisseur (`end_session_endpoint`). Absent ou
   * `null` : le fournisseur n'offre pas `createLogoutURL`.
   */
  readonly endSessionEndpoint?: string | null;
  /**
   * Vérifie la SIGNATURE d'un jeton de déconnexion (émetteur, audience,
   * algorithme, `exp`/`iat`) et rend ses claims, ou `null` s'il est refusé ;
   * lève sur une panne. Absente : le fournisseur n'offre pas
   * `verifyLogoutToken`. Le sens du jeton (§2.4) est contrôlé ensuite par
   * {@link readLogoutTokenClaims}, jamais par cette fonction.
   */
  readonly verifyLogoutTokenSignature?: (
    logoutToken: string,
  ) => Promise<{ issuer: string; payload: Record<string, unknown> } | null>;
}

const DEFAULT_OIDC_SCOPES = ["openid", "profile", "email"];

/** Membre de `events` qui déclare un jeton de déconnexion (§2.4). */
const BACKCHANNEL_LOGOUT_EVENT =
  "http://schemas.openid.net/event/backchannel-logout";

/**
 * Algorithme d'ID token par défaut quand l'émetteur n'en annonce aucun
 * (OpenID Connect Back-Channel Logout 1.0 §2.6, point 3).
 */
const DEFAULT_LOGOUT_TOKEN_ALGORITHMS = ["RS256"];

/**
 * Lit ce qu'un jeton de déconnexion DÉSIGNE, une fois sa signature vérifiée —
 * les points 5 à 7 de la validation (OpenID Connect Back-Channel Logout 1.0
 * §2.6) : `sub` ou `sid` présent, `events` qui le déclare jeton de
 * déconnexion, AUCUN `nonce`.
 *
 * @remarks Ces gardes ferment la confusion entre jetons (§4.1) : un ID token
 * du même émetteur, pour le même client, porte une signature tout aussi
 * valide — c'est `events` qui le distingue, et l'absence de `nonce` qui
 * empêche le chemin inverse. Fonction PURE, éprouvable sans clé ni réseau.
 *
 * @param issuer - émetteur canonique rendu par la vérification de signature.
 * @param payload - claims vérifiés.
 * @returns les claims utiles, ou `null` si le jeton n'est pas un jeton de
 *   déconnexion valide.
 */
export function readLogoutTokenClaims(
  issuer: string,
  payload: Record<string, unknown>,
): ILogoutTokenClaims | null {
  const sub = typeof payload.sub === "string" ? payload.sub : null;
  const sid = typeof payload.sid === "string" ? payload.sid : null;
  if ((sub === null || sub === "") && (sid === null || sid === "")) return null;
  const events = payload.events;
  if (typeof events !== "object" || events === null || Array.isArray(events)) {
    return null;
  }
  const event = (events as Record<string, unknown>)[BACKCHANNEL_LOGOUT_EVENT];
  if (typeof event !== "object" || event === null || Array.isArray(event)) {
    return null;
  }
  if ("nonce" in payload) return null;
  if (typeof payload.jti !== "string" || payload.jti === "") return null;
  if (typeof payload.exp !== "number") return null;
  return {
    issuer,
    subject: sub === "" ? null : sub,
    sid: sid === "" ? null : sid,
    tokenId: payload.jti,
    expiresAt: payload.exp,
  };
}

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
  const jose = await import("jose");
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
  const provider: IOAuthProvider = {
    usesPkce: true,
    issuerPolicy: {
      issuer: opts.issuer,
      requireIssParameter: opts.issParameterSupported === true,
    },
    defaultScopes: opts.defaultScopes ?? DEFAULT_OIDC_SCOPES,
    createAuthorizationURL(request) {
      // Le supplément traverse tel quel : c'est par lui que `resource`, `nonce`
      // ou `prompt` atteindront le serveur le jour où on les livrera.
      return opts.client.createAuthorizationURL({
        ...request,
        codeVerifier: requireVerifier(request.codeVerifier),
      });
    },
    validateAuthorizationCode(request) {
      return opts.client.validateAuthorizationCode({
        ...request,
        codeVerifier: requireVerifier(request.codeVerifier),
      });
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
  const endSession = opts.endSessionEndpoint ?? null;
  if (endSession !== null) {
    provider.createLogoutURL = (request) => {
      // `set` et non concaténation : le point publié peut déjà porter une query.
      const url = new URL(endSession);
      url.searchParams.set("id_token_hint", request.idTokenHint);
      url.searchParams.set(
        "post_logout_redirect_uri",
        request.postLogoutRedirectUri,
      );
      // Le fournisseur vérifie l'adresse de retour contre CE client — et,
      // avec `id_token_hint`, que les deux désignent bien le même.
      url.searchParams.set("client_id", opts.clientId);
      return url;
    };
  }
  const verifySignature = opts.verifyLogoutTokenSignature;
  if (verifySignature !== undefined) {
    provider.verifyLogoutToken = async (logoutToken) => {
      const verified = await verifySignature(logoutToken);
      if (verified === null) return null;
      return readLogoutTokenClaims(verified.issuer, verified.payload);
    };
  }
  return provider;
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
  // Jetons de déconnexion : mêmes clés et mêmes algorithmes que les ID tokens
  // (§2.6). Les algorithmes annoncés à secret partagé sont ÉCARTÉS — les clés
  // viennent d'un jeu public (RFC 8725 §2.1) ; Keycloak, par exemple, annonce
  // `HS256` parmi les siens.
  const announced = (metadata.idTokenSigningAlgValuesSupported ?? []).filter(
    (alg) => !alg.startsWith("HS") && alg.toLowerCase() !== "none",
  );
  const logoutTokenVerifier = new RemoteJwtVerifier({
    issuers: [
      {
        issuer: metadata.issuer,
        jwksUri: metadata.jwksUri,
        algorithms:
          announced.length > 0 ? announced : DEFAULT_LOGOUT_TOKEN_ALGORITHMS,
        requiredClaims: ["iat", "exp", "jti", "events"],
      },
    ],
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    ...(options.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
  });
  return createOidcProvider({
    name,
    // L'émetteur retenu est celui CANONISÉ par la découverte, pas la chaîne de
    // configuration : c'est lui que le claim `iss` et le paramètre `iss` du
    // retour devront égaler.
    issuer: metadata.issuer,
    issParameterSupported: metadata.issParameterSupported,
    endSessionEndpoint: metadata.endSessionEndpoint,
    // L'audience d'un jeton de déconnexion est le client (§2.4, `aud`).
    verifyLogoutTokenSignature: (logoutToken) =>
      logoutTokenVerifier.verifyClaims(logoutToken, ctx.clientId),
    clientId: ctx.clientId,
    decodeIdToken: decodeIdTokenClaims,
    client: new OAuth2Client({
      authorizationEndpoint: metadata.authorizationEndpoint,
      tokenEndpoint: metadata.tokenEndpoint,
      clientId: ctx.clientId,
      clientSecret: ctx.clientSecret,
      // Le défaut de l'OpenID Provider quand il n'annonce rien
      // (OpenID Connect Discovery §3, `token_endpoint_auth_methods_supported`
      // vaut `["client_secret_basic"]` par omission). Une application qui sait
      // que son serveur exige autre chose le déclare dans sa configuration.
      clientAuthMethod: ctx.clientAuthMethod ?? "client_secret_basic",
      redirectUri: ctx.redirectUri,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
    }),
  });
}
