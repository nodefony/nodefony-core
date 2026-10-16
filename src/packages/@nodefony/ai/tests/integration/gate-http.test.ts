import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * La mécanique de `@nodefony/ai` sur un SERVEUR RÉEL, par une porte
 * d'APPLICATION : la porte témoin du module `test` (`/nodefony/test/mcp-gate`,
 * `policy: "dev"` — elle n'existe pas en production). Elle est écrite comme une
 * application l'écrirait (`defineMcpGate` + `gate.serve`), avec ses seuls outils.
 *
 * Deux clients : des requêtes forgées à la main, qui prouvent la conformité à la
 * lettre (statuts, codes), et le client OFFICIEL de la spec, qui prouve qu'un
 * agent réel se CONNECTE — l'écart qui a déjà rendu une porte injoignable sans
 * qu'aucun test forgé le voie.
 *
 * Décor : le serveur de développement (`nodefony development`). Absent, la suite
 * se saute en le DISANT ; en CI, le rapporteur de la config d'intégration
 * transforme ce saut en échec.
 */

const BASE = process.env.NF_MCP_TEST_RESOURCE_BASE ?? "http://localhost:5151";
const GATE_PATH = "/nodefony/test/mcp-gate";
const URL_GATE = `${BASE}${GATE_PATH}`;

interface IReply {
  status: number;
  body: unknown;
}

async function post(
  message: unknown,
  headers: Record<string, string> = {},
): Promise<IReply> {
  const res = await fetch(URL_GATE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text === "" ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** La porte répond-elle ? `null` si oui, la raison sinon. */
async function gateSilent(): Promise<string | null> {
  try {
    const reply = await post({ jsonrpc: "2.0", id: 0, method: "tools/list" });
    if (reply.status !== 200) {
      return `${URL_GATE} répond ${reply.status} — module \`test\` absent ou dist périmé (npm run build)`;
    }
    return null;
  } catch (error) {
    return `${URL_GATE} injoignable : ${(error as Error).message} — lancer le serveur de développement`;
  }
}

const reason = await gateSilent();
if (reason !== null) {
  process.stderr.write(
    `\n[ai gate-http] SUITE SAUTÉE — le décor manque :\n  - ${reason}\n\n`,
  );
}

function toolNames(reply: IReply): string[] {
  const tools = (reply.body as { result?: { tools?: { name: string }[] } })
    .result?.tools;
  return (tools ?? []).map((t) => t.name);
}

function errorCode(reply: IReply): number | undefined {
  return (reply.body as { error?: { code: number } } | null)?.error?.code;
}

describe.skipIf(reason !== null)(
  "porte MCP d'application — requêtes forgées, serveur réel",
  () => {
    it("🔴 ne sert QUE ses outils : ni `nodefony_*`, ni ceux du module, ni l'outil réservé", async () => {
      const reply = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(reply.status).toBe(200);
      // `gate_admin` exige un rôle d'administration : une porte non protégée
      // n'en accorde AUCUN.
      expect(toolNames(reply)).toEqual(["gate_echo", "gate_count"]);
    });

    it("l'outil réservé n'est pas appelable en le nommant", async () => {
      const reply = await post({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "gate_admin", arguments: {} },
      });
      expect(JSON.stringify(reply.body)).not.toContain(
        "ne doit jamais répondre",
      );
    });

    it("`GET` et `DELETE` : 405 + `Allow: POST` — jamais un repli en 200", async () => {
      for (const method of ["GET", "DELETE"]) {
        const res = await fetch(URL_GATE, {
          method,
          signal: AbortSignal.timeout(8000),
        });
        expect(res.status).toBe(405);
        expect(res.headers.get("allow")).toBe("POST");
      }
    });

    it("révision du protocole inconnue : 400 + -32022 avec la liste servie", async () => {
      const reply = await post(
        { jsonrpc: "2.0", id: 3, method: "tools/list" },
        { "mcp-protocol-version": "2099-01-01" },
      );
      expect(reply.status).toBe(400);
      expect(errorCode(reply)).toBe(-32022);
    });

    it("origine étrangère : 403", async () => {
      const reply = await post(
        { jsonrpc: "2.0", id: 4, method: "tools/list" },
        { origin: "https://evil.example" },
      );
      expect(reply.status).toBe(403);
    });

    it("notification : 202 SANS corps", async () => {
      const reply = await post({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });
      expect(reply.status).toBe(202);
      expect(reply.body).toBeNull();
    });
  },
);

describe.skipIf(reason !== null)(
  "porte MCP d'application — client OFFICIEL (@modelcontextprotocol/sdk)",
  () => {
    async function open(): Promise<Client> {
      const client = new Client({ name: "banc-sdk", version: "0.0.0" });
      // Conversion assumée : le SDK type `sessionId` en `string | undefined` sur
      // son transport et en `sessionId?: string` sur son interface —
      // incompatibles sous `exactOptionalPropertyTypes`, défaut du SDK.
      const transport = new StreamableHTTPClientTransport(
        new URL(URL_GATE),
      ) as Transport;
      await client.connect(transport);
      return client;
    }

    function text(result: unknown): string {
      return (
        (result as { content?: { text?: string }[] }).content?.[0]?.text ?? ""
      );
    }

    it("se connecte, voit l'identité et le catalogue de la porte, appelle", async () => {
      const client = await open();
      try {
        expect(client.getServerVersion()?.name).toBe("test-gate");
        expect(client.getInstructions()).toMatch(/^Porte témoin/u);
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name)).toEqual(["gate_echo", "gate_count"]);
        const echo = await client.callTool({
          name: "gate_echo",
          arguments: { text: "bonjour du SDK" },
        });
        expect(text(echo)).toBe("bonjour du SDK");
      } finally {
        await client.close();
      }
    });

    it("🔴 la progression traverse le flux SSE d'une porte d'application", async () => {
      const client = await open();
      try {
        const steps: number[] = [];
        const result = await client.callTool(
          { name: "gate_count", arguments: { steps: 3 } },
          undefined,
          { onprogress: (p) => steps.push(p.progress) },
        );
        expect(result.isError ?? false).toBe(false);
        expect(text(result)).toBe("3");
        expect(steps).toEqual([1, 2, 3]);
      } finally {
        await client.close();
      }
    });
  },
);
