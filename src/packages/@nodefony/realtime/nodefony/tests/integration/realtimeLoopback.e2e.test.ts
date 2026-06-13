import { describe, it, expect, beforeEach } from "vitest";
import "reflect-metadata";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
// `RpcError` côté SERVEUR = celle du dist `nodefony` (le peer serveur, importé via
// RealtimeController → "nodefony", est buildé). Un handler serveur DOIT throw CETTE
// classe pour que `err instanceof RpcError` du peer la reconnaisse comme erreur
// applicative (sinon → -32603 opaque). Le client, lui, tourne sur le SOURCE (cf
// import plus bas) et reconstruit SA propre `RpcError` à partir du JSON reçu.
import { RpcError as RpcErrorServer, type RpcActionHandler } from "nodefony";
import type { ContextType } from "@nodefony/http";
import type {
  RealtimePublish,
  RealtimeInboundHandler,
} from "../../interfaces/IRealtimeController.js";
import type { IRealtimeAuthenticator } from "../../interfaces/IRealtimeAuthenticator.js";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken.js";
// ── Client importé EN SOURCE (pas le subpath `nodefony/client` qui résout vers le
// dist) : ce test exerce la refacto L0 du RealtimeClient SANS rebuild du core. Le
// serveur (RealtimeController relatif source) tire `JsonRpcPeer` du dist `nodefony`
// — le moteur n'est PAS modifié par L0, donc dist === source (protocole JSON pur).
import { RealtimeClient } from "../../../../../../nodefony/src/client/realtime/RealtimeClient.js";
import { RpcError } from "../../../../../../nodefony/src/realtime/JsonRpcPeer.js";
import {
  TransportState,
  type IRealtimeTransport,
} from "../../../../../../nodefony/src/realtime/IRealtimeTransport.js";

/**
 * INTÉGRATION BÉTON « la socket Nodefony » — VRAI `RealtimeClient` (navigateur,
 * core isomorphe) ↔ VRAI `RealtimeController` (serveur, @nodefony/realtime),
 * reliés par un câble loopback in-process.
 *
 * POURQUOI cette suite (≠ unit) : les tests unit du client le pilotent via
 * `handleMessage`/`send` STUBÉS → ils valident le CONTRAT de surface, qui ne
 * bouge pas après L0 → ils ne prouvent RIEN sur la plomberie (le client
 * compose-t-il vraiment le peer ?) ni sur le duplex serveur→client. Ici les
 * frames traversent les DEUX moteurs réels, sérialisées en STRING (comme le
 * réseau) et délivrées en ASYNC (microtask, comme le réseau) — c'est la JONCTION
 * qui est testée, pas chaque côté en isolation.
 *
 * Le loopback court-circuite uniquement le TRANSPORT (pas de WebSocket/Kernel) :
 * `conn.send(raw)` (serveur) → pump du transport client ; `clientT.send(raw)` →
 * `controller.handleRealtime(raw)`. Le protocole isomorphe, lui, est 100 % réel.
 */

const OPEN = 1;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * Câble loopback : aiguille les frames STRING entre les deux pairs, toujours en
 * `queueMicrotask` (découple send→receive, évite la réentrance synchrone).
 */
class LoopbackWire {
  /** `controller.handleRealtime` (null = handshake). Branché par `makeServer`. */
  feedServer: ((raw: string | null) => void) | null = null;
  /** pump entrant du transport client (`onMessage`). Branché par le transport. */
  pumpClient: ((raw: string) => void) | null = null;
  /** `onClose` du transport client. Branché par le transport. */
  closeClient: ((code: number, reason: string) => void) | null = null;
  /** état de la connexion serveur (lu par `WsConnectionTransport.send`). */
  serverConnOpen = true;

  /** serveur → client (appelé par `conn.send`). */
  deliverToClient(raw: string): void {
    queueMicrotask(() => this.pumpClient?.(raw));
  }
  /** client → serveur (appelé par `clientTransport.send`). */
  deliverToServer(raw: string): void {
    queueMicrotask(() => this.feedServer?.(raw));
  }
}

