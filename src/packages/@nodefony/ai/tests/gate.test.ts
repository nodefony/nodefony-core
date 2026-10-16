import { describe, it, expect } from "vitest";
import { ADMIN_DEFAULT_ROLE, ADMIN_SCOPE_READ } from "nodefony";
import type { IAccessTokenVerifier, IMcpTool } from "nodefony";
import {
  serveMcpRequest,
  rejectUnsupportedMcpMethod,
  mcpProtectedResources,
  mcpConfigSchema,
  mcpText,
  JsonRpcError,
} from "../index";
import type {
  IMcpConfig,
  IMcpEventSink,
  IMcpGateOptions,
  IMcpGateRequest,
  IMcpGateResponse,
} from "../index";

/**
 * La porte MCP sur HTTP, éprouvée SANS serveur : `serveMcpRequest` reçoit tout
 * et rend une réponse DÉCRITE. C'est la mécanique que devkit et toute porte
 * d'application partagent — chaque statut que la spec impose est vu ici.
 */

const RESOURCE = "https://app.example/nodefony/mcp";

function tool(name: string, extra: Partial<IMcpTool> = {}): IMcpTool {
  return {
    name,
    description: `outil ${name}`,
    inputSchema: { type: "object", properties: {} },
    handler: () => mcpText(`réponse de ${name}`),
    ...extra,
  };
}

/** Les modules servis : un outil public, un outil d'administration. */
const MODULES = {
  shop: {
    getModuleName: () => "shop",
    getMcpTools: () => [
      tool("shop_stock"),
      tool("shop_admin", { scopes: [ADMIN_SCOPE_READ] }),
    ],
  },
};

function settings(input: Record<string, unknown> = {}): IMcpConfig {
  return mcpConfigSchema.parse(input);
}

const PROTECTED = {
  authorization: {
    authorizationServers: ["https://auth.example"],
    resource: RESOURCE,
  },
};

function options(extra: Partial<IMcpGateOptions> = {}): IMcpGateOptions {
  return {
    settings: settings(),
    modules: MODULES,
    serverInfo: { name: "banc", version: "0.0.0" },
    ...extra,
  };
}

const LIST = { jsonrpc: "2.0", id: 1, method: "tools/list" };

function request(extra: Partial<IMcpGateRequest> = {}): IMcpGateRequest {
  return { body: LIST, remoteAddress: "127.0.0.1", ...extra };
}

/** Noms des outils d'une réponse `tools/list` en JSON. */
function toolNames(response: IMcpGateResponse): string[] {
  expect(response.kind).toBe("json");
  if (response.kind !== "json") return [];
  const body = response.body as { result?: { tools?: { name: string }[] } };
  return (body.result?.tools ?? []).map((t) => t.name);
}

function jsonError(response: IMcpGateResponse): number | undefined {
  if (response.kind !== "json") return undefined;
  return (response.body as { error?: { code: number } }).error?.code;
}

describe("serveMcpRequest — gardes et corps", () => {
  it("porte coupée par configuration : 404, elle n'existe pas", async () => {
    const response = await serveMcpRequest(
      request(),
      options({ settings: settings({ enabled: false }) }),
    );
    expect(response).toMatchObject({ kind: "json", status: 404 });
  });

  it("origine étrangère : 403, et le motif part au journal, pas à l'appelant", async () => {
    const logs: string[] = [];
    const response = await serveMcpRequest(
      request({ origin: "https://evil.example" }),
      options({ log: (message) => logs.push(message) }),
    );
    expect(response).toMatchObject({ kind: "json", status: 403 });
    expect(jsonError(response)).toBe(JsonRpcError.INVALID_REQUEST);
    expect(logs.some((l) => l.startsWith("MCP refusé"))).toBe(true);
  });

  it("appelant distant sur une porte locale : 403", async () => {
    const response = await serveMcpRequest(
      request({ remoteAddress: "203.0.113.9" }),
      options(),
    );
    expect(response).toMatchObject({ kind: "json", status: 403 });
  });

  it("texte qui ne se parse pas : 400 + -32700, distinct d'un `{}` reçu", async () => {
    const parse = await serveMcpRequest(
      request({ body: {}, rawBody: () => "{pas du json" }),
      options(),
    );
    expect(parse).toMatchObject({ kind: "json", status: 400 });
    expect(jsonError(parse)).toBe(JsonRpcError.PARSE_ERROR);

    const notObject = await serveMcpRequest(request({ body: "x" }), options());
    expect(jsonError(notObject)).toBe(JsonRpcError.INVALID_REQUEST);
  });

  it("notification acceptée : 202 SANS corps", async () => {
    const response = await serveMcpRequest(
      request({
        body: { jsonrpc: "2.0", method: "notifications/initialized" },
      }),
      options(),
    );
    expect(response).toEqual({ kind: "empty", status: 202 });
  });
});

