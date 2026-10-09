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
 * Chemin par défaut de la page de connexion servie par le framework.
 *
 * Défaut de `security.loginPage.path`, et donc de la redirection d'échec d'un
 * fournisseur : une seule écriture, pour que « là où l'on renvoie » et « là où
 * la page existe » ne puissent pas diverger.
 */
export const LOGIN_PAGE_PATH = "/login";

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
