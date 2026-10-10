import type { IOAuthProvider } from "../../contracts/IOAuthProvider";
import type { OAuth2ClientAuthMethod } from "./oauth2Client";
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
 * registerOAuthProvider(
 *   "azure",
 *   (ctx) => createDiscoveredOidcProvider("azure", ctx),
 *   { requiresIssuer: true }, // un émetteur oublié refuse le démarrage
 * );
 * ```
 */

/** Contexte de construction d'un fournisseur (secrets et URL issus de la config). */
export interface IOAuthProviderContext {
  /** Identifiant client (config, issu de l'env de l'app). */
  readonly clientId: string;
  /** Secret client (config) — jamais loggé ; vide pour un client public. */
  readonly clientSecret: string;
  /**
   * Comment le client s'authentifie au point de jeton, quand l'application le
   * DÉCLARE ; `undefined` laisse le fournisseur poser son défaut.
   *
   * Elle remonte jusqu'ici parce qu'elle appartient au serveur d'autorisation,
   * pas au code du fournisseur : un même Keycloak peut exiger `client_secret_post`
   * là où un autre veut Basic, et ils l'annoncent dans leurs métadonnées. Sans ce
   * champ, la forme serait ouverte dans le client et INATTEIGNABLE depuis une
   * application — donc absente.
   */
  readonly clientAuthMethod?: OAuth2ClientAuthMethod | undefined;
  /** URL de callback exacte (RFC 9700). */
  readonly redirectUri: string;
  /**
   * Émetteur du fournisseur OIDC (Keycloak : URL du realm, ex.
   * `https://kc.example/realms/app`) — `undefined` pour les fournisseurs dont
   * l'émetteur est connu d'avance (Google) ou qui n'en publient pas (GitHub).
   */
  readonly issuer?: string | undefined;
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

/**
 * Ce qu'une fabrique EXIGE de la configuration — lu au démarrage, avant que le
 * moindre utilisateur ne clique.
 *
 * @remarks La fabrique est une fonction opaque : rien, à sa seule lecture, ne
 * dit qu'elle lèvera faute d'émetteur. Sans déclaration, l'oubli ne se
 * découvrait qu'au premier login.
 */
export interface IOAuthProviderRegistration {
  /**
   * `true` si le fournisseur ne peut se construire sans `issuer` dans sa
   * configuration — typiquement un serveur OpenID Connect découvert par son
   * émetteur. Absent : l'émetteur est facultatif (connu d'avance, ou inutile).
   */
  readonly requiresIssuer?: boolean;
}

interface IRegisteredProvider {
  readonly factory: OAuthProviderFactory;
  readonly requiresIssuer: boolean;
}

const factories = new Map<string, IRegisteredProvider>();

/**
 * Enregistre (ou remplace) la fabrique d'un fournisseur OAuth. Appelée par les
 * builtins au chargement, et par une application pour ses fournisseurs.
 *
 * @param name - nom sous lequel le fournisseur se configure (`oauth2.providers.<name>`).
 * @param factory - fabrique du fournisseur.
 * @param registration - exigences de configuration, vérifiées au démarrage.
 */
export function registerOAuthProvider(
  name: string,
  factory: OAuthProviderFactory,
  registration: IOAuthProviderRegistration = {},
): void {
  factories.set(name, {
    factory,
    requiresIssuer: registration.requiresIssuer === true,
  });
}

/** Fabrique d'un fournisseur par nom, ou `undefined` si inconnu. */
export function getOAuthProviderFactory(
  name: string,
): OAuthProviderFactory | undefined {
  return factories.get(name)?.factory;
}

/** `true` si le fournisseur nommé a déclaré exiger un émetteur en configuration. */
export function oauthProviderRequiresIssuer(name: string): boolean {
  return factories.get(name)?.requiresIssuer === true;
}

/** Noms enregistrés (validation boot, introspection Studio, tests). */
export function listOAuthProviders(): string[] {
  return [...factories.keys()];
}

/**
 * Paramètre d'autorisation que lit le thème Keycloak livré (`template.ftl`)
 * pour afficher l'écran dans le thème de l'application (`light` | `dark`).
 */
export const KEYCLOAK_THEME_PARAMETER = "nf_theme";

/**
 * Ajoute le thème demandé ({@link IAuthorizationRequest.theme}) à l'URL
 * d'autorisation d'un fournisseur Keycloak, sous {@link KEYCLOAK_THEME_PARAMETER}.
 *
 * @param provider - fournisseur OIDC découvert, inchangé pour tout le reste
 * @returns le même fournisseur, dont l'URL d'autorisation porte le thème
 */
export function withKeycloakThemeHint(
  provider: IOAuthProvider,
): IOAuthProvider {
  return {
    ...provider,
    createAuthorizationURL(request) {
      const url = provider.createAuthorizationURL(request);
      if (request.theme === "light" || request.theme === "dark") {
        url.searchParams.set(KEYCLOAK_THEME_PARAMETER, request.theme);
      }
      return url;
    },
  };
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
registerOAuthProvider(
  "keycloak",
  async (ctx) =>
    withKeycloakThemeHint(await createDiscoveredOidcProvider("keycloak", ctx)),
  { requiresIssuer: true },
);
// Entrée générique : tout serveur OpenID Connect, décrit par son seul émetteur.
registerOAuthProvider(
  "oidc",
  (ctx) => createDiscoveredOidcProvider("oidc", ctx),
  { requiresIssuer: true },
);
// OAuth simple (non-OIDC) : profil lu via l'API du fournisseur.
registerOAuthProvider("github", createGithubProvider);
