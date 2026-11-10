import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLATFORM_BUS_CHANNELS,
  REALTIME_PRESENCE_METHOD,
  classifyNumberedChange,
  type RealtimePresenceFrame,
} from "nodefony";
import { RealtimeConnection } from "../../src/server/RealtimeConnection";
import { RealtimeHub } from "../../src/server/RealtimeHub";
import type { ChannelFrame, ChannelSink } from "../../src/server/RealtimeHub";
import type { BackplaneHandler, IBackplane } from "../../interfaces/IBackplane";
import { PRESENCE_WINDOW_MS } from "../../src/server/channelPresence";
import {
  PRESENCE_BATCH_MS,
  PRESENCE_FORGET_FACTOR,
  PRESENCE_INTERVAL_MS,
} from "../../src/server/presenceBus";

/**
 * Présence RÉPARTIE d'un canal (#760 lot D2, ADR-0025 P2) : deux hubs reliés
 * par un bus en mémoire (livraison en microtâche, comme un réseau), horloge
 * simulée. Ce qui est prouvé : lots de 50 ms, preuve de vie, demandes et
 * réponses d'état, oubli, trous, refus comptés — au compte exact.
 */

interface IWire {
  channel: string;
  payload: unknown;
  from: string;
}

/** Réseau en mémoire : chaque publication est rendue à tous les AUTRES pairs. */
function network(): {
  peer: (originId: string) => IBackplane;
  wire: IWire[];
  cut: Set<string>;
  dropNext: (pred: (w: IWire) => boolean) => void;
  inject: (to: string, msg: IWire) => void;
} {
  const handlers = new Map<string, BackplaneHandler>();
  const wire: IWire[] = [];
  const cut = new Set<string>();
  let drop: ((w: IWire) => boolean) | null = null;
  const deliver = (to: BackplaneHandler, w: IWire): void => {
    const payload = structuredClone(w.payload);
    queueMicrotask(() => to({ channel: w.channel, payload, originId: w.from }));
  };
  return {
    wire,
    cut,
    dropNext: (pred) => {
      drop = pred;
    },
    inject: (to, w) => {
      const h = handlers.get(to);
      if (h !== undefined) deliver(h, w);
    },
    peer: (originId) => ({
      originId,
      start: () => {},
      stop: () => {
        handlers.delete(originId);
      },
      publish: (channel, payload) => {
        const w = { channel, payload, from: originId };
        wire.push(w);
        if (cut.has(originId)) return;
        if (drop?.(w) === true) {
          drop = null;
          return;
        }
        for (const [id, h] of handlers) if (id !== originId) deliver(h, w);
      },
      onMessage: (h) => {
        handlers.set(originId, h);
      },
      describe: () => ({
        driver: "test-net",
        kind: "memory",
        originId,
        crossPod: true,
      }),
    }),
  };
}

function pod(net: ReturnType<typeof network>, id: string): RealtimeHub {
  const hub = new RealtimeHub();
  hub.declareChannelPolicy("room:*", { presence: true }, null);
  hub.declareChannelPolicy("solo:*", { presence: true }, null);
  hub.declareChannelPolicy("plain:*", {}, null);
  hub.declareChannelPolicy("wait:*", { presence: { grace: 1000 } }, null);
  hub.markBroadcastChannel("room:");
  hub.markBroadcastChannel("wait:");
  hub.markBroadcastChannel("plain:");
  hub.setBackplane(net.peer(id));
  return hub;
}

interface IClient {
  frames: RealtimePresenceFrame[];
  leave: () => void;
}

/** Un client du hub : `user` nommé, ou `null` pour un anonyme. */
function client(
  hub: RealtimeHub,
  channel: string,
  user: string | null,
): IClient {
  const frames: RealtimePresenceFrame[] = [];
  const codec = hub.textFrameCodec;
  const conn = new RealtimeConnection(
    {
      impose: () => {},
      end: () => false,
      send: (frame: ChannelFrame) => {
        const data = frame.encodeFor(codec);
        if (typeof data !== "string") return;
        const msg = JSON.parse(data) as {
          method: string;
          params: RealtimePresenceFrame;
        };
        if (msg.method === REALTIME_PRESENCE_METHOD) frames.push(msg.params);
      },
    },
    () => ({
      type: user === null ? "anonymous" : "test",
      authenticated: user !== null,
      id: user,
      userIdentifier: user ?? "anon.",
      roles: [],
      scopes: [],
      issuer: null,
      account: user !== null,
    }),
  );
  const sink: ChannelSink = () => {};
  expect(
    hub.subscribeClient(channel, sink, () => () => {}, undefined, conn),
  ).toBe(true);
  hub.presenceSubscribed(channel, conn);
  return {
    frames,
    leave: () => {
      hub.unsubscribe(channel, sink);
    },
  };
}

