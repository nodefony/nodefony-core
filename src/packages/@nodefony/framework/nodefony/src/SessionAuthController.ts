import type { Module } from "nodefony";
import type { ContextType, HTTPMethod } from "@nodefony/http";
import Router from "../service/router";
import Controller from "./Controller";

/**
 * Vue MINIMALE du flux de session BFF que consomme ce controller — le service
 * `authFlow` est posé au container par `@nodefony/security` (P6 J3). Contrat
 * structurel local : framework ne dépend JAMAIS de security (c'est http, sous
 * framework, que security décore) ; le couplage se fait par nom de service,
 * comme `adminBroker`.
 */
export interface ISessionAuthFlow {
  login(
    context: ContextType,
    identifier: unknown,
    password: unknown,
  ): Promise<unknown>;
  logout(context: ContextType): Promise<boolean>;
  me(context: ContextType): Promise<unknown | null>;
}

// Montage one-shot par process (même sémantique que `Router.setController`,
// qui fige `module` sur le prototype) — un re-boot en test ne re-crée rien.
let mounted = false;

/**
 * Endpoints HTTP du flux de session BFF — adaptateurs MINCES au-dessus du
 * service `authFlow` (`@nodefony/security`) :
 *
 *  - `POST /nodefony/security/api/auth/login`  — body JSON `{username, password}`
 *  - `POST /nodefony/security/api/auth/logout` — idempotent
 *  - `GET  /nodefony/security/api/auth/me`     — identité de la session courante
 *
 * Montés par le module framework UNIQUEMENT si le service `authFlow` existe
 * (module security chargé) — sans lui, les routes n'existent pas (404, zéro
 * surface). Remplace les mocks `/nodefony/studio/api/auth/*` de Studio.
 *
 * Erreurs : mappées par DUCK-TYPING sur `code` (401/429) — framework ne peut
 * pas importer les classes d'erreur de security. Un 429 reporte le
 * `Retry-After` (RFC 6585) posé par le throttler NIST ; tout le reste remonte
 * au pipeline d'erreurs standard (500, détail loggé jamais fuité).
 *
 * @remarks Dérogation RFC 7235 §3.1 DÉLIBÉRÉE : les 401 de `login`/`me` ne
 * portent PAS de `WWW-Authenticate` — aucun scheme HTTP ne décrit un cookie de
 * session, et un challenge `Basic` mensonger déclencherait le popup natif du
 * navigateur (l'anti-pattern que le BFF élimine). Les zones du firewall, elles,
 * restent strictement conformes (challenge du premier authenticator qui en
 * déclare un).
 */
class SessionAuthController extends Controller {
  constructor(context: ContextType) {
    super("SessionAuthController", context);
  }

  /** Login BFF : credential JSON présenté UNE fois → cookie de session opaque. */
  async login() {
    const flow = this.#flow();
    if (!flow) {
      return this.renderJson({ error: "Authentication unavailable" }, 503);
    }
    const body = (this.queryPost ?? {}) as {
      username?: unknown;
      password?: unknown;
    };
    try {
      const user = await flow.login(
        this.context as ContextType,
        body.username,
        body.password,
      );
      return this.renderJson({ user });
    } catch (e) {
      return this.#renderAuthError(e);
    }
  }

  /** Détruit la session (storage + cookie). Toujours 200 (idempotent). */
  async logout() {
    const flow = this.#flow();
    if (!flow) {
      return this.renderJson({ error: "Authentication unavailable" }, 503);
    }
    await flow.logout(this.context as ContextType);
    return this.renderJson({ ok: true });
  }

  /** Identité de la session courante, re-résolue (rôles frais), ou 401. */
  async me() {
    const flow = this.#flow();
    if (!flow) {
      return this.renderJson({ error: "Authentication unavailable" }, 503);
    }
    const user = await flow.me(this.context as ContextType);
    if (user === null) {
      return this.renderJson({ error: "Unauthorized" }, 401);
    }
    return this.renderJson({ user });
  }

  #flow(): ISessionAuthFlow | null {
    return this.get<ISessionAuthFlow>("authFlow") ?? null;
  }

  // 401 → message uniforme (anti-énumération) ; 429 → Retry-After (RFC 6585,
  // jamais wrappé 401) ; le reste → pipeline 500 (fail-closed, zéro fuite).
  #renderAuthError(e: unknown) {
    const code = (e as { code?: unknown }).code;
    if (code === 429) {
      const retry = (e as { retryAfterS?: unknown }).retryAfterS;
      return this.renderJson({ error: "Too many attempts" }, 429, {
        "retry-after": String(typeof retry === "number" ? retry : 1),
      });
    }
    if (code === 401) {
      return this.renderJson({ error: "Invalid credentials" }, 401);
    }
    throw e;
  }
}

/**
 * Monte les routes du flux de session BFF — appelé par le module framework à
 * `onKernelReady`, seulement si le service `authFlow` est présent.
 *
 * Routes nommées `security.auth.*` (espace data plane
 * `/nodefony/security/api/*`, convention « toujours ≥ 3 segments »). HTTP-only :
 * la sémantique session-par-socket du pont WS-RPC n'est pas conçue (P6+).
 */
export function mountSessionAuthRoutes(frameworkModule: Module): void {
  if (mounted) return;
  const base = "/nodefony/security/api/auth";
  const routes: Array<[string, string, HTTPMethod, string]> = [
    ["security.auth.login", `${base}/login`, "POST", "login"],
    ["security.auth.logout", `${base}/logout`, "POST", "logout"],
    ["security.auth.me", `${base}/me`, "GET", "me"],
  ];
  for (const [name, path, method, classMethod] of routes) {
    Router.createRoute(name, {
      path,
      constructor:
        SessionAuthController as unknown as Controller["constructor"],
      classMethod,
      requirements: { methods: [method] },
      // Ces routes SONT le mécanisme d'auth : l'aire data plane
      // (/nodefony/security/api/* la matche) ne peut pas les garder, sinon le
      // login exigerait d'être déjà loggé (deadlock). Le controller applique sa
      // propre sémantique (401 sans challenge — dérogation RFC 7235 §3.1, supra).
      bypassFirewall: true,
    });
  }
  if (
    !Object.prototype.hasOwnProperty.call(
      SessionAuthController.prototype,
      "module",
    )
  ) {
    Router.setController(
      SessionAuthController as unknown as Parameters<
        typeof Router.setController
      >[0],
      frameworkModule,
    );
  }
  mounted = true;
}

export default SessionAuthController;
