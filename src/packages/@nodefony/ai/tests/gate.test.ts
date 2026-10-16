import { describe, it, expect } from "vitest";
import {
  ADMIN_DEFAULT_ROLE,
  ADMIN_SCOPE_READ,
  BootConfigurationError,
} from "nodefony";
import type { IAccessTokenVerifier, IMcpTool } from "nodefony";
import {
  defineMcpGate,
  mcpText,
  JsonRpcError,
  McpProtocolError,
  MCP_SUPPORTED_VERSIONS,
} from "../index";
import type {
  IMcpEventSink,
  IMcpGateDefinition,
  IMcpGateRequest,
  IMcpGateResponse,
  IMcpGateRuntime,
} from "../index";

/**
 * Une porte MCP, éprouvée SANS serveur : `defineMcpGate` valide et fige la
 * définition, `gate.respond` reçoit tout et rend une réponse DÉCRITE. C'est la
 * mécanique que devkit et toute porte d'application partagent.
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

/** Un outil public, un outil d'administration. */
const TOOLS = [
  tool("shop_stock"),
  tool("shop_admin", { scopes: [ADMIN_SCOPE_READ] }),
];

const PROTECTED = {
  authorization: {
    authorizationServers: ["https://auth.example"],
    resource: RESOURCE,
  },
};

/**
 * Une définition volontairement FAUSSE — ce qu'un utilisateur pourrait écrire
 * en JavaScript, ou après une faute de frappe que le typage n'a pas vue.
 */
function invalid(definition: unknown): IMcpGateDefinition {
  return definition as IMcpGateDefinition;
}

function gate(extra: Partial<IMcpGateDefinition> = {}) {
  return defineMcpGate({ tools: TOOLS, ...extra });
}

const LIST = { jsonrpc: "2.0", id: 1, method: "tools/list" };

function request(extra: Partial<IMcpGateRequest> = {}): IMcpGateRequest {
  return { body: LIST, remoteAddress: "127.0.0.1", ...extra };
}

const RUNTIME: IMcpGateRuntime = {
  serverInfo: { name: "banc", version: "0.0.0" },
};

function result(response: IMcpGateResponse): Record<string, unknown> {
  expect(response.kind).toBe("json");
  if (response.kind !== "json") return {};
  return (response.body as { result?: Record<string, unknown> }).result ?? {};
}

/** Noms des outils d'une réponse `tools/list` en JSON. */
function toolNames(response: IMcpGateResponse): string[] {
  const tools = result(response).tools as { name: string }[] | undefined;
  return (tools ?? []).map((t) => t.name);
}

function jsonError(response: IMcpGateResponse): number | undefined {
  if (response.kind !== "json") return undefined;
  return (response.body as { error?: { code: number } }).error?.code;
}

describe("defineMcpGate — une faute de définition arrête le démarrage, en la nommant", () => {
  it("clé inconnue (faute de frappe) : refusée, jamais ignorée", () => {
    expect(() =>
      defineMcpGate(invalid({ tools: TOOLS, allowRemot: true })),
    ).toThrow(BootConfigurationError);
  });

  it("révision du protocole que le paquet ne sait pas servir : refusée", () => {
    expect(() =>
      defineMcpGate(
        invalid({ tools: TOOLS, protocol: { versions: ["2027-01-01"] } }),
      ),
    ).toThrow(/2027-01-01|protocol/u);
  });

  it("🔴 outil d'application sous le préfixe réservé `nodefony_` : refusé", () => {
    expect(() => defineMcpGate({ tools: [tool("nodefony_card")] })).toThrow(
      /nodefony_/u,
    );
  });

  it("deux outils du même nom : refusé", () => {
    expect(() =>
      defineMcpGate({ tools: [tool("shop_x"), tool("shop_x")] }),
    ).toThrow(BootConfigurationError);
  });

  it("objet qui n'est pas un outil : refusé", () => {
    expect(() => defineMcpGate(invalid({ tools: [{ name: "x" }] }))).toThrow(
      BootConfigurationError,
    );
  });

  it("rôles « sans jeton » sur une porte protégée : refusé (ils n'auraient aucun effet)", () => {
    expect(() =>
      gate({ ...PROTECTED, unprotectedRoles: [ADMIN_DEFAULT_ROLE] }),
    ).toThrow(/unprotectedRoles/u);
  });

  it("la définition est figée", () => {
    expect(Object.isFrozen(gate().settings)).toBe(true);
  });
});

