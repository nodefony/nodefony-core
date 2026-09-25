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
  // Scope de requête — un hook onAfterResponse le voit-il encore OUVERT ?
  // (il passe avant leaveScope). Indexé par requestId.
  scopeInHook: {} as Record<string, boolean>,
  // Après le teardown, la bulle porte ENCORE `scope`, mais refermé :
  // getScope() doit rendre undefined. Indexé par requestId.
  scopeAfterTeardown: {} as Record<string, boolean>,
};

type ContextEmitter = {
  on(event: string, fn: (context: object) => void): unknown;
  removeListener(event: string, fn: (context: object) => void): unknown;
};

/**
 * Traceur des contextes HTTP : chaque contexte créé est inscrit dans un
 * `FinalizationRegistry`, qui le décompte quand le ramasse-miettes l'a
 * réclamé. Module-level : il survit aux contrôleurs, qui sont par requête.
 *
 * Le compte est tenu par ÉPOQUE : `mark()` ouvre une époque neuve, et seuls les
 * contextes nés depuis y sont comptés. Sans cela, la base d'une boucle compte
 * encore les contextes du test précédent que le GC n'a pas fini de réclamer —
 * l'écart qui en résulte est NÉGATIF (−1 à −3 mesurés) et masquerait autant de
 * contextes retenus.
 */
const contextTracker = {
  armed: false,
  epoch: 0,
  created: 0,
  finalized: 0,
  registry: new FinalizationRegistry<number>((epoch) => {
    if (epoch === contextTracker.epoch) contextTracker.finalized++;
  }),
  onCreate: (context: object): void => {
    contextTracker.created++;
    contextTracker.registry.register(context, contextTracker.epoch);
  },
  mark: (): void => {
    contextTracker.epoch++;
    contextTracker.created = 0;
    contextTracker.finalized = 0;
  },
};

function armContextTracker(kernel: ContextEmitter | undefined): boolean {
  if (!kernel) return false;
  if (!contextTracker.armed) {
    kernel.on("onCreateContext", contextTracker.onCreate);
    contextTracker.armed = true;
  }
  return true;
}

