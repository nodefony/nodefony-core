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
import { getDeclaredChannelPolicies } from "../../decorators/realtimeDecorators";
import { registerControllerPolicies } from "../../src/server/channelPolicyRegistry";
import { createRealtimeHarness } from "../../testing/index";
import type { IRealtimeHarness } from "../../testing/index";

/**
 * #758 — une politique de LECTURE (`@RealtimeChannel`) et une politique
 * d'ÉCRITURE (`@RealtimeInbound`) déclarées sur le même nom ne s'écrasent plus.
 *
 * Avant le correctif, les deux décorateurs écrivaient la même case : la seconde
 * déclaration — selon l'ordre des méthodes dans la classe — effaçait l'autre
 * sans un mot. Chaque cas est joué contre le VRAI verrou du pare-feu : sans
 * lui, aucune politique n'est jugée et tout passe.
 */

const ADMIN = { roles: ["ROLE_ADMIN"] };
const CONNECTED = { authenticated: true };
const OPEN = { authenticated: false };

let written: string[] = [];
const open: IRealtimeHarness<RealtimeController>[] = [];

async function connect(
  factory: (ctx: ContextType) => RealtimeController,
  identity?: IRealtimeToken,
): Promise<IRealtimeHarness<RealtimeController>> {
  const h = createRealtimeHarness(factory, {
    ...(identity === undefined ? {} : { identity }),
    frameAuthorizer: createTestFrameAuthorizer(getRealtimeHub()),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

const user = (): IRealtimeToken => createTestIdentity({ roles: ["ROLE_USER"] });
const admin = (): IRealtimeToken =>
  createTestIdentity({ identifier: "root", roles: ["ROLE_ADMIN"] });
const deniedOn = (h: IRealtimeHarness<RealtimeController>): string[] =>
  h.denials().map((d) => d.channel);

// Lecture réservée aux admins, déclarée AVANT une écriture « tout connecté ».
class ReadFirst extends RealtimeController {
  constructor(ctx: ContextType) {
    super("ReadFirst", ctx);
  }
  @RealtimeChannel("split:read-first", ADMIN)
  feed(): () => void {
    return () => {};
  }
  @RealtimeInbound("split:read-first", CONNECTED)
  post(): void {
    written.push("split:read-first");
  }
}

// Écriture réservée aux admins, déclarée AVANT une lecture « tout connecté ».
class WriteFirst extends RealtimeController {
  constructor(ctx: ContextType) {
    super("WriteFirst", ctx);
  }
  @RealtimeInbound("split:write-first", ADMIN)
  post(): void {
    written.push("split:write-first");
  }
  @RealtimeChannel("split:write-first", CONNECTED)
  feed(): () => void {
    return () => {};
  }
}

// Le cas de la démo : tout le monde voit « Untel écrit… », seuls les connectés écrivent.
class OpenRead extends RealtimeController {
  constructor(ctx: ContextType) {
    super("OpenRead", ctx);
  }
  @RealtimeChannel("split:typing", OPEN)
  feed(): () => void {
    return () => {};
  }
  @RealtimeInbound("split:typing", CONNECTED)
  post(): void {
    written.push("split:typing");
  }
}

// Compatibilité : seule l'écriture est gardée ; la lecture en hérite, comme avant.
class WriteOnly extends RealtimeController {
  constructor(ctx: ContextType) {
    super("WriteOnly", ctx);
  }
  @RealtimeChannel("split:write-only")
  feed(): () => void {
    return () => {};
  }
  @RealtimeInbound("split:write-only", ADMIN)
  post(): void {
    written.push("split:write-only");
  }
}

describe("#758 — lecture et écriture d'un canal : aucune politique ne disparaît", () => {
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    getRealtimeHub().clear();
    written = [];
  });

  it("lecture admin puis écriture connectée : un simple utilisateur ne s'abonne pas", async () => {
    const alice = await connect((ctx) => new ReadFirst(ctx), user());
    await alice.subscribe("split:read-first");
    expect(deniedOn(alice)).toContain("split:read-first");
  });

  it("lecture admin puis écriture connectée : l'écriture reste gardée par la lecture", async () => {
    const alice = await connect((ctx) => new ReadFirst(ctx), user());
    await alice.notify("split:read-first", { text: "x" });
    expect(written).toEqual([]);
    const root = await connect((ctx) => new ReadFirst(ctx), admin());
    await root.subscribe("split:read-first");
    await root.notify("split:read-first", { text: "x" });
    expect(deniedOn(root)).toEqual([]);
    expect(written).toEqual(["split:read-first"]);
  });

  it("écriture admin puis lecture connectée : un simple utilisateur lit mais n'écrit pas", async () => {
    const alice = await connect((ctx) => new WriteFirst(ctx), user());
    await alice.subscribe("split:write-first");
    expect(deniedOn(alice)).toEqual([]);
    await alice.notify("split:write-first", { text: "x" });
    expect(written).toEqual([]);
    const root = await connect((ctx) => new WriteFirst(ctx), admin());
    await root.notify("split:write-first", { text: "x" });
    expect(written).toEqual(["split:write-first"]);
  });

  it("lecture libre, écriture connectée : l'anonyme s'abonne, son écriture est refusée", async () => {
    const visitor = await connect((ctx) => new OpenRead(ctx));
    await visitor.subscribe("split:typing");
    expect(deniedOn(visitor)).toEqual([]);
    await visitor.notify("split:typing", { typing: true });
    expect(written).toEqual([]);
    const alice = await connect((ctx) => new OpenRead(ctx), user());
    await alice.notify("split:typing", { typing: true });
    expect(written).toEqual(["split:typing"]);
  });

  it("écriture seule déclarée : la lecture reste protégée par elle (compatibilité)", async () => {
    const alice = await connect((ctx) => new WriteOnly(ctx), user());
    await alice.subscribe("split:write-only");
    expect(deniedOn(alice)).toContain("split:write-only");
    await alice.notify("split:write-only", { text: "x" });
    expect(written).toEqual([]);
    const root = await connect((ctx) => new WriteOnly(ctx), admin());
    await root.subscribe("split:write-only");
    expect(deniedOn(root)).toEqual([]);
  });
});

describe("#758 — deux déclarations contradictoires refusent le démarrage", () => {
  afterEach(() => getRealtimeHub().clear());

  it("même classe, deux LECTURES différentes : refus qui nomme la classe et le canal", () => {
    class TwoReads {
      @RealtimeChannel("dup:read", ADMIN)
      a(): () => void {
        return () => {};
      }
      @RealtimeChannel("dup:read", CONNECTED)
      b(): () => void {
        return () => {};
      }
    }
    expect(() => getDeclaredChannelPolicies(TwoReads)).toThrow(
      /TwoReads.*« dup:read ».*deux politiques de LECTURE/,
    );
  });

  it("même classe, deux ÉCRITURES différentes (action et canal entrant) : refus", () => {
    class TwoWrites {
      @RealtimeAction("dup:write", ADMIN)
      act(): void {}
      @RealtimeInbound("dup:write", OPEN)
      push(): void {}
    }
    expect(() => getDeclaredChannelPolicies(TwoWrites)).toThrow(
      /deux politiques de ÉCRITURE|deux politiques d'ÉCRITURE|ÉCRITURE différentes/,
    );
  });

  it("même classe, deux littéraux ÉQUIVALENTS (rôles dans un autre ordre) : accepté", () => {
    @RealtimePolicy({ "dup:same": { roles: ["ROLE_B", "ROLE_A"] } })
    class Same {
      @RealtimeChannel("dup:same", { roles: ["ROLE_A", "ROLE_B"] })
      a(): () => void {
        return () => {};
      }
    }
    expect(() => getDeclaredChannelPolicies(Same)).not.toThrow();
    // Le décorateur de classe contredisant une méthode, lui, est refusé.
    @RealtimePolicy({ "dup:other": ADMIN })
    class Contradicts {
      @RealtimeChannel("dup:other", CONNECTED)
      a(): () => void {
        return () => {};
      }
    }
    expect(() => getDeclaredChannelPolicies(Contradicts)).toThrow(
      /« dup:other »/,
    );
  });

  it("une sous-classe qui redéclare la lecture de son parent la SURCHARGE, sans refus", () => {
    class Parent {
      @RealtimeChannel("inherit:feed", ADMIN)
      feed(): () => void {
        return () => {};
      }
    }
    class Child extends Parent {
      @RealtimeChannel("inherit:feed", CONNECTED)
      override feed(): () => void {
        return () => {};
      }
    }
    expect(getDeclaredChannelPolicies(Child)?.read["inherit:feed"]).toEqual(
      CONNECTED,
    );
    expect(getDeclaredChannelPolicies(Parent)?.read["inherit:feed"]).toEqual(
      ADMIN,
    );
  });

  it("deux classes en désaccord sur un nom : refus qui nomme LES DEUX classes", () => {
    class FirstOwner {
      @RealtimeChannel("shared:name", ADMIN)
      feed(): () => void {
        return () => {};
      }
    }
    class SecondOwner {
      @RealtimeChannel("shared:name", CONNECTED)
      feed(): () => void {
        return () => {};
      }
    }
    const hub = getRealtimeHub();
    registerControllerPolicies(hub, FirstOwner, null);
    expect(() => registerControllerPolicies(hub, SecondOwner, null)).toThrow(
      /« shared:name ».*FirstOwner.*SecondOwner/,
    );
    // La première déclaration reste en place : rien n'a été écrasé.
    expect(hub.resolveChannelPolicy("shared:name")).toEqual(ADMIN);
  });

  it("deux classes qui déclarent des littéraux ÉQUIVALENTS : accepté", () => {
    class A {
      @RealtimeChannel("shared:same", { roles: ["ROLE_ADMIN"] })
      feed(): () => void {
        return () => {};
      }
    }
    class B {
      @RealtimeChannel("shared:same", { roles: ["ROLE_ADMIN"] })
      feed(): () => void {
        return () => {};
      }
    }
    const hub = getRealtimeHub();
    registerControllerPolicies(hub, A, null);
    expect(() => registerControllerPolicies(hub, B, null)).not.toThrow();
  });

  it("allow posé sur une écriture DISTINCTE de la lecture : refus (il ne serait évalué nulle part)", () => {
    class AllowOnWrite {
      @RealtimeChannel("room:allow-write", CONNECTED)
      feed(): () => void {
        return () => {};
      }
      @RealtimeInbound("room:allow-write", { allow: () => true })
      push(): void {}
    }
    expect(() =>
      registerControllerPolicies(getRealtimeHub(), AllowOnWrite, null),
    ).toThrow(
      /« allow » est posé sur l'écriture du canal « room:allow-write »/,
    );
  });

  it("allow sur un canal entrant SEUL : accepté, la lecture en hérite", () => {
    class AllowOnlyInbound {
      @RealtimeChannel("room:allow-only")
      feed(): () => void {
        return () => {};
      }
      @RealtimeInbound("room:allow-only", { allow: () => true })
      push(): void {}
    }
    const hub = getRealtimeHub();
    registerControllerPolicies(hub, AllowOnlyInbound, null);
    expect(hub.resolveChannelAdmission("room:allow-only")).not.toBeNull();
    expect(hub.resolveChannelPolicies("room:allow-only")?.write).toBeNull();
  });
});

describe("#758 — actions : le défaut fermé ne dépend plus de l'ordre", () => {
  afterEach(() => getRealtimeHub().clear());

  const call = (method: string, token: IRealtimeToken): boolean =>
    createTestFrameAuthorizer(getRealtimeHub())(
      { jsonrpc: "2.0", id: 1, method, params: {} },
      token,
    );

  it("action nue : fermée à l'anonyme, ouverte au connecté", () => {
    class Bare {
      @RealtimeAction("act:bare")
      act(): void {}
    }
    registerControllerPolicies(getRealtimeHub(), Bare, null);
    expect(call("act:bare", ANONYMOUS_REALTIME_TOKEN)).toBe(false);
    expect(call("act:bare", user())).toBe(true);
  });

  it("action homonyme d'un canal OUVERT, déclarée avant ou après lui : reste ouverte (le défaut ne rétrograde pas)", () => {
    class ActionFirst {
      @RealtimeAction("act:catalog-a")
      act(): void {}
      @RealtimeChannel("act:catalog-a", OPEN)
      feed(): () => void {
        return () => {};
      }
    }
    class ChannelFirst {
      @RealtimeChannel("act:catalog-b", OPEN)
      feed(): () => void {
        return () => {};
      }
      @RealtimeAction("act:catalog-b")
      act(): void {}
    }
    const hub = getRealtimeHub();
    registerControllerPolicies(hub, ActionFirst, null);
    registerControllerPolicies(hub, ChannelFirst, null);
    expect(call("act:catalog-a", ANONYMOUS_REALTIME_TOKEN)).toBe(true);
    expect(call("act:catalog-b", ANONYMOUS_REALTIME_TOKEN)).toBe(true);
  });

  it("action explicite sous une lecture différente : l'appel exige les DEUX", () => {
    class Both {
      @RealtimeChannel("act:both", { roles: ["ROLE_USER"] })
      feed(): () => void {
        return () => {};
      }
      @RealtimeAction("act:both", ADMIN)
      act(): void {}
    }
    registerControllerPolicies(getRealtimeHub(), Both, null);
    expect(call("act:both", user())).toBe(false); // lecture oui, écriture non
    expect(call("act:both", admin())).toBe(false); // écriture oui, lecture non
    expect(
      call(
        "act:both",
        createTestIdentity({ roles: ["ROLE_USER", "ROLE_ADMIN"] }),
      ),
    ).toBe(true);
  });
});

describe("#758 — garde de version : un verrou qui ne juge pas l'écriture est refusé", () => {
  afterEach(() => getRealtimeHub().clear());

  const blind = (): boolean => true; // verrou d'avant : ne déclare pas judgesWrite

  it("verrou aveugle posé APRÈS une écriture distincte : refus au démarrage", () => {
    const hub = getRealtimeHub();
    hub.registerChannelPolicy("guard:a", OPEN, undefined, CONNECTED);
    expect(() => hub.setFrameAuthorizer(blind)).toThrow(
      /« guard:a ».*judgesWrite/,
    );
  });

  it("écriture distincte inscrite APRÈS un verrou aveugle : refus au démarrage", () => {
    const hub = getRealtimeHub();
    hub.setFrameAuthorizer(blind);
    expect(() =>
      hub.registerChannelPolicy("guard:b", OPEN, undefined, CONNECTED),
    ).toThrow(/« guard:b ».*judgesWrite/);
  });

  it("le verrou du pare-feu juge l'écriture : accepté dans les deux ordres", () => {
    const hub = getRealtimeHub();
    hub.registerChannelPolicy("guard:c", OPEN, undefined, CONNECTED);
    expect(() =>
      hub.setFrameAuthorizer(createTestFrameAuthorizer(hub)),
    ).not.toThrow();
    expect(() =>
      hub.registerChannelPolicy("guard:d", OPEN, undefined, CONNECTED),
    ).not.toThrow();
  });

  it("sans écriture distincte, un verrou aveugle reste accepté (aucune rupture)", () => {
    const hub = getRealtimeHub();
    hub.registerChannelPolicy("guard:e", CONNECTED);
    expect(() => hub.setFrameAuthorizer(blind)).not.toThrow();
  });
});

// Lecture admise par `allow`, écriture gardée par un rôle.
class VipRoom extends RealtimeController {
  constructor(ctx: ContextType) {
    super("VipRoom", ctx);
  }
  @RealtimeChannel("vip:room", { authenticated: true, allow: () => true })
  feed(): () => void {
    return () => {};
  }
  @RealtimeInbound("vip:room", { roles: ["ROLE_VIP"] })
  post(): void {
    written.push("vip:room");
  }
}

// Lecture admise par `allow`, sans écriture distincte.
class OpenRoom extends RealtimeController {
  constructor(ctx: ContextType) {
    super("OpenRoom", ctx);
  }
  @RealtimeChannel("open:room", { allow: () => true, anonymous: true })
  feed(): () => void {
    return () => {};
  }
  @RealtimeInbound("open:room")
  post(): void {
    written.push("open:room");
  }
}

describe("#758 — allow : une admission ne vaut pas droit d'écrire", () => {
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    getRealtimeHub().clear();
    written = [];
  });

  it("admis par allow, sans le rôle d'écriture : l'abonnement passe, l'écriture est refusée", async () => {
    const alice = await connect((ctx) => new VipRoom(ctx), user());
    await alice.subscribe("vip:room");
    expect(deniedOn(alice)).toEqual([]);
    expect(alice.subscriptions()).toContain("vip:room");
    await alice.notify("vip:room", { text: "x" });
    await alice.notify("vip:room", { text: "y" });
    expect(written).toEqual([]);
    const vip = await connect(
      (ctx) => new VipRoom(ctx),
      createTestIdentity({ identifier: "vip", roles: ["ROLE_VIP"] }),
    );
    await vip.subscribe("vip:room");
    await vip.notify("vip:room", { text: "x" });
    expect(written).toEqual(["vip:room"]);
  });

  it("écriture inscrite APRÈS l'admission : la trame suivante est jugée et refusée", async () => {
    const visitor = await connect((ctx) => new OpenRoom(ctx));
    await visitor.subscribe("open:room");
    await visitor.notify("open:room", {});
    expect(written).toEqual(["open:room"]);
    const hub = getRealtimeHub();
    const read = hub.resolveChannelPolicy("open:room");
    expect(read).not.toBeNull();
    if (read === null) return;
    hub.registerChannelPolicy("open:room", read, undefined, CONNECTED);
    await visitor.notify("open:room", {});
    expect(written).toEqual(["open:room"]);
  });

  it("désabonné d'un canal à allow : son écriture n'est plus admise", async () => {
    const visitor = await connect((ctx) => new OpenRoom(ctx));
    await visitor.subscribe("open:room");
    await visitor.notify("open:room", {});
    await visitor.unsubscribe("open:room");
    await visitor.notify("open:room", {});
    expect(written).toEqual(["open:room"]);
  });
});
