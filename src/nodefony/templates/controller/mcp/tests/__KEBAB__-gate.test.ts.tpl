import { describe, it, expect } from "vitest";
import type { IMcpGateRequest, IMcpGateResponse } from "@nodefony/ai";
import { <%= it.camel %>Gate } from "../nodefony/mcp/<%= it.kebab %>-gate";

/**
 * La porte MCP `<%= it.route %>`, éprouvée SANS serveur : `gate.respond()` est la
 * mécanique que `gate.serve()` exécute derrière la route, sur une requête
 * décrite. Ce qui est vrai ici est vrai sur le réseau — les en-têtes en moins.
 */

/** Un message JSON-RPC envoyé depuis la machine locale. */
function local(
  body: unknown,
  extra: Partial<IMcpGateRequest> = {},
): IMcpGateRequest {
  return { body, remoteAddress: "127.0.0.1", ...extra };
}

/** Le corps d'une réponse JSON, sans présumer de sa forme. */
function json(response: IMcpGateResponse): unknown {
  return response.kind === "json" ? response.body : undefined;
}

const CALL_ECHO = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "<%= it.toolPrefix %>_echo", arguments: { text: "bonjour" } },
};

describe("porte MCP <%= it.route %>", () => {
<% if (it.oauth) { %>  it("sans jeton : 401, et le défi dit à l'agent où l'obtenir", async () => {
    const response = await <%= it.camel %>Gate.respond(local(CALL_ECHO));
    expect(response).toMatchObject({ kind: "json", status: 401 });
    const challenge =
      response.kind === "json" ? response.headers?.["WWW-Authenticate"] : "";
    expect(challenge).toContain("resource_metadata=");
  });

  it("la porte publie sa ressource protégée (RFC 9728)", () => {
    const [published] = <%= it.camel %>Gate.protectedResources();
    expect(published?.resource).toMatch(/<%= it.routeRegex %>$/u);
  });
<% } else { %>  it("liste ses outils, et eux seuls", async () => {
    const response = await <%= it.camel %>Gate.respond(
      local({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    expect(response).toMatchObject({ kind: "json", status: 200 });
    expect(JSON.stringify(json(response))).toContain("<%= it.toolPrefix %>_echo");
    expect(JSON.stringify(json(response))).toContain("<%= it.toolPrefix %>_batch");
  });

  it("appelle un outil et rend son résultat", async () => {
    const response = await <%= it.camel %>Gate.respond(local(CALL_ECHO));
    expect(response).toMatchObject({ kind: "json", status: 200 });
    expect(JSON.stringify(json(response))).toContain("bonjour");
  });

  it("refuse un appelant distant : la porte est locale", async () => {
    const response = await <%= it.camel %>Gate.respond(
      local(CALL_ECHO, { remoteAddress: "203.0.113.9" }),
    );
    expect(response).toMatchObject({ kind: "json", status: 403 });
  });

  it("refuse une page web (en-tête Origin étranger) — DNS rebinding", async () => {
    const response = await <%= it.camel %>Gate.respond(
      local(CALL_ECHO, { origin: "https://evil.example" }),
    );
    expect(response).toMatchObject({ kind: "json", status: 403 });
  });
<% } %>});
