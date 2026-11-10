import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BootConfigurationError,
  REALTIME_PRESENCE_METHOD,
  classifyNumberedChange,
  type RealtimePresenceFrame,
} from "nodefony";
import { createTestIdentity } from "@nodefony/security/testing";
import { RealtimeController } from "../../src/server/RealtimeController";
import { getRealtimeHub } from "../../src/server/RealtimeHub";
import { registerControllerPolicies } from "../../src/server/channelPolicyRegistry";
import {
  RealtimeChannel,
  RealtimeInbound,
  RealtimePolicy,
} from "../../decorators/realtimeDecorators";
import { createRealtimeHarness } from "../../testing/index";
import type { IRealtimeHarness } from "../../testing/index";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken";

/**
 * Présence LOCALE d'un canal (#760 lot C, ADR-0025 P2 bis, P3, P5) : la clé
 * `presence` de la politique, la trame `realtime:presence` (liste à chaque
 * abonnement, changements numérotés, fenêtre à front montant), le seuil des
 * noms, la grâce des départs, `hub.presence()`. Exercé au harnais, sur le vrai
 * contrôleur.
 */

@RealtimePolicy({
  "room:*": { presence: true },
  "hall:*": { presence: { maxNamed: 1 } },
  "crowd:*": { presence: { maxNamed: 0 } },
  "lobby:*": { presence: { grace: 1000 } },
})
class PresenceRt extends RealtimeController {
  constructor(ctx: ConstructorParameters<typeof RealtimeController>[1]) {
    super("PresenceRt", ctx);
  }
  override createRealtimeChannel(channel: string): (() => void) | null {
    return /^(room|hall|crowd|lobby|plain):/u.test(channel) ? () => {} : null;
  }
}

type Harness = IRealtimeHarness<PresenceRt>;

let open: Harness[] = [];

async function connect(
  identity: IRealtimeToken | undefined,
  first = false,
): Promise<Harness> {
  const h = createRealtimeHarness((ctx) => new PresenceRt(ctx), {
    ...(identity === undefined ? {} : { identity }),
    resetHub: first,
  });
  await h.connect();
  open.push(h);
  return h;
}

const user = (name: string, first = false): Promise<Harness> =>
  connect(createTestIdentity({ identifier: name }), first);

/** Appelant machine sans compte : identité `<émetteur>#<sujet>`, `account: false`. */
function machine(): IRealtimeToken {
  const token = createTestIdentity({ identifier: "svc" });
  const base = token.getIdentity?.();
  if (base === undefined) throw new Error("identité de test sans getIdentity");
  return Object.assign(Object.create(token) as IRealtimeToken, {
    getIdentity: () => ({
      ...base,
      id: "https://idp.test#svc",
      account: false,
    }),
  });
}

/** Vue reconstruite par un client qui applique la règle pure (`classifyNumberedChange`). */
interface IClientView {
  ref: number | null;
  members: Map<string, number>;
  count: number;
  unnamed: number;
  lists: number;
  deltas: number;
  gaps: number;
  named: boolean;
}

function presenceFrames(h: Harness, channel: string): RealtimePresenceFrame[] {
  const out: RealtimePresenceFrame[] = [];
  for (const f of h.received) {
    if (f.method !== REALTIME_PRESENCE_METHOD) continue;
    const p = f.params as RealtimePresenceFrame;
    if (p.channel === channel) out.push(p);
  }
  return out;
}

function pairs(
  flat: readonly (string | number)[],
  into: Map<string, number>,
): void {
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const id = flat[i];
    const tabs = flat[i + 1];
    if (typeof id === "string" && typeof tabs === "number") into.set(id, tabs);
  }
}

