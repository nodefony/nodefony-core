import path from "node:path";
import { describe, it, expect } from "vitest";
import { checkMcpAccess, isLocalAddress } from "../nodefony/src/mcp/guard";
import { handleMcpMessage } from "../nodefony/src/mcp/server";
import { listMcpTools, callMcpTool } from "../nodefony/src/mcp/tools";
import { MCP_PROTOCOL_VERSION } from "../nodefony/src/mcp/protocol";
import { defineDevkitConfig } from "../nodefony/config/defineModuleConfig";
import type { IAdminApi } from "nodefony";

/**
 * Ce que cette suite prouve, et pourquoi elle ne passe par aucun serveur : tout
 * le protocole MCP et ses gardes vivent en fonctions PURES. Le comportement qui
 * compte ici est le **refus** — et un refus ne s'éprouve bien que si on peut le
 * provoquer à volonté, sans monter de décor.
 */

/** Politique par défaut du module (défauts du schéma, non retapés ici). */
const defaults = defineDevkitConfig({}).mcp;

/** Un plan d'administration minimal — juste de quoi voir un sujet répondre. */
function fakeBroker(): { list(): readonly IAdminApi[] } {
  return {
    list: () => [
      {
        adminNamespace: "kernel",
        adminDescriptor: () => ({ label: "Kernel" }),
        adminEndpoints: () => [
          {
            path: "modules",
            handler: () => [{ name: "@nodefony/devkit", version: "10.0.0" }],
          },
        ],
      } as unknown as IAdminApi,
    ],
  };
}

/** Contexte de serveur complet, paramétrable par les cas. */
function context(tools: readonly string[] = defaults.tools) {
  return {
    tools,
    serverInfo: { name: "banc", version: "0.0.0" },
    broker: fakeBroker(),
    getCard: () => ({ app: "banc" }),
    // La racine de CE dépôt : il est lui-même une application Nodefony, donc
    // `check` et `symbols` y ont de quoi répondre pour de vrai.
    projectRoot: path.resolve(import.meta.dirname, "../../../../.."),
  };
}

/** Extrait le contenu textuel d'un `tools/call` réussi. */
function toolText(reply: { body: unknown }): {
  text: string;
  isError?: boolean;
} {
  const result = (
    reply.body as {
      result: { content: { text: string }[]; isError?: boolean };
    }
  ).result;
  return { text: result.content[0].text, isError: result.isError };
}