describe("serveMcpRequest — qui appelle, et ce qu'il voit", () => {
  it("🔴 porte non protégée : AUCUN rôle par défaut, l'outil d'administration est retenu", async () => {
    const response = await serveMcpRequest(request(), options());
    expect(toolNames(response)).toEqual(["shop_stock"]);
  });

  it("porte de développement : le rôle d'opérateur s'ÉCRIT, et ouvre l'outil d'administration", async () => {
    const response = await serveMcpRequest(
      request(),
      options({ operatorRoles: [ADMIN_DEFAULT_ROLE] }),
    );
    expect(toolNames(response)).toEqual(["shop_stock", "shop_admin"]);
  });

  it("porte protégée sans vérificateur : 503 + CRITIC, jamais un porteur accepté sans lecture", async () => {
    const logs: string[] = [];
    const response = await serveMcpRequest(
      request({ authorization: "Bearer abc" }),
      options({
        settings: settings(PROTECTED),
        log: (_message, severity) => logs.push(severity),
      }),
    );
    expect(response).toMatchObject({ kind: "json", status: 503 });
    expect(logs).toContain("CRITIC");
  });

  it("porte protégée sans jeton : 401 avec `resource_metadata`", async () => {
    const verifier: IAccessTokenVerifier = async () => null;
    const response = await serveMcpRequest(
      request(),
      options({ settings: settings(PROTECTED), verifier }),
    );
    expect(response).toMatchObject({ kind: "json", status: 401 });
    const header = response.kind === "json" ? response.headers : undefined;
    expect(header?.["WWW-Authenticate"]).toContain("resource_metadata=");
  });

  it("gabarit `${…}` non substitué : le refus se DIT au journal", async () => {
    const logs: string[] = [];
    const verifier: IAccessTokenVerifier = async () => null;
    await serveMcpRequest(
      request({ authorization: "Bearer ${NF_MCP_TOKEN}" }),
      options({
        settings: settings(PROTECTED),
        verifier,
        log: (message) => logs.push(message),
      }),
    );
    expect(logs.some((l) => l.includes("GABARIT non substitué"))).toBe(true);
  });

  it("jeton vérifié : les rôles viennent de ses SCOPES — l'opérateur n'y est pour rien", async () => {
    const verifier: IAccessTokenVerifier = async () => ({
      issuer: "https://auth.example",
      subject: "agent-1",
      scopes: [ADMIN_SCOPE_READ],
    });
    const response = await serveMcpRequest(
      request({ authorization: "Bearer bon" }),
      options({ settings: settings(PROTECTED), verifier }),
    );
    expect(toolNames(response)).toEqual(["shop_stock", "shop_admin"]);
  });
});

describe("serveMcpRequest — flux", () => {
  it("un outil qui notifie en route ouvre le flux ; la réponse finale le clôt", async () => {
    const sent: unknown[] = [];
    const sink: IMcpEventSink = {
      closed: false,
      send: (data) => {
        sent.push(data);
        return undefined;
      },
    };
    const modules = {
      shop: {
        getModuleName: () => "shop",
        getMcpTools: () => [
          tool("shop_long", {
            handler: (_args, _caller, run) => {
              run?.progress(1, 2);
              return mcpText("fini");
            },
          }),
        ],
      },
    };
    const response = await serveMcpRequest(
      request({
        body: {
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: { name: "shop_long", _meta: { progressToken: "p" } },
        },
        openStream: () => sink,
      }),
      options({ modules }),
    );
    expect(response).toEqual({ kind: "stream", stream: sink });
    expect(sent.length).toBe(2);
  });
});

describe("méthodes retirées et publication RFC 9728", () => {
  it("GET / DELETE : 405 + `Allow: POST` ; porte coupée : 404", () => {
    expect(rejectUnsupportedMcpMethod({ enabled: true })).toEqual({
      kind: "empty",
      status: 405,
      headers: { allow: "POST" },
    });
    expect(rejectUnsupportedMcpMethod({ enabled: false })).toMatchObject({
      status: 404,
    });
  });

  it("rien publié sans serveur d'autorisation ; sinon les scopes EXIGÉS par les outils", () => {
    expect(mcpProtectedResources(settings(), MODULES)).toEqual([]);
    expect(mcpProtectedResources(settings(PROTECTED), MODULES)).toEqual([
      expect.objectContaining({
        resource: RESOURCE,
        scopesSupported: [ADMIN_SCOPE_READ],
      }),
    ]);
  });
});