function replay(h: Harness, channel: string): IClientView {
  const v: IClientView = {
    ref: null,
    members: new Map(),
    count: 0,
    unnamed: 0,
    lists: 0,
    deltas: 0,
    gaps: 0,
    named: true,
  };
  for (const p of presenceFrames(h, channel)) {
    if (p.changes === undefined) {
      v.lists += 1;
      v.members = new Map();
      v.named = p.members !== undefined;
      if (p.members !== undefined) pairs(p.members, v.members);
      v.ref = p.version;
    } else {
      v.deltas += 1;
      const outcome = classifyNumberedChange(v.ref, p.version);
      if (outcome === "gap") v.gaps += 1;
      if (outcome !== "applied") continue;
      if (p.changes.set !== undefined) pairs(p.changes.set, v.members);
      for (const id of p.changes.gone ?? []) v.members.delete(id);
      v.ref = p.version;
    }
    v.count = p.count;
    v.unnamed = p.unnamed;
  }
  return v;
}

const asObject = (m: ReadonlyMap<string, number>): Record<string, number> =>
  Object.fromEntries([...m].sort(([a], [b]) => a.localeCompare(b)));

/** Attend un FAIT (jamais une durée) : la vue cliente converge. */
async function converges(
  h: Harness,
  channel: string,
  expected: Record<string, number>,
  unnamed = 0,
): Promise<IClientView> {
  await vi.waitFor(
    () => {
      const v = replay(h, channel);
      expect(asObject(v.members)).to.deep.equal(expected);
      expect(v.unnamed).toBe(unnamed);
    },
    { timeout: 2000, interval: 10 },
  );
  return replay(h, channel);
}

afterEach(() => {
  vi.useRealTimers();
  for (const h of open) h.close();
  open = [];
  getRealtimeHub().clear();
});

describe("#760 lot C — la clé `presence` de la politique", () => {
  it("🔴 posée sur une ÉCRITURE seule (@RealtimeInbound) : démarrage refusé, canal nommé", () => {
    class WriteOnly extends RealtimeController {
      @RealtimeInbound("chat:typing", { presence: true })
      onTyping(): void {}
    }
    expect(() =>
      registerControllerPolicies(getRealtimeHub(), WriteOnly, null),
    ).toThrow(/chat:typing.*ÉCRITURE/su);
  });

  it("🔴 option inconnue ou valeur illisible : refusée en la nommant", () => {
    class Typo extends RealtimeController {
      @RealtimeChannel("room:1", { presence: { graec: 10 } as never })
      room(): () => void {
        return () => {};
      }
    }
    expect(() =>
      registerControllerPolicies(getRealtimeHub(), Typo, null),
    ).toThrow(/option inconnue « graec »/u);
    expect(() =>
      getRealtimeHub().registerChannelPolicy("room:2", {
        presence: { grace: -1 },
      }),
    ).toThrow(BootConfigurationError);
  });

  it("🔴 canal réservé de la plateforme : refusé", () => {
    expect(() =>
      getRealtimeHub().registerChannelPolicy("nodefony:presence-test", {
        presence: true,
      }),
    ).toThrow(/réservé/u);
  });

  it("🔴 deux classes qui ne diffèrent QUE par la présence : refusé (une seule s'appliquerait)", () => {
    class A extends RealtimeController {
      @RealtimeChannel("room:dup", { authenticated: true, presence: true })
      room(): () => void {
        return () => {};
      }
    }
    class B extends RealtimeController {
      @RealtimeChannel("room:dup", { authenticated: true })
      room(): () => void {
        return () => {};
      }
    }
    const hub = getRealtimeHub();
    registerControllerPolicies(hub, A, null);
    expect(() => registerControllerPolicies(hub, B, null)).toThrow(
      /politiques de LECTURE différentes/u,
    );
  });

  it("canal sans présence : aucune trame, aucune structure, `hub.presence()` rend null", async () => {
    const a = await user("alice", true);
    await a.subscribe("plain:1");
    expect(presenceFrames(a, "plain:1")).to.deep.equal([]);
    expect(getRealtimeHub().presence("plain:1")).toBe(null);
    expect(getRealtimeHub().probe().presence?.channels).toBe(0);
  });
});

