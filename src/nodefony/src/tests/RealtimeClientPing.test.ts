import { expect } from "chai";
import {
  RealtimeClient,
  type KernelPingResult,
} from "../client/realtime/RealtimeClient";

/**
 * `ping()` est un helper RÉUTILISABLE de la lib cliente (Core isomorphe) : il
 * appelle la méthode RPC standard `nodefony:kernel:ping` et enrichit la réponse serveur du
 * RTT mesuré côté client. On le teste en isolant `request()` (déjà couvert ailleurs)
 * → pas de vrai WebSocket, déterministe.
 */
type RequestFn = (
  method: string,
  params?: unknown,
  timeoutMs?: number,
) => Promise<unknown>;
interface RequestStub {
  request: RequestFn;
}

describe("RealtimeClient — ping() (helper RTT réutilisable, lib cliente)", () => {
  it("appelle la méthode RPC standard `nodefony:kernel:ping` et ajoute `rtt` au résultat", async () => {
    const client = new RealtimeClient({
      url: "ws://localhost/nodefony/api/realtime",
      autoReconnect: false,
    });
    const calls: { method: string; params?: unknown; timeoutMs?: number }[] =
      [];
    const server: KernelPingResult = {
      pong: true,
      ts: 1_717_000_000_000,
      uptime: 42.5,
      pid: 1234,
      version: "10.0.0",
    };
    (client as unknown as RequestStub).request = async (
      method,
      params,
      timeoutMs,
    ) => {
      calls.push({ method, params, timeoutMs });
      return server;
    };

    const r = await client.ping();

    expect(calls).to.have.length(1);
    expect(calls[0].method).to.equal("nodefony:kernel:ping");
    expect(calls[0].params).to.equal(undefined);
    // payload serveur conservé tel quel…
    expect(r.pong).to.equal(true);
    expect(r.ts).to.equal(server.ts);
    expect(r.uptime).to.equal(42.5);
    expect(r.pid).to.equal(1234);
    expect(r.version).to.equal("10.0.0");
    // …enrichi du RTT mesuré client (≥ 0, valeur finie).
    expect(r.rtt).to.be.a("number");
    expect(r.rtt).to.be.at.least(0);
    expect(Number.isFinite(r.rtt)).to.equal(true);

    client.disconnect();
  });

  it("propage le `timeoutMs` passé à `ping()` jusqu'à `request()`", async () => {
    const client = new RealtimeClient({ url: "ws://x", autoReconnect: false });
    let seenTimeout: number | undefined;
    (client as unknown as RequestStub).request = async (_m, _p, timeoutMs) => {
      seenTimeout = timeoutMs;
      return { pong: true, ts: 0, uptime: 0, pid: 0 } as KernelPingResult;
    };

    await client.ping(1234);

    expect(seenTimeout).to.equal(1234);
    client.disconnect();
  });

  it("rejette si le serveur ne répond pas (timeout) ou ignore la méthode (-32601)", async () => {
    const client = new RealtimeClient({ url: "ws://x", autoReconnect: false });
    (client as unknown as RequestStub).request = async () => {
      throw new Error("RPC timeout: nodefony:kernel:ping");
    };

    let threw = false;
    try {
      await client.ping();
    } catch {
      threw = true;
    }

    expect(threw).to.equal(true);
    client.disconnect();
  });
});
