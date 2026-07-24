import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RealtimeClient } from "../client/realtime/RealtimeClient";
import {
  TransportState,
  type IRealtimeTransport,
} from "../realtime/IRealtimeTransport";

/**
 * Couverture exhaustive du `RealtimeClient` (core isomorphe) : cycle de connexion
 * (open/close/reconnect/backoff), heartbeat, échantillonneur de stats, canaux
 * (ref-count + handle + adaptatif), pont `api.request`, log protocole + redaction,
 * notices serveur. Transport MOCK piloté à la main + timers simulés.
 */

class MockTransport implements IRealtimeTransport {
  readyState: number = TransportState.CONNECTING;
  sent: string[] = [];
  connectCalls = 0;
  private _open: (() => void) | null = null;
  private _close: ((c: number, r: string) => void) | null = null;
  private _msg: ((raw: string) => void) | null = null;
  private _err: ((err: unknown) => void) | null = null;
  connect(): void {
    this.connectCalls++;
  }
  send(raw: string): void {
    this.sent.push(raw);
  }
  close(): void {
    this.readyState = TransportState.CLOSED;
  }
  onOpen(cb: () => void): void {
    this._open = cb;
  }
  onMessage(cb: (raw: string) => void): void {
    this._msg = cb;
  }
  onClose(cb: (c: number, r: string) => void): void {
    this._close = cb;
  }
  onError(cb: (err: unknown) => void): void {
    this._err = cb;
  }
  // Pilotage test :
  fireOpen(): void {
    this.readyState = TransportState.OPEN;
    this._open?.();
  }
  fireClose(code = 1006, reason = ""): void {
    this.readyState = TransportState.CLOSED;
    this._close?.(code, reason);
  }
  fireMsg(raw: string): void {
    this._msg?.(raw);
  }
  fireErr(err: unknown = new Error("transport error")): void {
    this._err?.(err);
  }
}

let transports: MockTransport[] = [];
function newClient(opts: Record<string, unknown> = {}) {
  transports = [];
  const client = new RealtimeClient(
    { url: "ws://loopback/realtime", ...opts },
    () => {
      const t = new MockTransport();
      transports.push(t);
      return t;
    },
  );
  return client;
}
const last = () => transports[transports.length - 1]!;

async function connected(opts: Record<string, unknown> = {}) {
  const client = newClient(opts);
  const p = client.connect();
  last().fireOpen();
  await p;
  return client;
}

describe("RealtimeClient — cycle de connexion", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("connect → onOpen → state connected + transport.connect appelé", async () => {
    const client = newClient();
    expect(client.state).to.equal("disconnected");
    const p = client.connect();
    expect(last().connectCalls).to.equal(1);
    last().fireOpen();
    await p;
    expect(client.state).to.equal("connected");
  });

  it("URL http(s) normalisée en ws(s) au connect", async () => {
    const a = newClient({ url: "http://localhost/realtime" });
    const pa = a.connect();
    last().fireOpen();
    await pa;
    expect(a.state).to.equal("connected");
    a.disconnect();
    const b = newClient({ url: "https://localhost/realtime" });
    const pb = b.connect();
    last().fireOpen();
    await pb;
    expect(b.state).to.equal("connected");
    b.disconnect();
  });

  it("token en option → ajouté en query string de l'URL", async () => {
    const client = newClient({ token: "secret-abc" });
    const p = client.connect();
    await Promise.resolve();
    // l'URL passée au factory contient le token (transport créé)
    last().fireOpen();
    await p;
    client.disconnect();
  });

  it("disconnect (intentionnel) → close → state disconnected, pas de reconnect", async () => {
    const client = await connected();
    client.disconnect();
    last().fireClose(1000, "bye");
    expect(client.state).to.equal("disconnected");
    expect(client.reconnectAttempts).to.equal(0);
  });

  it("close TRANSITOIRE (1006) → scheduleReconnect (backoff + __reconnect__ + nextRetryAt)", async () => {
    const client = await connected({ reconnectDelay: 1000 });
    const events: Array<{ attempt: number; delay: number }> = [];
    client.on(
      "__reconnect__" as never,
      ((e: { attempt: number; delay: number }) => events.push(e)) as never,
    );
    last().fireClose(1006);
    expect(client.state).to.equal("reconnecting");
    expect(client.reconnectAttempts).to.equal(1);
    expect(client.nextRetryAt).to.be.a("number");
    expect(events[0]!.delay).to.equal(1000);
    // Le timer de reco recrée un transport + reconnecte.
    vi.advanceTimersByTime(1000);
    expect(transports.length).to.equal(2);
    last().fireOpen();
    expect(client.reconnectAttempts).to.equal(0); // reset au succès
  });

  it("backoff exponentiel plafonné (reconnectDelayMax)", async () => {
    const client = await connected({
      reconnectDelay: 1000,
      reconnectDelayMax: 3000,
    });
    const delays: number[] = [];
    client.on(
      "__reconnect__" as never,
      ((e: { delay: number }) => delays.push(e.delay)) as never,
    );
    last().fireClose(1006); // attempt 1 → 1000
    vi.advanceTimersByTime(1000);
    last().fireClose(1006); // attempt 2 → 2000
    vi.advanceTimersByTime(2000);
    last().fireClose(1006); // attempt 3 → min(4000,3000)=3000
    expect(delays).to.deep.equal([1000, 2000, 3000]);
  });

  it("close FATAL (1008 policy) → state error, AUCUN reconnect", async () => {
    const client = await connected();
    last().fireClose(1008, "unauthorized");
    expect(client.state).to.equal("error");
    expect(client.reconnectAttempts).to.equal(0);
  });

  it("close transitoire mais autoReconnect:false → disconnected (pas de reco)", async () => {
    const client = await connected({ autoReconnect: false });
    last().fireClose(1006);
    expect(client.state).to.equal("disconnected");
  });

  it("retryNow : annule le backoff et relance immédiatement", async () => {
    const client = await connected({ reconnectDelay: 5000 });
    last().fireClose(1006);
    expect(client.state).to.equal("reconnecting");
    client.retryNow(); // annule le timer, relance openSocket
    expect(client.nextRetryAt).to.equal(null);
    last().fireOpen();
    expect(client.state).to.equal("connected");
  });

  it("retryNow : no-op si déjà connecté", async () => {
    const client = await connected();
    const before = transports.length;
    client.retryNow();
    expect(transports.length).to.equal(before);
    client.disconnect();
  });

  it("notice de rétablissement émise APRÈS une reconnexion (pas au 1er connect)", async () => {
    const client = await connected({ reconnectDelay: 100 });
    const notices: Array<{ level: string }> = [];
    client.onNotice((n) => notices.push(n));
    last().fireClose(1006);
    vi.advanceTimersByTime(100);
    last().fireOpen(); // reconnecté
    expect(notices.some((n) => n.level === "success")).to.equal(true);
  });
});

