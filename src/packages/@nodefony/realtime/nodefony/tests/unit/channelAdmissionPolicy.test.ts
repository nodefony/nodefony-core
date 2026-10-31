import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";
import "reflect-metadata";
import {
  BootConfigurationError,
  Container,
  Inject,
  Injector,
  Module,
  Service,
  injectable,
} from "nodefony";
import type {
  IChannelAdmission,
  IChannelPolicy,
  ISubscriberIdentity,
  RpcActionHandler,
} from "nodefony";
import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  channelPolicyDefect,
  getChannelPoliciesOf,
  isAdmissionClass,
  DEFAULT_ACTION_POLICY,
} from "../../decorators/realtimeDecorators";
import { RealtimeHub, getRealtimeHub } from "../../src/server/RealtimeHub";
import { RealtimeController } from "../../src/server/RealtimeController";
import {
  createAdmissionResolver,
  registerControllerPolicies,
} from "../../src/server/channelPolicyRegistry";
import { Realtime } from "../../../index";

/**
 * #622 lot 2 — la politique d'un canal porte `allow` et `anonymous`, sa garde
 * refuse toute faute, et les classes d'admission sont résolues AU DÉMARRAGE
 * (ADR-0021 §S10, §S10 bis). Chaque cas garde une protection que le framework
 * applique seul : une politique de sécurité mal écrite ne doit jamais ouvrir un
 * canal en silence.
 */

const POLICIES_KEY = "realtime:policies";
const ACTIONS_KEY = "realtime:actions";

const WHO: ISubscriberIdentity = Object.freeze({
  type: "session",
  authenticated: true,
  id: "acc-1",
  userIdentifier: "alice",
  roles: Object.freeze(["ROLE_USER"]),
  scopes: Object.freeze([]),
  issuer: null,
  account: true,
});

const arrow = (channel: string, who: ISubscriberIdentity): boolean =>
  channel === `user:${who.id}`;

@injectable()
class RoomAdmission extends Service implements IChannelAdmission {
  readonly prefix = "room:";
  constructor() {
    super("roomAdmission", new Container());
  }
  allow(channel: string): boolean {
    // Lit `this` : prouve que la méthode est appelée LIÉE à son instance.
    return channel.startsWith(this.prefix);
  }
}

/** Sous-classe NON décorée : hérite de la portée par la chaîne des prototypes. */
class UndecoratedChild extends RoomAdmission {}

/** Classe d'admission oubliée sans `@injectable`. */
class ForgottenAdmission implements IChannelAdmission {
  allow(): boolean {
    return true;
  }
}

@injectable({ scope: "transient" })
class TransientAdmission extends Service implements IChannelAdmission {
  constructor() {
    super("transientAdmission", new Container());
  }
  allow(): boolean {
    return true;
  }
}

@injectable({ scope: "request" })
class RequestAdmission extends Service implements IChannelAdmission {
  constructor() {
    super("requestAdmission", new Container());
  }
  allow(): boolean {
    return true;
  }
}

@injectable()
class NeedsMissing extends Service implements IChannelAdmission {
  constructor(@Inject("serviceThatDoesNotExist622") readonly dep: unknown) {
    super("needsMissing", new Container());
  }
  allow(): boolean {
    return true;
  }
}

@injectable()
class NoAllowMethod extends Service {
  constructor() {
    super("noAllowMethod", new Container());
  }
}

/** Classe porteuse d'une métadonnée de politiques posée à la main (elle est publique). */
function ownerWith(policies: Record<string, unknown>, name = "Owner"): object {
  const ctor = { [name]: class {} }[name]!;
  Reflect.defineMetadata(POLICIES_KEY, policies, ctor);
  return ctor;
}

