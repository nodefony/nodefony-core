import type { Module } from "nodefony";
import type { ContextType, HTTPMethod } from "@nodefony/http";
import Router from "../service/router";
import Controller from "../src/Controller";

/**
 * Options de cérémonie renvoyées au navigateur (forme JSON WebAuthn) — seul le
 * `challenge` nous intéresse côté serveur (stocké en session, anti-replay) ; le
 * reste est relayé tel quel au client.
 */
type CeremonyOptions = { challenge: string } & Record<string, unknown>;

/**
 * Vue MINIMALE du service `webauthn` (`@nodefony/security`) — couplage par NOM
 * (framework ne dépend jamais de security ni de `@simplewebauthn`). Contrat
 * structurel imposé par cast (`this.get<…>`), aucune liaison de build.
 */
export interface IWebAuthnService {
  isEnabled(): boolean;
  generateRegistrationOptions(user: {
    id: string;
    name: string;
    displayName?: string;
  }): Promise<CeremonyOptions>;
  verifyRegistration(
    response: unknown,
    expectedChallenge: string,
    userId: string,
    requestOrigin?: string,
  ): Promise<{ id: string }>;
  generateAuthenticationOptions(userId?: string): Promise<CeremonyOptions>;
  verifyAuthentication(
    response: unknown,
    expectedChallenge: string,
    requestOrigin?: string,
  ): Promise<{ userId: string }>;
  listUserCredentials(userId: string): Promise<
    Array<{
      id: string;
      transports: string[];
      backupState: boolean;
      createdAt: number;
      lastUsedAt: number | null;
    }>
  >;
  removeUserCredential(userId: string, credentialId: string): Promise<boolean>;
}

/** Vue minimale d'une session — porte le challenge de cérémonie (anti-replay). */
export interface IWebAuthnSession {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
  save(): Promise<unknown>;
}

/** Vue minimale du flux de session BFF (`authFlow`) consommée ici. */
export interface IWebAuthnBffFlow {
  me(context: ContextType): Promise<{ username: string } | null>;
  /**
   * @param reason - facteur d'authentification journalisé par l'audit
   *   (`"webauthn"` ici). Omis, il retombe sur `"federated"`, qui ne distingue
   *   plus une passkey d'un login social dans le journal.
   */
  establishSessionFor(
    context: ContextType,
    identifier: string,
    reason?: string,
  ): Promise<unknown>;
  /** Garantit une session (la démarre si déconnecté) pour porter le challenge. */
  ensureSession(context: ContextType): Promise<IWebAuthnSession | null>;
}

// Clés de session portant le challenge en cours (anti-replay, à usage unique).
const REG_CHALLENGE = "webauthn:reg:challenge";
const AUTH_CHALLENGE = "webauthn:auth:challenge";

// Montage one-shot par process (même sémantique que `mountSessionAuthRoutes`).
let mounted = false;

/**
 * Endpoints HTTP des cérémonies **WebAuthn / passkeys** (P6 J9) — adaptateurs
 * MINCES au-dessus du service `webauthn` (`@nodefony/security`) :
 *
 *  - `POST /nodefony/security/api/webauthn/register/options` — défi de création
 *    (utilisateur DÉJÀ connecté : lie un passkey à son compte)
 *  - `POST /nodefony/security/api/webauthn/register/verify`  — vérifie + stocke
 *  - `POST /nodefony/security/api/webauthn/login/options`    — défi d'assertion
 *  - `POST /nodefony/security/api/webauthn/login/verify`     — vérifie + ouvre
 *    la session BFF (l'empreinte remplace le mot de passe)
 *
 * Le **challenge** est stocké côté serveur en session (jamais rejouable) entre
 * `options` et `verify`.
 *
 * **Deux conditions distinctes, deux réponses distinctes** : les routes ne sont
 * montées que si le service `webauthn` est dans le container (`framework/index.ts:400`),
 * c'est-à-dire dès que `@nodefony/security` est chargé — sans security, **404**,
 * zéro surface. Le service reste enregistré même passkeys DÉSACTIVÉS
 * (`@services` l'instancie inconditionnellement) : dans ce cas les routes existent
 * et répondent **503** (`isEnabled()` faux). Ne pas lire un 503 comme « route
 * absente », ni un 404 comme « passkeys coupés ».
 *
 * @remarks `bypassFirewall` : `login/*` précède toute authentification ;
 * `register/*` exige une session active, vérifiée ICI (`me()` → 401), pas par le
 * firewall (qui, sur l'aire data plane, déclencherait un deadlock identique au
 * login BFF).
 */
class WebAuthnController extends Controller {
  constructor(context: ContextType) {
    super("WebAuthnController", context);
  }

