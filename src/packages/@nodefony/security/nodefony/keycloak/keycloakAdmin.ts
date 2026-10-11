import type { LoginPageSkin } from "nodefony";
import type { IOAuthCheck } from "../src/oauth/providerDiagnosis.js";
import type { ISecurityConfig } from "../config/config.js";
import {
  isNodefonyKeycloakTheme,
  keycloakLoginTheme,
  realmNameFromIssuer,
} from "./keycloakRealmInput.js";

/**
 * Client de l'API d'administration de Keycloak — le point d'entrée UNIQUE de
 * Nodefony vers cette API.
 *
 * Premier besoin : le thème de connexion d'un realm EXISTANT, que
 * `security:keycloak:realm --write` ne peut pas changer (Keycloak ne relit le
 * fichier d'import qu'à la création du realm). Les suivants — fermer une
 * session Keycloak, lire un compte, exporter — s'ajoutent ici en méthodes, sur
 * le même jeton et les mêmes gardes, au lieu de recopier l'appel.
 *
 * Il exige le compte d'administration du SERVEUR (realm `master`) : il est
 * refusé hors développement, quoi que dise la configuration. Le service
 * `keycloak` (`KeycloakService.admin()`) le rend, un par fournisseur.
 *
 * @module
 */

/** Le compte d'administration du serveur Keycloak (realm `master`). */
export interface IKeycloakAdminCredentials {
  readonly username: string;
  readonly password: string;
}

/** Le serveur à joindre et le compte qui l'administre. */
export interface IKeycloakAdminTarget {
  /** Émetteur du fournisseur — l'adresse du realm (`https://…/realms/<nom>`). */
  readonly issuer: string;
  readonly admin: IKeycloakAdminCredentials;
}

/** Ce que le client doit savoir. */
export interface IKeycloakAdminClientOptions extends IKeycloakAdminTarget {
  /** Environnement du kernel : tout autre que `development` est refusé. */
  readonly environment: string;
  /** Transport (défaut : `fetch` global) — injecté par les tests. */
  readonly fetch?: typeof globalThis.fetch | undefined;
  /** Délai de chaque appel, en millisecondes (défaut 10 s). */
  readonly timeoutMs?: number | undefined;
}

/**
 * Issue de {@link KeycloakAdminClient.applyLoginTheme} :
 * - `applied` : le thème a changé ;
 * - `unchanged` : le realm portait déjà ce thème ;
 * - `unmanaged` : le realm porte un thème qui n'est pas de Nodefony (ou
 *   aucun) — il appartient à l'application, rien n'est touché.
 */
export type KeycloakLoginThemeOutcome = "applied" | "unchanged" | "unmanaged";

/** Ce que le geste a constaté et fait. */
export interface IKeycloakLoginThemeResult {
  readonly realm: string;
  /** Thème du realm AVANT le geste ; `null` s'il n'en déclarait aucun. */
  readonly previous: string | null;
  /** Thème que l'habillage demande. */
  readonly theme: string;
  readonly outcome: KeycloakLoginThemeOutcome;
}

/** Refus ou échec d'un appel ; le message nomme la cause et le geste suivant. */
export class KeycloakAdminError extends Error {
  /**
   * @param message - phrase destinée à l'opérateur
   * @param status - statut HTTP de Keycloak, `null` s'il n'a pas répondu
   */
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "KeycloakAdminError";
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Marge retirée à la durée de vie du jeton : un jeton qui expire PENDANT un
 * appel rend un 401 qu'on lirait comme un compte refusé.
 */
const TOKEN_MARGIN_MS = 10_000;

/**
 * Le realm et le compte d'administration d'un fournisseur, lus dans la
 * configuration de sécurité VALIDÉE.
 *
 * @param config - configuration de sécurité (`defineSecurityConfig`)
 * @param providerName - nom dans `oauth2.providers` (défaut `keycloak`)
 * @returns l'émetteur et le compte
 * @throws {KeycloakAdminError} Fournisseur absent, sans émetteur ou sans
 *   compte d'administration
 */
export function keycloakAdminTarget(
  config: ISecurityConfig,
  providerName = "keycloak",
): IKeycloakAdminTarget {
  const provider = Object.hasOwn(config.oauth2.providers, providerName)
    ? config.oauth2.providers[providerName]
    : undefined;
  if (provider?.issuer === undefined) {
    throw new KeycloakAdminError(
      `aucun fournisseur « ${providerName} » avec un issuer dans ` +
        `oauth2.providers — il n'est monté que si ses variables NF_KEYCLOAK_* ` +
        `sont posées`,
    );
  }
  if (provider.admin === undefined) {
    throw new KeycloakAdminError(
      `oauth2.providers.${providerName}.admin absent : l'API d'administration ` +
        `exige le compte administrateur de Keycloak (NF_KEYCLOAK_ADMIN_USERNAME / ` +
        `NF_KEYCLOAK_ADMIN_PASSWORD, passés en développement seulement)`,
    );
  }
  return { issuer: provider.issuer, admin: provider.admin };
}

/**
 * Client de l'API d'administration d'UN realm Keycloak.
 *
 * Le jeton `admin-cli` est demandé au premier appel puis GARDÉ jusqu'à son
 * expiration ; un 401 en cours de route le renouvelle une fois. Les gardes
 * (développement seulement, https seulement) sont tenues au constructeur :
 * un client qui existe a le droit de parler.
 */
export class KeycloakAdminClient {
  /** Nom du realm administré. */
  readonly realm: string;
  /** Origine du serveur (`https://hôte:port`). */
  readonly origin: string;
  readonly #admin: IKeycloakAdminCredentials;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  #token: { value: string; expiresAt: number } | null = null;