describe("#622 — garde stricte d'une politique de canal", () => {
  const refused: Array<[string, unknown, string]> = [
    [
      "clé inconnue (faute de frappe sur roles)",
      { role: ["ROLE_X"] },
      "clé inconnue « role »",
    ],
    [
      "clé inconnue (faute de frappe sur allow)",
      { alow: arrow },
      "clé inconnue « alow »",
    ],
    [
      "roles non tableau",
      { roles: "ROLE_X" },
      "« roles » doit être un tableau",
    ],
    ["scopes non textuels", { scopes: [1] }, "« scopes » doit être un tableau"],
    [
      "authenticated non booléen",
      { authenticated: "yes" },
      "« authenticated » doit être un booléen",
    ],
    [
      "anonymous sans allow",
      { anonymous: true },
      "n'a de sens qu'avec « allow »",
    ],
    [
      "anonymous: false sans allow",
      { anonymous: false },
      "n'a de sens qu'avec « allow »",
    ],
    [
      "anonymous non booléen",
      { allow: arrow, anonymous: "yes" },
      "« anonymous » doit être un booléen",
    ],
    [
      "allow non fonction",
      { allow: "user:*" },
      "« allow » doit être une fonction",
    ],
    [
      "anonymous: true contre authenticated: true",
      { allow: arrow, anonymous: true, authenticated: true },
      "contredit",
    ],
    [
      "classe sans @injectable",
      { allow: ForgottenAdmission },
      "ForgottenAdmission) sans @injectable",
    ],
    [
      "sous-classe non décorée",
      { allow: UndecoratedChild },
      "UndecoratedChild) sans @injectable",
    ],
    ["pas un objet", null, "n'est pas un objet"],
  ];

  for (const [label, policy, reason] of refused) {
    it(`refuse au démarrage — ${label} — en nommant la classe, le canal et le défaut`, () => {
      const ctor = ownerWith({ "chan:x": policy }, "BadCtrl");
      assert.throws(
        () => getChannelPoliciesOf(ctor),
        (error: unknown) =>
          error instanceof BootConfigurationError &&
          error.message.includes("BadCtrl") &&
          error.message.includes("« chan:x »") &&
          error.message.includes(reason),
      );
    });
  }

  it("admet chaque forme valide (flèche, fonction, classe @injectable, anonyme sur option)", () => {
    function plainRule(): boolean {
      return true;
    }
    const valid: IChannelPolicy[] = [
      { allow: arrow },
      { allow: plainRule },
      { allow: RoomAdmission, authenticated: true, roles: ["ROLE_USER"] },
      { allow: arrow, anonymous: true },
      { allow: arrow, anonymous: false, authenticated: true },
      { authenticated: true, scopes: ["orders:read"] },
    ];
    for (const policy of valid) assert.equal(channelPolicyDefect(policy), null);
    const ctor = ownerWith({ a: valid[0], b: valid[2] });
    assert.deepEqual(getChannelPoliciesOf(ctor), { a: valid[0], b: valid[2] });
  });

  it("une clé `undefined` explicite reste une clé : refusée si inconnue", () => {
    assert.match(
      channelPolicyDefect({ alow: undefined }) ?? "",
      /clé inconnue/,
    );
  });
});

describe("#622 — le décorateur garde une politique faite du seul `allow`", () => {
  it("`{ allow }` seul est STOCKÉ (l'oublier ouvrait le canal à tous)", () => {
    class Ctrl {
      @RealtimeChannel("user:*", { allow: arrow })
      user(): () => void {
        return () => {};
      }
    }
    assert.deepEqual(getChannelPoliciesOf(Ctrl), {
      "user:*": { allow: arrow },
    });
  });

  it("une politique fautive est gardée pour être REFUSÉE à la lecture, jamais effacée", () => {
    class Ctrl {
      // @ts-expect-error — clé inconnue : le typage la refuse, l'exécution aussi.
      @RealtimeChannel("orders", { role: ["ROLE_SALES"] })
      orders(): () => void {
        return () => {};
      }
    }
    assert.throws(() => getChannelPoliciesOf(Ctrl), /clé inconnue « role »/);
  });

  it("`{ anonymous: true }` seul n'est pas effacé : refusé à la lecture", () => {
    class Ctrl {
      @RealtimeChannel("lobby", { anonymous: true })
      lobby(): () => void {
        return () => {};
      }
    }
    assert.throws(
      () => getChannelPoliciesOf(Ctrl),
      /n'a de sens qu'avec « allow »/,
    );
  });

  it("une politique sans aucune clé définie n'est pas stockée (canal libre, 0 alloc)", () => {
    class Ctrl {
      @RealtimeChannel("free", { authenticated: undefined })
      free(): () => void {
        return () => {};
      }
    }
    assert.equal(getChannelPoliciesOf(Ctrl), null);
  });
});

describe("#622 — flèche ou classe : tranché par la métadonnée @injectable", () => {
  it("classe décorée → classe ; flèche, fonction, sous-classe non décorée → non", () => {
    assert.equal(isAdmissionClass(RoomAdmission), true);
    assert.equal(isAdmissionClass(arrow), false);
    assert.equal(
      isAdmissionClass(function rule() {
        return true;
      }),
      false,
    );
    assert.equal(isAdmissionClass(UndecoratedChild), false);
  });
});