  /** Défi d'enregistrement — l'utilisateur connecté ajoute un passkey. */
  async registerOptions() {
    const svc = this.#service();
    const flow = this.#flow();
    if (!svc || !flow) {
      return this.renderJson({ error: "WebAuthn unavailable" }, 503);
    }
    const me = await flow.me(this.context as ContextType);
    if (!me) return this.renderJson({ error: "Unauthorized" }, 401);
    const options = await svc.generateRegistrationOptions({
      id: me.username,
      name: me.username,
    });
    const session = await flow.ensureSession(this.context as ContextType);
    session?.set(REG_CHALLENGE, options.challenge);
    await session?.save(); // PERSISTE le challenge (storage), pas juste en mémoire
    return this.renderJson(options);
  }

  /** Vérifie la réponse d'enregistrement et persiste le credential. */
  async registerVerify() {
    const svc = this.#service();
    if (!svc) return this.renderJson({ error: "WebAuthn unavailable" }, 503);
    const me = await this.#flow()?.me(this.context as ContextType);
    if (!me) return this.renderJson({ error: "Unauthorized" }, 401);
    const challenge = await this.#takeChallenge(REG_CHALLENGE);
    if (!challenge) return this.renderJson({ error: "No challenge" }, 400);
    try {
      const credential = await svc.verifyRegistration(
        this.#body().response,
        challenge,
        me.username,
        this.#origin(),
      );
      return this.renderJson({ verified: true, credentialId: credential.id });
    } catch (e) {
      return this.#renderAuthError(e);
    }
  }

  /**
   * Défi d'authentification. **Le ciblage ne vient jamais de la requête** : un
   * appelant anonyme obtient un défi découvrable (`allowCredentials` omis), un
   * appelant déjà authentifié obtient le sien (ré-authentification / step-up).
   *
   * @remarks Route en `bypassFirewall` : n'importe qui peut la poster. Peupler
   *   `allowCredentials` depuis un identifiant fourni dirait deux choses à cet
   *   inconnu — que le compte porte une passkey, et **lesquelles** (W3C WebAuthn
   *   L3, « Privacy leak via credential IDs » : un `credentialId` est un
   *   identifiant corrélable, exposé il dés-anonymise entre sites et confirme
   *   une hypothèse d'identité avec un accès momentané à l'authenticator). La
   *   spec propose deux remèdes, ce sont les deux régimes ci-dessous : les
   *   credentials découvrables pour l'anonyme, une **authentification préalable**
   *   quand on cible vraiment. Verrouillé par
   *   `tests/unit/webauthnLoginOptionsPrivacy.test.ts`.
   */
  async loginOptions() {
    const svc = this.#service();
    const flow = this.#flow();
    if (!svc || !flow) {
      return this.renderJson({ error: "WebAuthn unavailable" }, 503);
    }
    const me = await flow.me(this.context as ContextType);
    const options = await svc.generateAuthenticationOptions(me?.username);
    // Démarre une session MÊME déconnecté → porte le challenge anti-replay
    // jusqu'à la vérification (sinon « No challenge » au login).
    const session = await flow.ensureSession(this.context as ContextType);
    session?.set(AUTH_CHALLENGE, options.challenge);
    await session?.save(); // PERSISTE le challenge (storage), pas juste en mémoire
    return this.renderJson(options);
  }

  /** Vérifie l'assertion (empreinte) et OUVRE la session BFF. */
  async loginVerify() {
    const svc = this.#service();
    const flow = this.#flow();
    if (!svc || !flow) {
      return this.renderJson({ error: "WebAuthn unavailable" }, 503);
    }
    const challenge = await this.#takeChallenge(AUTH_CHALLENGE);
    if (!challenge) return this.renderJson({ error: "No challenge" }, 400);
    try {
      const { userId } = await svc.verifyAuthentication(
        this.#body().response,
        challenge,
        this.#origin(),
      );
      const user = await flow.establishSessionFor(
        this.context as ContextType,
        userId,
        "webauthn",
      );
      return this.renderJson({ verified: true, user });
    } catch (e) {
      return this.#renderAuthError(e);
    }
  }

  /** Liste les passkeys de l'utilisateur courant (console « mes appareils »). */
  async listCredentials() {
    const svc = this.#service();
    const flow = this.#flow();
    if (!svc || !flow) {
      return this.renderJson({ error: "WebAuthn unavailable" }, 503);
    }
    const me = await flow.me(this.context as ContextType);
    if (!me) return this.renderJson({ error: "Unauthorized" }, 401);
    const creds = await svc.listUserCredentials(me.username);
    return this.renderJson({
      credentials: creds.map((c) => ({
        id: c.id,
        transports: c.transports,
        backupState: c.backupState,
        createdAt: c.createdAt,
        lastUsedAt: c.lastUsedAt,
      })),
    });
  }

