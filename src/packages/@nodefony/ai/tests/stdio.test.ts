import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { ADMIN_DEFAULT_ROLE, ADMIN_SCOPE_READ } from "nodefony";
import type { IMcpTool } from "nodefony";
import {
  defineMcpGate,
  handleMcpMessage,
  mcpText,
  serveMcpStdio,
  JsonRpcError,
} from "../index";
import type { IMcpGate } from "../index";

/**
 * Le transport stdio, éprouvé SANS process : `serveMcpStdio` lit des lignes
 * sur un flux, la porte (`gate.respondStdio`) y répond. Le banc qui lance la
 * vraie commande vit dans `tests/integration/stdio-cli.test.ts`.
 */

function tool(name: string, extra: Partial<IMcpTool> = {}): IMcpTool {
  return {
    name,
    description: `outil ${name}`,
    inputSchema: { type: "object", properties: {} },
    handler: () => mcpText(`réponse de ${name}`),
    ...extra,
  };
}

/** Un outil long : avance par étapes, s'arrête quand son signal tombe. */
function slowTool(state: { aborted: boolean; done: number }): IMcpTool {
  return tool("slow", {
    handler: async (_args, _caller, run) => {
      for (let i = 1; i <= 50; i++) {
        if (run?.signal.aborted) {
          state.aborted = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        state.done = i;
        run?.progress(i, 50, `étape ${i}`);
      }
      return mcpText(state);
    },
  });
}

interface ISession {
  send(message: unknown): void;
  sendRaw(line: string): void;
  /** Lignes reçues jusqu'ici, parsées. */
  readonly received: Record<string, unknown>[];
  /** Lignes brutes reçues. */
  readonly raw: string[];
  /** Attend une ligne qui satisfait `match`. */
  waitFor(
    match: (message: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>>;
  /** Ferme l'entrée et attend la fin de la boucle. */
  close(): Promise<void>;
}

function session(gate: IMcpGate): ISession {
  const input = new PassThrough();
  const raw: string[] = [];
  const received: Record<string, unknown>[] = [];
  const waiters: {
    match: (m: Record<string, unknown>) => boolean;
    resolve: (m: Record<string, unknown>) => void;
  }[] = [];
  const done = serveMcpStdio(gate, {
    input,
    write: (chunk) => {
      for (const line of chunk.split("\n").filter(Boolean)) {
        raw.push(line);
        const message = JSON.parse(line) as Record<string, unknown>;
        received.push(message);
        // À rebours : un attendant servi est retiré pendant le parcours.
        for (let i = waiters.length - 1; i >= 0; i--) {
          const waiter = waiters[i];
          if (waiter?.match(message)) {
            waiters.splice(i, 1);
            waiter.resolve(message);
          }
        }
      }
    },
  });
  return {
    send: (message) => input.write(`${JSON.stringify(message)}\n`),
    sendRaw: (line) => input.write(`${line}\n`),
    received,
    raw,
    waitFor(match) {
      const found = received.find(match);
      if (found) return Promise.resolve(found);
      return new Promise((resolve) => waiters.push({ match, resolve }));
    },
    async close() {
      input.end();
      await done;
    },
  };
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "essai", version: "0" },
  },
};

describe("serveMcpStdio — un message par ligne", () => {
  it("répond à initialize, se tait sur une notification, ignore une ligne vide", async () => {
    const s = session(defineMcpGate({ tools: [tool("echo")] }));
    s.send(INITIALIZE);
    s.sendRaw("");
    s.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    s.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    await s.waitFor((m) => m.id === 2);
    await s.close();
    expect(s.received.map((m) => m.id)).toEqual([1, 2]);
    expect(s.received[0]?.result).toMatchObject({
      protocolVersion: "2025-06-18",
    });
  });

  it("rend -32700 pour une ligne illisible, sans arrêter la boucle", async () => {
    const s = session(defineMcpGate({ tools: [tool("echo")] }));
    s.sendRaw("pas du json");
    s.send({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "echo", arguments: {} },
    });
    const answer = await s.waitFor((m) => m.id === 7);
    await s.close();
    expect(s.received[0]).toMatchObject({
      id: null,
      error: { code: JsonRpcError.PARSE_ERROR },
    });
    expect(answer.result).toMatchObject({
      content: [{ type: "text", text: "réponse de echo" }],
    });
  });

  it("rend -32600 pour un JSON qui n'est pas un message", async () => {
    const s = session(defineMcpGate({ tools: [tool("echo")] }));
    s.sendRaw("42");
    await s.close();
    expect(s.received).toEqual([
      expect.objectContaining({
        id: null,
        error: expect.objectContaining({ code: JsonRpcError.INVALID_REQUEST }),
      }),
    ]);
  });

  it("chaque ligne écrite est UN message JSON-RPC complet", async () => {
    const s = session(defineMcpGate({ tools: [tool("echo")] }));
    s.send(INITIALIZE);
    s.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    await s.close();
    for (const line of s.raw) {
      expect(JSON.parse(line)).toMatchObject({ jsonrpc: "2.0" });
    }
  });
});

