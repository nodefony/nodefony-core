import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NodefonySocket,
  type RealtimeReconnectInfo,
} from "../client/realtime/NodefonySocket";
import {
  TransportState,
  type IRealtimeTransport,
} from "../realtime/IRealtimeTransport";

/**
 * Couverture exhaustive du `NodefonySocket` (core isomorphe) : cycle de connexion
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
  /**
   * Le serveur réel enchaîne l'ouverture et son `realtime:welcome` — et il JETTE
   * toute frame reçue entre les deux (`RealtimeController.handleRealtime`). Un mock
   * qui s'arrête à l'ouverture décrit un serveur qui n'existe pas : c'est ce qui a
   * laissé passer la perte des abonnements posés avant le welcome et rejoués après
   * une reconnexion. Le défaut du mock est donc l'enchaînement des DEUX.
   */
  fireOpen(): void {
    this.fireOpenSansWelcome();
    this.fireWelcome();
  }
  /** L'ouverture SEULE — la fenêtre où le serveur authentifie encore. */
  fireOpenSansWelcome(): void {
    this.readyState = TransportState.OPEN;
    this._open?.();
  }
  /** Sans `params` : la seule conséquence voulue ici est le rejeu des abonnements. */
  fireWelcome(): void {
    this._msg?.(JSON.stringify({ jsonrpc: "2.0", method: "realtime:welcome" }));
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
  const client = new NodefonySocket(
    // Sans sonde d'échec d'ouverture : ce banc pilote le cycle de connexion à
    // la minuterie factice, et la sonde a son propre banc (NodefonySocketProbe).
    { url: "ws://loopback/realtime", probe: false, ...opts },
    () => {
      const t = new MockTransport();
      transports.push(t);
      return t;
    },
  );
  return client;
}
const last = () => transports[transports.length - 1];
/** Dernier transport créé — échoue franchement si aucun (décor mal monté). */
const current = (): MockTransport => {
  const t = last();
  if (!t) throw new Error("aucun transport créé");
  return t;
};

async function connected(opts: Record<string, unknown> = {}) {
  const client = newClient(opts);
  const p = client.connect();
  current().fireOpen();
  await p;
  return client;
}

