import {
  Controller,
  controller,
  route,
  Get,
  Param,
  Session,
  UseSession,
} from "@nodefony/framework";
import { Context, HttpError, WebsocketContext } from "@nodefony/http";
import type { ISession } from "@nodefony/http";

/**
 * Controller DÉDIÉ au cycle de vie de session (le « plug runtime » — chantier
 * session étape 5). Volontairement **sans** `@UseSession` au niveau classe :
 * chaque route exerce une facette précise de l'activation (lazy, intent par
 * méthode, `@Session` param, readOnly, aire, reprise L1, regen, destroy) en
 * HTTP **et** WS. Sert de support aux tests unit/intégration/charge.
 */
@controller("/nodefony/test/session-rt")
class SessionRuntimeController extends Controller {
  constructor(context: Context) {
    super("SessionRuntimeController", context);
  }

  /** Contexte courant typé WebSocket (routes WS de ce controller). */
  private get wsCtx(): WebsocketContext | undefined {
    return this.context as WebsocketContext | undefined;
  }

  // ── Lazy : aucune déclaration → aucune session ──────────────────────────────

  /** Aucun `@UseSession`, aucun `@Session` param → DOIT rester sans session. */
  @Get("/lazy")
  lazy() {
    return this.renderJson({ hasSession: this.session != null });
  }

  // ── Activation par intent déclaré ───────────────────────────────────────────

  /** `@UseSession()` simple → session active, identifiant opaque présent. */
  @Get("/use")
  @UseSession()
  use() {
    return this.renderJson({
      hasSession: this.session != null,
      id: this.session?.id ?? null,
      status: this.session?.status ?? null,
    });
  }

  /**
   * Lecture seule : une mutation est tentée mais NE DOIT PAS être persistée
   * (`save` no-op). On expose le flag + l'état dirty pour l'assertion.
   */
  @Get("/readonly")
  @UseSession({ readOnly: true })
  readonly() {
    this.session?.set("ro-probe", Date.now());
    return this.renderJson({
      readOnly: this.session?.readOnly ?? null,
      dirty: this.session?.dirty ?? null,
    });
  }

  // ── Intent implicite par paramètre @Session ─────────────────────────────────

  /** Présence d'un `@Session()` param → intent implicite (pas de `@UseSession`). */
  @Get("/param")
  param(@Session() session: ISession | null) {
    return this.renderJson({
      hasSession: session != null,
      id: session?.id ?? null,
    });
  }

  /** `@Session("key")` → valeur d'attribut injectée directement. */
  @Get("/param-key/{key}")
  paramKey(@Param("key") key: string, @Session("ro-probe") probe: unknown) {
    return this.renderJson({ key, probe: probe ?? null });
  }

  // ── Attributs : set / get (persistance + reprise L1) ────────────────────────

  @route("session-rt-set", {
    path: "/set/{key}/{value}",
    requirements: { methods: "GET" },
  })
  @UseSession()
  setAttr(key: string, value: string) {
    const session = this.getSession();
    if (!session) throw new HttpError("Session not started", 500, this.context);
    session.set(key, value);
    return this.renderJson({ id: session.id, key, value });
  }

  @route("session-rt-get", {
    path: "/get/{key}",
    requirements: { methods: "GET" },
  })
  @UseSession()
  getAttr(key: string) {
    const session = this.getSession();
    if (!session) throw new HttpError("Session not started", 500, this.context);
    return this.renderJson({ id: session.id, key, value: session.get(key) });
  }

  // ── FlashBag (consommé à la lecture) ────────────────────────────────────────

  @route("session-rt-flash-set", {
    path: "/flash/{key}/{value}",
    requirements: { methods: "GET" },
  })
  @UseSession()
  flashSet(key: string, value: string) {
    const session = this.getSession();
    if (!session) throw new HttpError("Session not started", 500, this.context);
    session.setFlashBag(key, value);
    return this.renderJson({ key, value });
  }

  @route("session-rt-flash-get", {
    path: "/flash/{key}",
    requirements: { methods: "GET" },
  })
  @UseSession()
  flashGet(key: string) {
    const session = this.getSession();
    if (!session) throw new HttpError("Session not started", 500, this.context);
    return this.renderJson({ key, value: session.getFlashBag(key) });
  }

  // ── Régénération d'ID (anti session-fixation, seam P6) ──────────────────────

  @Get("/regen")
  @UseSession()
  regen() {
    const session = this.getSession();
    if (!session) throw new HttpError("Session not started", 500, this.context);
    const oldId = session.id;
    session.regenerateId();
    return this.renderJson({ oldId, newId: session.id });
  }

  // ── Destruction ─────────────────────────────────────────────────────────────

  @route("session-rt-destroy", {
    path: "/destroy",
    requirements: { methods: "DELETE" },
  })
  @UseSession()
  async destroy() {
    const session = this.getSession();
    if (!session) throw new HttpError("Session not started", 500, this.context);
    const id = session.id;
    await session.destroy(true);
    return this.renderJson({ destroyed: id });
  }

  // ── Inspection (id / cookie) ────────────────────────────────────────────────

  @Get("/info")
  @UseSession()
  info() {
    const session = this.getSession();
    if (!session) throw new HttpError("Session not started", 500, this.context);
    return this.renderJson({
      id: session.id,
      name: session.name,
      status: session.status,
      cookieName: session.cookieSession?.name ?? null,
      sameSite: session.cookieSession?.sameSite ?? null,
      httpOnly: session.cookieSession?.httpOnly ?? null,
    });
  }

  // ── WebSocket (co-citoyenneté : même intent, même plug) ─────────────────────

  /** WS avec intent → session active au handshake. */
  @route("session-rt-ws-use", {
    path: "/ws-use",
    requirements: { methods: ["WEBSOCKET"], protocol: "" },
  })
  @UseSession()
  wsUse(message: string | Buffer | null) {
    if (message == null) {
      return this.renderJson({
        handshake: true,
        hasSession: this.session != null,
        id: this.session?.id ?? null,
      });
    }
    return this.wsCtx?.send(JSON.stringify({ id: this.session?.id ?? null }));
  }

  /** WS sans intent → aucune session (lazy) même au handshake. */
  @route("session-rt-ws-lazy", {
    path: "/ws-lazy",
    requirements: { methods: ["WEBSOCKET"], protocol: "" },
  })
  wsLazy(message: string | Buffer | null) {
    if (message == null) {
      return this.renderJson({
        handshake: true,
        hasSession: this.session != null,
      });
    }
    return this.wsCtx?.send(JSON.stringify({ ok: true }));
  }
}

export default SessionRuntimeController;
