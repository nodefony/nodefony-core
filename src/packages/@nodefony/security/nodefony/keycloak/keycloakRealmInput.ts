import type {
  IKeycloakMachineInput,
  IKeycloakRealmInput,
  IKeycloakRoleInput,
} from "./keycloakRealm.js";
import { DEFAULT_LOGIN_PAGE_SKIN, type LoginPageSkin } from "nodefony";
import type { ISecurityConfig } from "../config/config.js";
import { KEYCLOAK_THEME_NAME } from "./scaffold.js";

/** Un fournisseur OAuth tel que la config validée le rend. */
type TProvider = ISecurityConfig["oauth2"]["providers"][string];

/**
 * Les ports de l'application, lus dans `servers` de sa configuration.
 *
 * L'HÔTE n'en fait pas partie : le domaine de la config est une adresse
 * d'ÉCOUTE (`127.0.0.1`, `0.0.0.0`), pas celle que tape le navigateur. Celle-ci
 * est l'hôte de `redirectUri`, que Keycloak compare au caractère près.
 */
export interface IAppServers {
  /** Port HTTP, `null` si le serveur en clair est coupé. */
  readonly httpPort: number | null;
  /** Port HTTPS, `null` si le serveur TLS est coupé. */
  readonly httpsPort: number | null;
}

/** Ce qu'il faut savoir de l'application pour dériver son realm. */
export interface IKeycloakRealmContext {
  /** Nom du fournisseur dans `oauth2.providers` (défaut `keycloak`). */
  readonly providerName: string;
  /** La configuration de sécurité VALIDÉE. */
  readonly config: ISecurityConfig;
  readonly servers: IAppServers;
  /**
   * `true` en production : aucun secret écrit (Keycloak le génère, l'exploitant
   * le copie dans son gestionnaire), aucune adresse locale de développement.
   */
  readonly production: boolean;
  /** Client machine à tenir à jour ; `null` = aucun. */
  readonly machine: IKeycloakMachineInput | null;
  /**
   * Origine que Keycloak utilise pour JOINDRE l'application (canal arrière).
   * Défaut développement : `http://host.docker.internal:<port http>` — le
   * Keycloak du compose vit dans un conteneur, `localhost` y désigne le sien.
   */
  readonly backchannelOrigin?: string;
  /**
   * `loginTheme` du realm déjà écrit, `null` s'il n'en déclare pas (ou s'il
   * n'existe pas encore). Seul un realm déjà habillé par Nodefony change
   * d'habillage : un thème propre à l'application n'est jamais remplacé.
   */
  readonly currentLoginTheme?: string | null;
}

/** Une dérivation, et ce qu'elle a remarqué en chemin. */
export interface IKeycloakRealmDerivation {
  readonly input: IKeycloakRealmInput;
  /** Constats à DIRE à l'utilisateur (le realm reste écrit). */
  readonly warnings: string[];
}

/** Erreur de dérivation : la config ne permet pas d'écrire un realm. */
export class KeycloakRealmError extends Error {
  override readonly name = "KeycloakRealmError";
}

/**
 * Le nom du realm, lu dans l'émetteur (`https://kc.example/realms/<nom>`).
 *
 * @throws {KeycloakRealmError} Si l'émetteur n'a pas la forme Keycloak
 */
export function realmNameFromIssuer(issuer: string | undefined): string {
  if (issuer === undefined) {
    throw new KeycloakRealmError(
      "le fournisseur n'a pas d'`issuer` : c'est l'adresse du realm (https://…/realms/<nom>)",
    );
  }
  let pathname: string;
  try {
    pathname = new URL(issuer).pathname;
  } catch {
    throw new KeycloakRealmError(`issuer « ${issuer} » n'est pas une URL`);
  }
  const match = /\/realms\/([^/]+)\/?$/u.exec(pathname);
  if (match?.[1] === undefined) {
    throw new KeycloakRealmError(
      `issuer « ${issuer} » ne finit pas par /realms/<nom> : ce n'est pas l'adresse d'un realm Keycloak`,
    );
  }
  return decodeURIComponent(match[1]);
}

/** Les ressources de toutes les zones qui acceptent des jetons tiers. */
function externalJwtResources(config: ISecurityConfig): string[] {
  const resources: string[] = [];
  for (const area of Object.values(config.areas)) {
    if (!area.authenticators.includes("external-jwt")) continue;
    if (area.resource !== undefined && !resources.includes(area.resource)) {
      resources.push(area.resource);
    }
  }
  return resources;
}

/** Le chemin du callback, réécrit en celui de la déconnexion par canal arrière. */
function backchannelPath(callbackPath: string): string {
  return callbackPath.replace(/\/callback\/?$/u, "/backchannel-logout");
}

/**
 * Dérive, depuis la configuration EFFECTIVE de l'application, ce que son realm
 * Keycloak doit dire.
 *
 * - **Client** : `clientId`, et son secret hors production.
 * - **URL de retour** : `redirectUri` du fournisseur, plus — hors production —
 *   le même chemin sur chaque serveur local (http ET https), parce que
 *   l'application répond sur les deux et que Keycloak compare au caractère près.
 * - **Audience** : `audiences` du fournisseur, sinon la `resource` de chaque
 *   zone `external-jwt`. Une audience qu'aucune zone ne porte est DITE : le
 *   jeton serait refusé partout.
 * - **Rôles** : les clés de `roleMapping`, rangées selon `rolesSource`.
 *
 * @param ctx - la configuration et le décor de l'application
 * @returns l'entrée du constructeur de realm et les constats
 * @throws {KeycloakRealmError} Si le fournisseur est absent ou sans émetteur
 */
