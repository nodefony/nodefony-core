import { afterEach, describe, expect, it } from "vitest";
import { PLATFORM_BUS_CHANNELS, PLATFORM_BUS_PREFIX } from "nodefony";
import type { IBackplaneInfo } from "nodefony";
import { RealtimeController } from "../../src/server/RealtimeController";
import { RealtimeHub, getRealtimeHub } from "../../src/server/RealtimeHub";
import { createRealtimeHarness } from "../../testing/index";
import type { IRealtimeHarness } from "../../testing/index";
import { createTestIdentity } from "@nodefony/security/testing";
import type { BackplaneHandler, IBackplane } from "../../interfaces/IBackplane";
import {
  MAX_CONTROL_FIELD_LENGTH,
  readControlOrder,
} from "../../src/backplane/controlOrder";

/**
 * #623 lot 2 — terminer un canal et éjecter un compte TRAVERSENT les pods
 * (ADR-0022 §6 décision 4). Pod A = le hub du harnais, qui tient les vraies
 * connexions ; pod B = un second hub, relié à A par un bus en mémoire. L'ordre
 * donné sur B doit atteindre les membres servis par A.
 */

let disposed: string[] = [];

class RoomRt extends RealtimeController {
  constructor(ctx: ConstructorParameters<typeof RealtimeController>[1]) {
    super("RoomRt", ctx);
  }
  override createRealtimeChannel(channel: string): (() => void) | null {
    if (!channel.startsWith("room:")) return null;
    return () => {
      disposed.push(channel);
    };
  }
}

type Harness = IRealtimeHarness<RoomRt>;

/** Messages publiés sur le bus, côté émetteur — pour voir ce qui part (ou pas). */
let wire: { channel: string; payload: unknown }[] = [];

/** Bus en mémoire entre deux hubs : chaque publication est rendue à l'AUTRE extrémité. */
function busPair(): [IBackplane, IBackplane] {
  const handlers: (BackplaneHandler | null)[] = [null, null];
  const end = (me: 0 | 1): IBackplane => ({
    originId: `pod-${me}`,
    start: () => {},
    stop: () => {},
    publish: (channel, payload) => {
      wire.push({ channel, payload });
      handlers[me === 0 ? 1 : 0]?.({ channel, payload, originId: `pod-${me}` });
    },
    onMessage: (h) => {
      handlers[me] = h;
    },
    describe: (): IBackplaneInfo => ({
      driver: "test-bus",
      kind: "memory",
      originId: `pod-${me}`,
      crossPod: true,
    }),
  });
  return [end(0), end(1)];
}

let open: Harness[] = [];

async function tab(user: string, first = false): Promise<Harness> {
  const h = createRealtimeHarness((ctx) => new RoomRt(ctx), {
    identity: createTestIdentity({ identifier: user }),
    resetHub: first,
  });
  await h.connect();
  open.push(h);
  return h;
}

/** Deux pods reliés ; A tient les connexions du harnais. */
function pods(): { a: RealtimeHub; b: RealtimeHub; inject: BackplaneHandler } {
  const a = getRealtimeHub();
  const b = new RealtimeHub();
  const [busA, busB] = busPair();
  let toA: BackplaneHandler | null = null;
  // Capte le handler d'entrée de A pour y injecter un message « venu du bus ».
  const tapped: IBackplane = {
    ...busA,
    onMessage: (h) => {
      toA = h;
      busA.onMessage(h);
    },
  };
  a.setBackplane(tapped);
  b.setBackplane(busB);
  return {
    a,
    b,
    inject: (msg) => {
      toA?.(msg);
    },
  };
}

const closedOf = (h: Harness): unknown[] =>
  h.received.filter((f) => f.method === "realtime:closed").map((f) => f.params);

afterEach(() => {
  for (const h of open) h.close();
  open = [];
  disposed = [];
  wire = [];
  getRealtimeHub().clear();
});

