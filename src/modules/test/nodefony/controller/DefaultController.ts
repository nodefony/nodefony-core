import { createRequire } from "node:module";
import fs from "node:fs";
import { Controller, route, controller } from "@nodefony/framework";
import { Context, HttpContext, HttpError } from "@nodefony/http";
import {
  inject,
  Fetch,
  nodefonyError as Error,
  RequestContext,
} from "nodefony";

/**
 * Bundle standalone de la debug bar (`nodefony/debugbar.js`), lu UNE fois +
 * caché. Sert à l'inclure via `<script>` sur la page EJS (rendue serveur, sans
 * Vite). `null` = pas encore lu, `false` = irrésoluble.
 */
let debugbarBundle: string | false | null = null;
function loadDebugbarBundle(): string | false {
  if (debugbarBundle !== null) return debugbarBundle;
  try {
    const file = createRequire(import.meta.url).resolve("nodefony/debugbar.js");
    debugbarBundle = fs.readFileSync(file, "utf8");
  } catch {
    debugbarBundle = false;
  }
  return debugbarBundle;
}

// Module-level counter used by P1.2 onAfterResponse integration tests.
// Lives outside the controller class because controllers are scoped per request.
const afterResponseState = {
  count: 0,
  multiCount: 0,
  lastFiredAtMs: 0,
};

// P1.3 — abort signal observation state. Same singleton pattern.
const abortState = {
  abortedCount: 0,
  completedCount: 0,
  lastAbortReason: "",
};

// P1.7 — security hooks observation state (populated by Test module
// listeners registered in src/modules/test/index.ts).
export const securityHooksState = {
  beforeResolveCount: 0,
  afterAuthCount: 0,
  onAuthFailureCount: 0,
  lastAuthFailureReason: "",
  lastHook: "" as "beforeResolve" | "afterAuth" | "onAuthFailure" | "",
};

@controller("/nodefony/test")
class DefaultController extends Controller {
  constructor(
    context: Context,
    @inject("Fetch") private fetchService: Fetch,
  ) {
    super("DefaultController", context);
  }

  async initialize(): Promise<this> {
    await this.startSession("test");
    return this;
  }

  @route("index", {
    path: "/index",
    requirements: { methods: ["GET", "HEAD"] },
  })
  index() {
    return this.renderJson({});
  }

  @route("forward", { path: "/forward" })
  testForward() {
    // Forward interne (RFC : re-dispatch serveur, PAS un 3xx) vers un controller
    // réel du module. Format "module:Controller:action".
    return this.forward("test:RouteController:method1");
  }

  @route("index2", { path: "/index2" })
  index2() {
    throw new Error("myError", 502);
  }

  @route("index3", { path: "/index3" })
  index3() {
    throw new HttpError({ foo: "bar" }, 503, this.context);
  }

  @route("index4", { path: "/index4" })
  index4() {
    return this.render({
      route: this.route,
    });
  }

