import { afterEach, describe, expect, it } from "vitest";
import { createTestIdentity } from "@nodefony/security/testing";
import { RealtimeController } from "../../src/server/RealtimeController";
import { getRealtimeHub } from "../../src/server/RealtimeHub";
import { createRealtimeHarness } from "../../testing/index";
import type { IRealtimeHarness } from "../../testing/index";
import type { IRealtimeConnection } from "../../interfaces/IRealtimeConnection";
import type { RealtimeInboundHandler } from "../../interfaces/IRealtimeController";

/**
 * Canal à membres (#623, ADR-0022 §6 décisions 2 et 3) : le hub connaît la
 * connexion de chaque abonné client — il la liste, l'éjecte, l'abonne d'office,
 * et termine le canal pour tous. Exercé au harnais, sur le vrai contrôleur.
 */

/** Verdicts des abonnements imposés depuis le gestionnaire entrant. */
let joins: Promise<boolean>[] = [];
/** Producteurs libérés, par canal. */
let disposed: string[] = [];

class MembersRt extends RealtimeController {
  constructor(ctx: ConstructorParameters<typeof RealtimeController>[1]) {
    super("MembersRt", ctx);
  }
  override createRealtimeChannel(channel: string): (() => void) | null {
    if (!channel.startsWith("room:") && !channel.startsWith("vip:"))
      return null;
    return () => {
      disposed.push(channel);
    };
  }
  override realtimeInbound(): Record<string, RealtimeInboundHandler> {
    return {
      // Le geste part PAR LA SOCKET : il atteint le processus qui la tient.
      "room:join": (params, _reply, connection) => {
        const room =
          typeof params === "object" && params !== null && "room" in params
            ? String(params.room)
            : "";
        joins.push(getRealtimeHub().subscribeConnection(room, connection));
      },
    };
  }
}

type Harness = IRealtimeHarness<MembersRt>;

async function connect(user: string, first = false): Promise<Harness> {
  const h = createRealtimeHarness((ctx) => new MembersRt(ctx), {
    identity: createTestIdentity({ identifier: user }),
    resetHub: first,
  });
  await h.connect();
  return h;
}

const memberOf = (channel: string, user: string): IRealtimeConnection => {
  const m = getRealtimeHub()
    .channelMembers(channel)
    .find((c) => c.userId === user);
  if (m === undefined)
    throw new Error(`${user} n'est pas membre de ${channel}`);
  return m;
};

const closedOf = (h: Harness): unknown[] =>
  h.received.filter((f) => f.method === "realtime:closed").map((f) => f.params);

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let open: Harness[] = [];
/** Deux connexions sur le MÊME hub — remis à zéro par la première : une politique s'inscrit APRÈS. */
async function two(): Promise<[Harness, Harness]> {
  const a = await connect("alice", true);
  const b = await connect("bob");
  open = [a, b];
  return [a, b];
}

afterEach(() => {
  for (const h of open) h.close();
  open = [];
  joins = [];
  disposed = [];
  getRealtimeHub().clear();
});

describe("#623 — membres d'un canal", () => {
  it("le hub liste les connexions abonnées par un client, avec leur compte", async () => {
    const [a, b] = await two();
    await a.subscribe("room:1");
    await b.subscribe("room:1");
    const users = getRealtimeHub()
      .channelMembers("room:1")
      .map((c) => c.userId);
    expect(users.sort()).to.deep.equal(["alice", "bob"]);
    expect(getRealtimeHub().channelMembers("room:absent")).to.deep.equal([]);
  });

  it("🔴 une connexion qui part sort du registre — désabonnement OU fermeture de la socket", async () => {
    const [a, b] = await two();
    await a.subscribe("room:1");
    await b.subscribe("room:1");
    await b.unsubscribe("room:1");
    expect(
      getRealtimeHub()
        .channelMembers("room:1")
        .map((c) => c.userId),
    ).to.deep.equal(["alice"]);
    const alice = memberOf("room:1", "alice");
    a.close();
    expect(getRealtimeHub().channelMembers("room:1")).to.deep.equal([]);
    expect(alice.open).toBe(false);
  });

  it("un écouteur du serveur n'est pas un membre", async () => {
    const [a] = await two();
    await a.subscribe("room:1");
    getRealtimeHub().listen("room:1", () => {});
    expect(getRealtimeHub().channelMembers("room:1")).to.have.length(1);
  });
});

