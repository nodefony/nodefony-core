import { Controller, route, controller, Body } from "@nodefony/framework";
import type { Context } from "@nodefony/http";
import { ADMIN_SCOPE_READ } from "nodefony";
import type { IMcpTool } from "nodefony";
import { defineMcpGate, mcpText } from "@nodefony/ai";

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

/**
 * La porte témoin — définie UNE fois, validée au chargement du module. Aucun
 * réglage d'accès : la plus fermée possible (locale, sans navigateur, sans
 * jeton, sans rôle).
 */
const GATE = defineMcpGate({
  name: "test-gate",
  version: "0.0.0",
  instructions: "Porte témoin du module de test — un écho.",
  tools: GATE_TOOLS,
});

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

  /** `POST` sert un message MCP ; `GET`/`DELETE` rendent `405`. */
  @route("test-mcp-gate", {
    path: "",
    requirements: { methods: ["POST", "GET", "DELETE"] },
  })
  mcp(@Body() body: unknown) {
    return GATE.serve(this, body);
  }
}

export default McpGateController;