/** Vue d'un client rejouée trame par trame (règle pure du navigateur). */
function replay(c: IClient): {
  members: Record<string, number>;
  unnamed: number;
  partial: boolean;
  gaps: number;
} {
  let ref: number | null = null;
  const members = new Map<string, number>();
  let unnamed = 0;
  let partial = false;
  let gaps = 0;
  const put = (flat: readonly (string | number)[]): void => {
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const id = flat[i];
      const tabs = flat[i + 1];
      if (typeof id === "string" && typeof tabs === "number")
        members.set(id, tabs);
    }
  };
  for (const p of c.frames) {
    if (p.changes === undefined) {
      members.clear();
      if (p.members !== undefined) put(p.members);
      ref = p.version;
    } else {
      const outcome = classifyNumberedChange(ref, p.version);
      if (outcome === "gap") gaps += 1;
      if (outcome !== "applied") continue;
      if (p.changes.set !== undefined) put(p.changes.set);
      for (const id of p.changes.gone ?? []) members.delete(id);
      ref = p.version;
    }
    unnamed = p.unnamed;
    partial = p.partial === true;
  }
  return {
    members: Object.fromEntries(
      [...members].sort(([a], [b]) => a.localeCompare(b)),
    ),
    unnamed,
    partial,
    gaps,
  };
}

const view = (hub: RealtimeHub, channel: string): Record<string, number> => {
  const v = hub.presence(channel);
  const out: Record<string, number> = {};
  if (v !== null)
    for (const [k, e] of [...v.members].sort(([a], [b]) => a.localeCompare(b)))
      out[k] = e.tabs;
  return out;
};

const onBus = (net: ReturnType<typeof network>, from: string): IWire[] =>
  net.wire.filter(
    (w) =>
      w.from === from &&
      (w.channel === PLATFORM_BUS_CHANNELS.presence ||
        w.channel === PLATFORM_BUS_CHANNELS.presenceAlive),
  );

const ops = (ws: IWire[]): string[] =>
  ws.map((w) =>
    w.channel === PLATFORM_BUS_CHANNELS.presenceAlive
      ? "alive"
      : (w.payload as { op: string }).op,
  );

/** Champ `channels` d'un message publié (le message doit exister). */
function channelsOf(w: IWire | undefined): unknown {
  if (w === undefined) throw new Error("message attendu absent");
  return (w.payload as { channels: unknown }).channels;
}

const tick = (ms: number): Promise<void> =>
  vi.advanceTimersByTimeAsync(ms).then(() => undefined);