describe("#623 — éjecter une connexion (local au pod)", () => {
  it("l'éjecté reçoit realtime:closed evicted et n'est plus servi ; les autres si", async () => {
    const [a, b] = await two();
    await a.subscribe("room:1");
    await b.subscribe("room:1");
    const hub = getRealtimeHub();
    expect(hub.evictConnection("room:1", memberOf("room:1", "alice"))).toBe(
      true,
    );
    expect(closedOf(a)).to.deep.equal([
      { channel: "room:1", reason: "evicted" },
    ]);
    hub.publish("room:1", { n: 1 });
    expect(a.messages("room:1")).to.have.length(0);
    expect(b.messages("room:1")).to.deep.equal([{ n: 1 }]);
    expect(hub.channelMembers("room:1")).to.have.length(1);
  });

  it("éjecter COUPE, n'exclut pas : sans `allow`, l'éjecté qui redemande rentre — et c'est un abonnement neuf, pas un fantôme", async () => {
    const [a] = await two();
    await a.subscribe("room:1");
    const hub = getRealtimeHub();
    hub.evictConnection("room:1", memberOf("room:1", "alice"));
    await a.subscribe("room:1");
    hub.publish("room:1", { n: 2 });
    expect(a.messages("room:1")).to.deep.equal([{ n: 2 }]);
    expect(hub.subscriberCount("room:1")).toBe(1);
  });

  it("🔴 avec `allow`, l'exclu qui redemande sur la MÊME connexion est refusé : le verdict d'avant l'éjection n'est pas retenu", async () => {
    // L'exclusion = appartenance retirée PUIS éjection. Une socket encore ouverte
    // qui redemande aussitôt ne doit pas rentrer sur le oui d'avant.
    const [a] = await two();
    const members = new Set(["alice"]);
    getRealtimeHub().registerChannelPolicy("room:*", {
      allow: (_channel, who) => members.has(who.id),
    });
    await a.subscribe("room:1");
    expect(a.subscriptions()).to.deep.equal(["room:1"]);
    members.delete("alice");
    const hub = getRealtimeHub();
    expect(hub.evictConnection("room:1", memberOf("room:1", "alice"))).toBe(
      true,
    );
    await a.subscribe("room:1");
    hub.publish("room:1", { n: 3 });
    expect(a.denials()).toMatchObject([
      { channel: "room:1", reason: "forbidden" },
    ]);
    expect(a.messages("room:1")).to.deep.equal([]);
    expect(hub.subscriberCount("room:1")).toBe(0);
  });

  it("sens négatif : non-membre, poignée fermée ou étrangère → `false`, jamais un geste muet", async () => {
    const [a] = await two();
    await a.subscribe("room:1");
    const hub = getRealtimeHub();
    const alice = memberOf("room:1", "alice");
    expect(hub.evictConnection("room:autre", alice)).toBe(false);
    const forged: IRealtimeConnection = { userId: "alice", open: true };
    expect(hub.evictConnection("room:1", forged)).toBe(false);
    a.close();
    expect(hub.evictConnection("room:1", alice)).toBe(false);
    expect(closedOf(a)).to.have.length(0);
  });
});