describe("#622 — le hub précalcule la règle d'admission", () => {
  it("flèche : retenue telle quelle, sans enveloppe", () => {
    const hub = new RealtimeHub();
    hub.registerChannelPolicy("user:*", { allow: arrow });
    assert.equal(hub.resolveChannelAdmission("user:acc-1"), arrow);
  });

  it("sans allow, ou canal inconnu → null", () => {
    const hub = new RealtimeHub();
    hub.registerChannelPolicy("admin", { roles: ["ROLE_ADMIN"] });
    assert.equal(hub.resolveChannelAdmission("admin"), null);
    assert.equal(hub.resolveChannelAdmission("nowhere"), null);
  });

  it("classe : méthode liée UNE fois à son instance (`this` disponible dans allow)", () => {
    const hub = new RealtimeHub();
    const admission = new RoomAdmission();
    hub.registerChannelPolicy("room:*", { allow: RoomAdmission }, admission);
    const admit = hub.resolveChannelAdmission("room:1");
    assert.ok(admit !== null);
    assert.equal(admit("room:1", WHO), true);
    assert.equal(admit("lobby", WHO), false);
    assert.equal(
      hub.resolveChannelAdmission("room:2"),
      admit,
      "liée une fois, pas par appel",
    );
  });

  it("classe SANS instance → refus nommant canal et classe, et RIEN n'est inscrit", () => {
    const hub = new RealtimeHub();
    assert.throws(
      () => hub.registerChannelPolicy("room:*", { allow: RoomAdmission }),
      (error: unknown) =>
        error instanceof BootConfigurationError &&
        error.message.includes("« room:* »") &&
        error.message.includes("RoomAdmission"),
    );
    assert.equal(hub.resolveChannelPolicy("room:1"), null);
  });

  it("instance d'une AUTRE classe → refus", () => {
    const hub = new RealtimeHub();
    const other: IChannelAdmission = { allow: () => true };
    assert.throws(
      () =>
        hub.registerChannelPolicy("room:*", { allow: RoomAdmission }, other),
      BootConfigurationError,
    );
  });

  it("la règle suit la politique qui s'applique : nom exact > motif, même sans allow", () => {
    const hub = new RealtimeHub();
    const vip = (): boolean => true;
    hub.registerChannelPolicy("room:*", { allow: arrow });
    hub.registerChannelPolicy("room:vip", { allow: vip });
    hub.registerChannelPolicy("room:open", { authenticated: true });
    assert.equal(hub.resolveChannelAdmission("room:42"), arrow);
    assert.equal(hub.resolveChannelAdmission("room:vip"), vip);
    assert.equal(hub.resolveChannelAdmission("room:open"), null);
    assert.deepEqual(hub.resolveChannelPolicy("room:open"), {
      authenticated: true,
    });
  });

  it("hasExactChannelPolicy ignore les motifs", () => {
    const hub = new RealtimeHub();
    hub.registerChannelPolicy("orders:*", { authenticated: false });
    assert.equal(hub.hasExactChannelPolicy("orders:quote"), false);
    hub.registerChannelPolicy("orders:quote", { roles: ["ROLE_SALES"] });
    assert.equal(hub.hasExactChannelPolicy("orders:quote"), true);
  });

  it("clear() vide règles d'admission et propriétaires inscrits", () => {
    const hub = new RealtimeHub();
    const owner = ownerWith({ "user:*": { allow: arrow } });
    registerControllerPolicies(hub, owner, null);
    hub.clear();
    assert.equal(hub.resolveChannelAdmission("user:acc-1"), null);
    assert.equal(hub.hasPolicyOwner(owner), false);
  });
});

