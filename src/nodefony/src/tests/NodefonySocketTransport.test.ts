import { expect, vi } from "vitest";
import { NodefonySocket } from "../client/realtime/NodefonySocket";
import {
  TransportState,
  type IRealtimeTransport,
  type RealtimeFrameData,
  type RealtimeOutboundData,
} from "../realtime/IRealtimeTransport";
import { BrowserWsTransport } from "../client/realtime/BrowserWsTransport";
import type { NodefonyNotice } from "../client/realtime/notice";

/**
 * Vérifie que l'extraction du transport ({@link IRealtimeTransport}) préserve
 * l'orchestration de NodefonySocket (connect/reconnect/heartbeat/disconnect) — via
 * un transport MOCK injecté, sans vrai WebSocket ni navigateur.
 */
class MockTransport implements IRealtimeTransport {
  sent: string[] = [];
  sentBinary: RealtimeOutboundData[] = [];
  connectCalls = 0;
  closedWith: {
    code?: number | undefined;
    reason?: string | undefined;
  } | null = null;
  readyState: number = TransportState.CONNECTING;
  private _onOpen: (() => void) | null = null;
  private _onMessage: ((raw: RealtimeFrameData) => void) | null = null;
  private _onClose: ((code: number, reason: string) => void) | null = null;
  private _onError: ((err: unknown) => void) | null = null;

  connect(): void {
    this.connectCalls++;
  }
  send(raw: RealtimeOutboundData): void {
    if (typeof raw === "string") this.sent.push(raw);
    else this.sentBinary.push(raw);
  }
  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
    this.readyState = TransportState.CLOSED;
    this._onClose?.(code ?? 1000, reason ?? "");
  }
  onOpen(cb: () => void): void {
    this._onOpen = cb;
  }
  onMessage(cb: (raw: RealtimeFrameData) => void): void {
    this._onMessage = cb;
  }
  onClose(cb: (code: number, reason: string) => void): void {
    this._onClose = cb;
  }
  onError(cb: (err: unknown) => void): void {
    this._onError = cb;
  }
  // déclencheurs de test
  fireOpen(): void {
    this.readyState = TransportState.OPEN;
    this._onOpen?.();
    // Le serveur réel enchaîne l'ouverture et son `realtime:welcome` — et il JETTE
    // toute frame reçue entre les deux (`RealtimeController.handleRealtime`). Un mock
    // qui s'arrête à l'ouverture décrit un serveur qui n'existe pas : c'est ce qui a
    // laissé passer la perte des abonnements posés avant le welcome et rejoués après
    // une reconnexion. Sans `params` : la seule conséquence voulue ici est le rejeu.
    this._onMessage?.(
      JSON.stringify({ jsonrpc: "2.0", method: "realtime:welcome" }),
    );
  }
  fireMessage(raw: RealtimeFrameData): void {
    this._onMessage?.(raw);
  }
  fireClose(code = 1006, reason = ""): void {
    this.readyState = TransportState.CLOSED;
    this._onClose?.(code, reason);
  }
}

const delay = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

function setup(opts: Record<string, unknown> = {}) {
  const transports: MockTransport[] = [];
  const client = new NodefonySocket(
    { url: "ws://x/nodefony/api/realtime", ...opts },
    () => {
      const t = new MockTransport();
      transports.push(t);
      return t;
    },
  );
  return { client, transports };
}

