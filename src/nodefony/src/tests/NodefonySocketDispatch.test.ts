import { expect } from "vitest";
import { NodefonySocket } from "../client/realtime/NodefonySocket";

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

function newClient(): { client: NodefonySocket; internal: Internals } {
  const client = new NodefonySocket({
    url: "ws://localhost/nodefony/api/realtime",
    autoReconnect: false,
  });
  return { client, internal: client as unknown as Internals };
}

describe("NodefonySocket — discrimination des frames (entrant vs sortant)", () => {
  it("RÉPONSE (id, result, SANS method) → résout la requête sortante", async () => {
    const { client, internal } = newClient();
    openTransport(internal);
    const p = client.request<"nodefony:kernel:ping", { ok: boolean }>(
      "nodefony:kernel:ping",
    ); // 1ʳᵉ requête → id 1
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
    expect(out[0]!.id).to.equal("abc-7");
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

describe("NodefonySocket — realtime:denied (refus de canal observable)", () => {
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

describe("NodefonySocket — erreur GLOBALE serveur vs réponse corrélée", () => {
  it("frame `{jsonrpc, error}` SANS id → notice « Temps réel »", () => {
    const { client, internal } = newClient();
    const notices: Array<{ message: string }> = [];
    client.onNotice((n) => notices.push(n));
    internal.handleMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "refus tardif" },
      }),
    );
    expect(notices.map((n) => n.message)).to.deep.equal(["refus tardif"]);
    client.disconnect();
  });

  it("erreur à `id: null` (§5 : id illisible) → notice, elle aussi globale", () => {
    const { client, internal } = newClient();
    const notices: unknown[] = [];
    client.onNotice((n) => notices.push(n));
    internal.handleMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      }),
    );
    expect(notices).to.have.length(1);
    client.disconnect();
  });

  it("🔴 frame invalide qui porte l'`id` d'un appel → l'appel échoue, SANS notice globale en double", async () => {
    const { client, internal } = newClient();
    openTransport(internal);
    const notices: unknown[] = [];
    client.onNotice((n) => notices.push(n));
    const p = client.request<"nodefony:kernel:ping">("nodefony:kernel:ping");
    // `result` ET `error` : interdit par §5, donc invalide — mais corrélé.
    internal.handleMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: 1,
        error: { code: -32000, message: "e" },
      }),
    );
    const err = await p.catch((e: unknown) => e);
    expect((err as Error).message).to.equal("e");
    expect(notices).to.have.length(0);
    client.disconnect();
  });
});
