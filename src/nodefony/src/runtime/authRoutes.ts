/**
 * Routes de connexion du framework — la SEULE écriture de ces chemins.
 *
 * Elles sont MONTÉES par le module framework (`mountSessionAuthRoutes`,
 * `mountWebAuthnRoutes`, `mountOAuth2Routes`), qui compose ses tables à partir
 * des bases ci-dessous, et CITÉES partout ailleurs : le déroulé de connexion
 * côté navigateur (`NodefonyLogin`), la commande qui crée un compte, l'indice
 * d'identité d'une route gardée, l'outillage `nodefony/testing`, les tests
 * générés d'une application. Chacun recopiait autrefois son littéral, et la
 * copie qui part chez l'utilisateur était précisément celle que rien ne
 * surveillait.
 *
 * Elles vivent donc ici, dans le seul paquet que tous importent — et dans un
 * fichier sans aucun import, pour rester lisible par le bundle navigateur. Les
 * gabarits qui ne peuvent pas l'importer (workflows, `AGENTS.md`) sont
 * confrontés à ces valeurs par un test du cœur (`authLoginPath.test.ts`).
 */

/** Base des routes de session : connexion, second facteur, déconnexion, identité. */
export const AUTH_API_BASE = "/nodefony/security/api/auth";

/** Base des cérémonies WebAuthn (passkeys). */
export const WEBAUTHN_API_BASE = "/nodefony/security/api/webauthn";

/** Base de la connexion par un fournisseur externe (OAuth 2.0 / OpenID Connect). */
export const OAUTH2_API_BASE = "/nodefony/security/api/oauth2";

/**
 * Route de connexion par session : `POST` avec `{username, password}`.
 *
 * Rend `200 { user }`, ou `202 { mfaRequired: true, methods }` quand le compte
 * exige un second facteur — aucune session n'est alors ouverte.
 */
export const AUTH_LOGIN_PATH = `${AUTH_API_BASE}/login`;

/** Second facteur après un `202 mfaRequired` : `POST` avec `{code}` (TOTP ou code de récupération). */
export const AUTH_LOGIN_TOTP_PATH = `${AUTH_API_BASE}/login/totp`;

/** Déconnexion : `POST`, idempotente ; rend `logoutUrl` quand la session venait d'un fournisseur. */
export const AUTH_LOGOUT_PATH = `${AUTH_API_BASE}/logout`;

/** Identité de la session courante : `GET`, `401` sans session. */
export const AUTH_ME_PATH = `${AUTH_API_BASE}/me`;

/** Défi de connexion par passkey : `POST` (corps vide) → options WebAuthn en JSON. */
export const WEBAUTHN_LOGIN_OPTIONS_PATH = `${WEBAUTHN_API_BASE}/login/options`;

/** Vérification de la passkey : `POST` avec `{response}` → ouvre la session. */
export const WEBAUTHN_LOGIN_VERIFY_PATH = `${WEBAUTHN_API_BASE}/login/verify`;

/** Fournisseurs de connexion configurés : `GET` → `{ providers: {name, label}[] }`. */
export const OAUTH2_PROVIDERS_PATH = `${OAUTH2_API_BASE}/providers`;

/**
 * Adresse qui démarre la connexion par un fournisseur : à ouvrir en navigation
 * PLEINE PAGE, jamais par `fetch` — le navigateur doit suivre les redirections
 * vers le fournisseur et revenir avec le cookie de session posé au retour.
 *
 * @param provider - nom du fournisseur, tel que le rend {@link OAUTH2_PROVIDERS_PATH}
 * @param from - page où revenir après la connexion ; le serveur la revalide
 *   (chemin local seulement) avant de s'en servir
 * @returns le chemin `…/oauth2/<provider>/authorize`, le nom encodé
 */
export function oauth2AuthorizePath(provider: string, from?: string): string {
  const path = `${OAUTH2_API_BASE}/${encodeURIComponent(provider)}/authorize`;
  return from ? `${path}?from=${encodeURIComponent(from)}` : path;
}

/**
 * Méthode de second facteur « code à usage unique » : un code TOTP, ou un
 * code de récupération, présenté à {@link AUTH_LOGIN_TOTP_PATH}.
 *
 * Le `202` du login est un DÉFI : il porte la liste `methods` des seconds
 * facteurs acceptés, liste OUVERTE (passkey, code par courriel… s'y ajouteront
 * sans rupture). Un client ne retient que celles qu'il sait conduire, et
 * traite une liste sans aucune d'elles comme une réponse inattendue.
 */
export const MFA_METHOD_TOTP = "totp";

/**
 * Refus d'un secret de connexion reçu en clair (HTTP) en production — corps
 * `error` d'une réponse 403 des routes de connexion.
 *
 * Écrit par le serveur, reconnu par le navigateur : un 403 sur ces routes peut
 * aussi venir de la défense CSRF, et seul ce texte dit que c'est le CANAL qui
 * est refusé, pas l'identifiant. L'écran ne dit alors pas « mot de passe
 * incorrect » — l'utilisateur recommencerait, et renverrait son secret en clair.
 */
