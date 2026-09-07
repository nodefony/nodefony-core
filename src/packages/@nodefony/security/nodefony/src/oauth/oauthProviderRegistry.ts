import type { IOAuthProvider } from "../../contracts/IOAuthProvider";
import { createDiscoveredOidcProvider } from "./providers/oidc";
import { createGithubProvider } from "./providers/github";

/**
 * Registre de **fabriques de fournisseurs OAuth** — résout un nom configuré
 * (`oauth2.providers.<name>`) vers un {@link IOAuthProvider}, SANS coupler le
 * cœur à un fournisseur en dur.
 *
 * Convention-frère : `tokenStoreRegistry`, `authenticatorRegistry`,
 * `webAuthnCredentialStoreRegistry`.
 *
 * @remarks Aucun fournisseur n'a de code propre : un serveur OpenID Connect publie
 * ses points d'entrée (RFC 8414 / OpenID Connect Discovery), donc son seul émetteur
 * suffit à le décrire. Enregistrer Microsoft Entra, Auth0, Okta ou Authentik tient
 * en une ligne dans l'application :
 *
 * ```ts
 * registerOAuthProvider("azure", (ctx) => createDiscoveredOidcProvider("azure", ctx));
 * ```
 */

/** Contexte de construction d'un fournisseur (secrets et URL issus de la config). */
export interface IOAuthProviderContext {
  /** Identifiant client (config, issu de l'env de l'app). */
  readonly clientId: string;
  /** Secret client (config) — jamais loggé ; vide pour un client public. */
  readonly clientSecret: string;
  /** URL de callback exacte (RFC 9700). */
  readonly redirectUri: string;
  /**
   * Émetteur du fournisseur OIDC (Keycloak : URL du realm, ex.
   * `https://kc.example/realms/app`) — `undefined` pour les fournisseurs dont
   * l'émetteur est connu d'avance (Google) ou qui n'en publient pas (GitHub).
   */
  readonly issuer?: string;
}

/**
 * Fabrique d'un fournisseur OAuth pour un nom donné.
 *
 * @remarks Elle peut être **asynchrone** : découvrir les points d'entrée d'un
 * émetteur est une opération de construction, faite une seule fois par processus
 * (le service mémoïse le fournisseur résolu).
 */
export type OAuthProviderFactory = (
  ctx: IOAuthProviderContext,
) => IOAuthProvider | Promise<IOAuthProvider>;

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
// Trois entrées seulement, et deux archétypes : OIDC par découverte (l'émetteur
// dit tout) et OAuth simple (profil lu à l'API du fournisseur).
const GOOGLE_ISSUER = "https://accounts.google.com";

registerOAuthProvider("google", (ctx) =>
  createDiscoveredOidcProvider("google", ctx, { issuer: GOOGLE_ISSUER }),
);
// Keycloak est self-hosted : son émetteur (= URL du realm) vient de la config et
// sert À LA FOIS à découvrir les endpoints et à valider l'`iss` (anti-mix-up).
registerOAuthProvider("keycloak", (ctx) =>
  createDiscoveredOidcProvider("keycloak", ctx),
);
// Entrée générique : tout serveur OpenID Connect, décrit par son seul émetteur.
registerOAuthProvider("oidc", (ctx) =>
  createDiscoveredOidcProvider("oidc", ctx),
);
// OAuth simple (non-OIDC) : profil lu via l'API du fournisseur.
registerOAuthProvider("github", createGithubProvider);