  /** Supprime une passkey DU porteur courant (sinon 404 — anti-IDOR/anti-énumération). */
  async removeCredential(id: unknown) {
    const svc = this.#service();
    const flow = this.#flow();
    if (!svc || !flow) {
      return this.renderJson({ error: "WebAuthn unavailable" }, 503);
    }
    const me = await flow.me(this.context as ContextType);
    if (!me) return this.renderJson({ error: "Unauthorized" }, 401);
    if (typeof id !== "string" || id.length === 0) {
      return this.renderJson({ error: "Not found" }, 404);
    }
    const ok = await svc.removeUserCredential(me.username, id);
    if (!ok) {
      return this.renderJson({ error: "Not found" }, 404);
    }
    return this.renderJson({ ok: true });
  }

  // ── Internes ─────────────────────────────────────────────────────────────────

  #service(): IWebAuthnService | null {
    const svc = this.get<IWebAuthnService>("webauthn");
    return svc && svc.isEnabled() ? svc : null;
  }

  #flow(): IWebAuthnBffFlow | null {
    return this.get<IWebAuthnBffFlow>("authFlow") ?? null;
  }

  /**
   * Corps utile des cérémonies : la réponse de l'authenticator, rien d'autre.
   * Aucun identifiant n'est lu ici — l'identité vient de la session, ou la
   * cérémonie est découvrable (cf {@link WebAuthnController.loginOptions}).
   */
  #body(): { response?: unknown } {
    return (this.queryPost ?? {}) as { response?: unknown };
  }

  /** Origine HTTP de la requête (validée par le service contre le rpID). */
  #origin(): string | undefined {
    const origin = (this.context as ContextType).request?.headers?.origin;
    return typeof origin === "string" ? origin : undefined;
  }

  /** Lit le challenge en session puis l'INVALIDE (usage unique, anti-replay). */
  async #takeChallenge(key: string): Promise<string | null> {
    const session = (this.context as ContextType).session;
    const value = session?.get(key);
    if (typeof value !== "string" || value.length === 0) return null;
    session?.set(key, null);
    await session?.save(); // persiste l'invalidation (anti-rejeu)
    return value;
  }

  // 401 → message uniforme (anti-énumération) ; 409 → plafond d'enrôlement
  // (message explicite : le porteur EST authentifié, rien à énumérer, et il doit
  // pouvoir comprendre qu'il faut retirer un appareil) ; le reste → pipeline 500.
  #renderAuthError(e: unknown) {
    const code = (e as { code?: unknown }).code;
    if (code === 401) {
      return this.renderJson({ error: "WebAuthn verification failed" }, 401);
    }
    if (code === 409) {
      return this.renderJson(
        { error: (e as Error).message ?? "Passkey limit reached" },
        409,
      );
    }
    throw e;
  }
}

/**
 * Monte les routes des cérémonies WebAuthn — appelé par le module framework à
 * `onKernelReady`, seulement si le service `webauthn` est présent.
 */
export function mountWebAuthnRoutes(frameworkModule: Module): void {
  if (mounted) return;
  const base = "/nodefony/security/api/webauthn";
  const routes: Array<[string, string, HTTPMethod, string, boolean]> = [
    // Cérémonies : SONT (ou précèdent) le mécanisme d'auth → bypassFirewall (login
    // = pas encore loggé ; register vérifie la session lui-même). Cf mountSessionAuthRoutes.
    [
      "security.webauthn.register.options",
      `${base}/register/options`,
      "POST",
      "registerOptions",
      true,
    ],
    [
      "security.webauthn.register.verify",
      `${base}/register/verify`,
      "POST",
      "registerVerify",
      true,
    ],
    [
      "security.webauthn.login.options",
      `${base}/login/options`,
      "POST",
      "loginOptions",
      true,
    ],
    [
      "security.webauthn.login.verify",
      `${base}/login/verify`,
      "POST",
      "loginVerify",
      true,
    ],
    // Self-service « mes passkeys » : session BFF REQUISE (≠ login) → PAS de bypass,
    // l'aire data plane garde ces routes (lister / supprimer SES propres clés).
    [
      "security.webauthn.credentials.list",
      `${base}/credentials`,
      "GET",
      "listCredentials",
      false,
    ],
    [
      "security.webauthn.credentials.remove",
      `${base}/credentials/{id}`,
      "DELETE",
      "removeCredential",
      false,
    ],
  ];
  for (const [name, path, method, classMethod, bypass] of routes) {
    Router.createRoute(name, {
      path,
      constructor: WebAuthnController as unknown as Controller["constructor"],
      classMethod,
      requirements: { methods: [method] },
      bypassFirewall: bypass,
    });
  }
  if (
    !Object.prototype.hasOwnProperty.call(
      WebAuthnController.prototype,
      "module",
    )
  ) {
    Router.setController(
      WebAuthnController as unknown as Parameters<
        typeof Router.setController
      >[0],
      frameworkModule,
    );
  }
  mounted = true;
}

export default WebAuthnController;
