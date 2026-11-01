import { describe, expect, it, vi } from "vitest";
import { NodefonySocket } from "../client/realtime/NodefonySocket";
import { LOCAL_EVENTS, isLocalEvent } from "../client/realtime/localEvents";
import {
  TransportState,
  type IRealtimeTransport,
  type RealtimeFrameData,
} from "../realtime/IRealtimeTransport";

/**
 * Le journal de trames (barre de debug, console de Studio) coûte RIEN en production.
 *
 * Le verdict « production » est INJECTÉ pour tout ce fichier : `vi.stubEnv("DEV", false)`
 * ne change pas `import.meta.env.DEV` sous vitest (constaté), un test qui s'y fierait
 * passerait en développement sans rien prouver.
 */
vi.mock("../client/announce", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client/announce")>()),
  isDevBuild: () => false,
  isVerbose: () => false,
}));

class Transport implements IRealtimeTransport {
  readyState: number = TransportState.CONNECTING;
  sent = 0;
  private _onOpen: (() => void) | null = null;
  private _onMessage: ((raw: RealtimeFrameData) => void) | null = null;
  connect(): void {}
  send(): void {
    this.sent++;
  }
  close(): void {
    this.readyState = TransportState.CLOSED;
  }
  onOpen(cb: () => void): void {
    this._onOpen = cb;
  }
  onMessage(cb: (raw: RealtimeFrameData) => void): void {
    this._onMessage = cb;
  }
  onClose(): void {}
  onError(): void {}
  open(): void {
    this.readyState = TransportState.OPEN;
    this._onOpen?.();
    this.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "realtime:welcome",
        params: {},
      }),
    );
  }
  receive(raw: RealtimeFrameData): void {
    this._onMessage?.(raw);
  }
  tick(i: number): void {
    this.receive(
      JSON.stringify({ jsonrpc: "2.0", method: "c", params: { i } }),
    );
  }
}

async function connected() {
  const t = new Transport();
  const client = new NodefonySocket(
    { url: "ws://x/rt", banner: false },
    () => t,
  );
  const p = client.connect();
  t.open();
  await p;
  return { client, t };
}

describe("NodefonySocket — journal de trames en production", () => {
  it("rien n'est journalisé tant qu'aucune console ne lit ; la première lecture l'allume", async () => {
    const { client, t } = await connected();
    for (let i = 0; i < 5; i++) t.tick(i);
    client.publish("c", { x: 1 });
    expect(t.sent).to.be.greaterThan(0);
    expect(client.frameLog).to.have.length(0);
    t.tick(99);
    const log = client.frameLog;
    expect(log).to.have.length(1);
    expect(log[0]!.payload).to.deep.equal({
      jsonrpc: "2.0",
      method: "c",
      params: { i: 99 },
    });
    client.disconnect();
  });

  it("écouter LOCAL_EVENTS.frame allume le journal — un événement LOCAL, jamais un canal", async () => {
    const { client, t } = await connected();
    t.tick(1);
    const vues: unknown[] = [];
    client.on(LOCAL_EVENTS.frame, (f) => vues.push(f));
    t.tick(2);
    expect(vues).to.have.length(1);
    expect(isLocalEvent(LOCAL_EVENTS.frame)).to.equal(true);
    client.disconnect();
  });
});