/**
 * Transport client loopback ({@link IRealtimeTransport}) injecté dans le VRAI
 * `RealtimeClient`. `connect()` ouvre + déclenche le handshake serveur (le vrai
 * pipeline framework appelle `handleRealtime(null)` à l'upgrade).
 */
class LoopbackClientTransport implements IRealtimeTransport {
  readyState: number = TransportState.CONNECTING;
  private _onOpen: (() => void) | null = null;
  private _onClose: ((code: number, reason: string) => void) | null = null;

  constructor(private readonly wire: LoopbackWire) {}

  connect(): void {
    this.readyState = TransportState.OPEN;
    queueMicrotask(() => {
      this._onOpen?.();
      this.wire.feedServer?.(null); // handshake serveur
    });
  }
  send(raw: string): void {
    if (this.readyState !== TransportState.OPEN) return;
    this.wire.deliverToServer(raw);
  }
  close(code = 1000, reason = ""): void {
    this.readyState = TransportState.CLOSED;
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
    this.wire.closeClient = cb;
  }
  onError(): void {
    /* erreurs surfacées par close */
  }
}

/** Sous-classe serveur de test : déclare actions/canaux/inbound + ponts de test. */
class LoopbackRt extends RealtimeController {
  publishers: Record<string, RealtimePublish> = {};

  constructor(ctx: ContextType) {
    super("loopback-rt", ctx);
  }

  protected override realtimeActions(): Record<string, RpcActionHandler> {
    return {
      "kernel:ping": () => ({ pong: true, ts: 1, uptime: 1, pid: 1 }),
      // erreur APPLICATIVE assumée → code/data exposés fidèlement au client.
      // `RpcErrorServer` (dist) = classe vue par le peer serveur (cf import).
      "fail:rpc": () => {
        throw new RpcErrorServer("not found /x", -32000, { status: 404 });
      },
      // throw opaque → -32603 générique (Zero Trust).
      "fail:opaque": () => {
        throw new Error("secret interne");
      },
    };
  }

  protected override realtimeChannels(): string[] {
    return ["tick"];
  }

  override createRealtimeChannel(
    channel: string,
    publish: RealtimePublish,
  ): (() => void) | null {
    this.publishers[channel] = publish;
    return () => {
      delete this.publishers[channel];
    };
  }

  protected override realtimeInbound(): Record<string, RealtimeInboundHandler> {
    return {
      "sip:line1": (params, reply) => reply({ ack: true, echo: params }),
    };
  }

  /** Pont test : la route WS appelle normalement `handleRealtime`. */
  feed(raw: string | null): void {
    this.handleRealtime(raw);
  }

  /**
   * Ponts test PUBLICS vers les API L1 `requestClient`/`notifyClient` (protected)
   * de la base : ce sont DÉSORMAIS les vraies méthodes serveur du duplex qui sont
   * exercées, plus un accès direct au peer. C'est le chemin débloqué par L0.
   */
  callClient<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    return this.requestClient<T>(method, params, timeoutMs);
  }

  callNotify(method: string, params?: unknown): void {
    this.notifyClient(method, params);
  }
}

/** Paramètres du handshake serveur (matchers d'authenticator, origin CSRF). */
interface ServerHandshake {
  url?: string;
  origin?: string;
}

/** Monte un serveur réel relié au câble ; renvoie le controller + ponts de test. */
function makeServer(
  wire: LoopbackWire,
  hs: ServerHandshake = {},
): {
  rt: LoopbackRt;
  fireFinish: () => void;
  closeServer: (code?: number, reason?: string) => void;
} {
  let onFinish: (() => void) | null = null;
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
  const ctx = {
    connection: conn,
    once: (event: string, fn: () => void) => {
      if (event === "onFinish") onFinish = fn;
    },
    request: { headers: {}, url: hs.url ?? "/realtime" },
    cookies: {},
    url: hs.url ?? "/realtime",
    remoteAddress: "127.0.0.1",
    origin: hs.origin ?? "",
  };
  const rt = new LoopbackRt(ctx as unknown as ContextType);
  wire.feedServer = (raw) => rt.feed(raw);
  return {
    rt,
    fireFinish: () => onFinish?.(),
    closeServer: (code, reason) => conn.close(code, reason),
  };
}

