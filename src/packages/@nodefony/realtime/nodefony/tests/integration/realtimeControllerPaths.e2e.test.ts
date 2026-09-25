import { describe, it, expect, beforeEach } from "vitest";
import "reflect-metadata";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
import {
  RpcError as RpcErrorServer,
  type RpcActionHandler,
  RequestContext,
  Container,
  Injector,
  Service,
  injectable,
  inject,
  type Scope,
} from "nodefony";
import type { ContextType } from "@nodefony/http";
import { FrameProfile } from "@nodefony/http";
import type { RealtimePublish } from "../../interfaces/IRealtimeController.js";
import type { IRealtimeAuthenticator } from "../../interfaces/IRealtimeAuthenticator.js";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken.js";
import { RealtimeClient } from "../../../../../../nodefony/src/client/realtime/RealtimeClient.js";
import { RpcError } from "../../../../../../nodefony/src/realtime/JsonRpcPeer.js";
import {
  TransportState,
  type IRealtimeTransport,
} from "../../../../../../nodefony/src/realtime/IRealtimeTransport.js";

/**
 * E2E des CHEMINS du {@link RealtimeController} (pipeline WS complet, vrai client
 * ↔ vrai serveur loopback) : refus d'Origin, échec d'authentification au
 * handshake, pont `api.request` souverain (succès + toute la grille d'erreurs),
 * fallback `createRealtimeChannel`, `requestClient` hors welcome, cleanup
 * `onFinish`. Complète la matrice d'autorisation (`realtimeChannelAuth.e2e`).
 */

const OPEN = 1;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

class LoopbackWire {
  feedServer: ((raw: string | null) => void) | null = null;
  pumpClient: ((raw: string) => void) | null = null;
  closeClient: ((code: number, reason: string) => void) | null = null;
  serverConnOpen = true;
  deliverToClient(raw: string): void {
    queueMicrotask(() => this.pumpClient?.(raw));
  }
  deliverToServer(raw: string): void {
    queueMicrotask(() => this.feedServer?.(raw));
  }
}

class LoopbackClientTransport implements IRealtimeTransport {
  readyState: number = TransportState.CONNECTING;
  lastCloseCode: number | null = null;
  private _onOpen: (() => void) | null = null;
  private _onClose: ((code: number, reason: string) => void) | null = null;
  constructor(private readonly wire: LoopbackWire) {}
  connect(): void {
    this.readyState = TransportState.OPEN;
    queueMicrotask(() => {
      this._onOpen?.();
      this.wire.feedServer?.(null);
    });
  }
  send(raw: string): void {
    if (this.readyState !== TransportState.OPEN) return;
    this.wire.deliverToServer(raw);
  }
  close(code = 1000, reason = ""): void {
    this.readyState = TransportState.CLOSED;
    this.lastCloseCode = code;
    this._onClose?.(code, reason);
  }
  onOpen(cb: () => void): void {
    this._onOpen = cb;
  }
  onMessage(cb: (raw: string) => void): void {
    this.wire.pumpClient = cb;
  }
  onClose(cb: (code: number, reason: string) => void): void {
    this._onClose = cb;
    this.wire.closeClient = (code, reason) => {
      this.lastCloseCode = code;
      cb(code, reason);
    };
  }
  onError(): void {
    /* surfacé par close */
  }
}

// Router factice pour le pont `api.request` — comportement piloté par scénario.
type RouterMode =
  | "ok"
  | "notfound"
  | "throw405"
  | "throwOpaque"
  | "action403"
  | "actionOpaque"
  | "actionOk"
  | "scopeProbe"
  | "sharedProbe";
let routerMode: RouterMode = "ok";
/** Conteneur posé sur le faux contexte, que le mode `scopeProbe` compare à `getScope()`. */
let probeScope: unknown = undefined;

/**
 * Service de portée `request` : en WebSocket, un exemplaire par CONNEXION. Il
 * porte un état mutable pour montrer ce que ce partage implique entre deux
 * invocations `api.request` concurrentes.
 */
