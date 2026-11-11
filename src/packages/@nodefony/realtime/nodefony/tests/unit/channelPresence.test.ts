import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BootConfigurationError,
  isPresenceFrame,
  PresenceView,
  REALTIME_PRESENCE_METHOD,
  type IPresenceEntry,
  type RealtimePresenceFrame,
} from "nodefony";
import { createTestIdentity } from "@nodefony/security/testing";
import { RealtimeController } from "../../src/server/RealtimeController";
import { getRealtimeHub } from "../../src/server/RealtimeHub";
import { registerControllerPolicies } from "../../src/server/channelPolicyRegistry";
import { ChannelPresence } from "../../src/server/channelPresence";
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

/** Vue du canal telle que le NAVIGATEUR la tient — la vue pure du cœur (`PresenceView`), plus les compteurs du banc. */
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

/** Trames de présence d'un canal reçues par `h`, passées au lecteur du cœur : une trame qu'il refuse est un défaut du serveur. */
function presenceFrames(h: Harness, channel: string): RealtimePresenceFrame[] {
  const out: RealtimePresenceFrame[] = [];
  for (const f of h.received) {
    if (f.method !== REALTIME_PRESENCE_METHOD) continue;
    const p = f.params;
    if (!isPresenceFrame(p))
      throw new Error(
        `trame de présence refusée par le lecteur : ${JSON.stringify(p)}`,
      );
    if (p.channel === channel) out.push(p);
  }
  return out;
}

/** Rejoue les trames reçues sur la vue du cœur — exactement ce que fait `NodefonySocket`. */
function replay(h: Harness, channel: string): IClientView {
  const view = new PresenceView(channel);
  let lists = 0;
  let deltas = 0;
  let gaps = 0;
  let named = true;
  for (const p of presenceFrames(h, channel)) {
    if (p.changes === undefined) {
      lists += 1;
      named = p.members !== undefined;
    } else deltas += 1;
    if (view.apply(p) === "gap") gaps += 1;
  }
  const snap = view.snapshot();
  const members = new Map<string, number>();
  for (const [id, entry] of snap.members) members.set(id, entry.tabs);
  return {
    ref: view.reference,
    members,
    count: snap.count,
    unnamed: snap.unnamed,
    lists,
    deltas,
    gaps,
    named,
  };
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

  it("🔴 isomorphe : la vue du navigateur (lecteur et vue du cœur) ÉGALE `hub.presence()`, à chaque étape", async () => {
    const byId = (
      m: ReadonlyMap<string, IPresenceEntry>,
    ): [string, IPresenceEntry][] =>
      [...m].sort(([x], [y]) => x.localeCompare(y));
    const sameAsServer = (h: Harness, channel: string): void => {
      const browser = new PresenceView(channel);
      for (const p of presenceFrames(h, channel)) browser.apply(p);
      const client = browser.snapshot();
      const server = getRealtimeHub().presence(channel);
      if (server === null) throw new Error("canal sans présence");
      expect({
        ready: client.ready,
        count: client.count,
        unnamed: client.unnamed,
        partial: client.partial,
        members: byId(client.members),
      }).to.deep.equal({
        ready: true,
        count: server.count,
        unnamed: server.unnamed,
        partial: server.partial,
        members: byId(server.members),
      });
    };
    const a = await user("alice", true);
    await a.subscribe("room:iso");
    await converges(a, "room:iso", { alice: 1 });
    sameAsServer(a, "room:iso");
    const bob1 = await user("bob");
    const bob2 = await user("bob");
    const carol = await user("carol");
    for (const h of [bob1, bob2, carol]) await h.subscribe("room:iso");
    await converges(a, "room:iso", { alice: 1, bob: 2, carol: 1 });
    sameAsServer(a, "room:iso");
    await bob1.unsubscribe("room:iso");
    carol.close();
    await converges(a, "room:iso", { alice: 1, bob: 1 });
    sameAsServer(a, "room:iso");
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

describe("#760 lot C — état pur `ChannelPresence` (départs en masse)", () => {
  it("🔴 2 000 départs en grâce : échéance lue en tête, UNE trame qui les nomme tous à l'échéance", () => {
    const p = new ChannelPresence("room:mass", { grace: 1000, maxNamed: 5000 });
    for (let i = 0; i < 2000; i++) p.join(`u${i}`);
    for (let i = 0; i < 3000; i++) p.join(null);
    p.takeChanges();
    for (let i = 0; i < 2000; i++) p.leave(`u${i}`, i); // échéances 1000…2999
    for (let i = 0; i < 3000; i++) p.leave(null, i);
    expect(p.nextDeadline()).toBe(1000);
    expect(p.dirty).toBe(false); // rien de publié pendant la grâce
    p.expire(1499);
    expect(p.nextDeadline()).toBe(1500);
    expect(p.view().unnamed).toBe(3000 - 500);
    p.expire(10_000);
    expect(p.nextDeadline()).toBe(Infinity);
    const frame = p.takeChanges();
    expect(frame?.changes?.gone?.length).toBe(2000); // aucun envoi entre les deux échéances
    expect(frame?.count).toBe(0);
    expect(frame?.unnamed).toBe(0);
    expect(p.takeChanges()).toBe(null);
  });

  it("🔴 salon AU seuil (S-rt-87) : osciller autour de `maxNamed` n'envoie pas la liste à chaque retour — elle revient sous `maxNamed − ⌊maxNamed / 10⌋` seulement", () => {
    const p = new ChannelPresence("room:edge", { grace: 0, maxNamed: 10 });
    for (let i = 0; i < 10; i++) p.join(`u${i}`);
    p.takeChanges();
    let lists = 0;
    let counts = 0;
    let changes = 0;
    const send = (): void => {
      const f = p.takeChanges();
      if (f === null) return;
      if (f.changes !== undefined) changes++;
      else if (f.members !== undefined) lists++;
      else counts++;
    };
    // 11 ↔ 10 pendant 50 fenêtres : au-dessus du seuil puis à la limite.
    for (let w = 0; w < 50; w++) {
      p.join("x");
      send();
      p.leave("x", 0);
      send();
    }
    expect(lists, "aucune liste nommée pendant l'oscillation").toBe(0);
    expect(counts).toBe(100);
    expect(
      p.listParams(),
      "un nouvel abonné reçoit les nombres, comme les autres",
    ).not.to.have.property("members");
    // 9 = 10 − ⌊10 / 10⌋ : la liste, une fois, à tous.
    p.leave("u0", 0);
    send();
    expect(lists).toBe(1);
    expect(p.listParams()).to.have.property("members");
    // Revenu à 10 (pas AU-DESSUS du seuil) : on reste nommé, par changements.
    p.join("u0");
    send();
    expect(changes).toBe(1);
    expect(lists).toBe(1);
  });

  it("une liste porte la version COURANTE ; seuls les changements la font avancer", () => {
    const p = new ChannelPresence("room:v", { grace: 0, maxNamed: 10 });
    p.join("a");
    expect(p.listParams().version).toBe(0);
    expect(p.takeChanges()?.version).toBe(1);
    expect(p.listParams()).to.deep.equal({
      channel: "room:v",
      version: 1,
      count: 1,
      unnamed: 0,
      members: ["a", 1],
    });
  });
});