describe("#622 — inscription des politiques d'une classe", () => {
  it("une fois par classe : la seconde inscription ne relit rien", () => {
    const hub = new RealtimeHub();
    const owner = ownerWith({ "user:*": { allow: arrow } });
    registerControllerPolicies(hub, owner, null);
    assert.equal(hub.hasPolicyOwner(owner), true);
    Reflect.defineMetadata(POLICIES_KEY, { "user:*": { roles: ["X"] } }, owner);
    registerControllerPolicies(hub, owner, null);
    assert.equal(hub.resolveChannelAdmission("user:acc-1"), arrow);
  });

  it("un refus NE marque PAS la classe : refusée de nouveau, jamais laissée ouverte", () => {
    const hub = new RealtimeHub();
    const owner = ownerWith({ "user:*": { alow: arrow } });
    assert.throws(
      () => registerControllerPolicies(hub, owner, null),
      BootConfigurationError,
    );
    assert.equal(hub.hasPolicyOwner(owner), false);
    assert.throws(
      () => registerControllerPolicies(hub, owner, null),
      BootConfigurationError,
    );
  });

  it("`allow` posé sur une ACTION → refus (rien ne l'appliquerait)", () => {
    const hub = new RealtimeHub();
    const owner = ownerWith({ "orders:quote": { allow: arrow } }, "ActCtrl");
    Reflect.defineMetadata(ACTIONS_KEY, { "orders:quote": "quote" }, owner);
    assert.throws(
      () => registerControllerPolicies(hub, owner, null),
      (error: unknown) =>
        error instanceof BootConfigurationError &&
        error.message.includes("ActCtrl") &&
        error.message.includes("l'action « orders:quote »"),
    );
  });

  it("sans résolveur (poignée de main), une classe d'admission est REFUSÉE", () => {
    const hub = new RealtimeHub();
    const owner = ownerWith({ "room:*": { allow: RoomAdmission } });
    assert.throws(
      () => registerControllerPolicies(hub, owner, null),
      BootConfigurationError,
    );
    assert.equal(hub.resolveChannelPolicy("room:1"), null);
  });
});

describe("#622 — résolution des classes d'admission au démarrage", () => {
  afterEach(() => {
    // La clé apprise reste sinon d'un test à l'autre (registre process-global).
    Injector.rememberContainerKey(RoomAdmission, "roomAdmission");
  });

  it("réutilise l'instance du conteneur et journalise « canal X, admission Y, résolue »", () => {
    const shared = new RoomAdmission();
    Injector.rememberContainerKey(RoomAdmission, "roomAdmission");
    const logs: string[] = [];
    const resolve = createAdmissionResolver(
      (key) => (key === "roomAdmission" ? shared : undefined),
      (m) => logs.push(m),
    );
    assert.equal(resolve(RoomAdmission, "room:*"), shared);
    assert.deepEqual(logs, ["canal room:*, admission RoomAdmission, résolue"]);
  });

  it("absente du conteneur : construite UNE fois, partagée par tous ses canaux", () => {
    const logs: string[] = [];
    const resolve = createAdmissionResolver(
      () => undefined,
      (m) => logs.push(m),
    );
    const a = resolve(RoomAdmission, "room:*");
    const b = resolve(RoomAdmission, "suite:*");
    assert.ok(a instanceof RoomAdmission);
    assert.equal(a, b);
    assert.deepEqual(logs, [
      "canal room:*, admission RoomAdmission, résolue",
      "canal suite:*, admission RoomAdmission, résolue",
    ]);
  });

  for (const [Cls, scope] of [
    [TransientAdmission, "transient"],
    [RequestAdmission, "request"],
  ] as const) {
    it(`portée « ${scope} » refusée en nommant la classe et le canal`, () => {
      const resolve = createAdmissionResolver(
        () => undefined,
        () => {},
      );
      assert.throws(
        () => resolve(Cls, "room:*"),
        (error: unknown) =>
          error instanceof BootConfigurationError &&
          error.message.includes(Cls.name) &&
          error.message.includes("« room:* »") &&
          error.message.includes(`« ${scope} »`),
      );
    });
  }

  it("dépendance absente → refus nommant la classe, le canal ET la dépendance", () => {
    const resolve = createAdmissionResolver(
      () => undefined,
      () => {},
    );
    assert.throws(
      () => resolve(NeedsMissing, "org:*"),
      (error: unknown) =>
        error instanceof BootConfigurationError &&
        error.message.includes("NeedsMissing") &&
        error.message.includes("« org:* »") &&
        error.message.includes("serviceThatDoesNotExist622"),
    );
  });

  it("classe sans méthode allow → refus nommant la classe et le canal", () => {
    const resolve = createAdmissionResolver(
      () => undefined,
      () => {},
    );
    assert.throws(
      () => Reflect.apply(resolve, undefined, [NoAllowMethod, "x:*"]),
      (error: unknown) =>
        error instanceof BootConfigurationError &&
        error.message.includes("NoAllowMethod") &&
        error.message.includes("n'a pas de méthode allow"),
    );
  });
});

/** Contrôleur temps réel minimal, câblé comme l'est un vrai endpoint. */
function fakeCtx(closes: number[] = []) {
  return {
    type: "websocket",
    connection: {
      readyState: 1,
      send: (_d: string, cb?: () => void) => cb?.(),
      close: (code: number) => closes.push(code),
    },
    once: () => {},
    request: { headers: {}, url: "/" },
    cookies: {},
    url: "/",
    remoteAddress: "127.0.0.1",
    origin: "",
  };
}