describe("#760 lot C — présence locale", () => {
  it("deux comptes : chacun voit l'autre, sans trou ; `hub.presence()` les nomme", async () => {
    const a = await user("alice", true);
    const b = await user("bob");
    await a.subscribe("room:1");
    await b.subscribe("room:1");
    const va = await converges(a, "room:1", { alice: 1, bob: 1 });
    const vb = await converges(b, "room:1", { alice: 1, bob: 1 });
    expect(va.gaps + vb.gaps).toBe(0);
    expect(va.count).toBe(2);
    const view = getRealtimeHub().presence("room:1");
    expect(view?.count).toBe(2);
    expect(view?.members.get("bob")).to.deep.equal({ tabs: 1 });
    expect(view?.partial).toBe(false);
  });

  it("une identité dans deux onglets compte pour UN présent (`tabs: 2`)", async () => {
    const a1 = await user("alice", true);
    const a2 = await user("alice");
    await a1.subscribe("room:1");
    await a2.subscribe("room:1");
    const v = await converges(a1, "room:1", { alice: 2 });
    expect(v.count).toBe(1);
    await a2.unsubscribe("room:1");
    await converges(a1, "room:1", { alice: 1 });
  });

  it("🔴 l'anonyme et l'appelant machine sont comptés dans `unnamed`, jamais nommés", async () => {
    const a = await user("alice", true);
    await connect(undefined).then((h) => h.subscribe("room:1"));
    await connect(machine()).then((h) => h.subscribe("room:1"));
    await a.subscribe("room:1");
    const v = await converges(a, "room:1", { alice: 1 }, 2);
    expect(v.count).toBe(1);
    expect([
      ...(getRealtimeHub().presence("room:1")?.members.keys() ?? []),
    ]).to.deep.equal(["alice"]);
  });

  it("un départ — désabonnement OU socket fermée — sort de la vue des autres", async () => {
    const a = await user("alice", true);
    const b = await user("bob");
    const c = await user("carol");
    for (const h of [a, b, c]) await h.subscribe("room:1");
    await converges(a, "room:1", { alice: 1, bob: 1, carol: 1 });
    await b.unsubscribe("room:1");
    await converges(a, "room:1", { alice: 1, carol: 1 });
    c.close();
    const v = await converges(a, "room:1", { alice: 1 });
    expect(v.gaps).toBe(0);
  });

  it("🔴 chaque (re-)subscribe reçoit la liste — aucune borne serveur (S-rt-103)", async () => {
    const a = await user("alice", true);
    await a.subscribe("room:1");
    await a.subscribe("room:1");
    await a.subscribe("room:1");
    expect(replay(a, "room:1").lists).toBe(3);
  });

  it("🔴 250 abonnés successifs : 0 trou chez les déjà présents, la liste construite au plus une fois par envoi", async () => {
    const first = await user("u0", true);
    await first.subscribe("room:big");
    const expected: Record<string, number> = { u0: 1 };
    for (let i = 1; i < 250; i++) {
      const h = await user(`u${i}`);
      await h.subscribe("room:big");
      expected[`u${i}`] = 1;
    }
    const v = await converges(first, "room:big", expected);
    expect(v.gaps).toBe(0);
    expect(v.lists).toBe(1);
    for (const h of open) expect(replay(h, "room:big").gaps).toBe(0);
    const probe = getRealtimeHub().probe().presence;
    expect(probe?.listTotal).toBe(250);
    expect(probe?.listBuiltTotal).toBeLessThanOrEqual(
      (probe?.frameTotal ?? 0) + 1,
    );
  });

  it("au-delà de `maxNamed` : nombres seuls ; revenu dessous : la liste, à tous", async () => {
    const a = await user("alice", true);
    const b = await user("bob");
    await a.subscribe("hall:1");
    await converges(a, "hall:1", { alice: 1 });
    await b.subscribe("hall:1");
    await vi.waitFor(() => {
      const v = replay(a, "hall:1");
      expect(v.named).toBe(false);
      expect(v.count).toBe(2);
    });
    expect(asObject(replay(a, "hall:1").members)).to.deep.equal({});
    await b.unsubscribe("hall:1");
    const v = await converges(a, "hall:1", { alice: 1 });
    expect(v.named).toBe(true);
    expect(getRealtimeHub().presence("hall:1")?.count).toBe(1);
  });

  it("`maxNamed: 0` : présents comptés, jamais nommés — `hub.presence()` les nomme quand même", async () => {
    const a = await user("alice", true);
    await a.subscribe("crowd:1");
    await vi.waitFor(() => expect(replay(a, "crowd:1").count).toBe(1));
    for (const p of presenceFrames(a, "crowd:1")) {
      expect(p.members).toBe(undefined);
      expect(p.changes).toBe(undefined);
    }
    expect(getRealtimeHub().presence("crowd:1")?.members.has("alice")).toBe(
      true,
    );
  });
});

