import { describe, expect, it } from "vitest";
import {
  createProgressReporter,
  readProgressToken,
  MCP_PROGRESS_MESSAGE_MAX,
  MCP_PROGRESS_MIN_INTERVAL_MS,
} from "../mcp/progress";
import { handleMcpMessage, type IMcpServerContext } from "../mcp/server";
import { mcpText } from "../mcp/tools";
import type { IJsonRpcNotification } from "../jsonrpc/index";
import type { IMcpTool, IMcpToolRun } from "../types/IMcpTool";

/**
 * Le protocole MCP pendant un appel (#554) : progression liée à la requête,
 * annulation transmise à l'outil, abonnement refusé en le disant. Fonctions
 * pures — la porte HTTP et son flux SSE sont éprouvés par le banc devkit.
 */
describe("readProgressToken — `params._meta.progressToken`", () => {
  it("chaîne ou entier ; tout le reste est absent", () => {
    expect(readProgressToken({ _meta: { progressToken: "abc" } })).toBe("abc");
    expect(readProgressToken({ _meta: { progressToken: 7 } })).toBe(7);
    expect(readProgressToken({ _meta: { progressToken: 1.5 } })).toBeNull();
    expect(readProgressToken({ _meta: { progressToken: null } })).toBeNull();
    expect(readProgressToken({ _meta: null })).toBeNull();
    expect(readProgressToken({})).toBeNull();
  });
});

describe("createProgressReporter — les exigences de la norme, tenues au cœur", () => {
  const collect = () => {
    const sent: IJsonRpcNotification[] = [];
    return { sent, notify: (n: IJsonRpcNotification) => void sent.push(n) };
  };

  it("sans jeton ou sans flux : muet", () => {
    const { sent, notify } = collect();
    createProgressReporter(null, notify).progress(1);
    createProgressReporter("t", undefined).progress(1);
    expect(sent).toEqual([]);
  });

  it("émet `notifications/progress` avec le jeton, le total et le message", () => {
    const { sent, notify } = collect();
    let t = 0;
    const r = createProgressReporter("t", notify, () => t, 100);
    r.progress(1, 4, "étape 1");
    expect(sent).toEqual([
      {
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: {
          progressToken: "t",
          progress: 1,
          total: 4,
          message: "étape 1",
        },
      },
    ]);
    t = 100;
    r.progress(2);
    expect(sent[1]?.params).toEqual({ progressToken: "t", progress: 2 });
  });

  it("une valeur qui ne CROÎT pas est ignorée", () => {
    const { sent, notify } = collect();
    let t = 0;
    const r = createProgressReporter(1, notify, () => t, 0);
    r.progress(5);
    t = 1;
    r.progress(5);
    r.progress(3);
    r.progress(Number.NaN);
    r.progress(6);
    expect(
      sent.map((n) => (n.params as { progress: number }).progress),
    ).toEqual([5, 6]);
  });

  it("la cadence est bornée : trop tôt après la précédente, ignorée", () => {
    const { sent, notify } = collect();
    let t = 0;
    const r = createProgressReporter("t", notify, () => t, 100);
    r.progress(1);
    t = 50;
    r.progress(2);
    t = 100;
    r.progress(3);
    expect(
      sent.map((n) => (n.params as { progress: number }).progress),
    ).toEqual([1, 3]);
  });

  it("muet après `end()` — « MUST stop after completion »", () => {
    const { sent, notify } = collect();
    const r = createProgressReporter("t", notify, () => 0, 0);
    r.end();
    r.progress(1);
    expect(sent).toEqual([]);
  });

  it("un message démesuré est tronqué", () => {
    const { sent, notify } = collect();
    createProgressReporter("t", notify, () => 0, 0).progress(
      1,
      undefined,
      "x".repeat(5000),
    );
    expect(
      (sent[0]?.params as { message?: string } | undefined)?.message,
    ).toHaveLength(MCP_PROGRESS_MESSAGE_MAX);
  });
});

