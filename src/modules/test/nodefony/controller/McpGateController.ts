import { Controller, route, controller, Body } from "@nodefony/framework";
import type { Context } from "@nodefony/http";
import { ADMIN_SCOPE_READ } from "nodefony";
import type { IMcpTool } from "nodefony";
import {
  serveMcp,
  rejectUnsupportedMcpMethod,
  writeMcpResponse,
  mcpConfigSchema,
  mcpText,
} from "@nodefony/ai";

/**
 * Réglages de la porte témoin : les défauts — locale, anonyme. Une application
 * les lirait dans sa config (`mcpConfigSchema` en sous-schéma de la sienne).
 */
const SETTINGS = mcpConfigSchema.parse({});

/** Les outils que CETTE porte sert — et eux seuls. */
const GATE_TOOLS: IMcpTool[] = [
  {
    name: "gate_echo",
    description: "Renvoie le texte reçu — outil public de la porte témoin.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
    },
    handler: (args) => mcpText(typeof args.text === "string" ? args.text : ""),
  },
  {
    // Exige un rôle d'administration : une porte d'application non protégée
    // n'en accorde AUCUN — cet outil doit rester invisible.
    name: "gate_admin",
    description: "Outil réservé — jamais servi par une porte non protégée.",
    inputSchema: { type: "object", properties: {} },
    scopes: [ADMIN_SCOPE_READ],
    handler: () => mcpText("ne doit jamais répondre"),
  },
];

/** Ce que la collecte lit : un module qui déclare ses outils. */
const GATE_MODULES = {
  gate: {
    getModuleName: () => "test-gate",
    getMcpTools: () => GATE_TOOLS,
  },
};

/**
 * Porte MCP TÉMOIN — celle qu'une application écrit pour exposer SES outils.
 *
 * Elle prouve que la mécanique de `@nodefony/ai` se réutilise sans recoder le
 * protocole : seuls des exports publics sont importés, et la porte ne fournit
 * que ce qu'elle décide — sa route, ses réglages, ses outils. Elle ne sert ni
 * les outils `nodefony_*` de devkit, ni ceux que le module déclare par
 * `getMcpTools()` : une porte choisit ce qu'elle publie.
 */
@controller("/nodefony/test/mcp-gate")
class McpGateController extends Controller {
  constructor(context: Context) {
    super("McpGateController", context);
  }

  /** `POST /nodefony/test/mcp-gate` — sert un message MCP. */
  @route("test-mcp-gate", {
    path: "",
    requirements: { methods: ["POST"] },
  })
  mcp(@Body() body: unknown) {
    return serveMcp(this, body, {
      settings: SETTINGS,
      modules: GATE_MODULES,
      serverInfo: { name: "test-gate", version: "0.0.0" },
    });
  }

  /** `GET` / `DELETE` — `405`, comme toute porte MCP. */
  @route("test-mcp-gate-unsupported", {
    path: "",
    requirements: { methods: ["GET", "DELETE"] },
  })
  unsupported() {
    return writeMcpResponse(this, rejectUnsupportedMcpMethod(SETTINGS));
  }
}

export default McpGateController;
