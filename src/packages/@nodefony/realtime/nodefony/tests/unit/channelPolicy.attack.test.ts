import { afterEach, describe, expect, it } from "vitest";
import type { ContextType } from "@nodefony/http";
import {
  createTestFrameAuthorizer,
  createTestIdentity,
} from "@nodefony/security/testing";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken";
import {
  ANONYMOUS_REALTIME_TOKEN,
  RealtimeAction,
  RealtimeChannel,
  RealtimeController,
  RealtimeInbound,
  RealtimePolicy,
  getRealtimeHub,
} from "../../../index";
import type {
  RealtimeActionHandler,
  RealtimeInboundHandler,
} from "../../../index";
import { getDeclaredChannelPolicies } from "../../decorators/realtimeDecorators";
import { registerControllerPolicies } from "../../src/server/channelPolicyRegistry";
import type { FrameAuthorizer } from "../../src/server/RealtimeHub";
import { createRealtimeHarness } from "../../testing/index";
import type { IRealtimeHarness } from "../../testing/index";

/**
 * RED-TEAM #758 — attaques CONÇUES contre la séparation lecture/écriture.
 * Chaque `it` est une attaque : vert = la garantie tient, rouge = elle tombe.
 */

const ADMIN = { roles: ["ROLE_ADMIN"] };
const VIP = { roles: ["ROLE_VIP"] };
const CONNECTED = { authenticated: true };
const OPEN = { authenticated: false };

let written: string[] = [];
const open: IRealtimeHarness<RealtimeController>[] = [];

function counting(): { auth: FrameAuthorizer; count: () => number } {
  const real = createTestFrameAuthorizer(getRealtimeHub());
  let n = 0;
  const auth: FrameAuthorizer = Object.assign(
    (frame: unknown, token: IRealtimeToken): boolean => {
      n += 1;
      return real(frame, token);
    },
    { judgesWrite: true as const },
  );
  return { auth, count: () => n };
}

