import { describe, it, expect, afterEach } from "vitest";
import "reflect-metadata";
import { RequestContext, RpcError } from "nodefony";
import { Body, CurrentUser, Query } from "@nodefony/framework";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
import { RealtimeAction } from "../../decorators/realtimeDecorators.js";
import type { ContextType } from "@nodefony/http";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken.js";
import { createRealtimeHarness } from "../../testing/index.js";

/**
 * Une `@RealtimeAction` reçoit ses paramètres décorés comme une route.
 *
 * Le défaut d'origine (#514) : l'action était appelée avec la seule charge
 * JSON-RPC, et tout décorateur de paramètre était ignoré SANS UN MOT —
 * `@CurrentUser()` rendait `undefined`, l'application démarrait, ses tests
 * passaient, et l'utilisateur ne voyait qu'un « internal error » au premier
 * envoi. Une action est fermée par défaut : elle SAIT que l'appelant est
 * authentifié, elle doit pouvoir savoir QUI il est.
 */

interface IAppUser {
  readonly identifier: string;
}

class ChatRt extends RealtimeController {
  constructor(context: ContextType) {
    super("chat-rt", context);
  }

  /** Le cas de l'essai : l'auteur vient du serveur, jamais du client. */
  @RealtimeAction("chat:send")
  send(@Body() payload: { body?: string }, @CurrentUser() user?: IAppUser) {
    return { author: user?.identifier ?? null, body: payload.body ?? null };
  }

  /** Une clé du corps, comme `@Body("x")` sur une route. */
  @RealtimeAction("chat:echo")
  echo(@Body("text") text?: string) {
    return { text: text ?? null };
  }

  /** Paramètre décoré en SECONDE position : chaque valeur va à son index. */
  @RealtimeAction("chat:whoami")
  whoami(@CurrentUser() user?: IAppUser) {
    return { user: user?.identifier ?? null };
  }

  /** L'ALS de l'appel porte l'utilisateur, comme sur le pont `api.request`. */
  @RealtimeAction("chat:als")
  als() {
    const user = RequestContext.getUser() as IAppUser | undefined;
    return { user: user?.identifier ?? null };
  }

  /** Ouverte à l'anonyme : `@CurrentUser` n'invente personne. */
  @RealtimeAction("chat:open", { authenticated: false })
  open(@CurrentUser() user?: IAppUser) {
    return { user: user?.identifier ?? null };
  }

  /** Une erreur JSON-RPC levée par l'action garde son code et ses données. */
  @RealtimeAction("chat:fail")
  fail(@Body() _payload: unknown): never {
    throw new RpcError("refusé", -32001, { status: 403 });
  }

  /** Une action n'a pas d'URL : `@Query` ne lit pas celle du handshake. */
  @RealtimeAction("chat:query")
  query(@Query() query?: Record<string, unknown>) {
    return { query: query ?? null };
  }

  /** Sans aucun décorateur de paramètre : la charge brute, comme avant. */
  @RealtimeAction("chat:raw")
  raw(params: unknown) {
    return { params };
  }
}

const alice: IAppUser = { identifier: "alice" };

const mkToken = (user: IAppUser = alice): IRealtimeToken => ({
  type: "session",
  getUserIdentifier: () => user.identifier,
  isAuthenticated: () => true,
  getRoles: () => ["ROLE_USER"],
  getScopes: () => [],
  getAttribute: (name: string) => (name === "user" ? user : undefined),
});

describe("@RealtimeAction — paramètres décorés", () => {
  afterEach(() => getRealtimeHub().clear());

  it("@CurrentUser reçoit l'utilisateur de la connexion, @Body la charge", async () => {
    const h = createRealtimeHarness((ctx) => new ChatRt(ctx), {
      identity: mkToken(),
    });
    await h.connect();
    const result = await h.call("chat:send", { body: "salut" });
    expect(result).to.deep.equal({ author: "alice", body: "salut" });
    h.dispose();
  });

  it("@Body(clé) extrait une clé de la charge", async () => {
    const h = createRealtimeHarness((ctx) => new ChatRt(ctx), {
      identity: mkToken(),
    });
    await h.connect();
    expect(await h.call("chat:echo", { text: "écho" })).to.deep.equal({
      text: "écho",
    });
    h.dispose();
  });

  it("@CurrentUser seul, sans @Body", async () => {
    const h = createRealtimeHarness((ctx) => new ChatRt(ctx), {
      identity: mkToken(),
    });
    await h.connect();
    expect(await h.call("chat:whoami")).to.deep.equal({ user: "alice" });
    h.dispose();
  });

  it("deux connexions entrelacées gardent chacune leur appelant", async () => {
    const a = createRealtimeHarness((ctx) => new ChatRt(ctx), {
      identity: mkToken(alice),
    });
    const b = createRealtimeHarness((ctx) => new ChatRt(ctx), {
      identity: mkToken({ identifier: "bob" }),
      resetHub: false,
    });
    await a.connect();
    await b.connect();
    const [ra, rb, ra2] = await Promise.all([
      a.call("chat:whoami"),
      b.call("chat:whoami"),
      a.call("chat:whoami"),
    ]);
    expect([ra, rb, ra2]).to.deep.equal([
      { user: "alice" },
      { user: "bob" },
      { user: "alice" },
    ]);
    a.dispose();
    b.dispose();
  });

  it("un appelant anonyme reçoit `undefined`, jamais l'identité d'un autre", async () => {
    const h = createRealtimeHarness((ctx) => new ChatRt(ctx));
    await h.connect();
    expect(await h.call("chat:open")).to.deep.equal({ user: null });
    h.dispose();
  });

  it("une RpcError levée garde son code et ses données", async () => {
    const h = createRealtimeHarness((ctx) => new ChatRt(ctx), {
      identity: mkToken(),
    });
    await h.connect();
    const err = (await h.call("chat:fail", {}).catch((e: unknown) => e)) as {
      rpc?: { code?: number; data?: unknown };
    };
    expect(err.rpc?.code).to.equal(-32001);
    expect(err.rpc?.data).to.deep.equal({ status: 403 });
    h.dispose();
  });

  it("@Query lit un objet vide : une action n'a pas d'URL", async () => {
    const h = createRealtimeHarness((ctx) => new ChatRt(ctx), {
      identity: mkToken(),
      url: "/realtime?leak=1",
    });
    await h.connect();
    expect(await h.call("chat:query")).to.deep.equal({ query: {} });
    h.dispose();
  });

  it("l'ALS de l'appel porte l'utilisateur (RequestContext.getUser)", async () => {
    const h = createRealtimeHarness((ctx) => new ChatRt(ctx), {
      identity: mkToken(),
    });
    await h.connect();
    expect(await h.call("chat:als")).to.deep.equal({ user: "alice" });
    h.dispose();
  });

  it("une action sans décorateur de paramètre reçoit la charge brute", async () => {
    const h = createRealtimeHarness((ctx) => new ChatRt(ctx), {
      identity: mkToken(),
    });
    await h.connect();
    expect(await h.call("chat:raw", { a: 1 })).to.deep.equal({
      params: { a: 1 },
    });
    h.dispose();
  });
});