export const INSECURE_TRANSPORT_MESSAGE = "Credentials must be sent over HTTPS";

/**
 * Chemin par défaut de la page de connexion servie par le framework.
 *
 * Défaut de `security.loginPage.path`, et donc de la redirection d'échec d'un
 * fournisseur : une seule écriture, pour que « là où l'on renvoie » et « là où
 * la page existe » ne puissent pas diverger.
 */
export const LOGIN_PAGE_PATH = "/login";

/**
 * Modes de mise en page de la page de connexion par défaut.
 *
 * Le balisage ne change jamais : le mode se pose sur `<body data-layout>` et
 * la feuille de style en dérive la disposition. `card` centre un panneau,
 * `split` partage l'écran entre une illustration et le formulaire, `bare` ne
 * garde que le formulaire. Source unique du schéma de `security.loginPage`.
 */
export const LOGIN_PAGE_LAYOUTS = ["card", "split", "bare"] as const;

/** Un mode de mise en page de la page de connexion (`loginPage.layout`). */
export type LoginPageLayout = (typeof LOGIN_PAGE_LAYOUTS)[number];

/** Fournisseur d'identité proposé sur la page de connexion. */
export interface ILoginPageProvider {
  /** Nom du fournisseur, tel qu'il figure dans l'adresse d'autorisation. */
  readonly name: string;
  /** Libellé affiché sur le bouton. */
  readonly label: string;
  /**
   * Image du bouton (chemin servi par l'application ou URL), ou `null` pour
   * l'icône du framework (marque GitHub, sinon une clé).
   */
  readonly icon: string | null;
}

/**
 * Contenu du panneau d'illustration qui REMPLACE la vitrine Nodefony. Texte
 * seul, échappé au rendu : l'image du panneau passe par la feuille de
 * l'application (`--nf-login-hero-image`), jamais par une adresse injectée
 * dans le balisage.
 */
export interface ILoginPageHero {
  /** Accroche du panneau. */
  readonly heading: string;
  /** Phrase sous l'accroche, ou `null`. */
  readonly text: string | null;
}

/**
 * Ce que la page de connexion par défaut doit afficher, décrit par la sécurité
 * et lu par le contrôleur qui la sert.
 *
 * Contrat entre `@nodefony/security` (qui le produit, `authFlow.describeLoginPage()`)
 * et `@nodefony/framework` (qui le rend) : il vit au cœur parce qu'aucun des
 * deux paquets n'importe l'autre.
 */
export interface ILoginPageDescription {
  /** Chemin où la page est servie (`loginPage.path`). */
  readonly path: string;
  /** Titre de la page, ou `null` pour le titre par défaut. */
  readonly title: string | null;
  /** Adresse du logo, ou `null` pour celui de Nodefony. */
  readonly logo: string | null;
  /** Gabarit `.eta` de l'application qui remplace celui du framework, ou `null`. */
  readonly template: string | null;
  /** Titre de la carte et de l'onglet, ou `null` pour « Se connecter ». */
  readonly heading: string | null;
  /** Ligne sous le titre, ou `null` pour la phrase déduite des moyens proposés. */
  readonly subtitle: string | null;
  /** Feuille de l'application chargée APRÈS celle du framework, ou `null`. */
  readonly stylesheet: string | null;
  /** Les fournisseurs passent-ils avant le formulaire (quand il y en a) ? */
  readonly providersFirst: boolean;
  /**
   * Panneau d'illustration : `null` = vitrine Nodefony, `false` = marque seule,
   * sinon le contenu qui la remplace.
   */
  readonly hero: ILoginPageHero | false | null;
  /** Pied de page : protections de la session et mention du framework. */
  readonly footer: boolean;
  /** Mode de mise en page. */
  readonly layout: LoginPageLayout;
  /** Le formulaire identifiant et mot de passe est-il proposé ? */
  readonly password: boolean;
  /** Fournisseurs à proposer, dans l'ordre de la configuration. */
  readonly providers: readonly ILoginPageProvider[];
}

/**
 * Base des fichiers de la page de connexion par défaut (script, feuille de
 * style). Distincte de la page elle-même, dont le chemin se règle
 * (`loginPage.path`) : ces fichiers ne changent pas d'adresse quand la page
 * en change.
 */
export const LOGIN_PAGE_ASSETS_BASE = "/nodefony/security/login";

/** Script de la page de connexion par défaut (bundle `nodefony/login.js`). */
export const LOGIN_PAGE_SCRIPT_PATH = `${LOGIN_PAGE_ASSETS_BASE}/login.js`;

/** Feuille de style de la page de connexion par défaut. */
export const LOGIN_PAGE_STYLE_PATH = `${LOGIN_PAGE_ASSETS_BASE}/login.css`;