describe("NodefonySocket — cycle de connexion", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("connect → onOpen → state connected + transport.connect appelé", async () => {
    const client = newClient();
    expect(client.state).to.equal("disconnected");
    const p = client.connect();
    expect(current().connectCalls).to.equal(1);
    current().fireOpen();
    await p;
    expect(client.state).to.equal("connected");
  });

  it("URL http(s) normalisée en ws(s) au connect", async () => {
    const a = newClient({ url: "http://localhost/realtime" });
    const pa = a.connect();
    current().fireOpen();
    await pa;
    expect(a.state).to.equal("connected");
    a.disconnect();
    const b = newClient({ url: "https://localhost/realtime" });
    const pb = b.connect();
    current().fireOpen();
    await pb;
    expect(b.state).to.equal("connected");
    b.disconnect();
  });

  it("token en option → ajouté en query string de l'URL", async () => {
    const client = newClient({ token: "secret-abc" });
    const p = client.connect();
    await Promise.resolve();
    // l'URL passée au factory contient le token (transport créé)
    current().fireOpen();
    await p;
    client.disconnect();
  });

  it("disconnect (intentionnel) → close → state disconnected, pas de reconnect", async () => {
    const client = await connected();
    client.disconnect();
    current().fireClose(1000, "bye");
    expect(client.state).to.equal("disconnected");
    expect(client.reconnectAttempts).to.equal(0);
  });

  it("close TRANSITOIRE (1006) → scheduleReconnect (backoff + __reconnect__ + nextRetryAt)", async () => {
    // Gigue neutralisée : le délai retenu vaut alors exactement le doublement.
    vi.spyOn(Math, "random").mockReturnValue(1);
    const client = await connected({ reconnectDelay: 1000 });
    const events: RealtimeReconnectInfo[] = [];
    client.onReconnect((e) => events.push(e));
    current().fireClose(1006);
    expect(client.state).to.equal("reconnecting");
    expect(client.reconnectAttempts).to.equal(1);
    expect(client.nextRetryAt).to.be.a("number");
    expect(events[0]?.delay).to.equal(1000);
    // Le timer de reco recrée un transport + reconnecte.
    vi.advanceTimersByTime(1000);
    expect(transports.length).to.equal(2);
    current().fireOpen();
    // Une connexion ne remet le back-off à zéro qu'une fois STABLE (5 s) : un
    // serveur qui accepte puis coupe aussitôt n'est pas sondé à cadence fixe.
    expect(client.reconnectAttempts).to.equal(1);
    vi.advanceTimersByTime(5000);
    current().fireClose(1006);
    expect(client.reconnectAttempts).to.equal(1); // remis à zéro, puis 1ʳᵉ tentative
    expect(events[1]?.delay).to.equal(1000);
    client.disconnect();
    vi.restoreAllMocks();
  });

  it("backoff exponentiel plafonné (reconnectDelayMax)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const client = await connected({
      reconnectDelay: 1000,
      reconnectDelayMax: 3000,
    });
    const delays: number[] = [];
    client.onReconnect((e) => delays.push(e.delay));
    current().fireClose(1006); // attempt 1 → 1000
    vi.advanceTimersByTime(1000);
    current().fireClose(1006); // attempt 2 → 2000
    vi.advanceTimersByTime(2000);
    current().fireClose(1006); // attempt 3 → min(4000,3000)=3000
    expect(delays).to.deep.equal([1000, 2000, 3000]);
    client.disconnect();
    vi.restoreAllMocks();
  });

  it("gigue : le délai tombe entre la moitié et la totalité du doublement", async () => {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0);
    const client = await connected({ reconnectDelay: 1000 });
    const delays: number[] = [];
    client.onReconnect((e) => delays.push(e.delay));
    current().fireClose(1006);
    expect(delays).to.deep.equal([500]);
    spy.mockReturnValue(0.5);
    vi.advanceTimersByTime(500);
    current().fireClose(1006); // 2ᵉ tentative : 2000 → 1000 + 0,5 × 1000
    expect(delays).to.deep.equal([500, 1500]);
    client.disconnect();
    vi.restoreAllMocks();
  });

  it("close FATAL (1008 policy) → state error, AUCUN reconnect", async () => {
    const client = await connected();
    current().fireClose(1008, "unauthorized");
    expect(client.state).to.equal("error");
    expect(client.reconnectAttempts).to.equal(0);
  });

  it("close transitoire mais autoReconnect:false → disconnected (pas de reco)", async () => {
    const client = await connected({ autoReconnect: false });
    current().fireClose(1006);
    expect(client.state).to.equal("disconnected");
  });

  it("retryNow : annule le backoff et relance immédiatement", async () => {
    const client = await connected({ reconnectDelay: 5000 });
    current().fireClose(1006);
    expect(client.state).to.equal("reconnecting");
    client.retryNow(); // annule le timer, relance openSocket
    expect(client.nextRetryAt).to.equal(null);
    current().fireOpen();
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
    current().fireClose(1006);
    vi.advanceTimersByTime(100);
    current().fireOpen(); // reconnecté
    expect(notices.some((n) => n.level === "success")).to.equal(true);
  });
});

