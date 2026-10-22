import { describe, it, expect } from "vitest";
import {
  ADMIN_DEFAULT_ROLE,
  ADMIN_SCOPE_READ,
  BootConfigurationError,
  RequestContext,
} from "nodefony";
import type {
  IAccessAccount,
  IAccessAccountResolver,
  IAccessPrincipal,
  IAccessTokenVerifier,
  IMcpTool,
  IRequestUser,
  RequestContextPayload,
} from "nodefony";
import { defineMcpGate, mcpText } from "../index";
import type {
  IMcpGateDefinition,
  IMcpGateRequest,
  IMcpGateResponse,
  IMcpGateRuntime,
  McpGateSeverity,
} from "../index";

/**
 * Un outil qui agit AU NOM du propriétaire du jeton (`actsForUser`, #648) —
 * éprouvé sans serveur : la porte retrouve le compte avant le handler, l'y pose
 * dans une bulle de requête, et ne l'exécute jamais en anonyme.
 *
 * Le résolveur de compte est un double : la règle qu'il porte (compte lié,
 * actif, sujet externe rattaché) vit dans `@nodefony/security` et s'éprouve
 * là-bas ; ici, on éprouve ce que la PORTE en fait.
 */

const RESOURCE = "https://app.example/nodefony/mcp";
const PROTECTED = {
  authorization: {
    authorizationServers: ["https://auth.example"],
    resource: RESOURCE,
  },
};

const ALICE: IRequestUser = {
  id: "u-1",
  identifier: "alice",
  roles: ["ROLE_USER"],
};

/** Un jeton reconnaissable : la porte doit le poser tel quel dans la bulle. */
const ALICE_TOKEN = Object.freeze({ kind: "jeton-de-alice" });

function principal(extra: Partial<IAccessPrincipal> = {}): IAccessPrincipal {
  return {
    issuer: "https://auth.example",
    subject: "alice",
    scopes: [ADMIN_SCOPE_READ],
    ...extra,
  };
}

function verifierFor(p: IAccessPrincipal | null): IAccessTokenVerifier {
  return async () => p;
}

/** Un résolveur qui compte ses appels. */
function resolverOf(
  account: IAccessAccount | null = { token: ALICE_TOKEN, user: ALICE },
): IAccessAccountResolver & { calls: number } {
  const resolve = Object.assign(
    async (): Promise<IAccessAccount | null> => {
      resolve.calls += 1;
      return account;
    },
    { calls: 0 },
  );
  return resolve;
}

/** Ce que le handler voit de la bulle. */
interface ISeen {
  user: IRequestUser | null;
  token: unknown;
  requestId: string | undefined;
}

function whoami(extra: Partial<IMcpTool> = {}): IMcpTool {
  return {
    name: "whoami",
    description: "rend l'utilisateur vu par le handler",
    inputSchema: { type: "object", properties: {} },
    scopes: [ADMIN_SCOPE_READ],
    actsForUser: true,
    handler: () => {
      const seen: ISeen = {
        user: RequestContext.getAuthenticatedUser(),
        token: RequestContext.get()?.token,
        requestId: RequestContext.getRequestId(),
      };
      return mcpText(JSON.stringify(seen));
    },
    ...extra,
  };
}

function gate(tools: IMcpTool[], extra: Partial<IMcpGateDefinition> = {}) {
  return defineMcpGate({ tools, ...PROTECTED, ...extra });
}

function call(name: string, id: number = 1): unknown {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: {} },
  };
}

function request(body: unknown): IMcpGateRequest {
  return {
    body,
    remoteAddress: "127.0.0.1",
    authorization: "Bearer bon",
  };
}

function runtime(extra: Partial<IMcpGateRuntime> = {}): IMcpGateRuntime {
  return {
    serverInfo: { name: "banc", version: "0.0.0" },
    verifier: verifierFor(principal()),
    accountResolver: resolverOf(),
    ...extra,
  };
}

interface IToolReply {
  isError: boolean;
  text: string;
  errorCode: number | undefined;
}

function reply(response: IMcpGateResponse): IToolReply {
  expect(response.kind).toBe("json");
  const body = (response.kind === "json" ? response.body : {}) as {
    result?: { isError?: boolean; content?: { text: string }[] };
    error?: { code: number };
  };
  return {
    isError: body.result?.isError === true,
    text: body.result?.content?.[0]?.text ?? "",
    errorCode: body.error?.code,
  };
}

function seen(response: IMcpGateResponse): ISeen {
  const r = reply(response);
  expect(r.isError).toBe(false);
  return JSON.parse(r.text) as ISeen;
}

