import { expect } from "chai";
import "mocha";
import { RealtimeClient } from "../client/realtime/RealtimeClient";
import {
  TransportState,
  type IRealtimeTransport,
} from "../realtime/IRealtimeTransport";
import type { IRealtimeHub } from "../realtime/IRealtimeHub";

/**
 * RealtimeClient implémente le contrat ISOMORPHE {@link IRealtimeHub} (« la socket
 * Nodefony »). On vérifie la conformité de la surface (primitives duplex + handle de
 * canal) via un transport MOCK injecté — sans vrai WebSocket ni navigateur.
 */
class MockTransport implements IRealtimeTransport {
  sent: string[] = [];
  readyState: number = TransportState.CONNECTING;
  private _onOpen: (() => void) | null = null;
  private _onMessage: ((raw: string) => void) | null = null;
  private _onClose: ((code: number, reason: string) => void) | null = null;
  private _onError: ((err: unknown) => void) | null = null;
  connect(): void {}
  send(raw: string): void {
    this.sent.push(raw);
  }
  close(code?: number, reason?: string): void {
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
  fireOpen(): void {
    this.readyState = TransportState.OPEN;
    this._onOpen?.();
  }
  fireMessage(raw: string): void {
    this._onMessage?.(raw);
  }
  frames(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s));
  }
}

async function openClient(): Promise<{
  client: RealtimeClient;
  transport: MockTransport;
}> {
  const transports: MockTransport[] = [];
  const client = new RealtimeClient(
    { url: "ws://x/nodefony/api/realtime", autoReconnect: false },
    () => {
      const t = new MockTransport();
      transports.push(t);
      return t;
    },
  );
  const p = client.connect();
  transports[0].fireOpen();
  await p;
  return { client, transport: transports[0] };
}

describe("RealtimeClient — conformité IRealtimeHub (la socket Nodefony)", () => {
  it("est assignable à IRealtimeHub (surface du contrat présente)", async () => {
    const { client } = await openClient();
    const hub: IRealtimeHub = client; // compile-time : conformité structurelle
    expect(hub.subscribedChannels).to.deep.equal([]);
    expect(typeof hub.publish).to.equal("function");
    expect(typeof hub.request).to.equal("function");
    expect(typeof hub.channel).to.equal("function");
    expect(typeof hub.getStats).to.equal("function");
    client.disconnect();
  });

  it("publish(channel, payload) → notification JSON-RPC (method=canal, SANS id)", async () => {
    const { client, transport } = await openClient();
    client.publish("sip:line1", { invite: 1 });
    const f = transport.frames().find((x) => x.method === "sip:line1");
    expect(f).to.not.equal(undefined);
    expect(f).to.deep.equal({
      jsonrpc: "2.0",
      method: "sip:line1",
      params: { invite: 1 },
    });
    expect("id" in f!).to.equal(false); // notification = pas de réponse attendue
    client.disconnect();
  });

  it("channel(name) — handle socket-like : open=subscribe, send=publish, close=unsubscribe", async () => {
    const { client, transport } = await openClient();
    const line = client.channel("sip:line1");
    expect(line.name).to.equal("sip:line1");

    line.open();
    expect(client.subscribedChannels).to.deep.equal(["sip:line1"]);
    line.send({ bye: true });
    line.close();

    const methods = transport.frames().map((f) => f.method);
    expect(methods).to.include("subscribe"); // open
    expect(methods).to.include("sip:line1"); // send
    expect(methods).to.include("unsubscribe"); // close
    expect(client.subscribedChannels).to.deep.equal([]);
    client.disconnect();
  });

  it("channel(name).on reçoit les notifications du canal, et close détache le handler", async () => {
    const { client, transport } = await openClient();
    const line = client.channel("dashboard:stats");
    const got: unknown[] = [];
    line.on((p) => got.push(p));

    transport.fireMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "dashboard:stats",
        params: { cpu: 42 },
      }),
    );
    expect(got).to.deep.equal([{ cpu: 42 }]);

    line.close(); // détache le handler branché via ce handle
    transport.fireMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "dashboard:stats",
        params: { cpu: 99 },
      }),
    );
    expect(got).to.deep.equal([{ cpu: 42 }]); // plus rien reçu après close
    client.disconnect();
  });

  it("getStats() expose les compteurs par canal après réception", async () => {
    const { client, transport } = await openClient();
    transport.fireMessage(
      JSON.stringify({ jsonrpc: "2.0", method: "orm:flow", params: { q: 1 } }),
    );
    const st = client.getChannelStats("orm:flow");
    expect(st?.method).to.equal("orm:flow");
    expect(st?.msgCount).to.equal(1);
    expect(client.getStats().some((s) => s.method === "orm:flow")).to.equal(
      true,
    );
    client.disconnect();
  });
});
