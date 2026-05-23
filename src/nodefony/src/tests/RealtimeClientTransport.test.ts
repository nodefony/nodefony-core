import { expect } from "chai";
import "mocha";
import { RealtimeClient } from "../client/realtime/RealtimeClient";
import {
  TransportState,
  type IRealtimeTransport,
} from "../realtime/IRealtimeTransport";

/**
 * Vérifie que l'extraction du transport ({@link IRealtimeTransport}) préserve
 * l'orchestration de RealtimeClient (connect/reconnect/heartbeat/disconnect) — via
 * un transport MOCK injecté, sans vrai WebSocket ni navigateur.
 */
class MockTransport implements IRealtimeTransport {
  sent: string[] = [];
  connectCalls = 0;
  closedWith: { code?: number; reason?: string } | null = null;
  readyState: number = TransportState.CONNECTING;
  private _onOpen: (() => void) | null = null;
  private _onMessage: ((raw: string) => void) | null = null;
  private _onClose: ((code: number, reason: string) => void) | null = null;
  private _onError: ((err: unknown) => void) | null = null;

  connect(): void {
    this.connectCalls++;
  }
  send(raw: string): void {
    this.sent.push(raw);
  }
  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
    this.readyState = TransportState.CLOSED;
    this._onClose?.(code ?? 1000, reason ?? "");
  }
  onOpen(cb: () => void): void {
    this._onOpen = cb;
  }
  onMessage(cb: (raw: string) => void): void {
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
  }
  fireMessage(raw: string): void {
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
  const client = new RealtimeClient(
    { url: "ws://x/nodefony/api/realtime", ...opts },
    () => {
      const t = new MockTransport();
      transports.push(t);
      return t;
    },
  );
  return { client, transports };
}

describe("RealtimeClient — extraction transport (IRealtimeTransport)", () => {
  it("connect() crée + ouvre un transport → state connected", async () => {
    const { client, transports } = setup();
    const p = client.connect();
    expect(transports).to.have.length(1);
    expect(transports[0].connectCalls).to.equal(1);
    expect(client.state).to.equal("connecting");
    transports[0].fireOpen();
    await p;
    expect(client.state).to.equal("connected");
    client.disconnect();
  });

  it("subscribe après ouverture → frame émise PAR le transport", async () => {
    const { client, transports } = setup();
    const p = client.connect();
    transports[0].fireOpen();
    await p;
    client.subscribe("dashboard:stats");
    const frames = transports[0].sent.map((s) => JSON.parse(s));
    expect(
      frames.some(
        (f) =>
          f.method === "subscribe" && f.params?.channel === "dashboard:stats",
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
    transports[0].fireOpen();
    await p;
    transports[0].fireClose(1006); // perte non intentionnelle
    expect(client.state).to.equal("reconnecting");
    await delay(20);
    expect(transports.length).to.equal(2); // un transport NEUF par tentative
    expect(transports[1].connectCalls).to.equal(1);
    transports[1].fireOpen();
    expect(client.state).to.equal("connected");
    client.disconnect();
  });

  it("disconnect() ferme proprement (1000) sans reconnexion", async () => {
    const { client, transports } = setup({ reconnectDelay: 1 });
    const p = client.connect();
    transports[0].fireOpen();
    await p;
    client.disconnect();
    expect(transports[0].closedWith?.code).to.equal(1000);
    expect(client.state).to.equal("disconnected");
    await delay(15);
    expect(transports.length).to.equal(1); // PAS de reconnexion (intentionnel)
  });

  it("heartbeat → ping émis périodiquement via le transport", async () => {
    const { client, transports } = setup({ heartbeatInterval: 5 });
    const p = client.connect();
    transports[0].fireOpen();
    await p;
    await delay(14);
    const pinged = transports[0].sent
      .map((s) => JSON.parse(s))
      .some((f) => f.method === "ping");
    expect(pinged).to.equal(true);
    client.disconnect(); // clear l'intervalle (sinon mocha traîne)
  });

  it("send dropé tant que le transport n'est pas OPEN", () => {
    const { client, transports } = setup();
    client.connect(); // CONNECTING, pas encore OPEN
    client.emit("evt", { x: 1 });
    expect(transports[0].sent).to.have.length(0);
    client.disconnect();
  });
});
