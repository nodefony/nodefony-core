import { describe, it, expect } from "vitest";

/**
 * L'identité de l'appelant DANS un outil MCP — #648, sur un SERVEUR RÉEL.
 *
 * La porte PROTÉGÉE du module `test` (`/nodefony/test/mcp-gate/secure`) est une
 * porte d'APPLICATION qui exige un jeton. Son outil `gate_whoami` rend ce que
 * voient le handler (`RequestContext.getAuthenticatedUser()`) et un service
 * qu'il appelle (le même accesseur, plus `authorization.decide`).
 *
 * Le jeton s'obtient comme un client l'obtiendrait : le grant par identifiants
 * de l'application, avec `resource` (RFC 8707) = l'audience de la porte, et le
 * scope que l'outil exige. La ressource est ÉCRITE ici, comme dans la config
 * de la porte : elle ne se dérive jamais du `Host`.
 *
 * Décor : le serveur de développement (`nodefony development`). Absent, la
 * suite se saute en le DISANT.
 */

const BASE = process.env.NF_MCP_TEST_RESOURCE_BASE ?? "http://localhost:5151";
const GATE_PATH = "/nodefony/test/mcp-gate/secure";
const RESOURCE = `http://localhost:5151${GATE_PATH}`;

interface IReply {
  status: number;
  body: unknown;
}

async function post(
  path: string,
  message: unknown,
  headers: Record<string, string> = {},
): Promise<IReply> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text === "" ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** Un jeton d'audience « porte protégée », ou la raison de son absence. */
async function issueToken(): Promise<{ token: string } | { reason: string }> {
  try {
    const reply = await post("/nodefony/security/api/token", {
      username: "admin",
      password: "secret-de-dev-42",
      resource: RESOURCE,
      scope: "admin:read",
    });
    const token = (reply.body as { access_token?: unknown } | null)
      ?.access_token;
    return typeof token === "string"
      ? { token }
      : {
          reason: `aucun jeton pour ${RESOURCE} (statut ${reply.status}) — audience absente de security.jwt.audiences ?`,
        };
  } catch (error) {
    return {
      reason: `${BASE} injoignable : ${(error as Error).message} — lancer le serveur de développement`,
    };
  }
}

const issued = await issueToken();
const reason = "reason" in issued ? issued.reason : null;
if (reason !== null) {
  process.stderr.write(
    `\n[ai gate-identity] SUITE SAUTÉE — le décor manque :\n  - ${reason}\n\n`,
  );
}
const TOKEN = "token" in issued ? issued.token : "";

interface IWhoAmI {
  caller: { subject: string | null; scopes: string[] };
  handler: { identifier: string; roles: string[] } | null;
  service: {
    user: { identifier: string; roles: string[] } | null;
    adminGranted: boolean | null;
    scopeGranted: boolean | null;
    writeGranted: boolean | null;
  };
}

async function whoAmI(): Promise<IWhoAmI> {
  const reply = await post(
    GATE_PATH,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "gate_whoami", arguments: {} },
    },
    { authorization: `Bearer ${TOKEN}` },
  );
  expect(reply.status).toBe(200);
  const text = (
    reply.body as { result?: { content?: { text?: string }[] } } | null
  )?.result?.content?.[0]?.text;
  expect(text).toBeTypeOf("string");
  return JSON.parse(text as string) as IWhoAmI;
}

describe.skipIf(reason !== null)(
  "porte MCP d'application protégée — identité de l'appelant",
  () => {
    it("sans jeton, la porte protégée refuse (401 + défi)", async () => {
      const reply = await post(GATE_PATH, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });
      expect(reply.status).toBe(401);
    });

    it("sous jeton, la porte établit l'appelant (sujet + scopes)", async () => {
      const seen = await whoAmI();
      expect(seen.caller.subject).toBe("admin");
      expect(seen.caller.scopes).toContain("admin:read");
    });

    // Aucune zone du pare-feu ne couvre la porte : c'est l'outil `actsForUser`
    // qui fait poser le compte du jeton dans la bulle de la requête.
    it("sous jeton, le handler voit le compte du propriétaire du jeton", async () => {
      const seen = await whoAmI();
      expect(seen.handler?.identifier).toBe("admin");
      expect(seen.handler?.roles).toContain("ROLE_ADMIN");
    });

    it("un service appelé par l'outil lit le même utilisateur, et l'autorisation le reconnaît", async () => {
      const seen = await whoAmI();
      expect(seen.service.user).toEqual(seen.handler);
      expect(seen.service.user?.identifier).toBe("admin");
      expect(seen.service.adminGranted).toBe(true);
    });

    it("l'autorisation borne les attributs `api:action` au scope du jeton", async () => {
      const seen = await whoAmI();
      expect(seen.service.scopeGranted).toBe(true);
      expect(seen.service.writeGranted).toBe(false);
    });
  },
);