/**
 * Le thème Keycloak de connexion qui porte un habillage de la page `/login`.
 *
 * @param skin - habillage (`loginPage.skin`)
 * @returns `nodefony` pour l'habillage par défaut, `nodefony-<habillage>` sinon
 *   (thème enfant livré sous `keycloak/themes/`)
 */
export function keycloakLoginTheme(skin: LoginPageSkin): string {
  return skin === DEFAULT_LOGIN_PAGE_SKIN
    ? KEYCLOAK_THEME_NAME
    : `${KEYCLOAK_THEME_NAME}-${skin}`;
}

/**
 * Dit si un thème Keycloak est l'un de ceux que livre Nodefony.
 *
 * @param theme - nom du thème
 * @returns `true` pour `nodefony` et `nodefony-<habillage>`
 */
export function isNodefonyKeycloakTheme(theme: string): boolean {
  return (
    theme === KEYCLOAK_THEME_NAME || theme.startsWith(`${KEYCLOAK_THEME_NAME}-`)
  );
}

export function deriveKeycloakRealmInput(
  ctx: IKeycloakRealmContext,
): IKeycloakRealmDerivation {
  const provider: TProvider | undefined =
    ctx.config.oauth2.providers[ctx.providerName];
  if (provider === undefined) {
    const known = Object.keys(ctx.config.oauth2.providers);
    throw new KeycloakRealmError(
      `aucun fournisseur « ${ctx.providerName} » dans oauth2.providers` +
        (known.length > 0
          ? ` (déclarés : ${known.join(", ")})`
          : " — il n'est monté que si ses variables NF_KEYCLOAK_* sont posées"),
    );
  }
  const warnings: string[] = [];
  const realm = realmNameFromIssuer(provider.issuer);
  const callback = new URL(provider.redirectUri);

  const origins: string[] = [];
  if (!ctx.production) {
    const host = callback.hostname;
    if (ctx.servers.httpsPort !== null) {
      origins.push(`https://${host}:${ctx.servers.httpsPort}`);
    }
    if (ctx.servers.httpPort !== null) {
      origins.push(`http://${host}:${ctx.servers.httpPort}`);
    }
  }
  if (!origins.includes(callback.origin)) origins.unshift(callback.origin);
  const redirectUris = origins.map((o) => `${o}${callback.pathname}`);

  const backOrigin =
    ctx.backchannelOrigin ??
    (ctx.production || ctx.servers.httpPort === null
      ? callback.origin
      : `http://host.docker.internal:${ctx.servers.httpPort}`);

  const resources = externalJwtResources(ctx.config);
  const audiences = provider.audiences ?? resources;
  for (const audience of audiences) {
    if (!resources.includes(audience)) {
      warnings.push(
        `audience « ${audience} » : aucune zone external-jwt ne porte cette resource — ` +
          `un jeton qui la porte est refusé partout`,
      );
    }
  }
  if (provider.audiences === undefined && resources.length > 1) {
    warnings.push(
      `${resources.length} zones external-jwt, audiences déduites de TOUTES — ` +
        `écrire oauth2.providers.${ctx.providerName}.audiences si l'une doit refuser ses jetons`,
    );
  }

  const sources = provider.rolesSource ?? ["client"];
  const roles: IKeycloakRoleInput[] = Object.entries(
    provider.roleMapping ?? {},
  ).map(([name, to]) => ({
    name,
    description: `Traduit en ${to} par la table roleMapping du fournisseur ${ctx.providerName}.`,
  }));
  if (sources.includes("groups") && roles.length > 0) {
    warnings.push(
      "rolesSource « groups » : les groupes et leur mapper se déclarent dans la console Keycloak, " +
        "ce realm ne les écrit pas",
    );
  }

  // L'habillage suit `loginPage.skin`, mais seulement sur un realm déjà
  // habillé par Nodefony : un thème de l'application lui appartient.
  const skin = ctx.config.loginPage.skin;
  const current = ctx.currentLoginTheme ?? null;
  const loginTheme =
    current !== null && isNodefonyKeycloakTheme(current)
      ? keycloakLoginTheme(skin)
      : null;
  if (loginTheme === null && skin !== DEFAULT_LOGIN_PAGE_SKIN) {
    warnings.push(
      `loginPage.skin « ${skin} » non appliqué à Keycloak : le realm ` +
        (current === null
          ? "ne déclare aucun thème de connexion"
          : `utilise le thème « ${current} », qui n'est pas un thème Nodefony`) +
        ` — poser loginTheme « ${keycloakLoginTheme(skin)} » à la main si c'est voulu`,
    );
  }

  return {
    input: {
      realm,
      clientId: provider.clientId,
      clientSecret: ctx.production ? null : provider.clientSecret,
      redirectUris,
      postLogoutRedirectUris: origins.map((o) => `${o}/*`),
      backchannelLogoutUrl: `${backOrigin}${backchannelPath(callback.pathname)}`,
      audiences,
      clientRoles: sources.includes("client") ? roles : [],
      realmRoles: sources.includes("realm") ? roles : [],
      machine: ctx.machine,
      ...(loginTheme === null ? {} : { themes: { login: loginTheme } }),
    },
    warnings,
  };
}