class SharedProbe extends Service {
  static created = 0;
  readonly serial: number;
  lastWriter: string | null = null;
  constructor(scope: Scope) {
    super("rtSharedProbe", scope, false);
    this.serial = ++SharedProbe.created;
  }
}
injectable({ name: "RtSharedProbe", scope: "request" })(SharedProbe);

/** Lecteur transient : RÉSOUT le service `request` à chaque invocation. */
class SharedProbeReader extends Service {
  constructor(readonly probe: SharedProbe) {
    super("rtSharedProbeReader", probe.container as Container, false);
  }
}
inject("RtSharedProbe")(SharedProbeReader, undefined, 0);
injectable({ name: "RtSharedProbeReader", scope: "transient" })(
  SharedProbeReader,
);

/**
 * Barrière à deux : chaque invocation attend que l'autre soit arrivée. Sans
 * elle, deux `api.request` pourraient se suivre au lieu de se chevaucher, et le
 * test ne prouverait rien de la concurrence.
 */
let barrier: { arrived: number; release: () => void; open: Promise<void> };
const resetBarrier = (): void => {
  let release!: () => void;
  const open = new Promise<void>((r) => (release = r));
  barrier = { arrived: 0, release, open };
};
resetBarrier();

function makeRouter() {
  return {
    resolve(_ctx: unknown, pathname: string) {
      if (routerMode === "throw405") {
        throw Object.assign(new Error("method not allowed"), { code: 405 });
      }
      if (routerMode === "throwOpaque") {
        throw new Error("boom interne");
      }
      if (routerMode === "notfound") {
        return { resolve: false };
      }
      return {
        resolve: true,
        queryOverride: undefined as unknown,
        // Le pont appelle `executeActionGuarded` (porte @Idempotent sans rendu)
        // — même contrat de retour `{ result }` que l'ex-`executeAction`.
        async executeActionGuarded(_a: unknown, _reload: boolean) {
          if (routerMode === "action403") {
            throw Object.assign(new Error("Access denied"), { code: 403 });
          }
          if (routerMode === "actionOpaque") {
            throw new Error("boom interne action"); // non-HTTP → opaque
          }
          if (routerMode === "actionOk") {
            return { result: { path: pathname, ok: true } };
          }
          if (routerMode === "scopeProbe") {
            const scope = RequestContext.getScope();
            return {
              result: {
                scopeDefined: scope !== undefined,
                scopeIsConnection: scope !== undefined && scope === probeScope,
              },
            };
          }
          if (routerMode === "sharedProbe") {
            const { probe } =
              Injector.instantiate<SharedProbeReader>(SharedProbeReader);
            probe.lastWriter = pathname;
            barrier.arrived += 1;
            if (barrier.arrived === 2) barrier.release();
            await barrier.open;
            return {
              result: {
                serial: probe.serial,
                wrote: pathname,
                readBack: probe.lastWriter,
              },
            };
          }
          return { result: { path: pathname } };
        },
      };
    },
  };
}

class ApiRt extends RealtimeController {
  publishers: Record<string, RealtimePublish> = {};
  constructor(ctx: ContextType) {
    super("api-rt", ctx);
  }
  protected override realtimeApiRequest(): boolean {
    return true;
  }
  // Déclare un préfixe broadcast → exerce `markBroadcastChannel` au handshake.
  protected override realtimeBroadcastChannels(): string[] {
    return ["bcast:"];
  }
  protected override realtimeActions(): Record<string, RpcActionHandler> {
    return { "nodefony:kernel:ping": () => ({ pong: true }) };
  }
  // Canaux déclarés via override (pas de décorateur) → exerce le FALLBACK
  // `createRealtimeChannel` de la base + la branche `null` (canal inconnu).
  protected override realtimeChannels(): string[] {
    return ["tick"];
  }
  override createRealtimeChannel(
    channel: string,
    publish: RealtimePublish,
  ): (() => void) | null {
    if (channel !== "tick") return null; // canal inconnu → base ne souscrit pas
    this.publishers[channel] = publish;
    publish(channel, { started: true });
    return () => {
      delete this.publishers[channel];
    };
  }
  feed(raw: string | null): void {
    this.handleRealtime(raw);
  }
  callBeforeWelcome(): Promise<unknown> {
    // Appel direct AVANT tout handshake → state absent → reject.
    return (
      this as unknown as { requestClient: (m: string) => Promise<unknown> }
    ).requestClient("client:noop");
  }
}