describe("serveMcpStdio — progression et annulation", () => {
  it("écrit la progression AVANT la réponse finale", async () => {
    const state = { aborted: false, done: 0 };
    const s = session(defineMcpGate({ tools: [slowTool(state)] }));
    s.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "slow", arguments: {}, _meta: { progressToken: "p" } },
    });
    await s.waitFor((m) => m.id === 3);
    await s.close();
    const progress = s.received.filter(
      (m) => m.method === "notifications/progress",
    );
    // Le rapporteur espace ses envois (`MCP_PROGRESS_MIN_INTERVAL_MS`) : au
    // moins un, jamais après la réponse.
    expect(progress.length).toBeGreaterThan(0);
    expect(s.received.at(-1)?.id).toBe(3);
  });

  it("notifications/cancelled arrête l'outil, et plus RIEN n'est écrit pour lui", async () => {
    const state = { aborted: false, done: 0 };
    const s = session(defineMcpGate({ tools: [slowTool(state)] }));
    s.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "slow", arguments: {}, _meta: { progressToken: "p" } },
    });
    // L'annulation arrive PENDANT l'appel : la boucle n'attend pas la
    // réponse d'une ligne pour lire la suivante.
    await s.waitFor((m) => m.method === "notifications/progress");
    s.send({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 4, reason: "plus besoin" },
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const seen = s.received.length;
    await s.close();
    expect(state.aborted).toBe(true);
    expect(state.done).toBeLessThan(50);
    // Spec MCP, stdio § Cancellation : aucun message de plus pour cet appel.
    expect(s.received.some((m) => m.id === 4)).toBe(false);
    expect(s.received.length).toBe(seen);
  });

  it("sans progression non plus, un appel annulé ne reçoit AUCUNE réponse", async () => {
    // Sans `progressToken`, aucun puits n'est ouvert avant le délai de grâce :
    // c'est la porte, et elle seule, qui doit taire la réponse.
    const state = { aborted: false, done: 0 };
    const s = session(defineMcpGate({ tools: [slowTool(state)] }));
    s.send({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "slow", arguments: {} },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    s.send({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 6 },
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    await s.close();
    expect(state.aborted).toBe(true);
    expect(s.received).toEqual([]);
  });

  it("l'entrée fermée abat l'appel en cours, puis la boucle se termine", async () => {
    const state = { aborted: false, done: 0 };
    const s = session(defineMcpGate({ tools: [slowTool(state)] }));
    s.send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "slow", arguments: {} },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await s.close();
    expect(state.aborted).toBe(true);
    expect(state.done).toBeLessThan(50);
  });
});

describe("gate.respondStdio — la posture d'une porte non protégée", () => {
  it("aucun rôle accordé par défaut : l'outil réservé reste retenu", async () => {
    const s = session(
      defineMcpGate({
        tools: [tool("public"), tool("secret", { scopes: ["x:read"] })],
      }),
    );
    s.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    s.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "secret", arguments: {} },
    });
    await s.close();
    const list = s.received.find((m) => m.id === 1)?.result as {
      tools: { name: string }[];
    };
    expect(list.tools.map((t) => t.name)).toEqual(["public"]);
    // Retenu = inconnu : son existence n'est pas révélée.
    expect(s.received.find((m) => m.id === 2)).toMatchObject({
      error: { code: JsonRpcError.INVALID_PARAMS },
    });
  });

  it("une porte qui ÉCRIT ses rôles les accorde aussi en stdio", async () => {
    const s = session(
      defineMcpGate({
        tools: [tool("admin", { scopes: [ADMIN_SCOPE_READ] })],
        unprotectedRoles: [ADMIN_DEFAULT_ROLE],
      }),
    );
    s.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    await s.close();
    expect(s.received[0]?.result).toMatchObject({
      tools: [expect.objectContaining({ name: "admin" })],
    });
  });

  it("une porte désactivée répond un message JSON-RPC, jamais un objet nu", async () => {
    const s = session(defineMcpGate({ enabled: false, tools: [tool("x")] }));
    s.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    await s.close();
    expect(s.received[0]).toMatchObject({ jsonrpc: "2.0", id: null });
  });
});

describe("annonce des outils réservés — ne renvoyer qu'à ce que la porte publie", () => {
  const initialize = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "t", version: "0" },
    },
  };
  const instructionsOf = async (
    authorizable: boolean | undefined,
  ): Promise<string> => {
    const reply = await handleMcpMessage(initialize, {
      tools: [tool("public")],
      serverInfo: { name: "t", version: "0" },
      withheldCount: 2,
      ...(authorizable === undefined ? {} : { authorizable }),
    });
    return (reply.body as { result: { instructions: string } }).result
      .instructions;
  };

  it("porte protégée : renvoie au document RFC 9728 et au défi", async () => {
    const text = await instructionsOf(true);
    expect(text).toContain("2 outil(s) supplémentaire(s) sont RÉSERVÉS");
    expect(text).toContain("RFC 9728");
  });

  it("porte qui ne reçoit aucun jeton (stdio, HTTP non protégée) : ne promet ni document ni défi", async () => {
    for (const authorizable of [false, undefined]) {
      const text = await instructionsOf(authorizable);
      expect(text).toContain("RÉSERVÉS");
      expect(text).not.toContain("RFC 9728");
      expect(text).toContain("porte HTTP protégée");
    }
  });

  it("serveMcpStdio : l'annonce de la porte stdio ne cite pas RFC 9728", async () => {
    const s = session(
      defineMcpGate({
        tools: [tool("public"), tool("secret", { scopes: ["x:y"] })],
      }),
    );
    s.send(INITIALIZE);
    await s.close();
    const handshake = s.received[0]?.result as
      { instructions?: string } | undefined;
    const text = handshake?.instructions;
    expect(text).toContain("RÉSERVÉS");
    expect(text).not.toContain("RFC 9728");
  });
});