describe("NodefonySocket — extraction transport (IRealtimeTransport)", () => {
  it("connect() crée + ouvre un transport → state connected", async () => {
    const { client, transports } = setup();
    const p = client.connect();
    expect(transports).to.have.length(1);
    expect(transports[0]!.connectCalls).to.equal(1);
    expect(client.state).to.equal("connecting");
    transports[0]!.fireOpen();
    await p;
    expect(client.state).to.equal("connected");
    client.disconnect();
  });

  it("subscribe après ouverture → frame émise PAR le transport", async () => {
    const { client, transports } = setup();
    const p = client.connect();
    transports[0]!.fireOpen();
    await p;
    client.subscribe("nodefony:dashboard");
    const frames = transports[0]!.sent.map((s) => JSON.parse(s));
    expect(
      frames.some(
        (f) =>
          f.method === "subscribe" &&
          f.params?.channel === "nodefony:dashboard",
      ),
    ).to.equal(true);
    client.disconnect();
  });

  it("fermeture anormale + autoReconnect → nouveau transport recréé (backoff)", async () => {
    const { client, transports } = setup({
      reconnectDelay: 1,
      reconnectDelayMax: 4,
    });
    const p = client.connect();
    transports[0]!.fireOpen();
    await p;
    transports[0]!.fireClose(1006); // perte non intentionnelle
    expect(client.state).to.equal("reconnecting");
    await delay(150); // plancher de 100 ms
    expect(transports.length).to.equal(2); // un transport NEUF par tentative
    expect(transports[1]!.connectCalls).to.equal(1);
    transports[1]!.fireOpen();
    expect(client.state).to.equal("connected");
    client.disconnect();
  });

  it("fermeture FATALE (1008 policy = 401/403) → PAS de reco + state error", async () => {
    const { client, transports } = setup({
      reconnectDelay: 1,
      reconnectDelayMax: 4,
    });
    const p = client.connect();
    transports[0]!.fireOpen();
    await p;
    transports[0]!.fireClose(1008); // policy → définitif (anonyme ne martèle pas)
    expect(client.state).to.equal("error");
    await delay(20);
    expect(transports.length).to.equal(1); // aucun transport recréé
    client.disconnect();
  });

  it("après un close fatal, connect() rétablit explicitement (ex. post-login)", async () => {
    const { client, transports } = setup({ reconnectDelay: 1 });
    const p = client.connect();
    transports[0]!.fireOpen();
    await p;
    transports[0]!.fireClose(1008);
    expect(client.state).to.equal("error");
    // l'app a corrigé la cause (login) → reconnexion MANUELLE
    const p2 = client.connect();
    expect(transports.length).to.equal(2);
    transports[1]!.fireOpen();
    await p2;
    expect(client.state).to.equal("connected");
    client.disconnect();
  });

  it("disconnect() ferme proprement (1000) sans reconnexion", async () => {
    const { client, transports } = setup({ reconnectDelay: 1 });
    const p = client.connect();
    transports[0]!.fireOpen();
    await p;
    client.disconnect();
    expect(transports[0]!.closedWith?.code).to.equal(1000);
    expect(client.state).to.equal("disconnected");
    await delay(15);
    expect(transports.length).to.equal(1); // PAS de reconnexion (intentionnel)
  });

  it("heartbeat → ping émis périodiquement via le transport", async () => {
    const { client, transports } = setup({ heartbeatInterval: 5 });
    const p = client.connect();
    transports[0]!.fireOpen();
    await p;
    await delay(14);
    const pinged = transports[0]!.sent
      .map((s) => JSON.parse(s))
      .some((f) => f.method === "ping");
    expect(pinged).to.equal(true);
    client.disconnect(); // clear l'intervalle (sinon mocha traîne)
  });

  it("send dropé tant que le transport n'est pas OPEN", () => {
    const { client, transports } = setup();
    // Non attendue : la connexion reste CONNECTING, c'est l'état éprouvé. Le
    // `disconnect()` final la fait rejeter — une ouverture annulée le dit.
    client.connect().catch(() => {}); // CONNECTING, pas encore OPEN
    client.emit("evt", { x: 1 });
    expect(transports[0]!.sent).to.have.length(0);
    client.disconnect();
  });
});

/**
 * #451 — une trame que le client ne sait pas lire n'est plus jetée EN SILENCE.
 * Le binaire était écarté deux fois sans un mot : par le transport du navigateur
 * (filtre `typeof === "string"`), puis par `handleMessage`.
 */