let lastFinish: (() => void) | null = null;
/** Profils de frame collectés par le faux contexte (radiographie de la porte). */
let collected: FrameProfile[] = [];

function makeServer(
  wire: LoopbackWire,
  opts: {
    noRouter?: boolean;
    headers?: Record<string, string | string[]>;
    url?: unknown;
    /** Simule un serveur avec le profiler dev actif (défaut : prod, aucun profil). */
    profiling?: boolean;
    /** Conteneur de la connexion (`ctx.container`) ; absent par défaut. */
    container?: unknown;
  } = {},
): ApiRt {
  const conn = {
    get readyState() {
      return wire.serverConnOpen ? OPEN : TransportState.CLOSED;
    },
    send: (raw: string, cb?: (err?: Error) => void) => {
      wire.deliverToClient(raw);
      cb?.();
    },
    close: (code?: number, reason?: string) => {
      wire.serverConnOpen = false;
      queueMicrotask(() => wire.closeClient?.(code ?? 1000, reason ?? ""));
    },
  };
  // Le contexte WS porte la radiographie de la porte socket : une invocation du
  // pont ouvre son PROPRE profil (le contexte, lui, vit pour la connexion).
  // `profiling: false` (défaut) = production : `beginFrame` rend `null`, le pont
  // n'alloue rien et répond une valeur nue — c'est le chemin que couvre la grille.
  let frameSeq = 0;
  const ctx = {
    connection: conn,
    once: (event: string, fn: () => void) => {
      if (event === "onFinish") lastFinish = fn;
    },
    beginFrame: (method: string, url: string): FrameProfile | null => {
      if (!opts.profiling) return null;
      frameSeq += 1;
      return new FrameProfile({
        requestId: `rid-test.${frameSeq}`,
        type: "websocket",
        scheme: "wss",
        method,
        url,
        remoteAddress: "127.0.0.1",
        traceparent: null,
        security: null,
        securityTrace: null,
        timing: true,
        queries: true,
      });
    },
    collectFrame: (frame: FrameProfile | null) => {
      if (frame) collected.push(frame);
    },
    request: {
      headers: opts.headers ?? { host: "localhost" },
      url: "/realtime",
    },
    cookies: { sid: { value: "abc" }, bad: { value: 42 } }, // value non-string ignorée
    url: "url" in opts ? opts.url : "/realtime",
    requestId: "rid-test",
    scheme: "wss",
    container: opts.container,
    router: opts.noRouter ? undefined : makeRouter(),
    remoteAddress: "127.0.0.1",
    origin: "https://app.test",
  };
  const rt = new ApiRt(ctx as unknown as ContextType);
  wire.feedServer = (raw) => rt.feed(raw);
  return rt;
}

async function connectCtx(opts: {
  headers?: Record<string, string | string[]>;
  url?: unknown;
}): Promise<RealtimeClient> {
  const wire = new LoopbackWire();
  makeServer(wire, opts);
  const transport = new LoopbackClientTransport(wire);
  const client = new RealtimeClient(
    { url: "ws://loopback/realtime", autoReconnect: false },
    () => transport,
  );
  await client.connect();
  await flush();
  await flush();
  return client;
}

async function connectWith(opts: {
  noRouter?: boolean;
}): Promise<RealtimeClient> {
  const wire = new LoopbackWire();
  makeServer(wire, opts);
  const transport = new LoopbackClientTransport(wire);
  const client = new RealtimeClient(
    { url: "ws://loopback/realtime", autoReconnect: false },
    () => transport,
  );
  await client.connect();
  await flush();
  await flush();
  return client;
}