function toolNames(response: IMcpGateResponse): string[] {
  const body = (response.kind === "json" ? response.body : {}) as {
    result?: { tools?: { name: string }[] };
  };
  return (body.result?.tools ?? []).map((t) => t.name);
}

describe("actsForUser — le handler agit au nom du propriétaire du jeton", () => {
  it("le handler voit le compte et le jeton que le résolveur a rendus", async () => {
    const view = seen(
      await gate([whoami()]).respond(request(call("whoami")), runtime()),
    );
    expect(view.user).toEqual(ALICE);
    expect(view.token).toEqual(ALICE_TOKEN);
  });

  it("un service appelé par le handler lit le même compte", async () => {
    const service = (): IRequestUser | null =>
      RequestContext.getAuthenticatedUser();
    const tool = whoami({
      handler: async () => {
        await Promise.resolve();
        return mcpText(JSON.stringify({ user: service() }));
      },
    });
    const r = reply(
      await gate([tool]).respond(request(call("whoami")), runtime()),
    );
    expect((JSON.parse(r.text) as { user: IRequestUser }).user).toEqual(ALICE);
  });

  it("la bulle hérite de la corrélation de la requête", async () => {
    const parent: RequestContextPayload = { requestId: "req-42" };
    const view = seen(
      await RequestContext.run(parent, () =>
        gate([whoami()]).respond(request(call("whoami")), runtime()),
      ),
    );
    expect(view.requestId).toBe("req-42");
    // Le magasin PARENT n'a reçu ni le compte ni le jeton : la bulle est un
    // nouvel objet.
    expect(parent.user).toBeUndefined();
    expect(parent.token).toBeUndefined();
  });

  it("la bulle est vidée à la fin de l'appel", async () => {
    let store: RequestContextPayload | undefined;
    const tool = whoami({
      handler: () => {
        store = RequestContext.get();
        return mcpText("ok");
      },
    });
    await gate([tool]).respond(request(call("whoami")), runtime());
    expect(store).toBeDefined();
    expect(store?.user).toBeUndefined();
    expect(store?.token).toBeUndefined();
  });

  it("le journal de requête apprend qui a agi", async () => {
    const identified: string[] = [];
    await gate([whoami()]).respond(
      { ...request(call("whoami")), onAccount: (id) => identified.push(id) },
      runtime(),
    );
    expect(identified).toEqual(["alice"]);
  });

  it("deux appels concurrents ne se voient pas", async () => {
    const BOB: IRequestUser = { id: "u-2", identifier: "bob", roles: [] };
    let release: () => void = () => {};
    const gateOpen = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tool = whoami({
      handler: async () => {
        await gateOpen;
        return mcpText(
          JSON.stringify({ user: RequestContext.getAuthenticatedUser() }),
        );
      },
    });
    const g = gate([tool]);
    const byName: IAccessAccountResolver = async (p) => ({
      token: p.subject,
      user: p.subject === "bob" ? BOB : ALICE,
    });
    const asAlice = g.respond(request(call("whoami", 1)), {
      ...runtime({ accountResolver: byName }),
      verifier: verifierFor(principal({ subject: "alice" })),
    });
    const asBob = g.respond(request(call("whoami", 2)), {
      ...runtime({ accountResolver: byName }),
      verifier: verifierFor(principal({ subject: "bob" })),
    });
    release();
    const [a, b] = await Promise.all([asAlice, asBob]);
    expect((JSON.parse(reply(a).text) as { user: IRequestUser }).user).toEqual(
      ALICE,
    );
    expect((JSON.parse(reply(b).text) as { user: IRequestUser }).user).toEqual(
      BOB,
    );
  });

  it("un outil qui ne déclare rien ne paie rien : le résolveur n'est jamais appelé", async () => {
    const resolver = resolverOf();
    const plain = whoami({ name: "plain", actsForUser: undefined });
    const g = gate([plain, whoami()]);
    const view = seen(
      await g.respond(
        request(call("plain")),
        runtime({ accountResolver: resolver }),
      ),
    );
    expect(view.user).toBeNull();
    // Une LISTE n'exécute rien : le résolveur n'y est pas appelé non plus.
    await g.respond(
      request({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
      runtime({ accountResolver: resolver }),
    );
    expect(resolver.calls).toBe(0);
  });
});

describe("actsForUser — une identité PROUVÉE, sinon l'outil est retenu", () => {
  it("anonyme sur une porte protégée qui le tolère : l'outil n'existe pas", async () => {
    const g = gate([whoami()], {
      authorization: { ...PROTECTED.authorization, anonymous: true },
    });
    const list = await g.respond(
      { body: { jsonrpc: "2.0", id: 1, method: "tools/list" } },
      runtime(),
    );
    expect(toolNames(list)).toEqual([]);
  });

  it("jeton présenté puis rejeté, servi en anonyme : l'outil reste retenu", async () => {
    const resolver = resolverOf();
    const g = gate([whoami()], {
      authorization: { ...PROTECTED.authorization, anonymous: true },
    });
    const r = reply(
      await g.respond(request(call("whoami")), {
        ...runtime({ accountResolver: resolver }),
        verifier: verifierFor(null),
      }),
    );
    expect(r.errorCode).toBeDefined();
    expect(resolver.calls).toBe(0);
  });

  it("l'opérateur d'une porte NON protégée ne s'y substitue pas", async () => {
    const g = defineMcpGate({
      tools: [whoami()],
      unprotectedRoles: [ADMIN_DEFAULT_ROLE],
    });
    const list = await g.respond(
      {
        body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
        remoteAddress: "127.0.0.1",
      },
      runtime(),
    );
    expect(toolNames(list)).toEqual([]);
  });

  it("sans `scopes` déclarés, l'outil est REFUSÉ au démarrage", () => {
    expect(() => gate([whoami({ scopes: undefined })])).toThrow(
      BootConfigurationError,
    );
    expect(() => gate([whoami({ scopes: [] })])).toThrow(/exige des `scopes`/);
  });

  it("`actsForUser` d'une autre forme qu'un booléen est refusé", () => {
    const bad = { ...whoami(), actsForUser: "oui" } as unknown as IMcpTool;
    expect(() => gate([bad])).toThrow(/`actsForUser` n'est pas un booléen/);
  });
});

describe("actsForUser — fail-closed : jamais une exécution en anonyme", () => {
  it("compte inutilisable (null) → isError, le handler ne s'exécute pas", async () => {
    let ran = false;
    const tool = whoami({
      handler: () => {
        ran = true;
        return mcpText("exécuté");
      },
    });
    const r = reply(
      await gate([tool]).respond(
        request(call("whoami")),
        runtime({ accountResolver: resolverOf(null) }),
      ),
    );
    expect(r.isError).toBe(true);
    expect(ran).toBe(false);
  });

  it("résolveur absent → isError, et la porte le CRIE", async () => {
    const logs: { message: string; severity: McpGateSeverity }[] = [];
    const r = reply(
      await gate([whoami()]).respond(request(call("whoami")), {
        ...runtime(),
        accountResolver: undefined,
        log: (message, severity) => logs.push({ message, severity }),
      }),
    );
    expect(r.isError).toBe(true);
    expect(logs.some((l) => l.severity === "CRITIC")).toBe(true);
  });

  it("panne du résolveur → erreur opaque, journalisée", async () => {
    const logs: string[] = [];
    const r = reply(
      await gate([whoami()]).respond(request(call("whoami")), {
        ...runtime(),
        accountResolver: async () => {
          throw new Error("annuaire injoignable");
        },
        log: (message) => logs.push(message),
      }),
    );
    expect(r.errorCode).toBeDefined();
    expect(r.text).not.toContain("annuaire");
    expect(logs.join("\n")).toContain("annuaire injoignable");
  });

  it("jeton déjà expiré → isError", async () => {
    const r = reply(
      await gate([whoami()]).respond(request(call("whoami")), {
        ...runtime(),
        verifier: verifierFor(
          principal({ expiresAt: Math.floor(Date.now() / 1000) - 1 }),
        ),
      }),
    );
    expect(r.isError).toBe(true);
  });

  it("le jeton expire PENDANT l'appel → le signal du handler s'abat", async () => {
    const tool = whoami({
      handler: async (_args, _caller, run) => {
        const outcome = await new Promise<string>((resolve) => {
          const late = setTimeout(() => resolve("pas annulé"), 2000);
          run?.signal.addEventListener("abort", () => {
            clearTimeout(late);
            resolve("annulé");
          });
        });
        return mcpText(outcome);
      },
    });
    const started = Date.now();
    const r = reply(
      await gate([tool]).respond(request(call("whoami")), {
        ...runtime(),
        verifier: verifierFor(
          principal({ expiresAt: (Date.now() + 80) / 1000 }),
        ),
      }),
    );
    expect(r.text).toBe("annulé");
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