describe("MCP — la garde d'accès", () => {
  it("reconnaît les trois formes d'adresse locale", () => {
    expect(isLocalAddress("127.0.0.1")).toBe(true);
    expect(isLocalAddress("::1")).toBe(true);
    // IPv4 encapsulée en IPv6 : la forme la plus fréquente sur double pile,
    // celle qu'une comparaison naïve à "127.0.0.1" raterait.
    expect(isLocalAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("sens négatif : une adresse absente ne vaut PAS locale", () => {
    // Le doute ne vaut pas un oui — sans adresse, pas de preuve de localité.
    expect(isLocalAddress(undefined)).toBe(false);
    expect(isLocalAddress("")).toBe(false);
  });

  it("sens négatif : une adresse publique n'est pas locale", () => {
    expect(isLocalAddress("203.0.113.7")).toBe(false);
    expect(isLocalAddress("192.168.1.10")).toBe(false);
    // Piège : « 127 » ailleurs qu'en tête ne fait pas une boucle locale.
    expect(isLocalAddress("10.0.0.127")).toBe(false);
  });

  it("laisse passer un client NATIF — il n'envoie aucune Origin", () => {
    const verdict = checkMcpAccess({ remoteAddress: "127.0.0.1" }, defaults);
    expect(verdict.allowed).toBe(true);
  });

  it("🔴 REFUSE une Origin de navigateur non déclarée (DNS rebinding)", () => {
    const verdict = checkMcpAccess(
      { origin: "https://evil.example", remoteAddress: "127.0.0.1" },
      defaults,
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.why).toMatch(/evil\.example/u);
    }
  });

  it("accepte une Origin explicitement déclarée", () => {
    const verdict = checkMcpAccess(
      { origin: "https://studio.local", remoteAddress: "127.0.0.1" },
      { ...defaults, allowedOrigins: ["https://studio.local"] },
    );
    expect(verdict.allowed).toBe(true);
  });

  it("🔴 REFUSE un appel distant tant que allowRemote est faux", () => {
    const verdict = checkMcpAccess({ remoteAddress: "203.0.113.7" }, defaults);
    expect(verdict.allowed).toBe(false);
  });

  it("la localité est jugée AVANT l'origine — un distant n'apprend rien", () => {
    // Origine pourtant admise : le refus doit porter sur l'adresse, sinon on
    // révèle à un appelant distant quelles origines seraient acceptées.
    const verdict = checkMcpAccess(
      { origin: "https://studio.local", remoteAddress: "203.0.113.7" },
      { ...defaults, allowedOrigins: ["https://studio.local"] },
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.why).toMatch(/non locale/u);
    }
  });

  it("allowRemote ouvre la porte quand on l'a demandé", () => {
    const verdict = checkMcpAccess(
      { remoteAddress: "203.0.113.7" },
      { ...defaults, allowRemote: true },
    );
    expect(verdict.allowed).toBe(true);
  });
});

describe("MCP — le protocole", () => {
  it("initialize annonce la révision et les seules capacités tenues", async () => {
    const reply = await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      context(),
    );
    expect(reply.status).toBe(200);
    const result = (reply.body as { result: Record<string, unknown> }).result;
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(result.capabilities).toEqual({ tools: {} });
  });

  it("une NOTIFICATION rend 202 SANS corps", async () => {
    // La spec l'exige : un client conforme n'attend rien à lire. Rendre un
    // objet JSON ici le ferait échouer.
    const reply = await handleMcpMessage(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      context(),
    );
    expect(reply.status).toBe(202);
    expect(reply.body).toBeNull();
  });

  it("🔴 une méthode inconnue rend 404 ET -32601", async () => {
    // 404, pas 200 : c'est ce qui distingue « je ne connais pas cette méthode »
    // d'un serveur qui n'hébergerait aucun endpoint MCP.
    const reply = await handleMcpMessage(
      { jsonrpc: "2.0", id: 7, method: "resources/list" },
      context(),
    );
    expect(reply.status).toBe(404);
    expect((reply.body as { error: { code: number } }).error.code).toBe(-32601);
  });

  it("🔴 un message sans `method` est refusé en 400", async () => {
    const reply = await handleMcpMessage({ jsonrpc: "2.0", id: 2 }, context());
    expect(reply.status).toBe(400);
    expect((reply.body as { error: { code: number } }).error.code).toBe(-32600);
  });

  it("tools/list ne publie QUE l'allowlist", async () => {
    const reply = await handleMcpMessage(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      context(["card"]),
    );
    const tools = (reply.body as { result: { tools: { name: string }[] } })
      .result.tools;
    expect(tools.map((t) => t.name)).toEqual(["nodefony_card"]);
  });

  it("sens négatif : une clé inconnue dans l'allowlist n'ouvre RIEN", () => {
    expect(listMcpTools(["inspect", "rm-rf", "toString"])).toHaveLength(1);
  });

  it("tools/call lit un sujet par le plan d'administration", async () => {
    const reply = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "nodefony_inspect", arguments: { subject: "modules" } },
      },
      context(),
    );
    expect(reply.status).toBe(200);
    const result = (
      reply.body as {
        result: { content: { text: string }[]; isError?: boolean };
      }
    ).result;
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/@nodefony\/devkit/u);
  });

  it("🔴 un outil HORS allowlist n'est pas appelable, même en le nommant", async () => {
    const reply = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "nodefony_inspect", arguments: { subject: "modules" } },
      },
      context(["card"]),
    );
    expect((reply.body as { error: { code: number } }).error.code).toBe(-32602);
  });

  it("un échec MÉTIER rend isError, pas une erreur de protocole", async () => {
    // La distinction compte pour l'agent : une erreur JSON-RPC dit « tu t'y
    // prends mal », un isError dit « ta demande est recevable mais n'aboutit
    // pas » — c'est la seconde qu'il peut corriger seul.
    const reply = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "nodefony_inspect", arguments: { subject: "licorne" } },
      },
      context(),
    );
    expect(reply.status).toBe(200);
    const result = (
      reply.body as {
        result: { isError?: boolean; content: { text: string }[] };
      }
    ).result;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/sujet inconnu/u);
  });

  it("un sujet servi par un module ABSENT le dit, au lieu de planter", async () => {
    const reply = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        // `entities` est servi par `orm`, que ce faux broker ne porte pas.
        params: {
          name: "nodefony_inspect",
          arguments: { subject: "entities" },
        },
      },
      context(),
    );
    const result = (
      reply.body as {
        result: { isError?: boolean; content: { text: string }[] };
      }
    ).result;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/n'est pas chargé/u);
  });

  it("un outil inexistant est refusé par `callMcpTool` lui-même", async () => {
    const result = await callMcpTool(
      "nodefony_rm",
      {},
      defaults.tools,
      context(),
    );
    expect(result).toBeNull();
  });
});