describe("gate.respond — gardes et corps", () => {
  it("porte coupée par configuration : 404, elle n'existe pas", async () => {
    const response = await gate({ enabled: false }).respond(request(), RUNTIME);
    expect(response).toMatchObject({ kind: "json", status: 404 });
  });

  it("origine étrangère : 403, et le motif part au journal, pas à l'appelant", async () => {
    const logs: string[] = [];
    const response = await gate().respond(
      request({ origin: "https://evil.example" }),
      { ...RUNTIME, log: (message) => logs.push(message) },
    );
    expect(response).toMatchObject({ kind: "json", status: 403 });
    expect(jsonError(response)).toBe(JsonRpcError.INVALID_REQUEST);
    expect(logs.some((l) => l.startsWith("MCP refusé"))).toBe(true);
  });

  it("appelant distant sur une porte locale : 403", async () => {
    const response = await gate().respond(
      request({ remoteAddress: "203.0.113.9" }),
      RUNTIME,
    );
    expect(response).toMatchObject({ kind: "json", status: 403 });
  });

  it("texte qui ne se parse pas : 400 + -32700, distinct d'un `{}` reçu", async () => {
    const parse = await gate().respond(
      request({ body: {}, rawBody: () => "{pas du json" }),
      RUNTIME,
    );
    expect(parse).toMatchObject({ kind: "json", status: 400 });
    expect(jsonError(parse)).toBe(JsonRpcError.PARSE_ERROR);

    const notObject = await gate().respond(request({ body: "x" }), RUNTIME);
    expect(jsonError(notObject)).toBe(JsonRpcError.INVALID_REQUEST);
  });

  it("notification acceptée : 202 SANS corps", async () => {
    const response = await gate().respond(
      request({
        body: { jsonrpc: "2.0", method: "notifications/initialized" },
      }),
      RUNTIME,
    );
    expect(response).toEqual({ kind: "empty", status: 202 });
  });
});

describe("gate.respond — qui appelle, et ce qu'il voit", () => {
  it("🔴 porte non protégée : AUCUN rôle par défaut, l'outil d'administration est retenu", async () => {
    expect(toolNames(await gate().respond(request(), RUNTIME))).toEqual([
      "shop_stock",
    ]);
  });

  it("porte que son périmètre protège : le rôle s'ÉCRIT, et ouvre l'outil d'administration", async () => {
    const response = await gate({
      unprotectedRoles: [ADMIN_DEFAULT_ROLE],
    }).respond(request(), RUNTIME);
    expect(toolNames(response)).toEqual(["shop_stock", "shop_admin"]);
  });

  it('`tools: "modules"` : sert ce que déclarent les modules passés', async () => {
    const modules = {
      shop: { getModuleName: () => "shop", getMcpTools: () => TOOLS },
    };
    const response = await defineMcpGate({ tools: "modules" }).respond(
      request(),
      { ...RUNTIME, modules },
    );
    expect(toolNames(response)).toEqual(["shop_stock"]);
  });

  it("porte protégée sans vérificateur : 503 + CRITIC, jamais un porteur accepté sans lecture", async () => {
    const logs: string[] = [];
    const response = await gate(PROTECTED).respond(
      request({ authorization: "Bearer abc" }),
      { ...RUNTIME, log: (_message, severity) => logs.push(severity) },
    );
    expect(response).toMatchObject({ kind: "json", status: 503 });
    expect(logs).toContain("CRITIC");
  });

  it("porte protégée sans jeton : 401 avec `resource_metadata`", async () => {
    const verifier: IAccessTokenVerifier = async () => null;
    const response = await gate(PROTECTED).respond(request(), {
      ...RUNTIME,
      verifier,
    });
    expect(response).toMatchObject({ kind: "json", status: 401 });
    const header = response.kind === "json" ? response.headers : undefined;
    expect(header?.["WWW-Authenticate"]).toContain("resource_metadata=");
  });

  it("gabarit `${…}` non substitué : le refus se DIT au journal", async () => {
    const logs: string[] = [];
    const verifier: IAccessTokenVerifier = async () => null;
    await gate(PROTECTED).respond(
      request({ authorization: "Bearer ${NF_MCP_TOKEN}" }),
      { ...RUNTIME, verifier, log: (message) => logs.push(message) },
    );
    expect(logs.some((l) => l.includes("GABARIT non substitué"))).toBe(true);
  });

  it("jeton vérifié : les rôles viennent de ses SCOPES", async () => {
    const verifier: IAccessTokenVerifier = async () => ({
      issuer: "https://auth.example",
      subject: "agent-1",
      scopes: [ADMIN_SCOPE_READ],
    });
    const response = await gate(PROTECTED).respond(
      request({ authorization: "Bearer bon" }),
      { ...RUNTIME, verifier },
    );
    expect(toolNames(response)).toEqual(["shop_stock", "shop_admin"]);
  });
});