  /**
   * @param options - realm, compte, environnement, transport
   * @throws {KeycloakAdminError} Hors développement, émetteur qui n'est pas un
   *   realm, ou émetteur en clair
   */
  constructor(options: IKeycloakAdminClientOptions) {
    if (options.environment !== "development") {
      throw new KeycloakAdminError(
        `refusé en « ${options.environment} » : l'API d'administration exige ` +
          `le compte administrateur de Keycloak, réservé au développement — ` +
          `en production, passer par la console (Realm settings)`,
      );
    }
    try {
      this.realm = realmNameFromIssuer(options.issuer);
    } catch (error) {
      throw new KeycloakAdminError(
        error instanceof Error ? error.message : String(error),
      );
    }
    const url = new URL(options.issuer);
    if (url.protocol !== "https:") {
      throw new KeycloakAdminError(
        `émetteur « ${options.issuer} » en clair : le mot de passe ` +
          `administrateur ne part qu'en https`,
      );
    }
    this.origin = url.origin;
    this.#admin = options.admin;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Un appel à l'API d'administration du realm, jeton joint.
   *
   * @param method - verbe HTTP
   * @param path - chemin SOUS `/admin/realms/<realm>` (`""` = le realm, `/users?…`)
   * @param body - corps JSON, ou rien
   * @returns la réponse brute — au consommateur de lire son statut
   * @throws {KeycloakAdminError} Serveur injoignable ou compte refusé
   */
  async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const url = `${this.origin}/admin/realms/${encodeURIComponent(this.realm)}${path}`;
    const send = async (token: string): Promise<Response> =>
      this.#call(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const response = await send(await this.#accessToken());
    if (response.status !== 401) return response;
    // Jeton révoqué ou serveur redémarré : un seul renouvellement.
    await response.body?.cancel();
    this.#token = null;
    return send(await this.#accessToken());
  }

  /**
   * La représentation du realm.
   *
   * @returns l'objet JSON rendu par Keycloak
   * @throws {KeycloakAdminError} Realm introuvable ou lecture refusée
   */
  async getRealm(): Promise<Record<string, unknown>> {
    const response = await this.request("GET", "");
    if (!response.ok) {
      await response.body?.cancel();
      throw new KeycloakAdminError(
        response.status === 404
          ? `realm « ${this.realm} » introuvable sur ${this.origin}`
          : `lecture du realm « ${this.realm} » refusée (HTTP ${response.status})`,
        response.status,
      );
    }
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new KeycloakAdminError(
        `Keycloak a rendu autre chose qu'un realm pour « ${this.realm} »`,
      );
    }
    return Object.fromEntries(Object.entries(body));
  }

  /**
   * Change des champs du realm — et eux seuls : Keycloak ne touche pas aux
   * champs absents d'un `PUT` partiel.
   *
   * @param changes - les champs à écrire
   * @throws {KeycloakAdminError} Écriture refusée
   */
  async updateRealm(changes: Record<string, unknown>): Promise<void> {
    const response = await this.request("PUT", "", changes);
    await response.body?.cancel();
    if (!response.ok) {
      throw new KeycloakAdminError(
        `écriture refusée sur le realm « ${this.realm} » (HTTP ${response.status})`,
        response.status,
      );
    }
  }

