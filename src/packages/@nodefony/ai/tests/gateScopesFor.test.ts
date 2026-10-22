import { describe, it, expect } from "vitest";
import {
  ADMIN_SCOPE_READ,
  ADMIN_SCOPE_WRITE,
  BootConfigurationError,
} from "nodefony";
import type { IAccessPrincipal, IMcpTool } from "nodefony";
import {
  callMcpTool,
  defineMcpGate,
  mcpCallScopes,
  mcpDeclaredScopes,
  mcpText,
} from "../index";
import type {
  IMcpGateDefinition,
  IMcpGateRequest,
  IMcpGateResponse,
} from "../index";

/**
 * `scopesFor` (#650) — un paramètre qui ÉLARGIT ce que fait un outil exige son
 * scope à l'APPEL, jamais à la collecte. Spec MCP 2026-07-28, autorisation :
 * « Runtime Insufficient Scope Errors » (403 + défi qui nomme TOUS les scopes
 * de l'opération) et « Scope Selection Strategy » (`scopes_supported` minimal).
 */

const RESOURCE = "https://app.example/nodefony/mcp";
const PROTECTED = {
  authorization: {
    authorizationServers: ["https://auth.example"],
    resource: RESOURCE,
  },
};

/** Un outil dont le paramètre `as` exige l'écriture ; compte ses exécutions. */
function act(extra: Partial<IMcpTool> = {}): IMcpTool & { runs: number } {
  const tool = {
    name: "act",
    description: "agit, au nom d'un autre compte si `as` est donné",
    inputSchema: {
      type: "object",
      properties: { as: { type: "string" } },
    },
    scopes: [ADMIN_SCOPE_READ],
    scopesFor: (args: Readonly<Record<string, unknown>>) =>
      typeof args.as === "string" ? [ADMIN_SCOPE_WRITE] : [],
    runs: 0,
    handler: () => {
      tool.runs += 1;
      return mcpText("fait");
    },
    ...extra,
  };
  return tool;
}

function principal(scopes: readonly string[]): IAccessPrincipal {
  return { issuer: "https://auth.example", subject: "alice", scopes };
}

function gate(tools: IMcpTool[], extra: Partial<IMcpGateDefinition> = {}) {
  return defineMcpGate({ tools, ...PROTECTED, ...extra });
}

function call(args: Record<string, unknown>): unknown {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "act", arguments: args },
  };
}

const LIST = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };

function request(body: unknown, token = true): IMcpGateRequest {
  return {
    body,
    remoteAddress: "127.0.0.1",
    ...(token ? { authorization: "Bearer bon" } : {}),
  };
}

function runtimeWith(scopes: readonly string[]) {
  return {
    serverInfo: { name: "banc", version: "0.0.0" },
    verifier: async () => principal(scopes),
  };
}

function challenge(response: IMcpGateResponse): string {
  expect(response.kind).toBe("json");
  return response.kind === "json"
    ? (response.headers?.["WWW-Authenticate"] ?? "")
    : "";
}

function status(response: IMcpGateResponse): number {
  return response.kind === "stream" ? 0 : response.status;
}

function toolResult(response: IMcpGateResponse): {
  isError: boolean;
  text: string;
} {
  const body = (response.kind === "json" ? response.body : {}) as {
    result?: { isError?: boolean; content?: { text: string }[] };
  };
  return {
    isError: body.result?.isError === true,
    text: body.result?.content?.[0]?.text ?? "",
  };
}