describe("NodefonySocket — trames binaires et illisibles (#451)", () => {
  async function connected() {
    const { client, transports } = setup();
    const notices: NodefonyNotice[] = [];
    client.onNotice((n) => notices.push(n));
    const p = client.connect();
    transports[0]!.fireOpen();
    await p;
    return { client, transport: transports[0]!, notices };
  }

  it("binaire sans lecteur → compté, UNE notice nommée, pas une par trame", async () => {
    const { client, transport, notices } = await connected();
    transport.fireMessage(new Uint8Array([1, 2, 3]));
    transport.fireMessage(new Uint8Array([4]));
    expect(client.binaryFramesDiscarded).to.equal(2);
    const binaires = notices.filter((n) => n.message.includes("binaire"));
    expect(binaires).to.have.length(1);
    expect(binaires[0]!.code).to.equal(-32700);
    expect(binaires[0]!.message).to.include("onBinary()");
    client.disconnect();
  });

  it("texte non JSON → compté, UNE notice, distinct du binaire", async () => {
    const { client, transport, notices } = await connected();
    transport.fireMessage("pas du json");
    transport.fireMessage("{tronqué");
    expect(client.malformedFramesDiscarded).to.equal(2);
    expect(client.binaryFramesDiscarded).to.equal(0);
    expect(
      notices.filter((n) => n.message.includes("illisible")),
    ).to.have.length(1);
    client.disconnect();
  });

  it("onBinary → la trame est remise intacte, ni comptée ni signalée ; dispose → de nouveau écartée", async () => {
    const { client, transport, notices } = await connected();
    const recues: Uint8Array[] = [];
    const dispose = client.onBinary((d) => recues.push(d));
    const octets = new Uint8Array([0xca, 0xfe]);
    transport.fireMessage(octets);
    expect(recues).to.have.length(1);
    expect(recues[0]).to.equal(octets);
    expect(client.binaryFramesDiscarded).to.equal(0);
    expect(notices).to.have.length(0);
    dispose();
    transport.fireMessage(octets);
    expect(client.binaryFramesDiscarded).to.equal(1);
    client.disconnect();
  });

  it("sendBinary → octets émis tels quels ; transport fermé → false et compté", async () => {
    const { client, transport } = await connected();
    const vue = new Uint8Array([7, 8]);
    expect(client.sendBinary(vue)).to.equal(true);
    expect(transport.sentBinary).to.deep.equal([vue]);
    expect(transport.sent.filter((s) => s.includes("7"))).to.have.length(0);
    client.disconnect();
    const avant = client.framesUnsent;
    expect(client.sendBinary(vue)).to.equal(false);
    expect(client.framesUnsent).to.equal(avant + 1);
  });
});

describe("BrowserWsTransport — relaie le binaire (#451)", () => {
  class FakeWebSocket extends EventTarget {
    static last: FakeWebSocket | null = null;
    binaryType: BinaryType = "blob";
    readyState = TransportState.OPEN;
    constructor(readonly url: string) {
      super();
      FakeWebSocket.last = this;
    }
    send(): void {}
    close(): void {}
  }

  afterEach(() => vi.unstubAllGlobals());

  it("pose binaryType=arraybuffer et relaie texte ET binaire, sans trier", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const t = new BrowserWsTransport("ws://x");
    const recues: RealtimeFrameData[] = [];
    t.onMessage((raw) => recues.push(raw));
    t.connect();
    const ws = FakeWebSocket.last!;
    expect(ws.binaryType).to.equal("arraybuffer");
    const octets = new Uint8Array([9]).buffer;
    ws.dispatchEvent(new MessageEvent("message", { data: "{}" }));
    ws.dispatchEvent(new MessageEvent("message", { data: octets }));
    expect(recues).to.have.length(2);
    expect(recues[0]).to.equal("{}");
    // Le binaire sort en `Uint8Array`, une vue sur l'`ArrayBuffer` reçu — sans copie.
    const vue = recues[1];
    expect(vue).to.be.instanceOf(Uint8Array);
    if (!(vue instanceof Uint8Array)) return;
    expect(vue.buffer).to.equal(octets);
    expect(vue.byteOffset).to.equal(0);
    expect(Array.from(vue)).to.deep.equal([9]);
  });
});