describe("#760 lot C — fenêtre et grâce (horloge simulée)", () => {
  const fake = (): void => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout", "performance"],
    });
  };

  it("🔴 front montant : le 1er changement d'un canal calme part tout de suite, les suivants attendent la fin de la fenêtre", async () => {
    fake();
    const a = await user("alice", true);
    const b = await user("bob");
    const c = await user("carol");
    await a.subscribe("room:w");
    await converges(a, "room:w", { alice: 1 });
    vi.advanceTimersByTime(1000); // fenêtre close : le canal est calme
    const before = replay(a, "room:w").deltas;
    await b.subscribe("room:w");
    expect(replay(a, "room:w").deltas).toBe(before + 1); // immédiat
    await c.subscribe("room:w");
    expect(asObject(replay(a, "room:w").members)).to.deep.equal({
      alice: 1,
      bob: 1,
    }); // carol retenue par la fenêtre
    vi.advanceTimersByTime(260);
    expect(asObject(replay(a, "room:w").members)).to.deep.equal({
      alice: 1,
      bob: 1,
      carol: 1,
    });
  });

  it("🔴 ≤ 5 trames de présence par seconde et par client, quel que soit le mouvement", async () => {
    fake();
    const a = await user("alice", true);
    const b = await user("bob");
    await a.subscribe("room:storm");
    await converges(a, "room:storm", { alice: 1 });
    vi.advanceTimersByTime(1000);
    const before = replay(a, "room:storm").deltas;
    const start = performance.now();
    for (let i = 0; i < 40; i++) {
      await b.subscribe("room:storm");
      await b.unsubscribe("room:storm");
      vi.advanceTimersByTime(25); // 40 × 25 ms = 1 s
    }
    const sent = replay(a, "room:storm").deltas - before;
    // L'horloge simulée avance AUSSI au rythme réel (`shouldAdvanceTime`) :
    // la borne se calcule sur le temps simulé ÉCOULÉ, jamais sur « 1 s » supposée.
    const seconds = (performance.now() - start) / 1000;
    expect(sent).toBeGreaterThanOrEqual(3); // le mouvement est bien publié…
    expect(sent).toBeLessThanOrEqual(Math.ceil(5 * seconds)); // …à 5/s au plus
  });

  it("🔴 grâce : un retour dans le délai ne publie RIEN ; une absence au-delà publie le départ", async () => {
    fake();
    const a = await user("alice", true);
    const b = await user("bob");
    await a.subscribe("lobby:1");
    await b.subscribe("lobby:1");
    await converges(a, "lobby:1", { alice: 1, bob: 1 });
    vi.advanceTimersByTime(1000);
    const before = replay(a, "lobby:1").deltas;
    await b.unsubscribe("lobby:1");
    vi.advanceTimersByTime(500);
    await b.subscribe("lobby:1");
    vi.advanceTimersByTime(2000);
    expect(replay(a, "lobby:1").deltas).toBe(before); // rechargement : aucun clignotement
    await b.unsubscribe("lobby:1");
    vi.advanceTimersByTime(900);
    expect(replay(a, "lobby:1").members.has("bob")).toBe(true);
    vi.advanceTimersByTime(400);
    expect(asObject(replay(a, "lobby:1").members)).to.deep.equal({ alice: 1 });
  });
});