describe("MCP — conformité de la révision 2026-07-28", () => {
  it("🔴 `server/discover` est un MUST — il répond, avec versions et identité", async () => {
    // « Servers MUST implement it » (server/discover). C'est le point d'entrée
    // d'un client MODERNE, qui n'ouvre aucune session.
    const reply = await handleMcpMessage(
      { jsonrpc: "2.0", id: 20, method: "server/discover" },
      context(),
    );
    expect(reply.status).toBe(200);
    const result = (reply.body as { result: Record<string, unknown> }).result;
    expect(result.supportedVersions).toEqual([MCP_PROTOCOL_VERSION]);
    expect(result.capabilities).toEqual({ tools: {} });
    expect(result.resultType).toBe("complete");
    // L'identité voyage en `_meta`, sous la clé que la spec nomme.
    expect(
      (result._meta as Record<string, unknown>)[
        "io.modelcontextprotocol/serverInfo"
      ],
    ).toEqual({ name: "banc", version: "0.0.0" });
  });

  it("🔴 une révision inconnue rend -32022 AVEC la liste des versions servies", async () => {
    // Sans cette liste, le client n'a rien pour se rattraper : la spec exige
    // qu'on nomme ce qu'on sait faire.
    const reply = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 21,
        method: "tools/list",
        params: {
          _meta: { "io.modelcontextprotocol/protocolVersion": "1900-01-01" },
        },
      },
      context(),
    );
    expect(reply.status).toBe(400);
    const error = (
      reply.body as { error: { code: number; data: Record<string, unknown> } }
    ).error;
    expect(error.code).toBe(-32022);
    expect(error.data.supported).toEqual([MCP_PROTOCOL_VERSION]);
    expect(error.data.requested).toBe("1900-01-01");
  });

  it("🔴 en-tête ≠ `_meta` rend 400 et -32020 (deux sources de vérité)", async () => {
    // Le motif est une vraie faille : un répartiteur peut router sur l'en-tête
    // pendant que le serveur exécute d'après le corps.
    const reply = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 22,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
          },
        },
      },
      context(),
      { protocolVersion: "2025-11-25" },
    );
    expect(reply.status).toBe(400);
    expect((reply.body as { error: { code: number } }).error.code).toBe(-32020);
  });

  it("un client MODERNE cohérent est servi normalement", async () => {
    const reply = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 23,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
          },
        },
      },
      context(),
      { protocolVersion: MCP_PROTOCOL_VERSION },
    );
    expect(reply.status).toBe(200);
  });

  it("DUAL-ÈRE assumé : un client LEGACY sans métadonnée passe encore", async () => {
    // Choix explicite, autorisé par la spec (« MAY implement both behaviors ») :
    // les clients déployés aujourd'hui ouvrent par `initialize`, un serveur
    // strictement moderne ne serait joignable par aucun d'eux.
    const reply = await handleMcpMessage(
      { jsonrpc: "2.0", id: 24, method: "initialize" },
      context(),
    );
    expect(reply.status).toBe(200);
    expect(
      (reply.body as { result: { protocolVersion: string } }).result
        .protocolVersion,
    ).toBe(MCP_PROTOCOL_VERSION);
  });
});