describe("NodefonySocket — heartbeat + stats sampler (timers)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("heartbeat : ping émis périodiquement quand le transport est ouvert", async () => {
    const client = await connected({ heartbeatInterval: 1000 });
    current().sent.length = 0;
    vi.advanceTimersByTime(1000);
    expect(current().sent.some((s) => s.includes('"ping"'))).to.equal(true);
    client.disconnect();
  });

  it("stats sampler : aucun intervalle avant connect, coupé par disconnect, réarmé au connect suivant", async () => {
    // Armé dans le constructeur et jamais arrêté, l'intervalle retenait
    // l'instance pour la vie du processus et allouait chaque seconde.
    const before = vi.getTimerCount();
    const idle = newClient();
    expect(vi.getTimerCount(), "socket jamais connectée : aucun minuteur").toBe(
      before,
    );
    idle.disconnect();
    const client = await connected();
    let ticks = 0;
    client.on("__stats__" as never, (() => ticks++) as never);
    vi.advanceTimersByTime(1000);
    expect(ticks).toBe(1);
    client.disconnect();
    vi.advanceTimersByTime(5000);
    expect(ticks, "plus aucun échantillon après disconnect").toBe(1);
    expect(vi.getTimerCount()).toBe(before);
    const p = client.connect();
    current().fireOpen();
    await p;
    vi.advanceTimersByTime(1000);
    expect(ticks, "réarmé par le connect suivant").toBe(2);
    client.disconnect();
  });

  it("stats sampler : calcule rate/series par canal toutes les secondes (__stats__)", async () => {
    const client = await connected();
    let statsTicks = 0;
    client.on("__stats__" as never, (() => statsTicks++) as never);
    current().fireMsg(
      JSON.stringify({ jsonrpc: "2.0", method: "chan:a", params: { v: 1 } }),
    );
    current().fireMsg(
      JSON.stringify({ jsonrpc: "2.0", method: "chan:a", params: { v: 2 } }),
    );
    vi.advanceTimersByTime(1000); // 1er tick : prev initialisé à msgCount → rate 0
    expect(statsTicks).to.be.greaterThan(0);
    const st = client.getChannelStats("chan:a");
    expect(st!.msgCount).to.equal(2);
    expect(st!.rate).to.equal(0); // pas d'historique compté au 1er échantillon
    current().fireMsg(
      JSON.stringify({ jsonrpc: "2.0", method: "chan:a", params: { v: 3 } }),
    );
    vi.advanceTimersByTime(1000); // 2e tick : 1 nouveau msg depuis prev → rate 1
    expect(st!.rate).to.equal(1);
    expect(st!.series.length).to.be.greaterThan(0);
    // 3 frames de canal + le `realtime:welcome` de l'ouverture : le compteur est
    // documenté « welcome inclus », et le serveur réel l'envoie toujours.
    expect(client.framesReceived).to.equal(4);
    expect(client.lastFrameMethod).to.equal("chan:a");
    expect(client.lastFrameAt).to.be.a("number");
    expect(client.getStats().length).to.be.greaterThan(0);
    client.disconnect();
  });
});

describe("NodefonySocket — la fenêtre où le serveur écoute (welcome)", () => {
  /** Les canaux effectivement demandés au serveur, dans l'ordre d'émission. */
  const abonnements = (t: MockTransport): string[] =>
    t.sent
      .map((raw) => JSON.parse(raw) as { method: string; params: unknown })
      .filter((f) => f.method === "subscribe")
      .map((f) => (f.params as { channel: string }).channel);

  it("un `subscribe` posé AVANT la connexion part au welcome, pas à l'ouverture", async () => {
    const client = newClient();
    client.subscribe("chan:z");
    const p = client.connect();
    const t = last();
    t!.fireOpenSansWelcome();
    await p;
    // La socket est ouverte et l'état dit `connected` — mais le serveur authentifie
    // encore : une frame émise ici serait jetée SANS RÉPONSE POSSIBLE (son transport
    // JSON-RPC n'est pas branché). Émettre maintenant, c'est parler dans le vide.
    expect(client.state).to.equal("connected");
    expect(abonnements(t!)).to.have.length(0);

    t!.fireWelcome();
    expect(abonnements(t!)).to.deep.equal(["chan:z"]);
  });

  it("après une coupure, le rejeu attend le welcome de la NOUVELLE connexion", async () => {
    // Le backoff de reconnexion est un `setTimeout` : l'attendre en temps réel
    // mesurerait la machine. On avance l'horloge, on ne relâche aucun seuil.
    vi.useFakeTimers();
    const client = await connected();
    client.subscribe("chan:z");
    const premier = last();
    expect(abonnements(premier!)).to.have.length(1);

    premier!.fireClose(1006, "perte réseau");
    await vi.advanceTimersByTimeAsync(1200); // backoff de la 1ʳᵉ tentative
    const second = last();
    expect(second, "un transport NEUF est ouvert").to.not.equal(premier);

    second!.fireOpenSansWelcome();
    expect(
      abonnements(second!),
      "rejouer à l'ouverture perd l'abonnement : le serveur n'écoute pas encore",
    ).to.have.length(0);

    second!.fireWelcome();
    expect(abonnements(second!)).to.deep.equal(["chan:z"]);
    vi.useRealTimers();
  });
});

