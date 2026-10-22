import { Controller, route, controller, Body } from "@nodefony/framework";
import type { Context } from "@nodefony/http";
import { ADMIN_SCOPE_READ, Nodefony, RequestContext } from "nodefony";
import type { IMcpTool, IRequestUser } from "nodefony";
import {
  defineMcpGate,
  mcpText,
  MCP_PROGRESS_MIN_INTERVAL_MS,
} from "@nodefony/ai";
import { setTimeout as sleep } from "node:timers/promises";

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
    name: "gate_count",
    description:
      "Compte jusqu'à `steps` en annonçant chaque étape — éprouve le flux SSE.",
    inputSchema: {
      type: "object",
      properties: { steps: { type: "integer", minimum: 1, maximum: 10 } },
    },
    handler: async (args, _caller, run) => {
      const steps =
        typeof args.steps === "number" && Number.isInteger(args.steps)
          ? Math.min(Math.max(args.steps, 1), 10)
          : 3;
      // Espacées de l'intervalle minimal de la progression : plus serrées, le
      // moteur les fusionne (une notification par intervalle, la dernière gagne).
      for (let step = 1; step <= steps; step += 1) {
        run?.progress(step, steps);
        await sleep(MCP_PROGRESS_MIN_INTERVAL_MS + 20);
      }
      return mcpText(String(steps));
    },
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

/** Vue minimale du service `authorization` (`@nodefony/security`). */
interface IAuthorizerLike {
  decide(token: unknown, attribute: string): Promise<boolean>;
}

function isAuthorizer(value: unknown): value is IAuthorizerLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "decide" in value &&
    typeof value.decide === "function"
  );
}

function describeUser(
  user: IRequestUser | null,
): { identifier: string; roles: readonly string[] } | null {
  return user === null
    ? null
    : { identifier: user.identifier, roles: user.roles };
}

/**
 * Ce qu'un SERVICE appelé par l'outil voit de l'utilisateur — il ne reçoit
 * rien de l'outil, il lit la requête courante comme le ferait un service de
 * l'application.
 */
async function serviceView(): Promise<{
  user: { identifier: string; roles: readonly string[] } | null;
  adminGranted: boolean | null;
  scopeGranted: boolean | null;
  writeGranted: boolean | null;
}> {
  const user = describeUser(RequestContext.getAuthenticatedUser());
  const authorization = Nodefony.getKernel()?.container?.get("authorization");
  const token = RequestContext.get()?.token;
  const decide = (attribute: string): Promise<boolean | null> =>
    isAuthorizer(authorization) && token !== undefined
      ? authorization.decide(token, attribute)
      : Promise.resolve(null);
  // Un RÔLE du compte, le scope que le jeton porte, et celui qu'il ne porte
  // pas : les rôles viennent du compte, les scopes bornent `api:action`.
  return {
    user,
    adminGranted: await decide("ROLE_ADMIN"),
    scopeGranted: await decide(ADMIN_SCOPE_READ),
    writeGranted: await decide("admin:write"),
  };
}

/**
 * La porte PROTÉGÉE : celle d'une application qui exige un jeton. Elle sert
 * l'outil qui doit voir l'utilisateur de l'appel (#648).
 *
 * `authorizationServers` n'est que PUBLIÉ (RFC 9728) — la vérification du jeton
 * appartient au service `accessTokenVerifier`, dont l'allowlist d'émetteurs vit
 * dans `security`. Même défaut que la porte de devkit (`nodefony/config/devkit.ts`).
 * `resource` s'écrit, jamais ne se dérive du `Host`, et figure dans
 * `security.jwt.audiences` (`nodefony/config/security.ts`) : sans elle, aucun
 * jeton ne pourrait être demandé pour cette porte.
 */
const SECURE_GATE = defineMcpGate({
  name: "test-gate-secure",
  version: "0.0.0",
  instructions: "Porte témoin PROTÉGÉE du module de test — qui suis-je ?",
  authorization: {
    authorizationServers: ["https://localhost:5152"],
    resource: "http://localhost:5151/nodefony/test/mcp-gate/secure",
    additionalResources: [
      "https://localhost:5152/nodefony/test/mcp-gate/secure",
    ],
  },
  tools: [
    {
      name: "gate_whoami",
      description:
        "Rend l'utilisateur vu par l'outil ET par un service qu'il appelle.",
      inputSchema: { type: "object", properties: {} },
      scopes: [ADMIN_SCOPE_READ],
      actsForUser: true,
      handler: async (_args, caller) =>
        mcpText(
          JSON.stringify({
            caller: { subject: caller.subject ?? null, scopes: caller.scopes },
            handler: describeUser(RequestContext.getAuthenticatedUser()),
            service: await serviceView(),
          }),
        ),
    },
  ],
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

  /** La même porte, protégée par un jeton — `/nodefony/test/mcp-gate/secure`. */
  @route("test-mcp-gate-secure", {
    path: "/secure",
    requirements: { methods: ["POST", "GET", "DELETE"] },
  })
  secure(@Body() body: unknown) {
    return SECURE_GATE.serve(this, body);
  }
}

export default McpGateController;