describe("MCP — les outils de diagnostic", () => {
  it("`check` rend un VERDICT, pas trois listes à recompter", async () => {
    const reply = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "nodefony_check", arguments: {} },
      },
      context(),
    );
    const { text, isError } = toolText(reply);
    expect(isError).toBeUndefined();
    const report = JSON.parse(text) as {
      verdict: string;
      total: number;
      root: string;
      scanned: number;
    };
    // Le verdict et son compte doivent être cohérents entre eux — c'est ce
    // qu'un agent lit en premier pour décider s'il continue.
    expect(report.verdict).toBe(report.total === 0 ? "ok" : "manquements");
    expect(report.scanned).toBeGreaterThan(0);
    expect(report.root).toBeTypeOf("string");
  });

  it("`symbols` sans argument rend le résumé du graphe", async () => {
    const reply = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "nodefony_symbols", arguments: {} },
      },
      context(),
    );
    const { text, isError } = toolText(reply);
    expect(isError).toBeUndefined();
    const resume = JSON.parse(text) as {
      total: number;
      parPaquet: Record<string, number>;
    };
    expect(resume.total).toBeGreaterThan(0);
    expect(Object.keys(resume.parPaquet).length).toBeGreaterThan(0);
  });

  it("`symbols` nommé rend la définition et son ancrage", async () => {
    const reply = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: { name: "nodefony_symbols", arguments: { name: "Kernel" } },
      },
      context(),
    );
    const { text, isError } = toolText(reply);
    expect(isError).toBeUndefined();
    const sym = JSON.parse(text) as { name: string; file: string };
    expect(sym.name).toBe("Kernel");
    expect(sym.file).toMatch(/\.ts$/u);
  });

  it("🔴 un symbole introuvable le DIT — il ne rend pas un vide", async () => {
    // Le pire rendu serait une réponse vide : l'agent conclurait que le
    // symbole n'existe pas, alors que le graphe peut simplement manquer.
    const reply = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: {
          name: "nodefony_symbols",
          arguments: { name: "ZzzPasUnSymbole" },
        },
      },
      context(),
    );
    const { text, isError } = toolText(reply);
    expect(isError).toBe(true);
    expect(text).toMatch(/introuvable/u);
  });

  it("`symbols --module` rend la surface exportée d'un paquet", async () => {
    const reply = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 14,
        method: "tools/call",
        params: {
          name: "nodefony_symbols",
          arguments: { module: "@nodefony/http" },
        },
      },
      context(),
    );
    const entries = JSON.parse(toolText(reply).text) as { module: string }[];
    expect(entries.length).toBeGreaterThan(0);
    // Le filtre doit MORDRE : aucun symbole d'un autre paquet ne passe.
    expect(entries.every((e) => e.module === "@nodefony/http")).toBe(true);
  });
});

describe("MCP — la configuration", () => {
  it("pose les quatre défauts, malgré le piège Zod 4", () => {
    // Un `.default({})` plat n'aurait ré-appliqué aucun sous-défaut : ce test
    // garde le pattern `default(() => schema.parse({}))`.
    expect(defaults.enabled).toBe(true);
    expect(defaults.allowedOrigins).toEqual([]);
    expect(defaults.allowRemote).toBe(false);
    expect(defaults.tools).toEqual(["inspect", "check", "symbols", "card"]);
  });

  it("les quatre outils par défaut sont tous IMPLÉMENTÉS", () => {
    // Sens du test : l'allowlist par défaut et le catalogue ne peuvent pas
    // diverger — publier un outil qu'aucun code ne sert serait invisible
    // jusqu'au premier appel d'un agent.
    expect(listMcpTools(defaults.tools)).toHaveLength(4);
  });

  it("refuse une valeur mal typée au boot, en nommant le champ", () => {
    expect(() =>
      defineDevkitConfig({ mcp: { allowRemote: "oui" } } as never),
    ).toThrow(/allowRemote/u);
  });
});
