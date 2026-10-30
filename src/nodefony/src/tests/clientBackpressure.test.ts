import { expect } from "vitest";
import { NodefonySocket } from "../client/realtime/NodefonySocket";
import {
  TransportState,
  type IRealtimeTransport,
  type RealtimeFrameData,
  type RealtimeOutboundData,
} from "../realtime/IRealtimeTransport";
import { BACKPRESSURE_CLOSE_CODE } from "../realtime/closeCodes";
import { socketSnapshot } from "../client/realtime/snapshot";

/**
 * Contre-pression SORTANTE du navigateur (ADR-0022 §5 C1) : au-delà de
 * `maxBufferedAmount`, la frame est jetée AVANT la mise en file et comptée ;
 * une file qui ne se vide plus ferme en `4007`, jamais en `1013` (refusé par
 * `WebSocket.close`).
 */
class SlowTransport implements IRealtimeTransport {
  sent: RealtimeOutboundData[] = [];
  closedWith: number[] = [];
  readyState: number = TransportState.CONNECTING;
  /** File du navigateur simulée : le test la règle. */
  bufferedAmount = 0;
  private open: (() => void) | null = null;
  private message: ((raw: RealtimeFrameData) => void) | null = null;
  private closeCb: ((code: number, reason: string) => void) | null = null;
  connect(): void {}
  send(raw: RealtimeOutboundData): void {
    this.sent.push(raw);
  }
  close(code = 1000, reason = ""): void {
    this.closedWith.push(code);
    this.readyState = TransportState.CLOSED;
    this.closeCb?.(code, reason);
  }
  onOpen(cb: () => void): void {
    this.open = cb;
  }
  onMessage(cb: (raw: RealtimeFrameData) => void): void {
    this.message = cb;
  }
  onClose(cb: (code: number, reason: string) => void): void {
    this.closeCb = cb;
  }
  onError(): void {}
  fireOpen(): void {
    this.readyState = TransportState.OPEN;
    this.open?.();
    this.message?.(
      JSON.stringify({ jsonrpc: "2.0", method: "realtime:welcome" }),
    );
  }
}

async function connected(opts: Record<string, unknown>) {
  const transports: SlowTransport[] = [];
  const client = new NodefonySocket(
    { url: "ws://x/nodefony/api/realtime", banner: false, ...opts },
    () => {
      const t = new SlowTransport();
      transports.push(t);
      return t;
    },
  );
  const p = client.connect();
  transports[0]!.fireOpen();
  await p;
  return { client, transports, t: transports[0]! };
}

describe("NodefonySocket — contre-pression sortante (maxBufferedAmount)", () => {
  it("sans borne : rien n'est jeté, même file pleine (défaut 10.x)", async () => {
    const { client, t } = await connected({});
    t.bufferedAmount = 1e9;
    const before = t.sent.length;
    client.emit("app:pos", { x: 1 });
    expect(t.sent.length).to.equal(before + 1);
    expect(client.framesDropped).to.equal(0);
    client.disconnect();
  });

  it("file au-delà du seuil : emit, request et sendBinary jettent et COMPTENT", async () => {
    const { client, t } = await connected({ maxBufferedAmount: 1024 });
    t.bufferedAmount = 4096;
    const before = t.sent.length;
    client.emit("app:pos", { x: 1 });
    expect(client.sendBinary(new Uint8Array([1, 2]))).to.equal(false);
    await client.request("app:ask", {}).catch(() => undefined);
    expect(t.sent.length).to.equal(before);
    expect(client.framesDropped).to.equal(3);
    // Visible là où la socket se décrit (barre de debug, devtools).
    expect(socketSnapshot(client).dropped).to.equal(3);
    // File écoulée : la frame repart.
    t.bufferedAmount = 0;
    client.emit("app:pos", { x: 2 });
    expect(t.sent.length).to.equal(before + 1);
    client.disconnect();
  });

  it("solde atteint : fermeture en 4007 (jamais 1013), puis reconnexion", async () => {
    const { client, transports, t } = await connected({
      maxBufferedAmount: 1024,
      backpressureCloseAfterDrops: 3,
      reconnectDelay: 1,
    });
    t.bufferedAmount = 4096;
    client.emit("app:pos", {});
    client.emit("app:pos", {});
    expect(t.closedWith).to.deep.equal([]);
    client.emit("app:pos", {});
    expect(t.closedWith).to.deep.equal([BACKPRESSURE_CLOSE_CODE]);
    expect(t.closedWith).to.not.include(1013);
    expect(client.framesDropped).to.equal(3);
    // 4007 est reconnectable : un transport neuf est demandé.
    expect(client.state).to.equal("reconnecting");
    await new Promise((r) => setTimeout(r, 250));
    expect(transports.length).to.be.greaterThan(1);
    client.disconnect();
  });
});