const mkToken = (auth: boolean): IRealtimeToken => ({
  type: auth ? "session" : "anonymous",
  getUserIdentifier: () => "u",
  isAuthenticated: () => auth,
  getRoles: () => (auth ? ["ROLE_USER"] : ["ROLE_ANONYMOUS"]),
  getScopes: () => [],
  // `getAttribute` est GÉNÉRIQUE au contrat (`<T = unknown>(key) => T | undefined`) :
  // on porte la même signature que le vrai token (cf `ANONYMOUS_REALTIME_TOKEN`,
  // qui fait aussi `attributes[key] as T | undefined`).
  getAttribute: <T = unknown>(k: string): T | undefined =>
    k === "user" ? ({ id: "u" } as T) : undefined,
});

async function connect(
  opts: { profiling?: boolean; container?: unknown } = {},
): Promise<{
  client: RealtimeClient;
  rt: ApiRt;
  transport: LoopbackClientTransport;
}> {
  const wire = new LoopbackWire();
  const rt = makeServer(wire, opts);
  const transport = new LoopbackClientTransport(wire);
  const client = new RealtimeClient(
    { url: "ws://loopback/realtime", autoReconnect: false },
    () => transport,
  );
  await client.connect();
  await flush();
  await flush();
  return { client, rt, transport };
}

describe("RealtimeController E2E — handshake : Origin + auth", () => {
  beforeEach(() => {
    getRealtimeHub().clear();
    routerMode = "ok";
    lastFinish = null;
  });

  it("Origin refusée par le guard → close 4003, jamais de welcome", async () => {
    getRealtimeHub().setOriginGuard(() => false);
    const { client, transport } = await connect();
    expect(transport.lastCloseCode).to.equal(4003);
    expect(client.identity).to.equal(null); // welcome jamais reçu
    client.disconnect();
  });

  it("authenticator qui THROW au handshake → close 4001 (unauthorized)", async () => {
    const badAuth: IRealtimeAuthenticator = {
      name: "bad",
      supports: () => true,
      authenticate: async () => {
        throw new Error("bad credentials");
      },
      onFailure: () => {
        /* hook d'audit */
      },
    };
    getRealtimeHub().useAuthenticator({ pattern: /.*/ }, badAuth);
    const { transport } = await connect();
    expect(transport.lastCloseCode).to.equal(4001);
  });

  it("authenticator OK → welcome avec l'identité résolue", async () => {
    const okAuth: IRealtimeAuthenticator = {
      name: "ok",
      supports: () => true,
      authenticate: async () => mkToken(true),
      onSuccess: () => {},
    };
    getRealtimeHub().useAuthenticator({ pattern: /.*/ }, okAuth);
    const { client } = await connect();
    expect(client.identity?.authenticated).to.equal(true);
    expect(client.identity?.userIdentifier).to.equal("u");
    client.disconnect();
  });
});

describe("RealtimeController E2E — pont api.request (toute la grille)", () => {
  beforeEach(() => {
    getRealtimeHub().clear();
    routerMode = "actionOk";
    lastFinish = null;
  });

  it("succès : api.request {path} → result de l'action (≡ GET REST)", async () => {
    const { client } = await connect();
    const res = await client.request<"api.request", { ok: boolean }>(
      "api.request",
      { path: "/nodefony/kernel/api/x?a=1&a=2&b=3" },
    );
    expect(res.ok).to.equal(true);
    client.disconnect();
  });

  it("params.path invalide (absent / sans /) → -32602", async () => {
    const { client } = await connect();
    for (const bad of [undefined, "no-slash", 42]) {
      let code: number | null = null;
      try {
        await client.request("api.request", { path: bad });
      } catch (e) {
        code = (e as RpcError).code;
      }
      expect(code).to.equal(-32602);
    }
    client.disconnect();
  });

  it("path inconnu (resolver.resolve falsy) → 404", async () => {
    routerMode = "notfound";
    const { client } = await connect();
    let status: unknown;
    try {
      await client.request("api.request", { path: "/ghost" });
    } catch (e) {
      status = (e as RpcError).data;
    }
    expect(status).to.deep.equal({ status: 404 });
    client.disconnect();
  });

  it("router THROW 405 (path sans transport WS) → status 405", async () => {
    routerMode = "throw405";
    const { client } = await connect();
    let status: unknown;
    try {
      await client.request("api.request", { path: "/http-only" });
    } catch (e) {
      status = (e as RpcError).data;
    }
    expect(status).to.deep.equal({ status: 405 });
    client.disconnect();
  });

  it("action throw 403 (garde @IsGranted) → status 403 (pas -32603 opaque)", async () => {
    routerMode = "action403";
    const { client } = await connect();
    let status: unknown;
    try {
      await client.request("api.request", { path: "/secure" });
    } catch (e) {
      status = (e as RpcError).data;
    }
    expect(status).to.deep.equal({ status: 403 });
    client.disconnect();
  });

  it("router THROW opaque (non-HTTP) → -32603 générique (Zero Trust)", async () => {
    routerMode = "throwOpaque";
    const { client } = await connect();
    let code: number | null = null;
    try {
      await client.request("api.request", { path: "/x" });
    } catch (e) {
      code = (e as RpcError).code;
    }
    expect(code).to.equal(-32603);
    client.disconnect();
  });
});