async function connect(
  factory: (ctx: ContextType) => RealtimeController,
  identity?: IRealtimeToken,
  authorizer?: FrameAuthorizer,
): Promise<IRealtimeHarness<RealtimeController>> {
  const h = createRealtimeHarness(factory, {
    ...(identity === undefined ? {} : { identity }),
    frameAuthorizer: authorizer ?? createTestFrameAuthorizer(getRealtimeHub()),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

const user = (id = "alice"): IRealtimeToken =>
  createTestIdentity({ identifier: id, roles: ["ROLE_USER"] });
const admin = (): IRealtimeToken =>
  createTestIdentity({ identifier: "root", roles: ["ROLE_ADMIN"] });
const vip = (id = "vip"): IRealtimeToken =>
  createTestIdentity({ identifier: id, roles: ["ROLE_VIP"] });
const deniedOn = (h: IRealtimeHarness<RealtimeController>): string[] =>
  h.denials().map((d) => d.channel);
/** `canal:motif` — un refus `unknown` (pas de provider) n'est PAS un refus de politique. */
const refusals = (h: IRealtimeHarness<RealtimeController>): string[] =>
  h.denials().map((d) => `${d.channel}:${d.reason}`);

const judge = (
  frame: Record<string, unknown>,
  token: IRealtimeToken,
): boolean =>
  createTestFrameAuthorizer(getRealtimeHub())(
    { jsonrpc: "2.0", ...frame },
    token,
  );

function teardown(): void {
  for (const h of open.splice(0)) h.close();
  getRealtimeHub().clear();
  written = [];
}

/** Base qui SERT tout canal demandé — les motifs de politique ne sont pas des providers. */
class AnyChannel extends RealtimeController {
  override createRealtimeChannel(): (() => void) | null {
    return () => {};
  }
}

// ───────────────────────── A — motifs × sortes ─────────────────────────

class PatternBoth extends AnyChannel {
  constructor(ctx: ContextType) {
    super("PatternBoth", ctx);
  }
  @RealtimeChannel("room:*", OPEN)
  feed(): () => void {
    return () => {};
  }
  @RealtimeInbound("room:*", ADMIN)
  post(): void {
    written.push("room:*");
  }
  protected override realtimeInbound(): Record<string, RealtimeInboundHandler> {
    return { "room:1": () => written.push("room:1") };
  }
}

class PatternWriteOnly extends AnyChannel {
  constructor(ctx: ContextType) {
    super("PatternWriteOnly", ctx);
  }
  @RealtimeInbound("wo:*", ADMIN)
  post(): void {
    written.push("wo:*");
  }
  protected override realtimeInbound(): Record<string, RealtimeInboundHandler> {
    return { "wo:1": () => written.push("wo:1") };
  }
}

// Motif d'ÉCRITURE strict, nom EXACT de LECTURE libre : l'écriture exacte hérite-t-elle du motif ?
class ExactReadUnderPatternWrite extends AnyChannel {
  constructor(ctx: ContextType) {
    super("ExactReadUnderPatternWrite", ctx);
  }
  @RealtimeInbound("mix:*", ADMIN)
  post(): void {
    written.push("mix:*");
  }
  @RealtimeChannel("mix:lobby", OPEN)
  lobby(): () => void {
    return () => {};
  }
  protected override realtimeInbound(): Record<string, RealtimeInboundHandler> {
    return { "mix:lobby": () => written.push("mix:lobby") };
  }
}

// Motif de LECTURE libre, nom EXACT d'ÉCRITURE strict (le cas que l'ADR dit protéger).
class ExactWriteUnderPatternRead extends AnyChannel {
  constructor(ctx: ContextType) {
    super("ExactWriteUnderPatternRead", ctx);
  }
  @RealtimeChannel("pm:*", OPEN)
  feed(): () => void {
    return () => {};
  }
  @RealtimeInbound("pm:secret", ADMIN)
  post(): void {
    written.push("pm:secret");
  }
}

describe("RED #758 A — motifs × sortes", () => {
  afterEach(teardown);

  it("A1 motif lecture OUVERTE + motif écriture ADMIN : l'utilisateur lit room:1 mais n'y écrit pas", async () => {
    const alice = await connect((ctx) => new PatternBoth(ctx), user());
    await alice.subscribe("room:1");
    expect(refusals(alice)).toEqual([]);
    expect(alice.subscriptions()).toContain("room:1");
    await alice.notify("room:1", { x: 1 });
    expect(written).toEqual([]);
    const root = await connect((ctx) => new PatternBoth(ctx), admin());
    await root.notify("room:1", { x: 1 });
    expect(written).toEqual(["room:1"]);
  });

  it("A2 motif écriture SEULE (ADMIN) : la lecture d'un canal du motif en hérite (refus de POLITIQUE)", async () => {
    const alice = await connect((ctx) => new PatternWriteOnly(ctx), user());
    await alice.subscribe("wo:1");
    expect(refusals(alice)).toEqual(["wo:1:forbidden"]);
    await alice.notify("wo:1", {});
    expect(written).toEqual([]);
  });

  it("A3 écriture ADMIN sur motif, lecture OUVERTE sur nom exact : l'anonyme n'écrit PAS sur le nom exact", async () => {
    const visitor = await connect((ctx) => new ExactReadUnderPatternWrite(ctx));
    await visitor.subscribe("mix:lobby");
    expect(refusals(visitor)).toEqual([]);
    await visitor.notify("mix:lobby", {});
    // Si ceci est rouge : la précédence « l'exact gouverne les deux sortes »
    // efface l'écriture ADMIN du motif pour mix:lobby.
    expect(written).toEqual([]);
  });

  it("A3b (cause) : au hub, l'écriture résolue pour mix:lobby devrait être ADMIN, pas « la lecture suffit »", async () => {
    await connect((ctx) => new ExactReadUnderPatternWrite(ctx));
    const hub = getRealtimeHub();
    expect(hub.resolveChannelPolicies("mix:other")?.policy).toEqual(ADMIN);
    expect(hub.resolveChannelPolicies("mix:lobby")?.policy).toEqual(OPEN);
    expect(hub.resolveChannelPolicies("mix:lobby")?.write).toEqual(ADMIN);
  });

  it("A4 lecture OUVERTE sur motif, écriture ADMIN sur nom exact : la lecture exacte hérite d'ADMIN", async () => {
    const alice = await connect(
      (ctx) => new ExactWriteUnderPatternRead(ctx),
      user(),
    );
    await alice.subscribe("pm:secret");
    expect(refusals(alice)).toEqual(["pm:secret:forbidden"]);
    await alice.notify("pm:secret", {});
    expect(written).toEqual([]);
    await alice.subscribe("pm:other");
    // Chaque refus (abonnement ET trame) porte sur pm:secret, jamais sur pm:other.
    expect(refusals(alice).every((r) => r === "pm:secret:forbidden")).toBe(
      true,
    );
    expect(alice.subscriptions()).toContain("pm:other");
  });
});

// ───────────────────────── B — actions ─────────────────────────

class TableActionUnderPattern extends AnyChannel {
  constructor(ctx: ContextType) {
    super("TableActionUnderPattern", ctx);
  }
  @RealtimeChannel("act:*", ADMIN)
  feed(): () => void {
    return () => {};
  }
  protected override realtimeActions(): Record<string, RealtimeActionHandler> {
    return { "act:table": () => "ok" };
  }
}

class BareActionUnderPattern extends AnyChannel {
  constructor(ctx: ContextType) {
    super("BareActionUnderPattern", ctx);
  }
  @RealtimeChannel("act:*", ADMIN)
  feed(): () => void {
    return () => {};
  }
  @RealtimeAction("act:bare")
  act(): string {
    return "ok";
  }
}

class DualName extends RealtimeController {
  constructor(ctx: ContextType) {
    super("DualName", ctx);
  }
  @RealtimeInbound("dual:x", CONNECTED)
  post(): void {
    written.push("dual:x:inbound");
  }
  @RealtimeAction("dual:x", CONNECTED)
  act(): string {
    written.push("dual:x:action");
    return "ok";
  }
}

// Action NUE + canal entrant OUVERT sous le même nom : l'action hérite-t-elle de l'ouverture ?
class BareActionOpenInbound extends RealtimeController {
  constructor(ctx: ContextType) {
    super("BareActionOpenInbound", ctx);
  }
  @RealtimeInbound("bo:x", OPEN)
  post(): void {
    written.push("bo:x:inbound");
  }
  @RealtimeAction("bo:x")
  act(): string {
    written.push("bo:x:action");
    return "ok";
  }
}

describe("RED #758 B — actions", () => {
  afterEach(teardown);

  it("B1 action de la TABLE sans politique, sous un motif de lecture ADMIN : l'utilisateur ne l'appelle pas", async () => {
    const alice = await connect(
      (ctx) => new TableActionUnderPattern(ctx),
      user(),
    );
    await expect(alice.call("act:table")).rejects.toThrow();
    const root = await connect(
      (ctx) => new TableActionUnderPattern(ctx),
      admin(),
    );
    await expect(root.call("act:table")).resolves.toBe("ok");
  });

  it("B2 action DÉCORÉE sans politique, sous un motif de lecture ADMIN : l'utilisateur ne l'appelle pas", async () => {
    const alice = await connect(
      (ctx) => new BareActionUnderPattern(ctx),
      user(),
    );
    await expect(alice.call("act:bare")).rejects.toThrow();
    const root = await connect(
      (ctx) => new BareActionUnderPattern(ctx),
      admin(),
    );
    await expect(root.call("act:bare")).resolves.toBe("ok");
  });

  it("B2b (cause) : au hub, la politique résolue pour act:bare devrait être celle du motif (ADMIN)", async () => {
    await connect((ctx) => new BareActionUnderPattern(ctx), admin());
    const hub = getRealtimeHub();
    expect(hub.resolveChannelPolicy("act:other")).toEqual(ADMIN);
    expect(hub.resolveChannelPolicy("act:bare")).toEqual(ADMIN);
  });

  it("B3 action et canal entrant homonymes : l'anonyme n'atteint ni l'un ni l'autre, le connecté les deux", async () => {
    const visitor = await connect((ctx) => new DualName(ctx));
    await expect(visitor.call("dual:x")).rejects.toThrow();
    await visitor.notify("dual:x", {});
    expect(written).toEqual([]);
    const alice = await connect((ctx) => new DualName(ctx), user());
    await alice.call("dual:x");
    await alice.notify("dual:x", {});
    expect(written.length).toBe(2);
  });

  it("B4 action NUE sous un canal entrant OUVERT du même nom : un nom n'a qu'UNE écriture — l'auteur l'a ouverte, l'action l'est aussi (décision #758)", async () => {
    const visitor = await connect((ctx) => new BareActionOpenInbound(ctx));
    await expect(visitor.call("bo:x")).resolves.not.toThrow();
  });
});

// ───────────────────────── C — noms du prototype ─────────────────────────

class ProtoNames extends RealtimeController {
  constructor(ctx: ContextType) {
    super("ProtoNames", ctx);
  }
  @RealtimeChannel("constructor", ADMIN)
  ctor(): () => void {
    return () => {};
  }
}

describe("RED #758 C — noms du prototype", () => {
  afterEach(teardown);

  it("C1 sans déclaration, résoudre un nom du prototype rend null (jamais Object.prototype)", () => {
    const hub = getRealtimeHub();
    for (const name of [
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
    ]) {
      expect(hub.resolveChannelPolicies(name)).toBeNull();
      expect(hub.resolveChannelPolicy(name)).toBeNull();
      expect(hub.resolveChannelAdmission(name)).toBeNull();
    }
  });

  it("C2 un canal nommé « constructor » porte sa politique ; l'utilisateur est refusé", async () => {
    const alice = await connect((ctx) => new ProtoNames(ctx), user());
    await alice.subscribe("constructor");
    expect(deniedOn(alice)).toContain("constructor");
    expect(getRealtimeHub().resolveChannelPolicy("constructor")).toEqual(ADMIN);
  });

  it("C3 déclarer « __proto__ » ne pollue pas la carte des politiques", () => {
    class Proto {
      @RealtimeChannel("__proto__", ADMIN)
      p(): () => void {
        return () => {};
      }
      @RealtimeChannel("safe:x", OPEN)
      s(): () => void {
        return () => {};
      }
    }
    const hub = getRealtimeHub();
    let threw = false;
    try {
      registerControllerPolicies(hub, Proto, null);
    } catch {
      threw = true;
    }
    // Soit refus franc, soit déclaration inerte — jamais une clé « roles » qui devient un canal.
    expect(hub.resolveChannelPolicies("roles")).toBeNull();
    expect(hub.resolveChannelPolicies("authenticated")).toBeNull();
    if (!threw) expect(hub.resolveChannelPolicy("safe:x")).toEqual(OPEN);
  });
});

// ───────────────────────── D — héritage et sous-classes ─────────────────────────

class ParentWriteAdmin extends RealtimeController {
  @RealtimeInbound("inh:x", ADMIN)
  post(): void {
    written.push("inh:x");
  }
}
class ChildOpensRead extends ParentWriteAdmin {
  constructor(ctx: ContextType) {
    super("ChildOpensRead", ctx);
  }
  @RealtimeChannel("inh:x", OPEN)
  feed(): () => void {
    return () => {};
  }
}

class ParentReadAdmin extends RealtimeController {
  @RealtimeChannel("inh:y", ADMIN)
  feed(): () => void {
    return () => {};
  }
}
class ChildOpensWrite extends ParentReadAdmin {
  constructor(ctx: ContextType) {
    super("ChildOpensWrite", ctx);
  }
  @RealtimeInbound("inh:y", OPEN)
  post(): void {
    written.push("inh:y");
  }
}

describe("RED #758 D — héritage et sous-classes", () => {
  afterEach(teardown);

  it("D1 le parent écrit ADMIN, l'enfant ouvre la LECTURE : l'écriture ADMIN du parent tient", async () => {
    const alice = await connect((ctx) => new ChildOpensRead(ctx), user());
    await alice.subscribe("inh:x");
    expect(deniedOn(alice)).toEqual([]);
    await alice.notify("inh:x", {});
    expect(written).toEqual([]);
    expect(
      getDeclaredChannelPolicies(ChildOpensRead)?.kinds["inh:x"]?.write,
    ).toEqual(ADMIN);
  });

  it("D2 le parent lit ADMIN, l'enfant ouvre l'ÉCRITURE : la lecture ADMIN garde aussi l'écriture", async () => {
    const alice = await connect((ctx) => new ChildOpensWrite(ctx), user());
    await alice.subscribe("inh:y");
    expect(deniedOn(alice)).toContain("inh:y");
    await alice.notify("inh:y", {});
    expect(written).toEqual([]);
  });

  it("D3 @RealtimePolicy (deux sortes) contredit par un @RealtimeInbound plus ouvert : refus", () => {
    @RealtimePolicy({ "rp:x": CONNECTED })
    class Rp {
      @RealtimeInbound("rp:x", OPEN)
      post(): void {}
    }
    expect(() => getDeclaredChannelPolicies(Rp)).toThrow(/« rp:x »/);
  });

  it("D4 deux littéraux à rôles identiques mais scopes différents ne sont PAS équivalents", () => {
    class Sc {
      @RealtimeChannel("sc:x", { roles: ["ROLE_A"] })
      a(): () => void {
        return () => {};
      }
      @RealtimeChannel("sc:x", { roles: ["ROLE_A"], scopes: ["s"] })
      b(): () => void {
        return () => {};
      }
    }
    expect(() => getDeclaredChannelPolicies(Sc)).toThrow(/« sc:x »/);
  });

  it("D5 deux « allow » différents sur un même nom ne sont PAS équivalents", () => {
    class Al {
      @RealtimeChannel("al:x", { allow: () => true })
      a(): () => void {
        return () => {};
      }
      @RealtimeChannel("al:x", { allow: () => false })
      b(): () => void {
        return () => {};
      }
    }
    expect(() => getDeclaredChannelPolicies(Al)).toThrow(/« al:x »/);
  });
});

// ───────────────────────── E — deux classes au hub ─────────────────────────

class EscapedAdmin extends RealtimeController {
  constructor(ctx: ContextType) {
    super("EscapedAdmin", ctx);
  }
  @RealtimeChannel("esc:room", ADMIN)
  feed(): () => void {
    return () => {};
  }
}
class EscapedOpen extends RealtimeController {
  constructor(ctx: ContextType) {
    super("EscapedOpen", ctx);
  }
  @RealtimeChannel("esc:room", OPEN)
  feed(): () => void {
    return () => {};
  }
}
// Conflit sur le PREMIER nom, puis un canal gardé : l'inscription partielle laisse-t-elle esc:secret LIBRE ?
class EscapedPartial extends RealtimeController {
  constructor(ctx: ContextType) {
    super("EscapedPartial", ctx);
  }
  @RealtimeChannel("esc:room", OPEN)
  feed(): () => void {
    return () => {};
  }
  @RealtimeChannel("esc:secret", ADMIN)
  secret(): () => void {
    return () => {};
  }
  @RealtimeInbound("esc:secret", ADMIN)
  post(): void {
    written.push("esc:secret");
  }
}

describe("RED #758 E — deux classes au hub", () => {
  afterEach(teardown);

  it("E1 première classe : lecture ADMIN ; seconde : écriture OUVERTE seule → complémentaires, FUSIONNÉES : la lecture ADMIN garde aussi l'écriture", () => {
    class First {
      @RealtimeChannel("two:a", ADMIN)
      feed(): () => void {
        return () => {};
      }
    }
    class Second {
      @RealtimeInbound("two:a", OPEN)
      post(): void {}
    }
    const hub = getRealtimeHub();
    registerControllerPolicies(hub, First, null);
    // Deux sortes différentes : aucune ne disparaît, rien à refuser.
    expect(() => registerControllerPolicies(hub, Second, null)).not.toThrow();
    expect(hub.resolveChannelPolicy("two:a")).toEqual(ADMIN);
    expect(hub.resolveChannelPolicies("two:a")?.write).toEqual(OPEN);
  });

  it("E2 première : lecture OUVERTE + écriture ADMIN ; seconde : lecture OUVERTE seule → même lecture, l'écriture ADMIN de la première tient", () => {
    class First {
      @RealtimeChannel("two:b", OPEN)
      feed(): () => void {
        return () => {};
      }
      @RealtimeInbound("two:b", ADMIN)
      post(): void {}
    }
    class Second {
      @RealtimeChannel("two:b", OPEN)
      feed(): () => void {
        return () => {};
      }
    }
    const hub = getRealtimeHub();
    registerControllerPolicies(hub, First, null);
    expect(() => registerControllerPolicies(hub, Second, null)).not.toThrow();
    expect(hub.resolveChannelPolicies("two:b")?.write).toEqual(ADMIN);
  });

  it("E3 classe échappée à la poignée de main : une seconde classe plus ouverte n'affaiblit pas la première", async () => {
    await connect((ctx) => new EscapedAdmin(ctx), admin());
    let bob: IRealtimeHarness<RealtimeController> | null;
    try {
      bob = await connect((ctx) => new EscapedOpen(ctx), user());
    } catch {
      bob = null;
    }
    if (bob !== null) {
      await bob.subscribe("esc:room");
      expect(deniedOn(bob)).toContain("esc:room");
    }
    expect(getRealtimeHub().resolveChannelPolicy("esc:room")).toEqual(ADMIN);
  });

  it("E4 classe échappée en conflit sur son 1er nom : ses AUTRES canaux gardés ne restent pas libres", async () => {
    await connect((ctx) => new EscapedAdmin(ctx), admin());
    let bob: IRealtimeHarness<RealtimeController> | null;
    try {
      bob = await connect((ctx) => new EscapedPartial(ctx), user());
    } catch {
      bob = null;
    }
    const hub = getRealtimeHub();
    if (bob !== null) {
      // La connexion a survécu au conflit : ses canaux gardés doivent l'être.
      await bob.subscribe("esc:secret");
      expect(refusals(bob)).toContain("esc:secret:forbidden");
      await bob.notify("esc:secret", {});
      expect(written).toEqual([]);
      expect(hub.resolveChannelPolicies("esc:secret")).not.toBeNull();
    }
    expect(hub.resolveChannelPolicy("esc:room")).toEqual(ADMIN);
  });
});

// ───────────────────────── F — allow / admission ─────────────────────────

class VipRoom extends RealtimeController {
  constructor(ctx: ContextType) {
    super("VipRoom", ctx);
  }
  @RealtimeChannel("lobby:x", OPEN)
  lobby(): () => void {
    return () => {};
  }
  @RealtimeChannel("vip:room", { authenticated: true, allow: () => true })
  feed(): () => void {
    return () => {};
  }
  @RealtimeInbound("vip:room", VIP)
  post(): void {
    written.push("vip:room");
  }
  @RealtimeChannel("open:room", { allow: () => true, anonymous: true })
  feed2(): () => void {
    return () => {};
  }
  @RealtimeInbound("open:room")
  post2(): void {
    written.push("open:room");
  }
}

class PersonalInbound extends RealtimeController {
  constructor(ctx: ContextType) {
    super("PersonalInbound", ctx);
  }
  protected override realtimeInbound(): Record<string, RealtimeInboundHandler> {
    return {
      "user:alice": () => written.push("user:alice"),
      "user:bob": () => written.push("user:bob"),
    };
  }
}

describe("RED #758 F — allow : admission ≠ droit d'écrire", () => {
  afterEach(teardown);

  it("F1 verdict retenu par CONNEXION : le VIP qui a écrit n'ouvre pas l'écriture à l'utilisateur admis ensuite", async () => {
    const v = await connect((ctx) => new VipRoom(ctx), vip());
    await v.subscribe("vip:room");
    await v.notify("vip:room", {});
    expect(written).toEqual(["vip:room"]);
    const alice = await connect((ctx) => new VipRoom(ctx), user());
    await alice.subscribe("vip:room");
    expect(deniedOn(alice)).toEqual([]);
    await alice.notify("vip:room", {});
    await alice.notify("vip:room", {});
    expect(written).toEqual(["vip:room"]);
  });

  it("F2 le rôle d'écriture sans abonnement de CETTE connexion : refusé", async () => {
    const v = await connect((ctx) => new VipRoom(ctx), vip());
    await v.notify("vip:room", {});
    expect(written).toEqual([]);
    await v.subscribe("vip:room");
    await v.notify("vip:room", {});
    expect(written).toEqual(["vip:room"]);
  });

  it("F3 abonnement IMPOSÉ par le serveur : l'écriture passe quand même le verrou", async () => {
    const alice = await connect((ctx) => new VipRoom(ctx), user());
    await alice.subscribe("lobby:x");
    const hub = getRealtimeHub();
    const [conn] = hub.channelMembers("lobby:x");
    expect(conn).toBeDefined();
    if (conn === undefined) return;
    expect(await hub.subscribeConnection("vip:room", conn)).toBe(true);
    expect(alice.subscriptions()).toContain("vip:room");
    await alice.notify("vip:room", {});
    expect(written).toEqual([]);
    const v = await connect((ctx) => new VipRoom(ctx), vip());
    await v.subscribe("lobby:x");
    const vconn = hub.channelMembers("lobby:x").find((c) => c !== conn);
    expect(vconn).toBeDefined();
    if (vconn === undefined) return;
    expect(await hub.subscribeConnection("vip:room", vconn)).toBe(true);
    await v.notify("vip:room", {});
    expect(written).toEqual(["vip:room"]);
  });

  it("F4 éjecté par le serveur puis rejeu : refusé ; réabonné : admis de nouveau", async () => {
    const v = await connect((ctx) => new VipRoom(ctx), vip());
    await v.subscribe("vip:room");
    await v.notify("vip:room", {});
    expect(written).toEqual(["vip:room"]);
    const hub = getRealtimeHub();
    const [conn] = hub.channelMembers("vip:room");
    expect(conn).toBeDefined();
    if (conn === undefined) return;
    expect(hub.evictConnection("vip:room", conn)).toBe(true);
    await v.notify("vip:room", {});
    expect(written).toEqual(["vip:room"]);
    await v.subscribe("vip:room");
    await v.notify("vip:room", {});
    expect(written).toEqual(["vip:room", "vip:room"]);
  });

  it("F5 allow posé sur une ACTION distincte de la lecture : refus au démarrage", () => {
    class AllowOnAction {
      @RealtimeChannel("aa:x", CONNECTED)
      feed(): () => void {
        return () => {};
      }
      @RealtimeAction("aa:x", { allow: () => true })
      act(): void {}
    }
    expect(() =>
      registerControllerPolicies(getRealtimeHub(), AllowOnAction, null),
    ).toThrow(/allow/);
  });

  it("F6 deux classes, deux allow différents sur le même nom : refus (jamais le premier qui gagne en silence)", () => {
    class A {
      @RealtimeChannel("al2:x", { allow: () => true })
      a(): () => void {
        return () => {};
      }
    }
    class B {
      @RealtimeChannel("al2:x", { allow: () => false })
      b(): () => void {
        return () => {};
      }
    }
    const hub = getRealtimeHub();
    registerControllerPolicies(hub, A, null);
    expect(() => registerControllerPolicies(hub, B, null)).toThrow(/« al2:x »/);
  });

  it("F7 canal personnel : alice n'écrit pas sur user:bob, ni ne s'y abonne ; sur le sien, oui", async () => {
    const alice = await connect(
      (ctx) => new PersonalInbound(ctx),
      user("alice"),
    );
    await alice.notify("user:bob", {});
    expect(written).toEqual([]);
    await alice.subscribe("user:bob");
    expect(deniedOn(alice)).toContain("user:bob");
    await alice.notify("user:bob", {});
    expect(written).toEqual([]);
    await alice.subscribe("user:alice");
    expect(alice.subscriptions()).toContain("user:alice");
    await alice.notify("user:alice", {});
    expect(written).toEqual(["user:alice"]);
  });

  it("F8 REQUÊTE (avec id) sur un canal entrant à allow, SANS abonnement : l'exigence d'abonnement ne se contourne pas", async () => {
    // L'anonyme n'est pas abonné à open:room (allow + anonymous) : une
    // notification serait refusée (abonnement exigé). La même méthode avec `id` ?
    const visitor = await connect((ctx) => new VipRoom(ctx));
    await visitor.send({
      jsonrpc: "2.0",
      id: 1,
      method: "open:room",
      params: {},
    });
    await visitor.send({
      jsonrpc: "2.0",
      id: 2,
      method: "vip:room",
      params: {},
    });
    expect(written).toEqual([]);
    // Et un VIP non abonné, par requête :
    const v = await connect((ctx) => new VipRoom(ctx), vip());
    await v.send({ jsonrpc: "2.0", id: 3, method: "vip:room", params: {} });
    expect(written).toEqual([]);
  });
});

// ───────────────────────── G — plancher système ─────────────────────────

class SystemSquat extends RealtimeController {
  constructor(ctx: ContextType) {
    super("SystemSquat", ctx);
  }
  @RealtimeChannel("nodefony:evil", OPEN)
  feed(): () => void {
    return () => {};
  }
  @RealtimeInbound("nodefony:evil", OPEN)
  post(): void {
    written.push("nodefony:evil");
  }
}

describe("RED #758 G — plancher système", () => {
  afterEach(teardown);

  it("G1 une politique OUVERTE déclarée sous nodefony: n'affaiblit ni la lecture ni l'écriture", async () => {
    const alice = await connect((ctx) => new SystemSquat(ctx), user());
    await alice.subscribe("nodefony:evil");
    expect(refusals(alice)).toEqual(["nodefony:evil:forbidden"]);
    await alice.notify("nodefony:evil", {});
    expect(written).toEqual([]);
    expect(
      judge({ method: "nodefony:evil", params: {} }, ANONYMOUS_REALTIME_TOKEN),
    ).toBe(false);
  });
});

// ───────────────────────── H — perf : une résolution par trame jugée ─────────────────────────

class PerfRoom extends RealtimeController {
  constructor(ctx: ContextType) {
    super("PerfRoom", ctx);
  }
  @RealtimeChannel("perf:room", CONNECTED)
  feed(): () => void {
    return () => {};
  }
  @RealtimeInbound("perf:room")
  post(): void {
    written.push("perf:room");
  }
  @RealtimeChannel("perf:allow", { authenticated: true, allow: () => true })
  feed2(): () => void {
    return () => {};
  }
  @RealtimeInbound("perf:allow")
  post2(): void {
    written.push("perf:allow");
  }
}

describe("RED #758 H — perf", () => {
  afterEach(teardown);

  it("H1 canal entrant sans allow : subscribe + 1ʳᵉ trame = 2 verdicts, les suivantes 0", async () => {
    const c = counting();
    const alice = await connect((ctx) => new PerfRoom(ctx), user(), c.auth);
    await alice.subscribe("perf:room");
    expect(c.count()).toBe(1);
    await alice.notify("perf:room", {});
    await alice.notify("perf:room", {});
    await alice.notify("perf:room", {});
    expect(written).toEqual(["perf:room", "perf:room", "perf:room"]);
    expect(c.count()).toBe(2);
  });

  it("H2 canal à allow : subscribe + 1ʳᵉ trame = 2 verdicts, les suivantes 0", async () => {
    const c = counting();
    const alice = await connect((ctx) => new PerfRoom(ctx), user(), c.auth);
    await alice.subscribe("perf:allow");
    expect(c.count()).toBe(1);
    await alice.notify("perf:allow", {});
    await alice.notify("perf:allow", {});
    expect(written).toEqual(["perf:allow", "perf:allow"]);
    expect(c.count()).toBe(2);
  });
});

// ───────────────────────── I — verdict retenu vs politique après coup (motif) ─────────────────────────

class LatePattern extends AnyChannel {
  constructor(ctx: ContextType) {
    super("LatePattern", ctx);
  }
  @RealtimeChannel("late:*", CONNECTED)
  feed(): () => void {
    return () => {};
  }
  protected override realtimeInbound(): Record<string, RealtimeInboundHandler> {
    return { "late:1": () => written.push("late:1") };
  }
}

describe("RED #758 I — politique inscrite après coup", () => {
  afterEach(teardown);

  it("I1 verdict retenu via un motif ; une écriture EXACTE plus stricte arrive : la trame suivante est refusée", async () => {
    const alice = await connect((ctx) => new LatePattern(ctx), user());
    await alice.subscribe("late:1");
    expect(alice.subscriptions()).toContain("late:1");
    await alice.notify("late:1", {});
    expect(written).toEqual(["late:1"]);
    getRealtimeHub().registerChannelPolicy(
      "late:1",
      CONNECTED,
      undefined,
      ADMIN,
    );
    await alice.notify("late:1", {});
    expect(written).toEqual(["late:1"]);
  });

  it("I2 verdict retenu ; un motif PLUS STRICT arrive après coup : la trame suivante est refusée", async () => {
    const alice = await connect((ctx) => new LatePattern(ctx), user());
    await alice.subscribe("late:1");
    await alice.notify("late:1", {});
    expect(written).toEqual(["late:1"]);
    getRealtimeHub().registerChannelPolicy("late:*", ADMIN);
    await alice.notify("late:1", {});
    expect(written).toEqual(["late:1"]);
  });
});

// ───────────────────────── J — garde de version ─────────────────────────

describe("RED #758 J — garde de version", () => {
  afterEach(teardown);

  it("J1 verrou aveugle déjà posé, classe à écriture distincte : refus (via le registre des classes)", () => {
    class Split {
      @RealtimeChannel("vg:x", OPEN)
      feed(): () => void {
        return () => {};
      }
      @RealtimeInbound("vg:x", CONNECTED)
      post(): void {}
    }
    const hub = getRealtimeHub();
    hub.setFrameAuthorizer((): boolean => true);
    expect(() => registerControllerPolicies(hub, Split, null)).toThrow(
      /judgesWrite/,
    );
  });

  it("J2 verrou aveugle : @RealtimePolicy (lecture = écriture) reste accepté — contrôle positif", () => {
    @RealtimePolicy({ "vg:y": CONNECTED })
    class Same {}
    const hub = getRealtimeHub();
    hub.setFrameAuthorizer((): boolean => true);
    expect(() => registerControllerPolicies(hub, Same, null)).not.toThrow();
  });

  it("J3 écriture distincte portée par un MOTIF, puis verrou aveugle : refus", () => {
    const hub = getRealtimeHub();
    hub.registerChannelPolicy("vg:*", OPEN, undefined, CONNECTED);
    expect(() => hub.setFrameAuthorizer((): boolean => true)).toThrow(
      /judgesWrite/,
    );
  });
});

// ───────────────────────── K — motif attrape-tout vs canal personnel ─────────────────────────

// Sans provider maison : `user:<id>` est servi par la plateforme (cf F7).
class CatchAll extends RealtimeController {
  constructor(ctx: ContextType) {
    super("CatchAll", ctx);
  }
  @RealtimeChannel("*", CONNECTED)
  feed(): () => void {
    return () => {};
  }
}

describe("RED #758 K — motif « * » et canal personnel", () => {
  afterEach(teardown);

  it("K1 « tous les canaux exigent la connexion » ne doit pas ouvrir user:bob à alice", async () => {
    const alice = await connect((ctx) => new CatchAll(ctx), user("alice"));
    await alice.subscribe("user:bob");
    expect(alice.subscriptions()).not.toContain("user:bob");
    expect(refusals(alice)).toContain("user:bob:forbidden");
  });
});