describe("scopesFor — porte protégée : l'élévation se DEMANDE (403 + défi)", () => {
  it("un jeton de lecture VOIT l'outil : le scope d'écriture ne conditionne pas la visibilité", async () => {
    const res = await gate([act()]).respond(
      request(LIST),
      runtimeWith([ADMIN_SCOPE_READ]),
    );
    const body = (res.kind === "json" ? res.body : {}) as {
      result?: { tools?: { name: string }[] };
    };
    expect(body.result?.tools?.map((t) => t.name)).toEqual(["act"]);
  });

  it("🔴 `as` sans admin:write → 403 insufficient_scope, défi nommant TOUS les scopes, handler jamais appelé", async () => {
    const tool = act();
    const res = await gate([tool]).respond(
      request(call({ as: "bob" })),
      runtimeWith([ADMIN_SCOPE_READ]),
    );
    expect(status(res)).toBe(403);
    const header = challenge(res);
    expect(header).toContain('error="insufficient_scope"');
    // RFC 6750 §3 : ASCII seul dans le défi, le message entier part dans le corps.
    expect(header).toContain(
      `error_description="missing scope: ${ADMIN_SCOPE_WRITE}"`,
    );
    expect(header).toContain(
      `scope="${ADMIN_SCOPE_READ} ${ADMIN_SCOPE_WRITE}"`,
    );
    expect(header).toContain(
      'resource_metadata="https://app.example/.well-known/oauth-protected-resource/nodefony/mcp"',
    );
    expect(tool.runs).toBe(0);
  });

  it("sans `as`, le jeton de lecture suffit : l'appel est servi", async () => {
    const tool = act();
    const res = await gate([tool]).respond(
      request(call({})),
      runtimeWith([ADMIN_SCOPE_READ]),
    );
    expect(status(res)).toBe(200);
    expect(toolResult(res)).toEqual({ isError: false, text: "fait" });
    expect(tool.runs).toBe(1);
  });

  it("avec admin:write, `as` est servi", async () => {
    const tool = act();
    const res = await gate([tool]).respond(
      request(call({ as: "bob" })),
      runtimeWith([ADMIN_SCOPE_READ, ADMIN_SCOPE_WRITE]),
    );
    expect(status(res)).toBe(200);
    expect(tool.runs).toBe(1);
  });

  it("anonyme toléré, outil public : 401 SANS code d'erreur (RFC 6750 §3), le scope y est nommé", async () => {
    const tool = act({ scopes: undefined });
    const res = await gate([tool], {
      authorization: { ...PROTECTED.authorization, anonymous: true },
    }).respond(request(call({ as: "bob" }), false), runtimeWith([]));
    expect(status(res)).toBe(401);
    const header = challenge(res);
    expect(header).not.toContain("error=");
    expect(header).toContain(`scope="${ADMIN_SCOPE_WRITE}"`);
    expect(tool.runs).toBe(0);
  });

  it("`scopes_supported` reste MINIMAL : un scope d'élévation n'y entre pas", () => {
    const [entry] = gate([act()]).protectedResources();
    expect(entry?.scopesSupported).toEqual([ADMIN_SCOPE_READ]);
    expect(
      mcpDeclaredScopes({ modules: { m: { getMcpTools: () => [] } } }),
    ).toEqual([]);
  });
});

describe("scopesFor — sans porte protégée : la même règle rend un isError", () => {
  it("porte non protégée : `as` sans scope → isError qui nomme admin:write, handler jamais appelé", async () => {
    const tool = act({ scopes: undefined });
    const res = await defineMcpGate({ tools: [tool] }).respond(
      request(call({ as: "bob" }), false),
      runtimeWith([]),
    );
    const r = toolResult(res);
    expect(r.isError).toBe(true);
    expect(r.text).toContain(ADMIN_SCOPE_WRITE);
    expect(tool.runs).toBe(0);
  });

  it("en process : callMcpTool applique la règle, l'appelant explicite la satisfait", async () => {
    const tool = act();
    const refused = await callMcpTool("act", { as: "bob" }, [tool], {
      authenticated: true,
      roles: [],
      scopes: [ADMIN_SCOPE_READ],
    });
    expect(refused?.isError).toBe(true);
    const served = await callMcpTool("act", { as: "bob" }, [tool], {
      authenticated: true,
      roles: [],
      scopes: [ADMIN_SCOPE_READ, ADMIN_SCOPE_WRITE],
    });
    expect(served?.isError).not.toBe(true);
    expect(tool.runs).toBe(1);
  });

  it("🔴 `scopesFor` qui lève ou rend une forme fausse → appel REFUSÉ, jamais servi sans borne", async () => {
    for (const scopesFor of [
      () => {
        throw new Error("boum");
      },
      () => "admin:write" as unknown as readonly string[],
    ]) {
      const tool = act({ scopesFor });
      const res = await callMcpTool("act", {}, [tool], {
        authenticated: true,
        roles: [],
        scopes: [ADMIN_SCOPE_READ, ADMIN_SCOPE_WRITE],
      });
      expect(res?.isError).toBe(true);
      expect(tool.runs).toBe(0);
    }
  });
});

describe("mcpCallScopes et la forme déclarée", () => {
  it("union sans doublon des scopes de l'outil et de ceux des arguments", () => {
    expect(mcpCallScopes(act(), {})).toEqual([ADMIN_SCOPE_READ]);
    expect(mcpCallScopes(act(), { as: "bob" })).toEqual([
      ADMIN_SCOPE_READ,
      ADMIN_SCOPE_WRITE,
    ]);
    expect(
      mcpCallScopes(act({ scopesFor: () => [ADMIN_SCOPE_READ] }), {}),
    ).toEqual([ADMIN_SCOPE_READ]);
  });

  it("`scopesFor` qui n'est pas une fonction : l'outil est refusé au démarrage", () => {
    expect(() =>
      gate([
        act({ scopesFor: "admin:write" as unknown as IMcpTool["scopesFor"] }),
      ]),
    ).toThrow(BootConfigurationError);
  });
});
