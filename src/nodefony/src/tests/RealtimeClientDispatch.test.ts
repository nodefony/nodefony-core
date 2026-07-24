import { expect } from "chai";
import { RealtimeClient } from "../client/realtime/RealtimeClient";

/**
 * Discrimination des frames JSON-RPC 2.0 : le RÔLE se lit sur `method`, pas sur
 * `id`. On exerce `handleMessage` (point d'arrivée des frames) sans vrai WebSocket
 * — `request()` enregistre un pending, `send()` est stubé pour capter une réponse
 * sortante. Verrouille le fix « entrant vs sortant » des 2 directions.
 */
interface Internals {
  handleMessage(raw: string): void;
  send(msg: unknown): boolean | void;
}

/**
 * Simule un transport OUVERT. Sans ce stub, `send` répond `false` (aucune socket
 * dans ce décor) et le peer rejette la requête AVANT qu'on puisse lui livrer sa
 * réponse — on ne testerait plus la corrélation, seulement l'absence de socket.
 */
const openTransport = (internal: Internals): void => {
  internal.send = () => true;
};

function newClient(): { client: RealtimeClient; internal: Internals } {
  const client = new RealtimeClient({
    url: "ws://localhost/nodefony/api/realtime",
    autoReconnect: false,
  });
  return { client, internal: client as unknown as Internals };
}

describe("RealtimeClient — discrimination des frames (entrant vs sortant)", () => {
  it("RÉPONSE (id, result, SANS method) → résout la requête sortante", async () => {
    const { client, internal } = newClient();
    openTransport(internal);
    const p = client.request<{ ok: boolean }>("nodefony:kernel:ping"); // 1ʳᵉ requête → id 1
    internal.handleMessage(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }),
    );
    const r = await p;
    expect(r).to.deep.equal({ ok: true });
    client.disconnect();
  });

  it("RÉPONSE error (id, error, SANS method) → rejette la requête sortante", async () => {
    const { client, internal } = newClient();
    openTransport(internal);
    const p = client.request("nodefony:orm:flow:reset"); // id 1
    internal.handleMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32601, message: "method not found" },
      }),
    );
    let rejected = false;
    try {
      await p;
    } catch {
      rejected = true;
    }
    expect(rejected).to.equal(true);
    client.disconnect();
  });

  it("REQUÊTE entrante (method + id) → le client répond -32601, PAS traitée comme une réponse", () => {
    const { client, internal } = newClient();
    const out: unknown[] = [];
    internal.send = (m) => {
      out.push(m);
      return true; // transport ouvert simulé
    };
    // aucune requête sortante enregistrée → si c'était mal classé en réponse, on
    // ne renverrait rien. Ici method présent + id = requête entrante.
    internal.handleMessage(
      JSON.stringify({ jsonrpc: "2.0", id: 42, method: "client:doStuff" }),
    );
    expect(out).to.have.length(1);
    expect(out[0]).to.deep.equal({
      jsonrpc: "2.0",
      id: 42,
      error: { code: -32601, message: "method not found: client:doStuff" },
    });
    client.disconnect();
  });

  it("REQUÊTE entrante à id STRING (JSON-RPC autorise string) → répond avec le même id string", () => {
    const { client, internal } = newClient();
    const out: Array<{ id?: unknown }> = [];
    internal.send = (m) => {
      out.push(m as { id?: unknown });
      return true; // transport ouvert simulé
    };
    internal.handleMessage(
      JSON.stringify({ jsonrpc: "2.0", id: "abc-7", method: "client:x" }),
    );
    expect(out).to.have.length(1);
    expect(out[0].id).to.equal("abc-7");
    client.disconnect();
  });

  it("NOTIFICATION (method, SANS id) → dispatch pub/sub, jamais prise pour une réponse", () => {
    const { client, internal } = newClient();
    const received: unknown[] = [];
    client.on("nodefony:dashboard", (p) => received.push(p));
    const out: unknown[] = [];
    internal.send = (m) => {
      out.push(m);
      return true; // transport ouvert simulé
    };
    internal.handleMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "nodefony:dashboard",
        params: { cpu: 12 },
      }),
    );
    expect(received).to.deep.equal([{ cpu: 12 }]);
    expect(out).to.have.length(0); // une notification n'appelle JAMAIS de réponse
    client.disconnect();
  });

  it("frame sans jsonrpc:2.0 → ignorée (ni handler, ni réponse)", () => {
    const { client, internal } = newClient();
    const received: unknown[] = [];
    client.on("x", (p) => received.push(p));
    const out: unknown[] = [];
    internal.send = (m) => {
      out.push(m);
      return true; // transport ouvert simulé
    };
    internal.handleMessage(JSON.stringify({ method: "x", params: 1 }));
    expect(received).to.have.length(0);
    expect(out).to.have.length(0);
    client.disconnect();
  });
});

describe("RealtimeClient — realtime:denied (refus de canal observable)", () => {
  it("notification realtime:denied → onDenied {channel, reason} + onNotice", () => {
    const { client, internal } = newClient();
    const denials: Array<{ channel: string; reason: string }> = [];
    const notices: unknown[] = [];
    client.onDenied((d) => denials.push(d));
    client.onNotice((n) => notices.push(n));
    internal.handleMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "realtime:denied",
        params: { channel: "admin:metrics", reason: "forbidden" },
      }),
    );
    expect(denials).to.deep.equal([
      { channel: "admin:metrics", reason: "forbidden" },
    ]);
    expect(notices).to.have.length(1); // UX générique en plus du seam ciblé
    client.disconnect();
  });

  it("payload partiel → motif par défaut forbidden, channel vide toléré", () => {
    const { client, internal } = newClient();
    const denials: Array<{ channel: string; reason: string }> = [];
    client.onDenied((d) => denials.push(d));
    internal.handleMessage(
      JSON.stringify({ jsonrpc: "2.0", method: "realtime:denied", params: {} }),
    );
    expect(denials).to.deep.equal([{ channel: "", reason: "forbidden" }]);
    client.disconnect();
  });
});