describe("#623 lot 2 — les ordres par NOM traversent les pods", () => {
  it("terminer un canal sur B : les membres servis par A reçoivent ended, le producteur de A est libéré", async () => {
    const alice = await tab("alice", true);
    const bob = await tab("bob");
    await alice.subscribe("room:1");
    await bob.subscribe("room:1");
    const { a, b } = pods();

    expect(b.closeChannel("room:1")).toBe(0); // aucun membre sur B
    for (const h of [alice, bob])
      expect(closedOf(h)).to.deep.equal([
        { channel: "room:1", reason: "ended" },
      ]);
    expect(disposed).to.deep.equal(["room:1"]);
    expect(a.channelMembers("room:1")).to.deep.equal([]);
    expect(a.probe().ingressRejectedTotal).toBe(0);
  });

  it("éjecter un compte sur B : TOUS ses onglets servis par A sortent, les autres restent", async () => {
    const tab1 = await tab("alice", true);
    const tab2 = await tab("alice");
    const bob = await tab("bob");
    for (const h of [tab1, tab2, bob]) await h.subscribe("room:1");
    const { a, b } = pods();

    expect(b.evictUser("room:1", "alice")).toBe(0);
    for (const h of [tab1, tab2])
      expect(closedOf(h)).to.deep.equal([
        { channel: "room:1", reason: "evicted" },
      ]);
    expect(closedOf(bob)).to.deep.equal([]);
    expect(a.channelMembers("room:1").map((c) => c.userId)).to.deep.equal([
      "bob",
    ]);
    a.publish("room:1", { n: 1 });
    expect(bob.messages("room:1")).to.have.length(1);
    expect(tab1.messages("room:1")).to.have.length(0);
  });

  it("le pod qui donne l'ordre l'applique aussi à SES membres, et le compte", async () => {
    const tab1 = await tab("alice", true);
    const tab2 = await tab("alice");
    for (const h of [tab1, tab2]) await h.subscribe("room:1");
    const { a } = pods();
    expect(a.evictUser("room:1", "alice")).toBe(2);
    expect(a.closeChannel("room:1")).toBe(0);
  });

  it("l'ordre part UNE fois sur le canal de contrôle, dans la charge, sans champ neuf dans l'enveloppe", async () => {
    await tab("alice", true);
    const { b } = pods();
    b.evictUser("room:1", "alice");
    b.closeChannel("room:2");
    expect(wire).to.deep.equal([
      {
        channel: PLATFORM_BUS_CHANNELS.control,
        payload: { op: "evictUser", channel: "room:1", user: "alice" },
      },
      {
        channel: PLATFORM_BUS_CHANNELS.control,
        payload: { op: "close", channel: "room:2" },
      },
    ]);
  });

  it("le canal de contrôle n'est jamais diffusé aux abonnés locaux", async () => {
    await tab("alice", true);
    const { a, b } = pods();
    const heard: unknown[] = [];
    a.listen(PLATFORM_BUS_CHANNELS.control, (p) => heard.push(p));
    b.closeChannel("room:1");
    expect(heard).to.deep.equal([]);
  });

  it("un canal de la plateforme reste local : rien ne part sur le bus", async () => {
    await tab("alice", true);
    const { b } = pods();
    b.closeChannel("nodefony:socket");
    b.evictUser("nodefony:audit", "alice");
    expect(wire).to.deep.equal([]);
  });

  it("sans bus, terminer et éjecter restent locaux et ne lèvent rien", async () => {
    const alice = await tab("alice", true);
    await alice.subscribe("room:1");
    expect(getRealtimeHub().evictUser("room:1", "alice")).toBe(1);
    expect(getRealtimeHub().closeChannel("room:1")).toBe(0);
  });

  it("sens négatif : un compte vide ou trop long n'éjecte rien et ne part pas", async () => {
    const alice = await tab("alice", true);
    await alice.subscribe("room:1");
    const { a } = pods();
    expect(a.evictUser("room:1", "")).toBe(0);
    expect(
      a.evictUser("room:1", "x".repeat(MAX_CONTROL_FIELD_LENGTH + 1)),
    ).toBe(0);
    expect(wire).to.deep.equal([]);
    expect(closedOf(alice)).to.deep.equal([]);
  });
});

