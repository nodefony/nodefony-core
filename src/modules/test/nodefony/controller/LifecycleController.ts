import { Controller, route, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";

/**
 * P2.4 — controller `initialize()` error boundary probe.
 *
 * This controller's `initialize()` ALWAYS throws, so any route on it exercises
 * the controller-initialize crash path:
 *   Resolver.newController → `await controller.initialize()` (throws)
 *   → HttpContext.handle() reject → HttpKernel.onError → coherent 500 (no hang).
 *
 * Kept in a dedicated controller so the throw cannot poison the shared
 * DefaultController (whose `initialize()` starts the session for every route).
 */
@controller("/nodefony/test/lifecycle")
class LifecycleController extends Controller {
  constructor(context: Context) {
    super("LifecycleController", context);
  }

  async initialize(): Promise<this> {
    throw new Error(
      "boom: controller initialize() crashed (P2.4 boundary probe)",
    );
  }

  @route("lifecycle-init-crash", { path: "/init-crash" })
  initCrash() {
    // Never reached — initialize() throws first. Present only so the route
    // resolves to an action and the crash happens during the lifecycle, not
    // because the action is missing.
    return this.renderJson({ reached: true });
  }

  /**
   * Même sonde, transport WebSocket — l'ordre y est différent : le controller
   * est instancié AU HANDSHAKE, avant `context.connect()`. Un `initialize()`
   * qui lève doit donc se voir côté client comme une fermeture propre (jamais
   * une socket acceptée puis muette, ni un handshake qui pend).
   */
  @route("lifecycle-init-crash-ws", {
    path: "/init-crash-ws",
    requirements: { methods: ["WEBSOCKET"] },
  })
  initCrashWs() {
    // Jamais atteint — `initialize()` lève au handshake.
    return this.renderJson({ reached: true });
  }
}

export default LifecycleController;
