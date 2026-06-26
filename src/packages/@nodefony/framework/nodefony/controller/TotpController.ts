import type { Module } from "nodefony";
import type { ContextType, HTTPMethod } from "@nodefony/http";
import Router from "../service/router";
import Controller from "../src/Controller";

/** Vue minimale de l'utilisateur courant (`authFlow.me`) — anti-IDOR. */
interface ISafeUserLike {
  username: string;
}

/** Vue locale du flux de session BFF (service `authFlow`, posé par security). */
interface ISessionAuthFlow {
  me(context: ContextType): Promise<ISafeUserLike | null>;
}

/**
 * Vue locale du service `totp` (`@nodefony/security` P6.17). Contrat structurel
 * — framework ne dépend JAMAIS de security ; couplage par nom de service.
 */
interface ITotpManager {
  isEnabled(): boolean;
  beginEnrollment(
    userId: string,
    account: string,
  ): Promise<{ secretBase32: string; otpauthUri: string }>;
  confirmEnrollment(
    userId: string,
    code: string,
  ): Promise<{ recoveryCodes: string[] }>;
  disable(userId: string): Promise<void>;
  status(userId: string): Promise<{
    enabled: boolean;
    pending: boolean;
    recoveryCodesRemaining: number;
  }>;
}

// Montage one-shot par process (même sémantique que `mountSessionAuthRoutes`).
let mounted = false;

/**
 * Endpoints HTTP **self-service 2FA TOTP (P6.17)** — console « ma sécurité »,
 * adaptateurs MINCES au-dessus du service `totp` (`@nodefony/security`) :
 *
 *  - `POST /nodefony/security/api/totp/enroll`  → `{secretBase32, otpauthUri}`
 *    (secret affiché 1× pour le QR ; secret PENDING tant que non confirmé)
 *  - `POST /nodefony/security/api/totp/confirm` — body `{code}` → `{recoveryCodes}`
 *    (active le 2FA ; codes de récupération affichés 1×)
 *  - `POST /nodefony/security/api/totp/disable` → `{ok}` (retire le 2FA)
 *  - `GET  /nodefony/security/api/totp/status`  → `{enabled, pending, recoveryCodesRemaining}`
 *
 * **PAS de `bypassFirewall`** (≠ login/totp) : ces routes vivent DANS la zone data
 * plane `^/nodefony/[^/]+/api(/|$)` → **session BFF requise**. Le sujet est
 * TOUJOURS l'utilisateur courant (`authFlow.me`), jamais un paramètre — on n'active
 * /ne désactive jamais le 2FA d'autrui (anti-IDOR). Montés seulement si le service
 * `totp` existe (security chargé + 2FA activé) → 404, zéro surface, sinon.
 */
class TotpController extends Controller {
  constructor(context: ContextType) {
    super("TotpController", context);
  }

  /** Démarre l'enrôlement : secret + URI otpauth affichés une seule fois. */
  async enroll() {
    const svc = this.#service();
    if (!svc) {
      return this.renderJson({ error: "2FA unavailable" }, 503);
    }
    const subject = await this.#currentSubject();
    if (subject === null) {
      return this.renderJson({ error: "Unauthorized" }, 401);
    }
    const enrollment = await svc.beginEnrollment(subject, subject);
    return this.renderJson(enrollment);
  }

  /** Confirme l'enrôlement par un 1ᵉʳ code → active + codes de récupération (1×). */
  async confirm() {
    const svc = this.#service();
    if (!svc) {
      return this.renderJson({ error: "2FA unavailable" }, 503);
    }
    const subject = await this.#currentSubject();
    if (subject === null) {
      return this.renderJson({ error: "Unauthorized" }, 401);
    }
    const code = (this.queryPost ?? ({} as { code?: unknown })).code;
    if (typeof code !== "string" || code.length === 0) {
      return this.renderJson({ error: "Invalid code" }, 400);
    }
    try {
      const activation = await svc.confirmEnrollment(subject, code);
      return this.renderJson(activation);
    } catch {
      // Code faux, enrôlement absent ou déjà confirmé — message uniforme (le
      // détail métier ne franchit pas la frontière HTTP).
      return this.renderJson({ error: "Invalid or expired code" }, 400);
    }
  }

  /** Désactive le 2FA du porteur courant (retire secret + codes). */
  async disable() {
    const svc = this.#service();
    if (!svc) {
      return this.renderJson({ error: "2FA unavailable" }, 503);
    }
    const subject = await this.#currentSubject();
    if (subject === null) {
      return this.renderJson({ error: "Unauthorized" }, 401);
    }
    await svc.disable(subject);
    return this.renderJson({ ok: true });
  }

  /** État 2FA du porteur courant (alimente la console « ma sécurité »). */
  async status() {
    const svc = this.#service();
    if (!svc) {
      return this.renderJson({ error: "2FA unavailable" }, 503);
    }
    const subject = await this.#currentSubject();
    if (subject === null) {
      return this.renderJson({ error: "Unauthorized" }, 401);
    }
    return this.renderJson(await svc.status(subject));
  }

  #service(): ITotpManager | null {
    const svc = this.get<ITotpManager>("totp");
    return svc && svc.isEnabled() ? svc : null;
  }

  #flow(): ISessionAuthFlow | null {
    return this.get<ISessionAuthFlow>("authFlow") ?? null;
  }

  /** Identifiant du porteur courant (session BFF revalidée), ou `null`. */
  async #currentSubject(): Promise<string | null> {
    const flow = this.#flow();
    if (!flow) return null;
    const me = await flow.me(this.context as ContextType);
    return me && typeof me.username === "string" ? me.username : null;
  }
}

/**
 * Monte les routes self-service 2FA — appelé par le module framework à
 * `onKernelReady`, seulement si le service `totp` est présent.
 *
 * Routes nommées `security.totp.*` (espace data plane `/nodefony/security/api/*`).
 * **Aucun `bypassFirewall`** : l'aire data plane (session BFF) les garde — gérer
 * son 2FA exige d'être authentifié.
 */
export function mountTotpRoutes(frameworkModule: Module): void {
  if (mounted) return;
  const base = "/nodefony/security/api/totp";
  const routes: Array<[string, string, HTTPMethod, string]> = [
    ["security.totp.enroll", `${base}/enroll`, "POST", "enroll"],
    ["security.totp.confirm", `${base}/confirm`, "POST", "confirm"],
    ["security.totp.disable", `${base}/disable`, "POST", "disable"],
    ["security.totp.status", `${base}/status`, "GET", "status"],
  ];
  for (const [name, path, method, classMethod] of routes) {
    Router.createRoute(name, {
      path,
      constructor: TotpController as unknown as Controller["constructor"],
      classMethod,
      requirements: { methods: [method] },
    });
  }
  if (
    !Object.prototype.hasOwnProperty.call(TotpController.prototype, "module")
  ) {
    Router.setController(
      TotpController as unknown as Parameters<typeof Router.setController>[0],
      frameworkModule,
    );
  }
  mounted = true;
}

export default TotpController;