describe("#623 lot 2 — 🔴 l'entrée du canal de contrôle : liste fermée, comptée", () => {
  const control = PLATFORM_BUS_CHANNELS.control;

  it.each([
    ["charge nulle", null],
    ["type d'ordre non textuel", { op: 7, channel: "room:1" }],
    ["type d'ordre vide", { op: "", channel: "room:1" }],
    ["ordre sans canal", { op: "close" }],
    ["canal vide", { op: "close", channel: "" }],
    ["éjection sans compte", { op: "evictUser", channel: "room:1" }],
    ["compte non textuel", { op: "evictUser", channel: "room:1", user: 42 }],
    [
      "génération négative",
      { op: "evictUser", channel: "room:1", user: "alice", generation: -1 },
    ],
    [
      "génération non entière",
      { op: "evictUser", channel: "room:1", user: "alice", generation: 1.5 },
    ],
    [
      "génération textuelle",
      { op: "evictUser", channel: "room:1", user: "alice", generation: "1" },
    ],
    ["canal de la plateforme", { op: "close", channel: "nodefony:socket" }],
  ])("%s → rejeté, compté, rien d'appliqué", async (_label, payload) => {
    const alice = await tab("alice", true);
    await alice.subscribe("room:1");
    const { a, inject } = pods();
    inject({ channel: control, payload, originId: "intrus" });
    expect(a.probe().ingressRejectedTotal).toBe(1);
    expect(closedOf(alice)).to.deep.equal([]);
    expect(a.channelMembers("room:1")).to.have.length(1);
  });

  it("une charge dont le PROTOTYPE porte l'ordre ne passe pas (champs propres seulement)", async () => {
    const alice = await tab("alice", true);
    await alice.subscribe("room:1");
    const { a, inject } = pods();
    const payload: unknown = Object.create({ op: "close", channel: "room:1" });
    inject({ channel: control, payload, originId: "intrus" });
    expect(a.probe().ingressRejectedTotal).toBe(1);
    expect(closedOf(alice)).to.deep.equal([]);
  });

  it("la génération RÉSERVÉE est acceptée et ignorée : toutes les générations sont éjectées", async () => {
    const alice = await tab("alice", true);
    await alice.subscribe("room:1");
    const { a, inject } = pods();
    inject({
      channel: control,
      payload: {
        op: "evictUser",
        channel: "room:1",
        user: "alice",
        generation: 7,
      },
      originId: "pod-1",
    });
    expect(a.probe().ingressRejectedTotal).toBe(0);
    expect(closedOf(alice)).to.deep.equal([
      { channel: "room:1", reason: "evicted" },
    ]);
  });

  it("un champ inconnu est toléré — une version suivante peut en ajouter sans faire refuser ses ordres", async () => {
    const alice = await tab("alice", true);
    await alice.subscribe("room:1");
    const { a, inject } = pods();
    inject({
      channel: control,
      payload: { op: "close", channel: "room:1", reason: "fin de partie" },
      originId: "pod-1",
    });
    expect(a.probe().ingressRejectedTotal).toBe(0);
    expect(closedOf(alice)).to.deep.equal([
      { channel: "room:1", reason: "ended" },
    ]);
  });

  it("la garde rend l'ordre lu, et rien d'autre", () => {
    expect(
      readControlOrder({ op: "close", channel: "room:1", extra: true }),
    ).to.deep.equal({ op: "close", channel: "room:1" });
    expect(
      readControlOrder({
        op: "evictUser",
        channel: "r",
        user: "u",
        generation: 0,
      }),
    ).to.deep.equal({
      op: "evictUser",
      channel: "r",
      user: "u",
      generation: 0,
    });
    expect(
      readControlOrder({
        op: "close",
        channel: "x".repeat(MAX_CONTROL_FIELD_LENGTH),
      }),
    ).not.toBe(null);
    expect(
      readControlOrder({
        op: "close",
        channel: "x".repeat(MAX_CONTROL_FIELD_LENGTH + 1),
      }),
    ).toBe(null);
  });
});

