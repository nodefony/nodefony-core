import { Controller, route, Get, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import { RequestContext } from "nodefony";

/**
 * Shared observation state for the ALS propagation integration tests
 * (BUG-001 WS messages, BUG-002 onAfterResponse). Module-level singleton —
 * controllers are scoped per request, so the captured values must live
 * outside the instance. Read back over HTTP via `/als-test/state`.
 */
export const alsTestState = {
  // BUG-002 HTTP — requestId seen by an after-response hook, keyed by ctx id.
  byContext: {} as Record<string, string | null>,
  lastHookRequestId: null as string | null,
  // BUG-002 HTTP — user (set mid-request) seen by an after-response hook.
  hookUser: null as string | null,
  // BUG-002 HTTP — late-registered hook (fired === true branch).
  lateHookRequestId: null as string | null,
  // BUG-002 WS — requestId seen by a WS after-response hook on close.
  wsHookRequestId: null as string | null,
  wsHookHandshakeId: null as string | null,
  // Lifecycle — how many times the WS after-hook fired (must be 1 per
  // connection: proves the onFinish tear-down is deduplicated).
  wsHookFireCount: 0,
  hookCount: 0,
};

/**
 * Dedicated test controller for AsyncLocalStorage propagation across the
 * WebSocket message lifecycle (BUG-001) and the onAfterResponse hook
 * (BUG-002). Kept out of DefaultController to avoid a catch-all file.
 */
@controller("/nodefony/test/als-test")
class AlsController extends Controller {
  constructor(context: Context) {
    super("AlsController", context);
  }

  async initialize(): Promise<this> {
    return this;
  }

  // ── BUG-002 HTTP — after-response hook reads ALS ─────────────────
  @Get("/after")
  afterRegister() {
    const ctxId = this.context!.requestId;
    this.context!.onAfterResponse(() => {
      const alsId = RequestContext.getRequestId() ?? null;
      alsTestState.lastHookRequestId = alsId;
      alsTestState.byContext[ctxId] = alsId;
      alsTestState.hookCount++;
    });
    return this.renderJson({ contextRequestId: ctxId });
  }

  // ── BUG-002 HTTP — user set mid-request visible in the hook ──────
  @Get("/after/user")
  afterUser() {
    RequestContext.set("user", { id: "http-user-7" });
    this.context!.onAfterResponse(() => {
      alsTestState.hookUser =
        (RequestContext.getUser() as { id?: string } | undefined)?.id ?? null;
    });
    return this.renderJson({ ok: true });
  }

  // ── BUG-002 HTTP — late subscribe (after _afterResponseFired) ───
  // hook1 runs with restored ALS (the fix) and registers hook2 while
  // fired === true, exercising the late branch bind.
  @Get("/after/late")
  afterLate() {
    const ctxId = this.context!.requestId;
    this.context!.onAfterResponse((ctx) => {
      ctx.onAfterResponse(() => {
        alsTestState.lateHookRequestId = RequestContext.getRequestId() ?? null;
      });
    });
    return this.renderJson({ contextRequestId: ctxId });
  }

  @Get("/state")
  state() {
    return this.renderJson({
      byContext: alsTestState.byContext,
      lastHookRequestId: alsTestState.lastHookRequestId,
      hookUser: alsTestState.hookUser,
      lateHookRequestId: alsTestState.lateHookRequestId,
      wsHookRequestId: alsTestState.wsHookRequestId,
      wsHookHandshakeId: alsTestState.wsHookHandshakeId,
      wsHookFireCount: alsTestState.wsHookFireCount,
      hookCount: alsTestState.hookCount,
    });
  }

  // Lifecycle diagnostic — number of live "request" scopes still held by the
  // DI container. Ground truth for scope leaks (immune to GC/Rollup heap noise).
  // A clean server idles near 1 (the scope of this very request).
  @Get("/scopes")
  scopeCount() {
    const httpKernel = this.kernel?.get("HttpKernel") as
      | { container?: { scopes?: Record<string, Record<string, unknown>> } }
      | undefined;
    const reqScopes = httpKernel?.container?.scopes?.request;
    return this.renderJson({
      requestScopes: reqScopes ? Object.keys(reqScopes).length : -1,
    });
  }

  @Get("/reset")
  reset() {
    alsTestState.byContext = {};
    alsTestState.lastHookRequestId = null;
    alsTestState.hookUser = null;
    alsTestState.lateHookRequestId = null;
    alsTestState.wsHookRequestId = null;
    alsTestState.wsHookHandshakeId = null;
    alsTestState.wsHookFireCount = 0;
    alsTestState.hookCount = 0;
    return this.renderJson({ ok: true });
  }

  // ── BUG-001 WS — ALS readable on every message + handshake ──────
  // Handshake invokes the action with `undefined` (no frame), messages with
  // the payload — so detect the handshake with a nullish check, never
  // `.toString()` an absent message.
  @route("als-test-ws", { path: "/ws", requirements: { methods: ["WEBSOCKET"] } })
  async wsAls(message: string | Buffer | null | undefined) {
    return this.renderJson({
      handshake: message == null,
      alsRequestId: RequestContext.getRequestId() ?? null,
      alsUser: (RequestContext.getUser() as { id?: string } | undefined)?.id ?? null,
      alsTraceparent: (RequestContext.get()?.traceparent as string) ?? null,
      contextRequestId: this.context?.requestId ?? null,
    });
  }

  // ── BUG-001 WS — user set in one message survives to the next ───
  @route("als-test-ws-user", { path: "/ws/user", requirements: { methods: ["WEBSOCKET"] } })
  async wsAlsUser(message: string | Buffer | null | undefined) {
    if (message != null && message.toString() === "login") {
      RequestContext.set("user", { id: "ws-user-42" });
    }
    return this.renderJson({
      handshake: message == null,
      alsUser: (RequestContext.getUser() as { id?: string } | undefined)?.id ?? null,
    });
  }

  // ── BUG-002 WS — after-response hook (onFinish) reads ALS ───────
  @route("als-test-ws-after", { path: "/ws/after", requirements: { methods: ["WEBSOCKET"] } })
  async wsAlsAfter(message: string | Buffer | null | undefined) {
    if (message == null) {
      const handshakeId = RequestContext.getRequestId() ?? null;
      this.context?.onAfterResponse(() => {
        alsTestState.wsHookRequestId = RequestContext.getRequestId() ?? null;
        alsTestState.wsHookHandshakeId = handshakeId;
        alsTestState.wsHookFireCount++;
      });
      return this.renderJson({ handshake: true, requestId: handshakeId });
    }
    return this.renderJson({ echo: message.toString() });
  }
}

export default AlsController;