describe("RealtimeController E2E — radiographie de la porte (profil par frame)", () => {
  beforeEach(() => {
    getRealtimeHub().clear();
    routerMode = "actionOk";
    lastFinish = null;
    collected = [];
  });

  it("profiler actif → la réponse porte meta.requestId, et le result reste NU", async () => {
    const { client } = await connect({ profiling: true });
    const { result, requestId } = await client.call<{ ok: boolean }>(
      "/nodefony/kernel/api/x",
    );
    // Contrat « snapshot ≡ GET REST » : la méta n'a pas emballé la valeur (le
    // result est celui du controller, à l'identique).
    expect(result.ok).to.equal(true);
    expect(requestId).to.equal("rid-test.1");
    client.disconnect();
  });

  it("chaque invocation a SON profil (phases non cumulatives sur la connexion)", async () => {
    const { client } = await connect({ profiling: true });
    const a = await client.call("/nodefony/kernel/api/x");
    const b = await client.call("/nodefony/kernel/api/x");
    expect(a.requestId).to.equal("rid-test.1");
    expect(b.requestId).to.equal("rid-test.2");
    expect(collected).to.have.length(2);
    // La 2ᵉ frame ne traîne AUCUNE phase de la 1ʳᵉ.
    const names = collected.map((f) => f.phases.map((p) => p.name));
    expect(names[0]).to.deep.equal(names[1]);
    expect(names[1].filter((n) => n === "action")).to.have.length(1);
    expect(collected[0].response?.statusCode).to.equal(200);
    client.disconnect();
  });

  it("un refus (403) est profilé AVEC son statut, et son id part dans error.data", async () => {
    routerMode = "action403";
    const { client } = await connect({ profiling: true });
    let data: unknown;
    try {
      await client.call("/secure");
    } catch (e) {
      data = (e as RpcError).data;
    }
    expect(data).to.deep.equal({ status: 403, requestId: "rid-test.1" });
    expect(collected).to.have.length(1);
    expect(collected[0].response?.statusCode).to.equal(403);
    expect(collected[0].error?.message).to.be.a("string");
    client.disconnect();
  });

  it("hors profiling (production) → aucun profil, aucune méta, valeur nue", async () => {
    const { client } = await connect();
    const { result, requestId } = await client.call<{ ok: boolean }>(
      "/nodefony/kernel/api/x",
    );
    expect(result.ok).to.equal(true);
    expect(requestId).to.equal(null);
    expect(collected).to.have.length(0);
    client.disconnect();
  });
});