function disarmContextTracker(kernel: ContextEmitter | undefined): void {
  if (kernel && contextTracker.armed) {
    kernel.removeListener("onCreateContext", contextTracker.onCreate);
  }
  contextTracker.armed = false;
}

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

  // ── Scope de requête — RequestContext.getScope() ───────────────
  // Doit rendre LE scope de ce contexte (même objet), et un hook
  // onAfterResponse doit encore le voir ouvert.
  @Get("/scope")
  scopeHttp() {
    const ctxId = this.context!.requestId;
    const scope = RequestContext.getScope();
    // Identité d'objet : `IScope` et `Container` sont deux types distincts.
    const container: unknown = this.context?.container;
    this.context!.onAfterResponse((ctx) => {
      alsTestState.scopeInHook[ctxId] = RequestContext.getScope() !== undefined;
      // Une continuation qui reprend APRÈS le teardown (`leaveScope` puis
      // `clean()`) : on attend le SIGNAL `cleaned`, jamais un délai fixe.
      const afterTeardown = (left: number): void => {
        if (!ctx.cleaned && left > 0) {
          setImmediate(() => afterTeardown(left - 1));
          return;
        }
        alsTestState.scopeAfterTeardown[ctxId] =
          ctx.cleaned &&
          RequestContext.get()?.scope !== undefined &&
          RequestContext.getScope() === undefined;
      };
      setImmediate(() => afterTeardown(1000));
    });
    return this.renderJson({
      contextRequestId: ctxId,
      scopeIsContainer: scope !== undefined && scope === container,
    });
  }

  // Verdicts des hooks de `/scope`. Route À PART : `/state` est la cible du banc
  // comparatif (`bench-frameworks/payload.mjs` en recopie la réponse pour
  // Express et Fastify) — un champ de plus ici fausserait l'égalité des camps.
  @Get("/scope/hooks")
  scopeHooks() {
    return this.renderJson({
      scopeInHook: alsTestState.scopeInHook,
      scopeAfterTeardown: alsTestState.scopeAfterTeardown,
    });
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
    // API d'introspection dédiée (Container.scopeCount) — la structure interne
    // (Map depuis le durcissement Container) n'est plus fouillée à la main.
    const httpKernel = this.kernel?.get("HttpKernel") as
      { container?: { scopeCount?: (name: string) => number } } | undefined;
    const count = httpKernel?.container?.scopeCount?.("request");
    return this.renderJson({
      requestScopes: count ?? -1,
      // Clés PROPRES du scope de CETTE requête : ce que le pipeline y écrit à
      // chaque requête (le contrôleur…). Sonde des écritures par requête.
      requestScopeKeys: this.context?.container?.keys() ?? null,
    });
  }

  // Compteur EXACT des contextes HTTP encore vivants — ce que ni le heap ni le
  // registre des scopes ne voient : un contexte retenu ailleurs (tableau,
  // fermeture, cache) alors que son scope a bien été refermé. Armé à la
  // demande : l'écouteur `onCreateContext` fait payer un `fireAsync` à CHAQUE
  // requête (`http-kernel.ts`, garde `listenerCount`), les autres suites ne
  // doivent pas le porter.
  @Get("/contexts/arm")
  contextsArm() {
    const kernel = this.kernel?.get("HttpKernel") as ContextEmitter | undefined;
    return this.renderJson({ armed: armContextTracker(kernel) });
  }

  @Get("/contexts/disarm")
  contextsDisarm() {
    const kernel = this.kernel?.get("HttpKernel") as ContextEmitter | undefined;
    disarmContextTracker(kernel);
    return this.renderJson({ armed: false });
  }

  /** Ouvre une époque : seuls les contextes nés après seront comptés. */
  @Get("/contexts/mark")
  contextsMark() {
    contextTracker.mark();
    return this.renderJson({ epoch: contextTracker.epoch });
  }

  @Get("/contexts")
  async contexts() {
    // Le GC forcé ne fait que PLANIFIER les rappels de finalisation, et un
    // objet réclamé peut en libérer d'autres au GC suivant : on alterne GC et
    // retour à la boucle jusqu'à ce que le compte ne bouge plus (borné). Une
    // base lue trop tôt compte encore les contextes du test précédent, et
    // l'écart qui en résulte, NÉGATIF, masquerait autant de contextes retenus.
    const gc = (globalThis as { gc?: () => void }).gc;
    let previous = -1;
    for (let i = 0; i < 5 && previous !== contextTracker.finalized; i++) {
      previous = contextTracker.finalized;
      gc?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    return this.renderJson({
      armed: contextTracker.armed,
      epoch: contextTracker.epoch,
      created: contextTracker.created,
      finalized: contextTracker.finalized,
      alive: contextTracker.created - contextTracker.finalized,
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
    alsTestState.scopeInHook = {};
    alsTestState.scopeAfterTeardown = {};
    return this.renderJson({ ok: true });
  }

  // ── BUG-001 WS — ALS readable on every message + handshake ──────
  // Handshake invokes the action with `undefined` (no frame), messages with
  // the payload — so detect the handshake with a nullish check, never
  // `.toString()` an absent message.
  @route("als-test-ws", {
    path: "/ws",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async wsAls(message: string | Buffer | null | undefined) {
    const scope = RequestContext.getScope();
    const container: unknown = this.context?.container;
    return this.renderJson({
      // Le scope de la connexion, atteint par l'ALS — handshake ET messages.
      alsScopeIsContainer: scope !== undefined && scope === container,
      handshake: message == null,
      alsRequestId: RequestContext.getRequestId() ?? null,
      alsUser:
        (RequestContext.getUser() as { id?: string } | undefined)?.id ?? null,
      alsTraceparent: (RequestContext.get()?.traceparent as string) ?? null,
      contextRequestId: this.context?.requestId ?? null,
    });
  }

  // ── BUG-001 WS — user set in one message survives to the next ───
  @route("als-test-ws-user", {
    path: "/ws/user",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async wsAlsUser(message: string | Buffer | null | undefined) {
    if (message != null && message.toString() === "login") {
      RequestContext.set("user", { id: "ws-user-42" });
    }
    return this.renderJson({
      handshake: message == null,
      alsUser:
        (RequestContext.getUser() as { id?: string } | undefined)?.id ?? null,
    });
  }

  // ── BUG-002 WS — after-response hook (onFinish) reads ALS ───────
  @route("als-test-ws-after", {
    path: "/ws/after",
    requirements: { methods: ["WEBSOCKET"] },
  })
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