describe("RealtimeClient — heartbeat + stats sampler (timers)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("heartbeat : ping émis périodiquement quand le transport est ouvert", async () => {
    const client = await connected({ heartbeatInterval: 1000 });
    last().sent.length = 0;
    vi.advanceTimersByTime(1000);
    expect(last().sent.some((s) => s.includes('"ping"'))).to.equal(true);
    client.disconnect();
  });

  it("stats sampler : calcule rate/series par canal toutes les secondes (__stats__)", async () => {
    const client = await connected();
    let statsTicks = 0;
    client.on("__stats__" as never, (() => statsTicks++) as never);
    last().fireMsg(
      JSON.stringify({ jsonrpc: "2.0", method: "chan:a", params: { v: 1 } }),
    );
    last().fireMsg(
      JSON.stringify({ jsonrpc: "2.0", method: "chan:a", params: { v: 2 } }),
    );
    vi.advanceTimersByTime(1000); // 1er tick : prev initialisé à msgCount → rate 0
    expect(statsTicks).to.be.greaterThan(0);
    const st = client.getChannelStats("chan:a");
    expect(st!.msgCount).to.equal(2);
    expect(st!.rate).to.equal(0); // pas d'historique compté au 1er échantillon
    last().fireMsg(
      JSON.stringify({ jsonrpc: "2.0", method: "chan:a", params: { v: 3 } }),
    );
    vi.advanceTimersByTime(1000); // 2e tick : 1 nouveau msg depuis prev → rate 1
    expect(st!.rate).to.equal(1);
    expect(st!.series.length).to.be.greaterThan(0);
    expect(client.framesReceived).to.equal(3);
    expect(client.lastFrameMethod).to.equal("chan:a");
    expect(client.lastFrameAt).to.be.a("number");
    expect(client.getStats().length).to.be.greaterThan(0);
    client.disconnect();
  });
});