describe("RealtimeController E2E — canaux & cycle de vie", () => {
  beforeEach(() => {
    getRealtimeHub().clear();
    routerMode = "ok";
    lastFinish = null;
  });

  it("subscribe canal connu (fallback createRealtimeChannel) → tick reçu", async () => {
    const { client } = await connect();
    const got: unknown[] = [];
    client.on("tick", (p) => got.push(p));
    client.subscribe("tick");
    await flush();
    await flush();
    expect(got).to.deep.equal([{ started: true }]);
    client.disconnect();
  });

  it("subscribe canal INCONNU (base renvoie null) → aucun abonnement", async () => {
    const { client } = await connect();
    const got: unknown[] = [];
    client.on("ghost", (p) => got.push(p));
    client.subscribe("ghost");
    await flush();
    await flush();
    expect(got).to.have.length(0);
    client.disconnect();
  });

  it("subscribe idempotent (2× le même canal) → un seul abonnement", async () => {
    const { client, rt } = await connect();
    client.subscribe("tick");
    client.subscribe("tick");
    await flush();
    await flush();
    expect(getRealtimeHub().subscriberCount("tick")).to.equal(1);
    expect(rt.publishers["tick"]).to.be.a("function");
    client.disconnect();
  });

  it("unsubscribe puis onFinish : cleanup complet (provider disposé)", async () => {
    const { client, rt } = await connect();
    client.subscribe("tick");
    await flush();
    await flush();
    client.unsubscribe("tick");
    await flush();
    expect(rt.publishers["tick"]).to.equal(undefined); // disposé au dernier abonné
    lastFinish?.(); // simule la fermeture WS → cleanup onFinish (idempotent)
    client.disconnect();
  });

  it("requestClient AVANT welcome (state absent) → reject explicite", async () => {
    const wire = new LoopbackWire();
    const rt = makeServer(wire); // pas de handshake déclenché
    await expect(rt.callBeforeWelcome()).rejects.toThrow(/non établie/);
  });
});

describe("RealtimeController E2E — edge dégradés & parsing", () => {
  beforeEach(() => {
    getRealtimeHub().clear();
    routerMode = "actionOk";
    lastFinish = null;
  });

  it("handleRealtime quand this.context est undefined → no-op (garde 170)", () => {
    const wire = new LoopbackWire();
    const rt = makeServer(wire);
    (rt as unknown as { context: unknown }).context = undefined;
    expect(() => rt.feed(null)).to.not.throw();
  });

  it("onHandshake avec connection null → no-op (pas de welcome)", async () => {
    const wire = new LoopbackWire();
    const ctx = {
      connection: null,
      once: () => {},
      request: { headers: {}, url: "/realtime" },
      url: "/realtime",
    };
    const rt = new ApiRt(ctx as unknown as ContextType);
    wire.feedServer = (raw) => rt.feed(raw);
    expect(() => rt.feed(null)).to.not.throw();
    await flush();
  });

  it("frame illisible (non-JSON) après welcome → ignorée (JSON.parse catch)", async () => {
    const { rt } = await connect();
    expect(() => rt.feed("{ pas du json")).to.not.throw();
  });

  it("subscribe SANS channel (params vide) → no-op (startChannel !channel)", async () => {
    const client = await connectWith({});
    client.emit("subscribe", {}); // notification subscribe sans `channel`
    await flush();
    await flush();
    client.disconnect(); // pas de crash, aucun abonnement
  });

  it("api.request query à 3 valeurs répétées → array (branche push)", async () => {
    const client = await connectWith({});
    const res = await client.request("api.request", {
      path: "/x?a=1&a=2&a=3",
    });
    expect(res).to.be.an("object");
    client.disconnect();
  });

  it("api.request sans router dans le ctx → status 500", async () => {
    const client = await connectWith({ noRouter: true });
    let status: unknown;
    try {
      await client.request("api.request", { path: "/x" });
    } catch (e) {
      status = (e as RpcError).data;
    }
    expect(status).to.deep.equal({ status: 500 });
    client.disconnect();
  });

  it("api.request action throw OPAQUE (non-HTTP) → -32603 (Zero Trust)", async () => {
    routerMode = "actionOpaque";
    const client = await connectWith({});
    let code: number | null = null;
    try {
      await client.request("api.request", { path: "/x" });
    } catch (e) {
      code = (e as RpcError).code;
    }
    expect(code).to.equal(-32603);
    client.disconnect();
  });

  it("unsubscribe SANS channel (params vide) → no-op (stopChannel !channel)", async () => {
    const { client } = await connect();
    client.emit("unsubscribe", {}); // notification unsubscribe sans `channel`
    await flush();
    await flush();
    client.disconnect();
  });

  it("handshake : Sec-WebSocket-Protocol en ARRAY → normalisé", async () => {
    const client = await connectCtx({
      headers: { host: "x", "sec-websocket-protocol": ["a", "b,c"] },
    });
    expect(client.identity).to.not.equal(null); // handshake abouti
    client.disconnect();
  });

  it("handshake : Sec-WebSocket-Protocol en CSV string → normalisé", async () => {
    const client = await connectCtx({
      headers: { host: "x", "sec-websocket-protocol": "a, b , " },
    });
    expect(client.identity).to.not.equal(null);
    client.disconnect();
  });

  it("handshake : url absente/non-string → path '/' (pas de crash)", async () => {
    const client = await connectCtx({ url: undefined });
    expect(client.identity).to.not.equal(null);
    client.disconnect();
  });
});

