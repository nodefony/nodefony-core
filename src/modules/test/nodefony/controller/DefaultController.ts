import { Controller, route, controller } from "@nodefony/framework";
import { Context, HttpContext, HttpError } from "@nodefony/http";
import { inject, Fetch, nodefonyError as Error } from "nodefony";

@controller("/nodefony/test")
class DefaultController extends Controller {
  constructor(
    context: Context,
    @inject("Fetch") private fetchService: Fetch
  ) {
    super("DefaultController", context);
  }

  async initialize(): Promise<this> {
    await this.startSession("test");
    return this;
  }

  @route("index", { path: "/index", requirements: { methods: ["GET", "HEAD"] } })
  index() {
    return this.renderJson({});
  }

  @route("forward", { path: "/forward" })
  testForward() {
    return this.forward("app:AppController:method1");
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
}

export default DefaultController;
