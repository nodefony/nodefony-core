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
  establishSessionFor(
    context: ContextType,
    identifier: string,
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
 * `options` et `verify`. Montés UNIQUEMENT si le service `webauthn` existe
 * (passkeys activés) — 404 sinon, zéro surface.
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

  /** Défi d'authentification — `username` optionnel (usernameless si absent). */
  async loginOptions() {
    const svc = this.#service();
    const flow = this.#flow();
    if (!svc || !flow) {
      return this.renderJson({ error: "WebAuthn unavailable" }, 503);
    }
    const username = this.#body().username;
    const options = await svc.generateAuthenticationOptions(
      typeof username === "string" && username.length > 0
        ? username
        : undefined,
    );
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
      );
      return this.renderJson({ verified: true, user });
    } catch (e) {
      return this.#renderAuthError(e);
    }
  }

  // ── Internes ─────────────────────────────────────────────────────────────────

  #service(): IWebAuthnService | null {
    const svc = this.get<IWebAuthnService>("webauthn");
    return svc && svc.isEnabled() ? svc : null;
  }

  #flow(): IWebAuthnBffFlow | null {
    return this.get<IWebAuthnBffFlow>("authFlow") ?? null;
  }

  #body(): { response?: unknown; username?: unknown } {
    return (this.queryPost ?? {}) as { response?: unknown; username?: unknown };
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

  // 401 → message uniforme (anti-énumération) ; le reste → pipeline 500.
  #renderAuthError(e: unknown) {
    if ((e as { code?: unknown }).code === 401) {
      return this.renderJson({ error: "WebAuthn verification failed" }, 401);
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
  const routes: Array<[string, string, HTTPMethod, string]> = [
    [
      "security.webauthn.register.options",
      `${base}/register/options`,
      "POST",
      "registerOptions",
    ],
    [
      "security.webauthn.register.verify",
      `${base}/register/verify`,
      "POST",
      "registerVerify",
    ],
    [
      "security.webauthn.login.options",
      `${base}/login/options`,
      "POST",
      "loginOptions",
    ],
    [
      "security.webauthn.login.verify",
      `${base}/login/verify`,
      "POST",
      "loginVerify",
    ],
  ];
  for (const [name, path, method, classMethod] of routes) {
    Router.createRoute(name, {
      path,
      constructor: WebAuthnController as unknown as Controller["constructor"],
      classMethod,
      requirements: { methods: [method] },
      // Ces routes SONT (ou précèdent) le mécanisme d'auth : l'aire data plane
      // ne peut pas les garder (login = pas encore loggé ; register vérifie la
      // session lui-même). Cf `mountSessionAuthRoutes`.
      bypassFirewall: true,
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