  /**
   * Pose sur le realm le thème de connexion qui porte un habillage de `/login`.
   *
   * Un realm habillé par l'application (thème ni `nodefony` ni `nodefony-*`,
   * ou aucun) n'est JAMAIS modifié : même règle que la dérivation du fichier
   * d'import.
   *
   * @param skin - habillage (`loginPage.skin`, ou celui d'un aperçu)
   * @returns le thème d'avant, celui demandé, et ce qui a été fait
   * @throws {KeycloakAdminError} Keycloak injoignable, compte refusé, realm
   *   introuvable
   */
  async applyLoginTheme(
    skin: LoginPageSkin,
  ): Promise<IKeycloakLoginThemeResult> {
    const theme = keycloakLoginTheme(skin);
    const current = (await this.getRealm()).loginTheme;
    const previous =
      typeof current === "string" && current.length > 0 ? current : null;
    const realm = this.realm;
    if (previous === null || !isNodefonyKeycloakTheme(previous)) {
      return { realm, previous, theme, outcome: "unmanaged" };
    }
    if (previous === theme) {
      return { realm, previous, theme, outcome: "unchanged" };
    }
    await this.updateRealm({ loginTheme: theme });
    return { realm, previous, theme, outcome: "applied" };
  }

  /** Le jeton `admin-cli`, gardé jusqu'à son expiration. */
  async #accessToken(): Promise<string> {
    if (this.#token !== null && this.#token.expiresAt > Date.now()) {
      return this.#token.value;
    }
    const response = await this.#call(
      `${this.origin}/realms/master/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "password",
          client_id: "admin-cli",
          username: this.#admin.username,
          password: this.#admin.password,
        }).toString(),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new KeycloakAdminError(
        `compte administrateur refusé par Keycloak (HTTP ${response.status}, ` +
          `realm master) — vérifier NF_KEYCLOAK_ADMIN_USERNAME et ` +
          `NF_KEYCLOAK_ADMIN_PASSWORD`,
        response.status,
      );
    }
    const payload: unknown = await response.json();
    const field = (key: string): unknown =>
      typeof payload === "object" && payload !== null
        ? Object.getOwnPropertyDescriptor(payload, key)?.value
        : undefined;
    const accessToken = field("access_token");
    const expiresIn = field("expires_in");
    if (typeof accessToken !== "string" || accessToken === "") {
      throw new KeycloakAdminError(
        "Keycloak n'a rendu aucun jeton d'administration",
      );
    }
    const lifetimeMs = typeof expiresIn === "number" ? expiresIn * 1000 : 0;
    this.#token = {
      value: accessToken,
      expiresAt: Date.now() + lifetimeMs - TOKEN_MARGIN_MS,
    };
    return accessToken;
  }

  /** Un appel réseau borné ; une panne devient une erreur qui nomme le serveur. */
  async #call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.#fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      const cause =
        error instanceof Error && error.cause instanceof Error
          ? ` (${error.cause.message})`
          : "";
      throw new KeycloakAdminError(
        `Keycloak injoignable à ${this.origin} : ` +
          `${error instanceof Error ? error.message : String(error)}${cause}`,
      );
    }
  }
}

/**
 * Le thème de connexion qu'une page servie par Keycloak charge.
 *
 * Lu sans aucun identifiant : la page d'autorisation publique charge ses
 * fichiers sous `/resources/<version>/login/<thème>/…`.
 *
 * @param html - début de la page d'autorisation
 * @returns le nom du thème, ou `null` si la page n'est pas celle de Keycloak
 */
export function readKeycloakLoginTheme(html: string): string | null {
  const match = /\/resources\/[^/"'\s]+\/login\/([^/"'\s]+)\//u.exec(html);
  return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
}

/**
 * La sonde « thème » du diagnostic d'un fournisseur : la page de Keycloak
 * suit-elle l'habillage de `/login` ?
 *
 * @param skin - habillage configuré (`loginPage.skin`)
 * @returns une fonction qui juge la page d'autorisation ; elle rend `null` —
 *   aucune sonde — sur une page qui n'est pas de Keycloak
 */
export function keycloakLoginThemeCheck(
  skin: LoginPageSkin,
): (html: string) => IOAuthCheck | null {
  const expected = keycloakLoginTheme(skin);
  return (html) => {
    const active = readKeycloakLoginTheme(html);
    if (active === null) return null;
    if (!isNodefonyKeycloakTheme(active)) {
      return {
        name: "theme",
        status: "ok",
        message: `thème « ${active} » propre à l'application, laissé tel quel`,
      };
    }
    if (active === expected) {
      return {
        name: "theme",
        status: "ok",
        message: `la page de Keycloak suit l'habillage « ${skin} » (${active})`,
      };
    }
    return {
      name: "theme",
      status: "failed",
      kind: "login-theme-mismatch",
      message:
        `Keycloak affiche le thème « ${active} », l'habillage « ${skin} » ` +
        `demande « ${expected} » — la connexion marche, mais ne ressemble pas ` +
        `à /login : nodefony security:keycloak:realm --apply ` +
        `(ou Realm settings › Themes)`,
    };
  };
}
