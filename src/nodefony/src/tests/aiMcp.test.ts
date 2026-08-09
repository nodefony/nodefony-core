import { describe, it, expect } from "vitest";
import {
  buildMcpUrl,
  planMcpConfig,
  renderMcpPlan,
  MCP_SERVER_KEY,
  type IMcpConfigDocument,
} from "../cli/aiMcpReport";
import { parseAiMcpArgv } from "../cli/aiMcp";

/**
 * Ce que cette suite garde : `ai:mcp` écrit dans un fichier que le projet
 * possède déjà et qui peut porter d'autres serveurs. Le comportement qui compte
 * n'est donc pas « sait-elle écrire », mais « que DÉTRUIT-elle en écrivant ».
 */

describe("ai:mcp — l'URL", () => {
  it("colle l'origine et le chemin sans doubler la barre", () => {
    expect(buildMcpUrl("http://localhost:5151", "/nodefony/mcp")).toBe(
      "http://localhost:5151/nodefony/mcp",
    );
    expect(buildMcpUrl("http://localhost:5151/", "/nodefony/mcp")).toBe(
      "http://localhost:5151/nodefony/mcp",
    );
  });
});

describe("ai:mcp — le plan d'écriture", () => {
  const url = "http://localhost:5151/nodefony/mcp";

  it("pose l'entrée quand aucun fichier n'existe", () => {
    const plan = planMcpConfig(null, url);
    expect(plan.action).toBe("pose");
    expect(plan.document.mcpServers[MCP_SERVER_KEY]).toEqual({
      type: "http",
      url,
    });
  });

  it("🔴 PRÉSERVE les autres serveurs MCP du projet", () => {
    // Le test qui justifie la fonction : une commande de câblage qui emporte
    // les serveurs déclarés par ailleurs est une commande qu'on n'ose plus
    // lancer.
    const existing = {
      mcpServers: {
        github: { type: "http", url: "https://api.github.com/mcp" },
      },
    } as unknown as IMcpConfigDocument;
    const plan = planMcpConfig(existing, url);
    expect(Object.keys(plan.document.mcpServers).sort()).toEqual([
      "github",
      "nodefony",
    ]);
  });

  it("🔴 PRÉSERVE les clés étrangères du document", () => {
    const existing = {
      $schema: "https://example/mcp.json",
      mcpServers: {},
    } as unknown as IMcpConfigDocument;
    expect(planMcpConfig(existing, url).document.$schema).toBe(
      "https://example/mcp.json",
    );
  });

  it("est idempotente au sens FORT — rien à réécrire", () => {
    const existing = {
      mcpServers: { [MCP_SERVER_KEY]: { type: "http", url } },
    } as unknown as IMcpConfigDocument;
    expect(planMcpConfig(existing, url).action).toBe("inchange");
  });

  it("annonce le REMPLACEMENT et l'ancienne URL", () => {
    const existing = {
      mcpServers: {
        [MCP_SERVER_KEY]: { type: "http", url: "http://localhost:9999/x" },
      },
    } as unknown as IMcpConfigDocument;
    const plan = planMcpConfig(existing, url);
    expect(plan.action).toBe("remplace");
    expect(plan.previousUrl).toBe("http://localhost:9999/x");
  });
});

describe("ai:mcp — ce que le rendu DOIT dire", () => {
  it("nomme les deux conditions sans lesquelles rien ne répondra", () => {
    // Sans ces deux lignes, on annoncerait un succès suivi d'un outil
    // introuvable : l'app doit tourner, et l'agent ne relit pas sa config.
    const texte = renderMcpPlan(
      planMcpConfig(null, "http://localhost:5151/nodefony/mcp"),
      "/app/.mcp.json",
      false,
    );
    expect(texte).toMatch(/TOURNER/u);
    expect(texte).toMatch(/redémarre ton agent/u);
  });

  it("dit clairement qu'une simulation n'écrit rien", () => {
    const texte = renderMcpPlan(
      planMcpConfig(null, "http://x/y"),
      "/app/.mcp.json",
      true,
    );
    expect(texte).toMatch(/rien n'est écrit/u);
  });
});

describe("ai:mcp — la ligne de commande", () => {
  it("lit les options qu'elle annonce", () => {
    const parsed = parseAiMcpArgv([
      "node",
      "nodefony",
      "ai:mcp",
      "--url",
      "https://localhost:5152",
      "--dry-run",
      "--json",
    ]);
    expect("error" in parsed).toBe(false);
    if (!("error" in parsed)) {
      expect(parsed.url).toBe("https://localhost:5152");
      expect(parsed.dryRun).toBe(true);
      expect(parsed.json).toBe(true);
    }
  });

  it("sens négatif : une option inconnue est REFUSÉE, jamais avalée", () => {
    const parsed = parseAiMcpArgv(["node", "nodefony", "ai:mcp", "--force"]);
    expect("error" in parsed).toBe(true);
  });
});