const FORGET_MS = PRESENCE_FORGET_FACTOR * PRESENCE_INTERVAL_MS;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("#760 lot D2 — présence répartie entre deux pods (bus en mémoire)", () => {
  it("🔴 une connexion tenue par A apparaît dans la présence lue sur B, et dans les trames de ses clients", async () => {
    const net = network();
    const a = pod(net, "A");
    const b = pod(net, "B");
    client(a, "room:1", "alice");
    const bob = client(b, "room:1", "bob");
    await tick(PRESENCE_BATCH_MS * 4);
    expect(view(a, "room:1")).to.deep.equal({ alice: 1, bob: 1 });
    expect(view(b, "room:1")).to.deep.equal({ alice: 1, bob: 1 });
    expect(b.presence("room:1")?.partial).toBe(false);
    await tick(PRESENCE_WINDOW_MS); // fenêtre navigateur
    const seen = replay(bob);
    expect(seen.members).to.deep.equal({ alice: 1, bob: 1 });
    expect(seen.partial).toBe(false);
    expect(seen.gaps).toBe(0);
    const probe = b.probe().presence;
    expect(probe?.pods).toBe(1);
    expect(probe?.gaps).toBe(0);
    expect(probe?.distributedChannels).toBe(1);
  });

  it("une identité dans deux onglets sur deux pods compte pour UN présent (`tabs: 2`) ; un anonyme compte dans `unnamed`, jamais nommé", async () => {
    const net = network();
    const a = pod(net, "A");
    const b = pod(net, "B");
    client(a, "room:1", "alice");
    client(b, "room:1", "alice");
    client(a, "room:1", null);
    await tick(PRESENCE_BATCH_MS * 4);
    for (const hub of [a, b]) {
      const v = hub.presence("room:1");
      expect(v?.count).toBe(1);
      expect(v?.unnamed).toBe(1);
      expect(view(hub, "room:1")).to.deep.equal({ alice: 2 });
    }
  });

  it("un départ sur A sort de la vue de B ; le dernier client parti libère le canal sans laisser de fantôme", async () => {
    const net = network();
    const a = pod(net, "A");
    const b = pod(net, "B");
    const alice = client(a, "room:1", "alice");
    const carol = client(a, "room:1", "carol");
    const bob = client(b, "room:1", "bob");
    await tick(PRESENCE_BATCH_MS * 4);
    expect(view(b, "room:1")).to.deep.equal({ alice: 1, bob: 1, carol: 1 });
    alice.leave();
    await tick(PRESENCE_BATCH_MS * 2);
    expect(view(b, "room:1")).to.deep.equal({ bob: 1, carol: 1 });
    carol.leave(); // dernier client de A : canal retiré de A
    await tick(PRESENCE_BATCH_MS * 2);
    expect(view(b, "room:1")).to.deep.equal({ bob: 1 });
    await tick(PRESENCE_WINDOW_MS);
    expect(replay(bob).members).to.deep.equal({ bob: 1 });
    expect(a.probe().presence?.distributedChannels).toBe(0);
  });

  it("🔴 premier abonné de B après A : vue `partial` pendant la synchronisation, complète en ≤ 2 fenêtres après la demande", async () => {
    const net = network();
    const a = pod(net, "A");
    const b = pod(net, "B");
    client(a, "room:1", "alice");
    await tick(PRESENCE_BATCH_MS * 2);
    const bob = client(b, "room:1", "bob");
    expect(replay(bob).partial).toBe(true);
    expect(b.presence("room:1")?.partial).toBe(true);
    // Demande au lot suivant (≤ 1 fenêtre), réponse groupée chez A (≤ 1 fenêtre).
    await tick(PRESENCE_BATCH_MS * 2);
    expect(view(b, "room:1")).to.deep.equal({ alice: 1, bob: 1 });
    expect(ops(onBus(net, "B"))).toContain("request");
    expect(ops(onBus(net, "A"))).toContain("state");
    await tick(PRESENCE_WINDOW_MS);
    const seen = replay(bob);
    expect(seen.members).to.deep.equal({ alice: 1, bob: 1 });
    expect(seen.partial).toBe(false);
    expect(seen.gaps).toBe(0);
  });

  it("🔴 A vivant et calme n'est jamais oublié (preuve de vie) ; A muet est oublié au délai d'oubli, pas avant", async () => {
    const net = network();
    const a = pod(net, "A");
    const b = pod(net, "B");
    client(a, "room:1", "alice");
    client(b, "room:1", "bob");
    await tick(PRESENCE_BATCH_MS * 4);
    // Calme : plus aucun changement, seules les preuves de vie circulent.
    await tick(FORGET_MS * 4);
    expect(view(b, "room:1")).to.deep.equal({ alice: 1, bob: 1 });
    expect(b.probe().presence?.forgottenTotal).toBe(0);
    expect(ops(onBus(net, "A"))).toContain("alive");
    // A se tait (processus tué) : rien ne part plus.
    net.cut.add("A");
    await tick(FORGET_MS - PRESENCE_INTERVAL_MS * 1.5);
    expect(view(b, "room:1")).to.deep.equal({ alice: 1, bob: 1 });
    await tick(PRESENCE_INTERVAL_MS * 3);
    expect(view(b, "room:1")).to.deep.equal({ bob: 1 });
    expect(b.probe().presence?.forgottenTotal).toBe(1);
  });

  it("🔴 un lot perdu : trou, vue `partial`, demande CIBLÉE, réponse, vue réparée", async () => {
    const net = network();
    const a = pod(net, "A");
    const b = pod(net, "B");
    client(a, "room:1", "alice");
    const bob = client(b, "room:1", "bob");
    await tick(PRESENCE_BATCH_MS * 4);
    // Le prochain lot de A se perd en route.
    net.dropNext(
      (w) => w.from === "A" && (w.payload as { op?: string }).op === "batch",
    );
    client(a, "room:1", "carol");
    await tick(PRESENCE_BATCH_MS * 2);
    expect(view(b, "room:1")).to.deep.equal({ alice: 1, bob: 1 });
    client(a, "room:1", "dave"); // lot suivant : `prev` ≠ dernier appliqué
    await tick(PRESENCE_BATCH_MS + 1);
    expect(b.probe().presence?.gaps).toBe(1);
    expect(b.presence("room:1")?.partial).toBe(true);
    await tick(PRESENCE_BATCH_MS * 4);
    const requests = onBus(net, "B").filter(
      (w) => (w.payload as { op?: string }).op === "request",
    );
    expect(requests.map((w) => (w.payload as { to: unknown }).to)).toContain(
      "A",
    );
    expect(view(b, "room:1")).to.deep.equal({
      alice: 1,
      bob: 1,
      carol: 1,
      dave: 1,
    });
    expect(b.probe().presence?.gaps).toBe(0);
    await tick(PRESENCE_WINDOW_MS);
    const seen = replay(bob);
    expect(seen.partial).toBe(false);
    expect(seen.members).to.deep.equal({ alice: 1, bob: 1, carol: 1, dave: 1 });
  });

  it("grâce : parti de A, revenu sur B pendant la grâce — jamais vu partir, et la grâce échue ne l'efface pas", async () => {
    const net = network();
    const a = pod(net, "A");
    const b = pod(net, "B");
    client(a, "wait:1", "watcher");
    const alice = client(a, "wait:1", "alice");
    client(b, "wait:1", "bob");
    await tick(PRESENCE_WINDOW_MS * 2);
    const framesBefore = a.probe().presence?.frameTotal ?? 0;
    alice.leave(); // retenu par la grâce sur A
    client(b, "wait:1", "alice"); // revenu sur B
    await tick(PRESENCE_BATCH_MS * 4);
    await tick(1000 + PRESENCE_WINDOW_MS * 2); // grâce échue
    for (const hub of [a, b])
      expect(view(hub, "wait:1")).to.deep.equal({
        alice: 1,
        bob: 1,
        watcher: 1,
      });
    // Aucune trame n'a annoncé de départ chez A.
    const watcherFrames = (a.probe().presence?.frameTotal ?? 0) - framesBefore;
    expect(watcherFrames).toBe(0);
  });

  it("une demande ciblée à un pod qui ne sert pas le canal reçoit UNE réponse, vide", async () => {
    const net = network();
    pod(net, "A");
    net.peer("ghost"); // pair qui n'écoute rien : on lit ce que A publie
    net.inject("A", {
      channel: PLATFORM_BUS_CHANNELS.presence,
      payload: {
        op: "request",
        incarnation: 1,
        seq: 1,
        channels: ["room:9"],
        to: "A",
      },
      from: "ghost",
    });
    await tick(PRESENCE_BATCH_MS * 2);
    const answers = onBus(net, "A").filter(
      (w) => (w.payload as { op?: string }).op === "state",
    );
    expect(answers).toHaveLength(1);
    expect(answers[0]?.payload).to.deep.include({ i: 0, n: 1, last: 0 });
    expect(channelsOf(answers[0])).to.deep.equal([
      { channel: "room:9", members: [], unnamed: 0 },
    ]);
    // Un demandeur qui ne sert aucun canal ferme lui aussi son trou : réponse, vide.
    net.inject("A", {
      channel: PLATFORM_BUS_CHANNELS.presence,
      payload: { op: "request", incarnation: 1, seq: 2, channels: [], to: "A" },
      from: "ghost",
    });
    await tick(PRESENCE_BATCH_MS * 2);
    const all = onBus(net, "A").filter(
      (w) => (w.payload as { op?: string }).op === "state",
    );
    expect(all).toHaveLength(2);
    expect(channelsOf(all[1])).to.deep.equal([]);
  });

  it("canal fermé sur A pendant la grâce d'un départ : aucun fantôme chez B", async () => {
    const net = network();
    const a = pod(net, "A");
    const b = pod(net, "B");
    const alice = client(a, "wait:1", "alice");
    client(b, "wait:1", "bob");
    await tick(PRESENCE_WINDOW_MS * 2);
    expect(view(b, "wait:1")).to.deep.equal({ alice: 1, bob: 1 });
    alice.leave(); // dernier client de A, départ retenu : le canal ferme sur A
    await tick(FORGET_MS * 2);
    expect(view(b, "wait:1")).to.deep.equal({ bob: 1 });
  });

  it("une arrivée puis un départ dans la même fenêtre de 50 ms : aucun lot ne part (annulation à la source)", async () => {
    const net = network();
    const a = pod(net, "A");
    client(a, "room:1", "alice");
    await tick(PRESENCE_BATCH_MS * 2);
    const before = onBus(net, "A").filter(
      (w) => (w.payload as { op?: string }).op === "batch",
    ).length;
    const ghost = client(a, "room:1", "bob");
    ghost.leave();
    await tick(PRESENCE_BATCH_MS * 2);
    const after = onBus(net, "A").filter(
      (w) => (w.payload as { op?: string }).op === "batch",
    ).length;
    expect(after).toBe(before);
  });

  it("canal sans présence : aucun message de présence ; canal à présence NON diffusé : rien sur le bus, un avis unique", async () => {
    const net = network();
    const a = pod(net, "A");
    const notices: string[] = [];
    a.onPlatformNotice((m) => notices.push(m));
    client(a, "plain:1", "alice");
    await tick(FORGET_MS);
    expect(onBus(net, "A")).to.deep.equal([]);
    expect(a.probe().presence?.aliveTotal).toBe(0);
    client(a, "solo:1", "alice");
    client(a, "solo:2", "bob");
    await tick(FORGET_MS);
    expect(onBus(net, "A")).to.deep.equal([]);
    expect(view(a, "solo:1")).to.deep.equal({ alice: 1 });
    expect(
      notices.filter((n) => n.includes("déclare la présence")),
    ).toHaveLength(1);
  });

  it("🔴 entrée du bus : forme invalide → `presenceRejectedTotal`, type inconnu → `ingressUnknownDiscardedTotal`, rejeu → `presenceStaleDiscardedTotal` ; jamais une injection", async () => {
    const net = network();
    const a = pod(net, "A");
    client(a, "room:1", "alice");
    const send = (payload: unknown, alive = false): void =>
      net.inject("A", {
        channel: alive
          ? PLATFORM_BUS_CHANNELS.presenceAlive
          : PLATFORM_BUS_CHANNELS.presence,
        payload,
        from: "X",
      });
    const batch = {
      op: "batch",
      incarnation: 7,
      seq: 1,
      prev: 0,
      channels: [{ channel: "room:1", set: ["xavier", 1], unnamed: 0 }],
    };
    send(batch);
    send(batch); // rejeu
    send({ op: "batch", incarnation: 7, seq: "2", prev: 1, channels: [] }); // forme
    send({ op: "gossip", incarnation: 7, seq: 3 }); // version plus récente
    send({ incarnation: 7, seq: 4, last: 1, interval: 1 }, true); // intervalle hors bornes
    send({
      op: "batch",
      incarnation: 7,
      seq: 5,
      prev: 1,
      channels: [{ channel: "nope:1", set: ["x", 1], unnamed: 0 }],
    }); // canal non déclaré à présence
    await tick(1);
    expect(view(a, "room:1")).to.deep.equal({ alice: 1, xavier: 1 });
    const probe = a.probe();
    expect(probe.presence?.presenceStaleDiscardedTotal).toBe(1);
    expect(probe.presence?.presenceRejectedTotal).toBe(3);
    expect(probe.ingressUnknownDiscardedTotal).toBe(1);
    expect(probe.ingressRejectedTotal).toBe(0);
  });

  it("un hub sans aucune présence déclarée refuse un message de présence sans rien allouer", async () => {
    const net = network();
    const hub = new RealtimeHub();
    hub.setBackplane(net.peer("A"));
    net.inject("A", {
      channel: PLATFORM_BUS_CHANNELS.presenceAlive,
      payload: { incarnation: 1, seq: 1, last: 0, interval: 5000 },
      from: "X",
    });
    await tick(FORGET_MS);
    const probe = hub.probe();
    expect(probe.presence?.presenceRejectedTotal).toBe(1);
    expect(probe.presence?.pods).toBe(0);
    expect(onBus(net, "A")).to.deep.equal([]);
  });

  it("3 000 présents d'un coup : plusieurs lots chaînés de ≤ 64 Ko, tous appliqués chez le pair", async () => {
    const net = network();
    const a = pod(net, "A");
    const b = pod(net, "B");
    client(b, "room:1", "bob");
    const id = (i: number): string =>
      `utilisateur-${String(i).padStart(4, "0")}-${"é".repeat(12)}`;
    for (let i = 0; i < 3000; i += 1) client(a, "room:1", id(i));
    await tick(PRESENCE_BATCH_MS * 4);
    const batches = onBus(net, "A").filter(
      (w) => (w.payload as { op?: string }).op === "batch",
    );
    expect(batches.length).toBeGreaterThan(1);
    for (const w of batches)
      expect(Buffer.byteLength(JSON.stringify(w.payload))).toBeLessThanOrEqual(
        65_536,
      );
    expect(b.presence("room:1")?.count).toBe(3001);
    expect(b.probe().presence?.gaps).toBe(0);
  });
});