describe("handleMcpMessage — `tools/call` sous transport", () => {
  const call = (meta?: Record<string, unknown>) => ({
    jsonrpc: "2.0" as const,
    id: 1,
    method: "tools/call",
    params: { name: "slow", arguments: {}, ...(meta ? { _meta: meta } : {}) },
  });
  const context = (
    handler: IMcpTool["handler"],
    transport?: IMcpServerContext["transport"],
  ): IMcpServerContext => ({
    tools: [
      {
        name: "slow",
        description: "d",
        inputSchema: { type: "object" },
        handler,
      },
    ],
    serverInfo: { name: "t", version: "0" },
    ...(transport ? { transport } : {}),
  });

  it("le jeton de la requête mène la progression jusqu'au transport, puis plus rien", async () => {
    const sent: IJsonRpcNotification[] = [];
    let late: IMcpToolRun | undefined;
    const reply = await handleMcpMessage(
      call({ progressToken: "p1" }),
      context(
        (_args, _caller, run) => {
          late = run;
          run?.progress(1, 2, "moitié");
          return mcpText("fini");
        },
        { notify: (n) => void sent.push(n) },
      ),
    );
    expect(reply.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.params).toMatchObject({
      progressToken: "p1",
      progress: 1,
      total: 2,
    });
    // Après la réponse, l'outil n'a plus de jeton « en cours » : rien ne part.
    // Attendre AU-DELÀ de la borne de cadence : sinon c'est elle qui tait
    // l'appel tardif, et le test passerait sans que la fin soit tenue.
    await new Promise((resolve) =>
      setTimeout(resolve, MCP_PROGRESS_MIN_INTERVAL_MS + 20),
    );
    late?.progress(2);
    expect(sent).toHaveLength(1);
  });

  it("sans `progressToken`, aucune notification — la réponse reste seule", async () => {
    const sent: IJsonRpcNotification[] = [];
    await handleMcpMessage(
      call(),
      context(
        (_a, _c, run) => {
          run?.progress(1);
          return mcpText("ok");
        },
        { notify: (n) => void sent.push(n) },
      ),
    );
    expect(sent).toEqual([]);
  });

  it("le signal du transport atteint l'outil ; sans transport, un signal jamais abattu", async () => {
    const abort = new AbortController();
    abort.abort();
    let seen: boolean | undefined;
    await handleMcpMessage(
      call(),
      context(
        (_a, _c, run) => {
          seen = run?.signal.aborted;
          return mcpText("ok");
        },
        { signal: abort.signal },
      ),
    );
    expect(seen).toBe(true);
    await handleMcpMessage(
      call(),
      context((_a, _c, run) => {
        seen = run?.signal.aborted;
        return mcpText("ok");
      }),
    );
    expect(seen).toBe(false);
  });

  it("un outil qui lève : la progression s'arrête aussi", async () => {
    const sent: IJsonRpcNotification[] = [];
    let late: IMcpToolRun | undefined;
    const reply = await handleMcpMessage(
      call({ progressToken: 9 }),
      context(
        (_a, _c, run) => {
          late = run;
          throw new Error("boum");
        },
        { notify: (n) => void sent.push(n) },
      ),
    );
    expect(reply.status).toBe(200);
    late?.progress(1);
    expect(sent).toEqual([]);
  });
});

describe("handleMcpMessage — `subscriptions/listen` refusé en le disant", () => {
  it("404 + -32601, avec la raison et le remède", async () => {
    const reply = await handleMcpMessage(
      { jsonrpc: "2.0", id: 3, method: "subscriptions/listen", params: {} },
      { tools: [], serverInfo: { name: "t", version: "0" } },
    );
    expect(reply.status).toBe(404);
    const error = (reply.body as { error: { code: number; message: string } })
      .error;
    expect(error.code).toBe(-32601);
    expect(error.message).toContain("tools/list");
  });
});