describe("RealtimeController E2E — scope de la connexion sous api.request (#484)", () => {
  beforeEach(() => {
    getRealtimeHub().clear();
    routerMode = "scopeProbe";
    probeScope = undefined;
    lastFinish = null;
  });

  it("une invocation api.request atteint le scope de la connexion par getScope()", async () => {
    const root = new Container();
    root.addScope("request");
    const scope = root.enterScope("request");
    probeScope = scope;
    const { client } = await connect({ container: scope });
    const res = await client.request<
      "api.request",
      { scopeDefined: boolean; scopeIsConnection: boolean }
    >("api.request", { path: "/nodefony/kernel/api/x" });
    expect(res).to.deep.equal({ scopeDefined: true, scopeIsConnection: true });
    client.disconnect();
  });

  it("un conteneur RACINE n'est jamais rendu : getScope() reste undefined", async () => {
    const root = new Container();
    probeScope = root;
    const { client } = await connect({ container: root });
    const res = await client.request<
      "api.request",
      { scopeDefined: boolean; scopeIsConnection: boolean }
    >("api.request", { path: "/nodefony/kernel/api/x" });
    expect(res).to.deep.equal({
      scopeDefined: false,
      scopeIsConnection: false,
    });
    client.disconnect();
  });

  // Constat 10 de l'audit #481 : la portée `request` suit la CONNEXION en
  // WebSocket. Deux invocations concurrentes sur une même socket reçoivent donc
  // le MÊME exemplaire — et ce que l'une y écrit, l'autre le lit. Débrancher :
  // poser un scope neuf par invocation dans le pont (`RealtimeController.ts`,
  // champ `scope` de l'ALS) → deux numéros d'exemplaire, le test tombe.
  it("deux api.request concurrents sur une socket partagent l'exemplaire request", async () => {
    routerMode = "sharedProbe";
    resetBarrier();
    SharedProbe.created = 0;
    const root = new Container();
    root.addScope("request");
    const scope = root.enterScope("request");
    const { client } = await connect({ container: scope });
    type Shared = { serial: number; wrote: string; readBack: string };
    const [a, b] = await Promise.all([
      client.request<"api.request", Shared>("api.request", { path: "/a" }),
      client.request<"api.request", Shared>("api.request", { path: "/b" }),
    ]);
    // La barrière s'est ouverte : les deux actions étaient EN VOL ensemble.
    expect(barrier.arrived).to.equal(2);
    expect(SharedProbe.created).to.equal(1);
    expect(a.serial).to.equal(b.serial);
    // Le même état mutable : les deux relisent la DERNIÈRE écriture, donc l'une
    // d'elles lit ce que l'autre a écrit.
    expect(a.readBack).to.equal(b.readBack);
    expect([a.wrote, b.wrote].filter((w) => w !== a.readBack)).to.have.length(
      1,
    );
    client.disconnect();
    root.leaveScope(scope);
  });
});
