import type * as Arctic from "arctic";
import type { IOAuthProvider } from "../../contracts/IOAuthProvider";
import { createOidcProvider } from "./providers/oidc";
import { createGithubProvider } from "./providers/github";

/**
 * Registre de **fabriques de fournisseurs OAuth** — résout un nom configuré
 * (`oauth2.providers.<name>`) vers un {@link IOAuthProvider}, SANS coupler le
 * cœur à un fournisseur en dur.
 *
 * Convention-frère : `tokenStoreRegistry`, `authenticatorRegistry`,
 * `webAuthnCredentialStoreRegistry`. Les builtins (`google`, `github`) couvrent
 * les deux archétypes (OIDC+PKCE / OAuth simple) ; une application enregistre les
 * ~50 autres fournisseurs `arctic` (Microsoft, Apple, Discord...) ou un
 * fournisseur maison via {@link registerOAuthProvider}, sans éditer le core.
 *
 * @remarks `arctic` n'est ici qu'un **type** : l'instance runtime, chargée
 * paresseusement par `OAuth2Service` au premier login, est passée à la fabrique
 * via {@link IOAuthProviderContext.arctic} — zéro import runtime statique.
 */

/** Contexte de construction d'un fournisseur (lib arctic chargée + secrets de config). */
export interface IOAuthProviderContext {
  /** Module `arctic` chargé paresseusement (les classes de fournisseurs). */
  readonly arctic: typeof Arctic;
  /** Identifiant client (config, issu de l'env de l'app). */
  readonly clientId: string;
  /** Secret client (config) — jamais loggé. */
  readonly clientSecret: string;
  /** URL de callback exacte (RFC 9700). */
  readonly redirectUri: string;
  /**
   * Émetteur/realm des fournisseurs OIDC self-hosted (Keycloak : URL du realm,
   * ex. `https://kc.example/realms/app`) — `undefined` pour les fournisseurs à
   * endpoints fixes (Google, GitHub).
   */
  readonly issuer?: string;
}

/** Fabrique d'un fournisseur OAuth pour un nom donné. */
export type OAuthProviderFactory = (
  ctx: IOAuthProviderContext,
) => IOAuthProvider;

const factories = new Map<string, OAuthProviderFactory>();

/**
 * Enregistre (ou remplace) la fabrique d'un fournisseur OAuth. Appelée par les
 * builtins au chargement, et par une application pour ses fournisseurs.
 */
export function registerOAuthProvider(
  name: string,
  factory: OAuthProviderFactory,
): void {
  factories.set(name, factory);
}

/** Fabrique d'un fournisseur par nom, ou `undefined` si inconnu. */
export function getOAuthProviderFactory(
  name: string,
): OAuthProviderFactory | undefined {
  return factories.get(name);
}

/** Noms enregistrés (validation boot, introspection Studio, tests). */
export function listOAuthProviders(): string[] {
  return [...factories.keys()];
}

// ─── Builtins ─────────────────────────────────────────────────────────────────
// OIDC (helper générique, zéro mapping spécifique) — Google (issuer fixe) +
// Keycloak (issuer = URL du realm, fournie en config). Ajouter Microsoft/Auth0/
// Okta = une entrée identique (nom + classe arctic + issuer).
registerOAuthProvider("google", (ctx) =>
  createOidcProvider({
    name: "google",
    client: new ctx.arctic.Google(
      ctx.clientId,
      ctx.clientSecret,
      ctx.redirectUri,
    ),
    issuer: "https://accounts.google.com",
    decodeIdToken: ctx.arctic.decodeIdToken,
  }),
);
registerOAuthProvider("keycloak", (ctx) => {
  // Keycloak est self-hosted : son émetteur (= URL du realm) sert À LA FOIS à
  // construire le client (endpoints dérivés) et à valider l'`iss` (anti-mix-up).
  if (!ctx.issuer) {
    throw new Error(
      'OAuth provider "keycloak" : config "issuer" requise (URL du realm, ex. https://kc.example/realms/app).',
    );
  }
  return createOidcProvider({
    name: "keycloak",
    client: new ctx.arctic.KeyCloak(
      ctx.issuer,
      ctx.clientId,
      ctx.clientSecret,
      ctx.redirectUri,
    ),
    issuer: ctx.issuer,
    decodeIdToken: ctx.arctic.decodeIdToken,
  });
});
// OAuth simple (non-OIDC) : profil lu via l'API du fournisseur.
registerOAuthProvider("github", createGithubProvider);