  // Sert le bundle standalone de la debug bar pour la page EJS (rendue serveur,
  // hors Vite). La page `/index4` l'inclut via <script type="module">.
  @route("debugbar-js", {
    path: "/debugbar.js",
    requirements: { methods: ["GET", "HEAD"] },
  })
  debugbarJs() {
    const js = loadDebugbarBundle();
    if (js === false) {
      throw new HttpError("debugbar bundle introuvable", 404, this.context);
    }
    // Auto-montage appended : la page EJS l'inclut en <script src> EXTERNE
    // (autorisé par CSP `script-src 'self'`) — un script inline serait bloqué.
    return this.render(`${js}\nmountDebugBar();\n`, "utf-8", 200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-cache",
    });
  }

  // ── context inspection ──────────────────────────────────────────
  @route("context-info", { path: "/context" })
  contextInfo() {
    const ctx = this.context as HttpContext;
    return this.renderJson({
      type: ctx.type,
      scheme: ctx.scheme,
      method: this.method,
      host: ctx.getHost(),
      remoteAddress: ctx.getRemoteAddress(),
      userAgent: ctx.getUserAgent() ?? null,
      sessionId: ctx.session?.id ?? null,
    });
  }

  // ── security probe — echoes ?x-val into a response header ───────
  // Tests Node.js header sanitization: CR/LF in value → ERR_INVALID_HTTP_TOKEN
  @route("header-echo", { path: "/header-echo" })
  headerEcho() {
    const val = String(this.queryGet?.["x-val"] ?? "none");
    (this.context as HttpContext).response?.setHeader("x-echoed", val);
    return this.renderJson({ echoed: val });
  }

  // ── resilience routes ────────────────────────────────────────────
  @route("crash-sync", { path: "/crash/sync" })
  crashSync() {
    throw new Error("simulated sync crash");
  }

  @route("crash-async", { path: "/crash/async" })
  async crashAsync() {
    await Promise.reject(new Error("simulated async crash"));
  }

  @route("crash-native", { path: "/crash/native" })
  crashNative() {
    throw new TypeError("native error — no HttpError");
  }

  @route("memory-stats", { path: "/memory" })
  memoryStats() {
    const mem = process.memoryUsage();
    return this.renderJson({
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external,
    });
  }

  // "action" phase is still open here (controller runs inside it),
  // so its endMs/durationMs may be null. Other phases are closed.
  @route("timing", { path: "/timing" })
  timing() {
    const ctx = this.context as HttpContext;
    return this.renderJson({
      phases: ctx.phases.map((p) => ({
        name: p.name,
        startMs: p.startMs,
        endMs: p.endMs ?? null,
        durationMs: p.durationMs ?? null,
      })),
    });
  }

  // ── P1.2 onAfterResponse probes ─────────────────────────────────
  @route("after-incr", { path: "/after/incr" })
  afterIncr() {
    this.context!.onAfterResponse(() => {
      afterResponseState.count++;
      afterResponseState.lastFiredAtMs = Date.now();
    });
    return this.renderJson({ ok: true });
  }

  @route("after-multi", { path: "/after/multi" })
  afterMulti() {
    this.context!.onAfterResponse(() => {
      afterResponseState.multiCount += 1;
    });
    this.context!.onAfterResponse(() => {
      afterResponseState.multiCount += 10;
    });
    this.context!.onAfterResponse(() => {
      afterResponseState.multiCount += 100;
    });
    return this.renderJson({ ok: true });
  }

  @route("after-throw", { path: "/after/throw" })
  afterThrow() {
    this.context!.onAfterResponse(() => {
      afterResponseState.count++;
    });
    throw new Error("after-throw — hook must still fire", 500);
  }

  @route("after-state", { path: "/after/state" })
  afterState() {
    return this.renderJson({
      count: afterResponseState.count,
      multiCount: afterResponseState.multiCount,
      lastFiredAtMs: afterResponseState.lastFiredAtMs,
    });
  }

  @route("after-reset", { path: "/after/reset" })
  afterReset() {
    afterResponseState.count = 0;
    afterResponseState.multiCount = 0;
    afterResponseState.lastFiredAtMs = 0;
    return this.renderJson({ ok: true });
  }

  // ── P1.3 abort signal probes ────────────────────────────────────
  // Waits up to 2s; resolves early if context.signal aborts (client disconnect).
  @route("abort-wait", { path: "/abort/wait" })
  async abortWait() {
    const signal = this.context!.signal;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          abortState.completedCount++;
          resolve();
        }, 2000);
        const onAbort = () => {
          clearTimeout(timer);
          abortState.abortedCount++;
          abortState.lastAbortReason =
            (signal.reason as Error)?.message ??
            String(signal.reason ?? "aborted");
          reject(new Error("aborted"));
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      });
    } catch {
      // Aborted — client already gone, but action returns so server stays clean.
      return this.renderJson({ aborted: true });
    }
    return this.renderJson({ aborted: false });
  }

  @route("abort-state", { path: "/abort/state" })
  abortStateRoute() {
    return this.renderJson({
      abortedCount: abortState.abortedCount,
      completedCount: abortState.completedCount,
      lastAbortReason: abortState.lastAbortReason,
    });
  }

  @route("abort-reset", { path: "/abort/reset" })
  abortReset() {
    abortState.abortedCount = 0;
    abortState.completedCount = 0;
    abortState.lastAbortReason = "";
    return this.renderJson({ ok: true });
  }

  // ── P1.7 security hooks probes ──────────────────────────────────
  @route("hooks-state", { path: "/hooks/state" })
  hooksState() {
    return this.renderJson({
      beforeResolveCount: securityHooksState.beforeResolveCount,
      afterAuthCount: securityHooksState.afterAuthCount,
      onAuthFailureCount: securityHooksState.onAuthFailureCount,
      lastAuthFailureReason: securityHooksState.lastAuthFailureReason,
      lastHook: securityHooksState.lastHook,
    });
  }

  @route("hooks-reset", { path: "/hooks/reset" })
  hooksReset() {
    securityHooksState.beforeResolveCount = 0;
    securityHooksState.afterAuthCount = 0;
    securityHooksState.onAuthFailureCount = 0;
    securityHooksState.lastAuthFailureReason = "";
    securityHooksState.lastHook = "";
    return this.renderJson({ ok: true });
  }

  // ── P1.4 RequestContext (ALS) probes ────────────────────────────
  // Sync read of ALS state at controller execution time.
  @route("als-now", { path: "/als/now" })
  alsNow() {
    return this.renderJson({
      requestId: RequestContext.getRequestId() ?? null,
      scheme: RequestContext.get()?.scheme ?? null,
      contextRequestId: this.context!.requestId,
    });
  }

  // Read ALS state AFTER an async hop (setTimeout + await).
  // Validates propagation across the event loop boundary.
  @route("als-async", { path: "/als/async" })
  async alsAsync() {
    const beforeAwait = RequestContext.getRequestId();
    await new Promise<void>((r) => setTimeout(r, 20));
    const afterAwait = RequestContext.getRequestId();
    return this.renderJson({
      beforeAwait: beforeAwait ?? null,
      afterAwait: afterAwait ?? null,
      sameAcrossAwait: beforeAwait === afterAwait,
      contextRequestId: this.context!.requestId,
    });
  }
}

export default DefaultController;