describe("gate.respond — version du protocole", () => {
  it("défaut : toutes les révisions du paquet installé", () => {
    expect(gate().settings.protocol.versions).toBeUndefined();
  });

  it("🔴 révision hors de la liste de la PORTE : 400 + -32022 avec SA liste", async () => {
    const response = await gate({
      protocol: { versions: ["2026-07-28"] },
    }).respond(request({ protocolVersion: "2025-11-25" }), RUNTIME);
    expect(response).toMatchObject({ kind: "json", status: 400 });
    expect(jsonError(response)).toBe(
      McpProtocolError.UNSUPPORTED_PROTOCOL_VERSION,
    );
    const data = (
      response as { body: { error: { data: { supported: string[] } } } }
    ).body.error.data;
    expect(data.supported).toEqual(["2026-07-28"]);
  });

  it("révision inconnue de tous (future) : 400 + -32022, la liste du paquet", async () => {
    const response = await gate().respond(
      request({ protocolVersion: "2099-01-01" }),
      RUNTIME,
    );
    expect(jsonError(response)).toBe(
      McpProtocolError.UNSUPPORTED_PROTOCOL_VERSION,
    );
    const data = (
      response as { body: { error: { data: { supported: string[] } } } }
    ).body.error.data;
    expect(data.supported).toEqual([...MCP_SUPPORTED_VERSIONS]);
  });

  it("`initialize` d'une révision que la porte ne sert pas : elle annonce SA préférée", async () => {
    const response = await gate({
      protocol: { versions: ["2025-06-18", "2025-11-25"] },
    }).respond(
      request({
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05" },
        },
      }),
      RUNTIME,
    );
    expect(result(response).protocolVersion).toBe("2025-11-25");
  });
});

describe("gate.respond — instructions et cache", () => {
  function initialize(definition: Partial<IMcpGateDefinition> = {}) {
    return gate(definition).respond(
      request({
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18" },
        },
      }),
      RUNTIME,
    );
  }

  it("les instructions de la porte ouvrent le texte lu par l'agent", async () => {
    const text = result(await initialize({ instructions: "Stock du magasin." }))
      .instructions as string;
    expect(text.startsWith("Stock du magasin.")).toBe(true);
    expect(text).toContain("shop_stock");
  });

  it("🔴 sans instructions : une phrase NEUTRE — jamais celle de l'outillage de Nodefony", async () => {
    const text = result(await initialize()).instructions as string;
    expect(text).not.toMatch(/introspection|carte de visite/u);
  });

  it("client moderne : `ttlMs`/`cacheScope` sur `tools/list` (MUST), défaut 0 / private", async () => {
    const modern = result(
      await gate().respond(request({ protocolVersion: "2026-07-28" }), RUNTIME),
    );
    expect(modern).toMatchObject({ ttlMs: 0, cacheScope: "private" });

    const tuned = result(
      await gate({ cache: { ttlMs: 60_000, scope: "public" } }).respond(
        request({ protocolVersion: "2026-07-28" }),
        RUNTIME,
      ),
    );
    expect(tuned).toMatchObject({ ttlMs: 60_000, cacheScope: "public" });
  });

  it("client legacy : aucun indice de cache (champs d'une autre ère)", async () => {
    const legacy = result(await gate().respond(request(), RUNTIME));
    expect(legacy).not.toHaveProperty("ttlMs");
    expect(legacy).not.toHaveProperty("cacheScope");
  });
});

describe("gate.respond — flux", () => {
  it("un outil qui notifie en route ouvre le flux ; la réponse finale le clôt", async () => {
    const sent: unknown[] = [];
    const sink: IMcpEventSink = {
      closed: false,
      send: (data) => {
        sent.push(data);
        return undefined;
      },
    };
    const longGate = defineMcpGate({
      tools: [
        tool("shop_long", {
          handler: (_args, _caller, run) => {
            run?.progress(1, 2);
            return mcpText("fini");
          },
        }),
      ],
    });
    const response = await longGate.respond(
      request({
        body: {
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: { name: "shop_long", _meta: { progressToken: "p" } },
        },
        openStream: () => sink,
      }),
      RUNTIME,
    );
    expect(response).toEqual({ kind: "stream", stream: sink });
    expect(sent.length).toBe(2);
  });
});

describe("gate.protectedResources — publication RFC 9728", () => {
  it("rien sans serveur d'autorisation ; sinon les scopes EXIGÉS par les outils", () => {
    expect(gate().protectedResources()).toEqual([]);
    expect(gate(PROTECTED).protectedResources()).toEqual([
      expect.objectContaining({
        resource: RESOURCE,
        scopesSupported: [ADMIN_SCOPE_READ],
      }),
    ]);
  });
});