describe("#761 — un message de bus d'une version plus récente : jeté, compté À PART, jamais comme une injection", () => {
  const control = PLATFORM_BUS_CHANNELS.control;
  // Ce qu'une version 10.x ajoutera au bus (présence répartie, ADR-0025).
  const newerChannel = `${PLATFORM_BUS_PREFIX}zq-presence`;

  it("canal `nodefony:bus:*` inconnu : compteur à part, injection intacte, aucun abonné servi", async () => {
    const alice = await tab("alice", true);
    await alice.subscribe("room:1");
    const { a, inject } = pods();
    const fanout = a.probe().fanoutTotal;
    const frames = alice.received.length;
    inject({
      channel: newerChannel,
      payload: { room: "room:1" },
      originId: "pod-1",
    });
    const p = a.probe();
    expect(p.ingressUnknownDiscardedTotal).toBe(1);
    expect(p.ingressRejectedTotal).toBe(0);
    expect(p.fanoutTotal).toBe(fanout);
    expect(alice.received).to.have.length(frames);
  });

  it.each([
    ["ordre bien formé", { op: "inconnu", channel: "room:1" }],
    [
      "ordre qui admettrait",
      { op: "subscribe", channel: "room:1", user: "alice" },
    ],
    ["ordre sans canal", { op: "presence" }],
  ])(
    "type d'ordre inconnu (%s) : compteur à part, injection intacte, rien d'appliqué",
    async (_label, payload) => {
      const alice = await tab("alice", true);
      await alice.subscribe("room:1");
      const { a, inject } = pods();
      inject({ channel: control, payload, originId: "pod-1" });
      const p = a.probe();
      expect(p.ingressUnknownDiscardedTotal).toBe(1);
      expect(p.ingressRejectedTotal).toBe(0);
      expect(closedOf(alice)).to.deep.equal([]);
      expect(a.channelMembers("room:1")).to.have.length(1);
    },
  );

  it("le journal parle UNE fois par motif, pas une ligne par message, sans recopier le nom reçu", () => {
    const { a, inject } = pods();
    const notices: { message: string; severity: string }[] = [];
    a.onPlatformNotice((message, severity) =>
      notices.push({ message, severity }),
    );
    for (let i = 0; i < 5; i += 1) {
      inject({ channel: newerChannel, payload: i, originId: "pod-1" });
      inject({
        channel: control,
        payload: { op: "zq-op", channel: "room:1" },
        originId: "pod-1",
      });
    }
    expect(a.probe().ingressUnknownDiscardedTotal).toBe(10);
    expect(notices).to.have.length(2);
    for (const n of notices) {
      expect(n.severity).toBe("INFO");
      expect(n.message).toContain("ingressUnknownDiscardedTotal");
      expect(n.message).not.toContain("zq-");
    }
  });

  it("ce qui reste suspect reste une injection : canal de la plateforme hors du bus, variante de casse du bus", () => {
    const { a, inject } = pods();
    inject({ channel: "nodefony:socket", payload: {}, originId: "pod-1" });
    inject({
      channel: newerChannel.toUpperCase(),
      payload: {},
      originId: "pod-1",
    });
    const p = a.probe();
    expect(p.ingressRejectedTotal).toBe(2);
    expect(p.ingressUnknownDiscardedTotal).toBe(0);
  });

  it("clear() remet le compteur à zéro", () => {
    const { a, inject } = pods();
    inject({ channel: newerChannel, payload: {}, originId: "pod-1" });
    expect(a.probe().ingressUnknownDiscardedTotal).toBe(1);
    a.clear();
    expect(a.probe().ingressUnknownDiscardedTotal).toBe(0);
  });
});