describe("NodefonySocket — canaux (ref-count, handle, adaptatif)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("subscribe ref-compté : 1 seul subscribe réseau pour N consommateurs", async () => {
    const client = await connected();
    current().sent.length = 0;
    client.subscribe("room:1");
    client.subscribe("room:1"); // 2e consommateur → pas de 2e subscribe réseau
    const subs = current().sent.filter((s) => s.includes('"subscribe"'));
    expect(subs.length).to.equal(1);
    client.unsubscribe("room:1"); // encore 1 consommateur → pas d'unsubscribe
    expect(
      current().sent.filter((s) => s.includes('"unsubscribe"')).length,
    ).to.equal(0);
    client.unsubscribe("room:1"); // dernier → unsubscribe réseau
    expect(
      current().sent.filter((s) => s.includes('"unsubscribe"')).length,
    ).to.equal(1);
    client.disconnect();
  });

  it("ré-abonnement automatique des canaux au reconnect", async () => {
    const client = await connected({ reconnectDelay: 50 });
    client.subscribe("room:persist");
    current().fireClose(1006);
    vi.advanceTimersByTime(100); // plancher de 100 ms
    current().sent.length = 0;
    current().fireOpen(); // reconnecté → ré-émet les subscribe
    expect(current().sent.some((s) => s.includes("room:persist"))).to.equal(
      true,
    );
    client.disconnect();
  });

  it("channel() : handle on/send/open/close", async () => {
    const client = await connected();
    const ch = client.channel("sip:line1");
    expect(ch.name).to.equal("sip:line1");
    const got: unknown[] = [];
    const dispose = ch.on((p) => got.push(p));
    ch.open(); // subscribe
    current().fireMsg(
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

describe("NodefonySocket — RPC (path, ping, register)", () => {
  /** Dernière trame `api.request` émise, relue telle que le serveur la lit. */
  const lastBridgeFrame = (): {
    id: number;
    params: Record<string, unknown>;
  } => {
    const raw = current().sent.findLast((s) => s.includes('"api.request"'));
    expect(raw, "aucune trame api.request émise").to.be.a("string");
    const frame: unknown = JSON.parse(raw ?? "null");
    if (
      typeof frame !== "object" ||
      frame === null ||
      !("id" in frame) ||
      typeof frame.id !== "number" ||
      !("params" in frame) ||
      typeof frame.params !== "object" ||
      frame.params === null
    ) {
      throw new Error("trame api.request mal formée");
    }
    return { id: frame.id, params: { ...frame.params } };
  };

  it("get → api.request {path} seul : la trame d'une lecture n'a ni verbe ni clé", async () => {
    const client = await connected();
    const p = client.get("/nodefony/kernel/api/x");
    const { id, params } = lastBridgeFrame();
    expect(params).to.deep.equal({ path: "/nodefony/kernel/api/x" });
    current().fireMsg(
      JSON.stringify({ jsonrpc: "2.0", id, result: { ok: true } }),
    );
    expect(await p).to.deep.equal({ ok: true });
    client.disconnect();
  });

  it("get + query → sérialisée dans le chemin (tableau = clé répétée, null/undefined omis)", async () => {
    const client = await connected();
    void client
      .get("/a/b?x=1", {
        query: {
          limit: 20,
          tag: ["r", "s"],
          on: true,
          skip: undefined,
          none: null,
        },
        timeoutMs: 50,
      })
      .catch(() => undefined);
    expect(lastBridgeFrame().params.path).to.equal(
      "/a/b?x=1&limit=20&tag=r&tag=s&on=true",
    );
    client.disconnect();
  });

  it("query non scalaire → TypeError AVANT d'émettre (un objet ne voyage pas dans un chemin)", async () => {
    const client = await connected();
    const before = current().sent.length;
    expect(() => client.get("/a", { query: { deep: { x: 1 } } })).to.throw(
      TypeError,
      /deep/,
    );
    expect(current().sent.length).to.equal(before);
    client.disconnect();
  });

  it("gabarit + params → chemin rempli, chaque valeur encodée pour son segment", async () => {
    const client = await connected();
    void client
      .get("/chat/messages/{id}", {
        params: { id: "a/b" },
        query: { v: 1 },
        timeoutMs: 50,
      })
      .catch(() => undefined);
    expect(lastBridgeFrame().params.path).to.equal("/chat/messages/a%2Fb?v=1");
    void client
      .delete("/chat/messages/{id}", undefined, {
        params: { id: 7 },
        timeoutMs: 50,
      })
      .catch(() => undefined);
    expect(lastBridgeFrame().params).to.include({
      path: "/chat/messages/7",
      method: "DELETE",
    });
    client.disconnect();
  });

  it("gabarit sans sa valeur, ou valeur `..` → TypeError AVANT d'émettre", async () => {
    const client = await connected();
    const before = current().sent.length;
    // Appel non typé : ce que ferait un JavaScript, ou une valeur venue du réseau.
    const untyped: (path: `/${string}`, o?: object) => Promise<unknown> = (
      path,
      o,
    ) => client.get(path, o);
    expect(() => untyped("/chat/messages/{id}")).to.throw(TypeError, /« id »/);
    expect(() =>
      client.get("/chat/messages/{id}", { params: { id: ".." } }),
    ).to.throw(TypeError, /« \.\. »/);
    expect(current().sent.length).to.equal(before);
    client.disconnect();
  });

  it("post → verbe + corps + clé d'idempotence GÉNÉRÉE, une par appel", async () => {
    const client = await connected();
    void client
      .post("/chat/send", { text: "a" }, { timeoutMs: 50 })
      .catch(() => undefined);
    const first = lastBridgeFrame().params;
    void client
      .post("/chat/send", { text: "a" }, { timeoutMs: 50 })
      .catch(() => undefined);
    const second = lastBridgeFrame().params;
    expect(first.method).to.equal("POST");
    expect(first.body).to.deep.equal({ text: "a" });
    expect(first.idempotencyKey).to.be.a("string").with.length.greaterThan(8);
    expect(second.idempotencyKey).to.not.equal(first.idempotencyKey);
    client.disconnect();
  });

  it("post + idempotencyKey fournie → reprise telle quelle (une INTENTION, deux appels)", async () => {
    const client = await connected();
    void client
      .post("/chat/send", undefined, { idempotencyKey: "k-1", timeoutMs: 50 })
      .catch(() => undefined);
    expect(lastBridgeFrame().params.idempotencyKey).to.equal("k-1");
    client.disconnect();
  });

  it("put / patch / delete → le verbe de la méthode voyage", async () => {
    const client = await connected();
    const verbs: string[] = [];
    for (const call of [
      () => client.put("/r/1", { a: 1 }, { timeoutMs: 50 }),
      () => client.patch("/r/1", { a: 2 }, { timeoutMs: 50 }),
      () => client.delete("/r/1", undefined, { timeoutMs: 50 }),
    ]) {
      void call().catch(() => undefined);
      const { method } = lastBridgeFrame().params;
      verbs.push(typeof method === "string" ? method : "?");
    }
    expect(verbs).to.deep.equal(["PUT", "PATCH", "DELETE"]);
    client.disconnect();
  });

  it("ping : mesure le RTT via nodefony:kernel:ping", async () => {
    const client = await connected();
    const p = client.ping(5000);
    current().fireMsg(
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
    client.register("client:confirm" as never, () => ({ ok: 1 }));
    expect(client.methods).to.include("client:confirm");
    client.unregister("client:confirm" as never);
    expect(client.methods).to.not.include("client:confirm");
    client.disconnect();
  });

  it("notify : notification sortante (sans réponse)", async () => {
    const client = await connected();
    current().sent.length = 0;
    client.notify("app:event" as never, { x: 1 });
    expect(current().sent.some((s) => s.includes("app:event"))).to.equal(true);
    client.disconnect();
  });
});

describe("NodefonySocket — log protocole, redaction, erreurs serveur", () => {
  it("frameLog + redaction des champs sensibles (token/password/…)", async () => {
    const client = await connected();
    client.notify("auth:login" as never, {
      token: "SECRET",
      password: "p",
      safe: "ok",
    });
    current().fireMsg(
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
    client.notify("live:x" as never, { a: 1 });
    expect(frames.length).to.be.greaterThan(0);
    dispose();
    client.disconnect();
  });

  it("erreur GLOBALE serveur (frame invalide avec error) → notice 'server'", async () => {
    const client = await connected();
    const notices: Array<{ source: string; message: string }> = [];
    client.onNotice((n) => notices.push(n));
    current().fireMsg(
      JSON.stringify({ jsonrpc: "2.0", error: { code: 500, message: "boom" } }),
    );
    expect(
      notices.some((n) => n.source === "server" && n.message === "boom"),
    ).to.equal(true);
    client.disconnect();
  });

  it("welcome partiel / non-objet → toléré (pas de crash)", async () => {
    const client = await connected();
    current().fireMsg(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "realtime:welcome",
        params: null,
      }),
    );
    current().fireMsg(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "realtime:welcome",
        params: {
          identity: {
            type: "session",
            authenticated: true,
            id: "u-1",
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
    client.notify("x" as never, { a: 1 });
    expect(transports.length).to.equal(0); // aucun transport créé
  });
});

describe("NodefonySocket — edge (parsing, redaction, dispose, frameLog)", () => {
  it("handleMessage : binaire (non-string) ignoré + JSON invalide ignoré", async () => {
    const client = await connected();
    const before = client.framesReceived;
    current().fireMsg(new ArrayBuffer(4) as unknown as string); // binaire → ignoré
    current().fireMsg("{ pas du json"); // parse error → ignoré
    expect(client.framesReceived).to.equal(before);
    client.disconnect();
  });

  it("frameLog buildFrame : kinds error/response + redaction d'array", async () => {
    const client = await connected();
    current().fireMsg(
      JSON.stringify({ jsonrpc: "2.0", error: { code: 1, message: "e" } }),
    );
    current().fireMsg(
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
      current().fireMsg(
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
    current().fireMsg(
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
    current().fireMsg(
      JSON.stringify({ jsonrpc: "2.0", method: "boom", params: {} }),
    );
    expect(reached).to.equal(true); // le wildcard est atteint malgré le throw
    client.disconnect();
  });
});

describe("NodefonySocket — shared (singleton par URL) + events d'état", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shared : même URL → même instance", () => {
    const a = NodefonySocket.shared({ url: "ws://x/realtime" });
    const b = NodefonySocket.shared({ url: "ws://x/realtime" });
    expect(a).to.equal(b);
  });

  it("onState : notifié à chaque transition", async () => {
    const client = newClient();
    const states: string[] = [];
    client.on("__state__" as never, ((s: string) => states.push(s)) as never);
    const p = client.connect();
    current().fireOpen();
    await p;
    expect(states).to.include("connected");
    client.disconnect();
  });
});