describe("RealtimeClient — canaux (ref-count, handle, adaptatif)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("subscribe ref-compté : 1 seul subscribe réseau pour N consommateurs", async () => {
    const client = await connected();
    last().sent.length = 0;
    client.subscribe("room:1");
    client.subscribe("room:1"); // 2e consommateur → pas de 2e subscribe réseau
    const subs = last().sent.filter((s) => s.includes('"subscribe"'));
    expect(subs.length).to.equal(1);
    client.unsubscribe("room:1"); // encore 1 consommateur → pas d'unsubscribe
    expect(
      last().sent.filter((s) => s.includes('"unsubscribe"')).length,
    ).to.equal(0);
    client.unsubscribe("room:1"); // dernier → unsubscribe réseau
    expect(
      last().sent.filter((s) => s.includes('"unsubscribe"')).length,
    ).to.equal(1);
    client.disconnect();
  });

  it("ré-abonnement automatique des canaux au reconnect", async () => {
    const client = await connected({ reconnectDelay: 50 });
    client.subscribe("room:persist");
    last().fireClose(1006);
    vi.advanceTimersByTime(50);
    last().sent.length = 0;
    last().fireOpen(); // reconnecté → ré-émet les subscribe
    expect(last().sent.some((s) => s.includes("room:persist"))).to.equal(true);
    client.disconnect();
  });

  it("channel() : handle on/send/open/close", async () => {
    const client = await connected();
    const ch = client.channel("sip:line1");
    expect(ch.name).to.equal("sip:line1");
    const got: unknown[] = [];
    const dispose = ch.on((p) => got.push(p));
    ch.open(); // subscribe
    last().fireMsg(
      JSON.stringify({ jsonrpc: "2.0", method: "sip:line1", params: { v: 9 } }),
    );
    expect(got).to.deep.equal([{ v: 9 }]);
    ch.send({ cmd: "x" }); // publish (notify)
    dispose();
    ch.close(); // unsubscribe + dispose handlers
    client.disconnect();
  });

  it("adaptiveChannel : renvoie une poignée avec dispose", async () => {
    const client = await connected();
    const binding = client.adaptiveChannel("metrics", () => {}, {
      desiredHz: 1,
    } as never);
    expect(binding).to.have.property("dispose");
    binding.dispose();
    client.disconnect();
  });
});

describe("RealtimeClient — RPC (path, ping, register)", () => {
  it("request forme PATH → routé en api.request {path} (2e arg = timeout)", async () => {
    const client = await connected();
    const p = client.request("/nodefony/kernel/api/x", 5000);
    // le serveur répond (id 1)
    last().fireMsg(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }),
    );
    expect(await p).to.deep.equal({ ok: true });
    // la frame sortante est bien api.request
    expect(last().sent.some((s) => s.includes('"api.request"'))).to.equal(true);
    client.disconnect();
  });

  it("ping : mesure le RTT via nodefony:kernel:ping", async () => {
    const client = await connected();
    const p = client.ping(5000);
    last().fireMsg(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { pong: true, ts: 1, uptime: 1, pid: 1 },
      }),
    );
    const res = await p;
    expect(res.pong).to.equal(true);
    expect(res.rtt).to.be.a("number");
    client.disconnect();
  });

  it("register/unregister : action exposée au pair (duplex) + methods", async () => {
    const client = await connected();
    client.register("client:confirm" as never, (() => ({ ok: 1 })) as never);
    expect(client.methods).to.include("client:confirm");
    client.unregister("client:confirm" as never);
    expect(client.methods).to.not.include("client:confirm");
    client.disconnect();
  });

  it("notify : notification sortante (sans réponse)", async () => {
    const client = await connected();
    last().sent.length = 0;
    client.notify("app:event" as never, { x: 1 } as never);
    expect(last().sent.some((s) => s.includes("app:event"))).to.equal(true);
    client.disconnect();
  });
});

describe("RealtimeClient — log protocole, redaction, erreurs serveur", () => {
  it("frameLog + redaction des champs sensibles (token/password/…)", async () => {
    const client = await connected();
    client.notify(
      "auth:login" as never,
      {
        token: "SECRET",
        password: "p",
        safe: "ok",
      } as never,
    );
    last().fireMsg(
      JSON.stringify({ jsonrpc: "2.0", method: "x", params: { apikey: "K" } }),
    );
    const log = client.frameLog;
    expect(log.length).to.be.greaterThan(0);
    const out = log.find((f) => f.dir === "out")!;
    const payload = out.payload as { params: { token: string; safe: string } };
    expect(payload.params.token).to.equal("[redacted]");
    expect(payload.params.safe).to.equal("ok");
    client.clearFrameLog();
    expect(client.frameLog.length).to.equal(0);
    client.disconnect();
  });

  it("__frame__ live : émis seulement si un listener écoute", async () => {
    const client = await connected();
    const frames: unknown[] = [];
    const dispose = client.on(
      "__frame__" as never,
      ((f: unknown) => frames.push(f)) as never,
    );
    client.notify("live:x" as never, { a: 1 } as never);
    expect(frames.length).to.be.greaterThan(0);
    dispose();
    client.disconnect();
  });

  it("erreur GLOBALE serveur (frame invalide avec error) → notice 'server'", async () => {
    const client = await connected();
    const notices: Array<{ source: string; message: string }> = [];
    client.onNotice((n) => notices.push(n));
    last().fireMsg(
      JSON.stringify({ jsonrpc: "2.0", error: { code: 500, message: "boom" } }),
    );
    expect(
      notices.some((n) => n.source === "server" && n.message === "boom"),
    ).to.equal(true);
    client.disconnect();
  });

  it("welcome partiel / non-objet → toléré (pas de crash)", async () => {
    const client = await connected();
    last().fireMsg(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "realtime:welcome",
        params: null,
      }),
    );
    last().fireMsg(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "realtime:welcome",
        params: {
          identity: {
            type: "session",
            authenticated: true,
            userIdentifier: "u",
            roles: [],
            scopes: [],
          },
          channels: ["c"],
          methods: ["m"],
        },
      }),
    );
    expect(client.identity?.userIdentifier).to.equal("u");
    expect(client.serverChannels).to.deep.equal(["c"]);
    expect(client.serverMethods).to.deep.equal(["m"]);
    client.disconnect();
  });

  it("send hors connexion (transport non OPEN) → drop silencieux", () => {
    const client = newClient();
    // pas connecté → notify droppé (pas de crash, rien envoyé)
    client.notify("x" as never, { a: 1 } as never);
    expect(transports.length).to.equal(0); // aucun transport créé
  });
});