describe("#622 — inscription au démarrage (onKernelReady) et à la poignée de main", () => {
  beforeEach(() => getRealtimeHub().clear());

  it("onKernelReady inscrit les contrôleurs temps réel connus et RÉSOUT leur classe d'admission", async () => {
    class BootCtrl extends RealtimeController {
      constructor(ctx: unknown) {
        super("boot-ctrl", ctx as ContextType);
      }
      @RealtimeChannel("room:*", { authenticated: true, allow: RoomAdmission })
      room(): () => void {
        return () => {};
      }
    }
    /** Classe étrangère au temps réel, même métadonnée : ignorée. */
    const foreign = ownerWith({ "foreign:x": { allow: arrow } }, "Foreign");
    const keys = ["test622:BootCtrl", "test622:Foreign"];
    Reflect.set(Module.controllers, keys[0]!, BootCtrl);
    Reflect.set(Module.controllers, keys[1]!, foreign);
    const logs: string[] = [];
    try {
      await Reflect.apply(
        Realtime.prototype.onKernelReady,
        {
          config: { enabled: true },
          kernel: { container: { get: () => undefined } },
          log: (m: string) => logs.push(m),
        },
        [],
      );
    } finally {
      for (const key of keys) Reflect.deleteProperty(Module.controllers, key);
    }
    const hub = getRealtimeHub();
    assert.equal(hub.hasPolicyOwner(BootCtrl), true);
    assert.equal(hub.resolveChannelAdmission("room:1")?.("room:1", WHO), true);
    assert.equal(hub.resolveChannelPolicy("foreign:x"), null);
    assert.deepEqual(logs, ["canal room:*, admission RoomAdmission, résolue"]);
  });

  it("module désactivé : aucune inscription", async () => {
    class OffCtrl extends RealtimeController {
      @RealtimeChannel("off", { allow: arrow })
      offChannel(): () => void {
        return () => {};
      }
    }
    Reflect.set(Module.controllers, "test622:OffCtrl", OffCtrl);
    try {
      await Reflect.apply(
        Realtime.prototype.onKernelReady,
        {
          config: { enabled: false },
          kernel: { container: { get: () => undefined } },
          log: () => {},
        },
        [],
      );
    } finally {
      Reflect.deleteProperty(Module.controllers, "test622:OffCtrl");
    }
    assert.equal(getRealtimeHub().resolveChannelPolicy("off"), null);
  });

  it("une classe échappée au démarrage s'inscrit à sa première poignée de main", async () => {
    class LateCtrl extends RealtimeController {
      constructor(ctx: unknown) {
        super("late-ctrl", ctx as ContextType);
      }
      @RealtimeChannel("user:*", { allow: arrow })
      userChannel(): () => void {
        return () => {};
      }
      feed(): void {
        this.handleRealtime(null);
      }
    }
    new LateCtrl(fakeCtx()).feed();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(getRealtimeHub().resolveChannelAdmission("user:acc-1"), arrow);
  });

  it("une classe d'admission échappée au démarrage fait ÉCHOUER la poignée de main (fail-closed, 1011)", async () => {
    class LateClassCtrl extends RealtimeController {
      constructor(ctx: unknown) {
        super("late-class-ctrl", ctx as ContextType);
      }
      @RealtimeChannel("room:*", { allow: RoomAdmission })
      room(): () => void {
        return () => {};
      }
      feed(): void {
        this.handleRealtime(null);
      }
    }
    const closes: number[] = [];
    new LateClassCtrl(fakeCtx(closes)).feed();
    // Poignée de main asynchrone : le refus ferme la connexion, il ne remonte pas.
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(closes, [1011]);
    assert.equal(getRealtimeHub().resolveChannelPolicy("room:1"), null);
    assert.equal(getRealtimeHub().hasPolicyOwner(LateClassCtrl), false);
  });

  it("un MOTIF de canal inscrit au démarrage ne retire pas son défaut fermé à une action", async () => {
    getRealtimeHub().registerChannelPolicy("orders:*", {
      authenticated: false,
    });
    class ActionCtrl extends RealtimeController {
      constructor(ctx: unknown) {
        super("action-ctrl", ctx as ContextType);
      }
      protected override realtimeActions(): Record<string, RpcActionHandler> {
        return { "orders:quote": () => 1 };
      }
      feed(): void {
        this.handleRealtime(null);
      }
    }
    new ActionCtrl(fakeCtx()).feed();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(
      getRealtimeHub().resolveChannelPolicy("orders:quote"),
      DEFAULT_ACTION_POLICY,
    );
  });
});