describe("#623 — abonner d'office (local au pod)", () => {
  it("le gestionnaire entrant reçoit la connexion et l'abonne : acquittement `imposed`, flux servi", async () => {
    const [a] = await two();
    await a.notify("room:join", { room: "room:7" });
    expect(await joins[0]).toBe(true);
    const ack = a.received.find(
      (f) => f.method === "realtime:subscribed",
    )?.params;
    expect(ack).to.deep.equal({ channel: "room:7", imposed: true });
    getRealtimeHub().publish("room:7", { n: 1 });
    expect(a.messages("room:7")).to.deep.equal([{ n: 1 }]);
    expect(memberOf("room:7", "alice").userId).toBe("alice");
  });

  it("déjà membre : `true`, sans second acquittement", async () => {
    const [a] = await two();
    await a.subscribe("room:7");
    const before = a.subscriptions().length;
    await a.notify("room:join", { room: "room:7" });
    expect(await joins[0]).toBe(true);
    expect(a.subscriptions()).to.have.length(before);
  });

  it("`allow` reste seul juge : refus rendu à l'appelant, RIEN envoyé au client", async () => {
    const [a, b] = await two();
    getRealtimeHub().registerChannelPolicy("vip:*", {
      allow: (_channel, who) => who.id === "alice",
    });
    await b.notify("room:join", { room: "vip:1" });
    expect(await joins[0]).toBe(false);
    expect(b.denials()).to.have.length(0);
    expect(b.subscriptions()).to.have.length(0);
    await a.notify("room:join", { room: "vip:1" });
    expect(await joins[1]).toBe(true);
    expect(getRealtimeHub().channelMembers("vip:1")).to.have.length(1);
  });

  it("`allow` asynchrone : la connexion fermée pendant l'attente rend `false`, aucune marque", async () => {
    const [a] = await two();
    let release: (v: boolean) => void = () => {};
    getRealtimeHub().registerChannelPolicy("vip:*", {
      allow: () =>
        new Promise<boolean>((r) => {
          release = r;
        }),
    });
    await a.notify("room:join", { room: "vip:1" });
    a.close();
    release(true);
    expect(await joins[0]).toBe(false);
    expect(getRealtimeHub().channelMembers("vip:1")).to.deep.equal([]);
  });

  it("le client se désabonne pendant l'attente de `allow` : `false`", async () => {
    const [a] = await two();
    let release: (v: boolean) => void = () => {};
    getRealtimeHub().registerChannelPolicy("vip:*", {
      allow: () =>
        new Promise<boolean>((r) => {
          release = r;
        }),
    });
    await a.notify("room:join", { room: "vip:1" });
    await a.unsubscribe("vip:1");
    expect(await joins[0]).toBe(false);
    release(true);
    await flush();
    expect(getRealtimeHub().channelMembers("vip:1")).to.deep.equal([]);
  });

  it("🔴 le verrou des trames juge l'imposition comme un `subscribe` du client — et refuse s'il lève", async () => {
    const [a] = await two();
    const subscribedTo = (frame: unknown): unknown =>
      typeof frame === "object" &&
      frame !== null &&
      "method" in frame &&
      frame.method === "subscribe" &&
      "params" in frame &&
      typeof frame.params === "object" &&
      frame.params !== null &&
      "channel" in frame.params
        ? frame.params.channel
        : undefined;
    getRealtimeHub().setFrameAuthorizer((frame) => {
      const channel = subscribedTo(frame);
      if (channel === "room:boom") throw new Error("verrou en panne");
      return channel !== "room:secret";
    });
    await a.notify("room:join", { room: "room:secret" });
    await a.notify("room:join", { room: "room:boom" });
    await a.notify("room:join", { room: "room:libre" });
    expect(await Promise.all(joins)).to.deep.equal([false, false, true]);
    expect(
      getRealtimeHub()
        .channelMembers("room:secret")
        .concat(getRealtimeHub().channelMembers("room:boom")),
    ).to.deep.equal([]);
  });

  it("canal sans producteur : `false`, aucun refus envoyé au client", async () => {
    const [a] = await two();
    await a.notify("room:join", { room: "inconnu:1" });
    expect(await joins[0]).toBe(false);
    expect(a.denials()).to.have.length(0);
  });

  it("sens négatif : une poignée étrangère ou fermée rend `false`", async () => {
    const [a] = await two();
    const hub = getRealtimeHub();
    expect(
      await hub.subscribeConnection("room:1", { userId: null, open: true }),
    ).toBe(false);
    await a.subscribe("room:2");
    const alice = memberOf("room:2", "alice");
    a.close();
    expect(await hub.subscribeConnection("room:1", alice)).toBe(false);
  });
});

describe("#623 — terminer un canal", () => {
  it("chaque membre reçoit realtime:closed ended, le producteur est libéré, l'écouteur reste", async () => {
    const [a, b] = await two();
    await a.subscribe("room:1");
    await b.subscribe("room:1");
    const heard: unknown[] = [];
    const hub = getRealtimeHub();
    hub.listen("room:1", (payload) => heard.push(payload));
    expect(hub.closeChannel("room:1")).toBe(2);
    for (const h of [a, b])
      expect(closedOf(h)).to.deep.equal([
        { channel: "room:1", reason: "ended" },
      ]);
    expect(disposed).to.deep.equal(["room:1"]);
    expect(hub.channelMembers("room:1")).to.deep.equal([]);
    hub.publish("room:1", { n: 1 });
    expect(heard).to.deep.equal([{ n: 1 }]);
    expect(a.messages("room:1")).to.have.length(0);
  });

  it("seule la fabrique clôt un canal : un client qui redemande fait rejouer la fabrique", async () => {
    const [a] = await two();
    await a.subscribe("room:1");
    const hub = getRealtimeHub();
    hub.closeChannel("room:1");
    await a.subscribe("room:1");
    expect(hub.channelMembers("room:1")).to.have.length(1);
    // Une fabrique qui rend `null` pour une instance terminée : refus `unknown`.
    await a.subscribe("termine:1");
    expect(a.denials().map((d) => d.reason)).to.deep.equal(["unknown"]);
  });

  it("un canal inconnu : 0, rien d'envoyé", async () => {
    const [a] = await two();
    expect(getRealtimeHub().closeChannel("room:rien")).toBe(0);
    expect(closedOf(a)).to.have.length(0);
  });
});