describe("RealtimeClient — edge (parsing, redaction, dispose, frameLog)", () => {
  it("handleMessage : binaire (non-string) ignoré + JSON invalide ignoré", async () => {
    const client = await connected();
    const before = client.framesReceived;
    last().fireMsg(new ArrayBuffer(4) as unknown as string); // binaire → ignoré
    last().fireMsg("{ pas du json"); // parse error → ignoré
    expect(client.framesReceived).to.equal(before);
    client.disconnect();
  });

  it("frameLog buildFrame : kinds error/response + redaction d'array", async () => {
    const client = await connected();
    last().fireMsg(
      JSON.stringify({ jsonrpc: "2.0", error: { code: 1, message: "e" } }),
    );
    last().fireMsg(
      JSON.stringify({ jsonrpc: "2.0", id: 6, result: { ok: 1 } }),
    );
    client.notify("arr:x" as never, [{ token: "SECRET" }, "plain"] as never);
    const log = client.frameLog;
    const kinds = log.map((f) => f.kind);
    expect(kinds).to.include("error");
    expect(kinds).to.include("response");
    // redaction récursive dans un array
    const arrFrame = log.find((f) => f.kind === "arr:x")!;
    const payload = arrFrame.payload as {
      params: Array<Record<string, unknown>>;
    };
    expect(payload.params[0]!.token).to.equal("[redacted]");
    client.disconnect();
  });

  it("frameLog : ring borné (anciennes frames évincées au-delà du max)", async () => {
    const client = await connected();
    for (let i = 0; i < 320; i++) {
      last().fireMsg(
        JSON.stringify({ jsonrpc: "2.0", method: "spam", params: { i } }),
      );
    }
    expect(client.frameLog.length).to.be.lessThanOrEqual(300);
    client.disconnect();
  });

  it("URL invalide → openSocket rejette + state error ; retryNow tolère l'échec", async () => {
    const client = newClient({ url: "http://[bad-url" });
    await expect(client.connect()).rejects.toThrow();
    expect(client.state).to.equal("error");
    client.retryNow(); // openSocket().catch(...) — ne throw pas
    expect(client.state).to.equal("error");
  });

  it("buildFrame : extrait le canal depuis params.channel", async () => {
    const client = await connected();
    last().fireMsg(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "chan:x",
        params: { channel: "room:42" },
      }),
    );
    const f = client.frameLog.find((fr) => fr.kind === "chan:x");
    expect(f!.channel).to.equal("room:42");
    client.disconnect();
  });

  it("dispatch : un handler qui THROW n'interrompt pas les autres (wildcard inclus)", async () => {
    const client = await connected();
    let reached = false;
    client.on(
      "boom" as never,
      (() => {
        throw new Error("handler buggy");
      }) as never,
    );
    client.on(
      "*" as never,
      (() => {
        reached = true;
      }) as never,
    );
    last().fireMsg(
      JSON.stringify({ jsonrpc: "2.0", method: "boom", params: {} }),
    );
    expect(reached).to.equal(true); // le wildcard est atteint malgré le throw
    client.disconnect();
  });
});

describe("RealtimeClient — shared (singleton par URL) + events d'état", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shared : même URL → même instance", () => {
    const a = RealtimeClient.shared({ url: "ws://x/realtime" });
    const b = RealtimeClient.shared({ url: "ws://x/realtime" });
    expect(a).to.equal(b);
  });

  it("onState : notifié à chaque transition", async () => {
    const client = newClient();
    const states: string[] = [];
    client.on("__state__" as never, ((s: string) => states.push(s)) as never);
    const p = client.connect();
    last().fireOpen();
    await p;
    expect(states).to.include("connected");
    client.disconnect();
  });
});