/** Connecte un VRAI client à un VRAI serveur via le loopback + attend le welcome. */
async function connectPair(
  clientOpts: Record<string, unknown> = {},
  serverHs: ServerHandshake = {},
): Promise<{
  client: RealtimeClient;
  rt: LoopbackRt;
  fireFinish: () => void;
  closeServer: (code?: number, reason?: string) => void;
}> {
  const wire = new LoopbackWire();
  const { rt, fireFinish, closeServer } = makeServer(wire, serverHs);
  const transport = new LoopbackClientTransport(wire);
  const client = new RealtimeClient(
    { url: "ws://loopback/realtime", autoReconnect: false, ...clientOpts },
    () => transport,
  );
  await client.connect(); // résout sur onOpen
  await flush(); // laisse le handshake serveur (async) livrer le welcome
  await flush();
  return { client, rt, fireFinish, closeServer };
}

describe("Realtime loopback E2E — VRAI client ↔ VRAI serveur (la jonction)", () => {
  // Le hub des canaux est un singleton PAR PROCESS → reset entre tests.
  beforeEach(() => getRealtimeHub().clear());

  it("handshake → welcome : identité ANONYME + capabilities annoncées par le serveur réel", async () => {
    const { client } = await connectPair();
    expect(client.identity?.authenticated).to.equal(false);
    expect(client.identity?.type).to.equal("anonymous");
    expect(client.serverChannels).to.deep.equal(["tick"]);
    expect(client.serverMethods).to.include("kernel:ping");
  });

  it("request client→serveur : `kernel:ping` résolu par le handler serveur réel", async () => {
    const { client } = await connectPair();
    const res = await client.request<{ pong: boolean }>("kernel:ping");
    expect(res.pong).to.equal(true);
  });

  it("request client→serveur en erreur APPLICATIVE → RpcError code/data fidèles", async () => {
    const { client } = await connectPair();
    let err: RpcError | null = null;
    try {
      await client.request("fail:rpc");
    } catch (e) {
      err = e as RpcError;
    }
    expect(err).to.be.instanceOf(RpcError);
    expect(err!.code).to.equal(-32000);
    expect(err!.data).to.deep.equal({ status: 404 });
  });

  it("request client→serveur, throw OPAQUE → -32603 générique (Zero Trust)", async () => {
    const { client } = await connectPair();
    let code: number | null = null;
    try {
      await client.request("fail:opaque");
    } catch (e) {
      code = (e as RpcError).code;
    }
    expect(code).to.equal(-32603);
  });

  it("pub/sub : subscribe client → provider serveur démarré → notification reçue par on()", async () => {
    const { client, rt } = await connectPair();
    const got: unknown[] = [];
    client.on("tick", (p) => got.push(p));
    client.subscribe("tick");
    await flush(); // subscribe atteint le serveur + provider démarre
    expect(rt.publishers["tick"]).to.be.a("function");
    rt.publishers["tick"]("tick", { v: 42 }); // le provider pousse
    await flush(); // la notification revient au client
    expect(got).to.deep.equal([{ v: 42 }]);
  });

  it("full-duplex entrant : publish client sur un canal inbound → reply serveur reçu", async () => {
    const { client } = await connectPair();
    const got: unknown[] = [];
    client.on("sip:line1", (p) => got.push(p));
    client.publish("sip:line1", { invite: 1 });
    await flush();
    await flush();
    expect(got).to.deep.equal([{ ack: true, echo: { invite: 1 } }]);
  });

  it("duplex serveur→client SANS handler client → le serveur reçoit -32601 (method not found)", async () => {
    const { rt } = await connectPair();
    let code: number | null = null;
    try {
      await rt.callClient("client:noop", { x: 1 }, 1000);
    } catch (e) {
      code = (e as RpcError).code;
    }
    expect(code).to.equal(-32601);
  });

  // ── ⭐ DUPLEX serveur→client : débloqué par L0 (le client compose le peer) ──

  it("⭐ duplex serveur→client AVEC client.register → le serveur reçoit le result (L0)", async () => {
    const { client, rt } = await connectPair();
    client.register("client:confirm", (params) => ({
      ack: true,
      echo: params,
    }));
    const res = await rt.requestClient<{ ack: boolean; echo: unknown }>(
      "client:confirm",
      { n: 7 },
      2000,
    );
    expect(res).to.deep.equal({ ack: true, echo: { n: 7 } });
  });

  it("duplex serveur→client : handler client throw OPAQUE → serveur reçoit -32603", async () => {
    const { client, rt } = await connectPair();
    client.register("client:boom", () => {
      throw new Error("secret client");
    });
    let code: number | null = null;
    try {
      await rt.callClient("client:boom", undefined, 2000);
    } catch (e) {
      code = (e as RpcError).code;
    }
    expect(code).to.equal(-32603);
  });

  it("duplex serveur→client : handler client throw RpcError → serveur reçoit code/data fidèles", async () => {
    const { client, rt } = await connectPair();
    client.register("client:denied", () => {
      throw new RpcError("client refuse", -32050, { reason: "policy" });
    });
    let err: RpcError | null = null;
    try {
      await rt.callClient("client:denied", undefined, 2000);
    } catch (e) {
      err = e as RpcError;
    }
    expect(err!.code).to.equal(-32050);
    expect(err!.data).to.deep.equal({ reason: "policy" });
  });

  it("duplex serveur→client : handler client ASYNC → result attendu (Promise résolue)", async () => {
    const { client, rt } = await connectPair();
    client.register("client:async", async (params) => {
      await Promise.resolve();
      return { got: params };
    });
    const res = await rt.requestClient<{ got: unknown }>(
      "client:async",
      { v: 1 },
      2000,
    );
    expect(res).to.deep.equal({ got: { v: 1 } });
  });

  it("unregister côté client → la requête entrante retombe sur -32601", async () => {
    const { client, rt } = await connectPair();
    client.register("client:tmp", () => ({ ok: true }));
    client.unregister("client:tmp");
    let code: number | null = null;
    try {
      await rt.callClient("client:tmp", undefined, 1000);
    } catch (e) {
      code = (e as RpcError).code;
    }
    expect(code).to.equal(-32601);
  });

  it("L1 notifyClient → notification CIBLÉE serveur→client (hors canal) reçue par on()", async () => {
    const { client, rt } = await connectPair();
    const got: unknown[] = [];
    client.on("server:notice", (p) => got.push(p));
    rt.callNotify("server:notice", { msg: "hello" });
    await flush();
    expect(got).to.deep.equal([{ msg: "hello" }]);
  });

  // ── request client→serveur : chemin d'erreur restant ──

  it("request client→serveur méthode inconnue → le client rejette -32601", async () => {
    const { client } = await connectPair();
    let code: number | null = null;
    try {
      await client.request("does:not:exist");
    } catch (e) {
      code = (e as RpcError).code;
    }
    expect(code).to.equal(-32601);
  });

  // ── pub/sub : ref-count client + dispatch local (à travers le VRAI hub) ──

  it("ref-count subscribe : 2 abonnés = 1 provider ; stop au DERNIER unsubscribe seulement", async () => {
    const { client, rt } = await connectPair();
    client.subscribe("tick");
    client.subscribe("tick"); // 2e consommateur, MÊME canal
    await flush();
    expect(rt.publishers["tick"]).to.be.a("function"); // 1 seul provider démarré
    client.unsubscribe("tick"); // ref 2→1 : provider conservé
    await flush();
    expect(rt.publishers["tick"]).to.be.a("function");
    client.unsubscribe("tick"); // ref 1→0 : dispose serveur
    await flush();
    expect(rt.publishers["tick"]).to.equal(undefined);
  });

  it("dispatch : plusieurs handlers on() sur le même canal → tous reçoivent", async () => {
    const { client, rt } = await connectPair();
    const a: unknown[] = [];
    const b: unknown[] = [];
    client.on("tick", (p) => a.push(p));
    client.on("tick", (p) => b.push(p));
    client.subscribe("tick");
    await flush();
    rt.publishers["tick"]("tick", { v: 1 });
    await flush();
    expect(a).to.deep.equal([{ v: 1 }]);
    expect(b).to.deep.equal([{ v: 1 }]);
  });

  it("dispatch : off() détache un handler, les autres continuent de recevoir", async () => {
    const { client, rt } = await connectPair();
    const a: unknown[] = [];
    const b: unknown[] = [];
    const hb = (p: unknown): void => {
      b.push(p);
    };
    client.on("tick", (p) => a.push(p));
    client.on("tick", hb);
    client.subscribe("tick");
    await flush();
    client.off("tick", hb);
    rt.publishers["tick"]("tick", { v: 2 });
    await flush();
    expect(a).to.deep.equal([{ v: 2 }]);
    expect(b).to.deep.equal([]); // détaché
  });

  it("dispatch : wildcard on('*') reçoit (method, params) de toute notification", async () => {
    const { client, rt } = await connectPair();
    const seen: Array<[string, unknown]> = [];
    client.on("*", (...args) => seen.push(args as [string, unknown]));
    client.subscribe("tick");
    await flush();
    rt.publishers["tick"]("tick", { v: 3 });
    await flush();
    expect(seen.some(([m]) => m === "tick")).to.equal(true);
  });

  // ── identité résolue par le serveur, à travers le wire réel ──

  it("welcome AUTHENTIFIÉ (authenticator serveur) → identity authenticated + roles + scopes", async () => {
    const token: IRealtimeToken = {
      type: "jwt",
      getUserIdentifier: () => "user-42",
      isAuthenticated: () => true,
      getRoles: () => ["ROLE_USER", "ROLE_ADMIN"],
      getScopes: () => ["chat:write"],
      getAttribute: () => undefined,
    };
    const auth: IRealtimeAuthenticator = {
      name: "fake_jwt",
      supports: () => true,
      authenticate: async () => token,
    };
    getRealtimeHub().useAuthenticator({ pattern: "/realtime" }, auth);
    const { client } = await connectPair({}, { url: "/realtime" });
    expect(client.identity).to.deep.equal({
      type: "jwt",
      authenticated: true,
      userIdentifier: "user-42",
      roles: ["ROLE_USER", "ROLE_ADMIN"],
      scopes: ["chat:write"],
    });
  });

  it("onIdentity() notifié au welcome avec l'identité résolue (abonné AVANT connect)", async () => {
    const seen: Array<{ authenticated: boolean } | null> = [];
    const wire = new LoopbackWire();
    makeServer(wire); // branche wire.feedServer
    const transport = new LoopbackClientTransport(wire);
    const client = new RealtimeClient(
      { url: "ws://loopback/realtime", autoReconnect: false },
      () => transport,
    );
    client.onIdentity((id) =>
      seen.push(id as { authenticated: boolean } | null),
    );
    await client.connect();
    await flush();
    await flush();
    expect(seen).to.have.length(1);
    expect(seen[0]!.authenticated).to.equal(false); // anonyme
    client.disconnect();
  });

  // ── sécurité : seam #4 Origin + close code FATAL à travers le wire ──

  it("seam #4 Origin refusée → close, AUCUN welcome (identity reste null)", async () => {
    getRealtimeHub().setOriginGuard((o) => o === "https://app.example.com");
    const { client } = await connectPair(
      {},
      { url: "/realtime", origin: "https://evil.com" },
    );
    expect(client.identity).to.equal(null); // jamais welcomé (refusé au handshake)
    expect(client.serverChannels).to.equal(null);
    client.disconnect();
  });

  it("close serveur FATAL (1008 policy) → state error + AUCUNE reconnexion auto", async () => {
    const { client, closeServer } = await connectPair({ autoReconnect: true });
    expect(client.state).to.equal("connected");
    const notices: number[] = [];
    client.onNotice((n) => {
      if (n.code !== undefined) notices.push(n.code);
    });
    closeServer(1008, "policy");
    await flush();
    await flush();
    expect(client.state).to.equal("error"); // 1008 fatal → pas de reco
    expect(notices).to.include(1008);
  });
});
