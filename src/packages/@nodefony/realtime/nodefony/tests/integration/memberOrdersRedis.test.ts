import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "redis";
import {
  RedisBackplane,
  createRedisServiceTransport,
} from "../../src/backplane/RedisBackplane.js";
import { sealBackplaneEnvelope } from "../../src/backplane/envelope.js";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { RealtimeHub, getRealtimeHub } from "../../src/server/RealtimeHub.js";
import { createRealtimeHarness } from "../../testing/index.js";
import type { IRealtimeHarness } from "../../testing/index.js";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken.js";
import { PLATFORM_BUS_CHANNELS } from "nodefony";
import {
  REDIS_GATE,
  gateValue,
} from "../../../../../../../scripts/test/vitest/gates";

/**
 * #623 lot 2 sur un Redis RÉEL — terminer un canal et éjecter un compte
 * traversent deux pods reliés par le bus scellé (ADR-0022 §6 décision 4).
 * Pod A = le hub du harnais, qui tient de vraies connexions ; pod B = un second
 * hub. Auto-skip si Redis est injoignable — et `gateReporter` le dit.
 *
 *   docker compose -f src/packages/@nodefony/redis/docker/docker-compose.yml up -d
 */

const PASSWORD = process.env.NF_REDIS_PASSWORD ?? "nodefony-dev";
const HOST = process.env.NF_REDIS_HOST ?? "localhost";
const PORT = Number.parseInt(process.env.NF_REDIS_PORT ?? "6379", 10);

// Type rendu par `createClient` lui-même : aucune conversion.
function mkClient() {
  const url = gateValue(REDIS_GATE, "NF_REDIS_URL");
  const c = createClient(
    url
      ? { url, socket: { reconnectStrategy: false } }
      : {
          socket: { host: HOST, port: PORT, reconnectStrategy: false },
          password: PASSWORD,
        },
  );
  c.on("error", () => {});
  return c;
}

async function redisReachable(): Promise<boolean> {
  const probe = mkClient();
  try {
    await probe.connect();
    await probe.ping();
    await probe.quit();
    return true;
  } catch {
    try {
      probe.destroy();
    } catch {
      /* déjà fermé */
    }
    return false;
  }
}

type RedisClient = ReturnType<typeof mkClient>;

const REDIS_UP = await redisReachable();
const wait = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Attend une condition — jamais un délai fixe (pub/sub sans borne sous charge). */
async function until(cond: () => boolean, what: string): Promise<void> {
  const end = Date.now() + 5000;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`délai dépassé : ${what}`);
    await wait(10);
  }
}

function tokenOf(id: string): IRealtimeToken {
  return {
    type: "session",
    getUserIdentifier: () => id,
    isAuthenticated: () => true,
    getRoles: () => ["ROLE_USER"],
    getScopes: () => [],
    getAttribute: () => undefined,
    getIdentity: () =>
      Object.freeze({
        type: "session",
        authenticated: true,
        id,
        userIdentifier: id,
        roles: Object.freeze(["ROLE_USER"]),
        scopes: Object.freeze([]),
        issuer: null,
        account: true,
      }),
  };
}

class RoomRt extends RealtimeController {
  constructor(ctx: ConstructorParameters<typeof RealtimeController>[1]) {
    super("RoomRt", ctx);
  }
  override createRealtimeChannel(channel: string): (() => void) | null {
    return channel.startsWith("chat:") ? () => {} : null;
  }
}

type Harness = IRealtimeHarness<RoomRt>;

const closedOf = (h: Harness): unknown[] =>
  h.received.filter((f) => f.method === "realtime:closed").map((f) => f.params);

describe.skipIf(!REDIS_UP)("#623 — ordres de contrôle sur Redis", () => {
  const SECRET = `ord-${"k".repeat(32)}`;
  const bus = `nodefony:rt:orders:${Date.now()}`;
  const clients: RedisClient[] = [];
  const backplanes: RedisBackplane[] = [];
  let tabs: Harness[] = [];
  let other: RealtimeHub | null = null;

  async function connected(): Promise<RedisClient> {
    const c = mkClient();
    await c.connect();
    clients.push(c);
    return c;
  }

  async function backplane(originId: string): Promise<RedisBackplane> {
    const bp = new RedisBackplane(
      createRedisServiceTransport(await connected(), await connected()),
      originId,
      bus,
      SECRET,
    );
    await bp.start();
    backplanes.push(bp);
    return bp;
  }

  async function tab(user: string, first = false): Promise<Harness> {
    const h = createRealtimeHarness((ctx) => new RoomRt(ctx), {
      identity: tokenOf(user),
      resetHub: first,
    });
    await h.connect();
    tabs.push(h);
    return h;
  }

  /** Pod A (le harnais) et pod B, reliés par Redis, au même secret. */
  async function pods(): Promise<{ a: RealtimeHub; b: RealtimeHub }> {
    const a = getRealtimeHub();
    a.setBackplane(await backplane("pod-a"));
    const b = new RealtimeHub();
    b.setBackplane(await backplane("pod-b"));
    other = b;
    return { a, b };
  }

  afterEach(async () => {
    for (const h of tabs) h.close();
    tabs = [];
    getRealtimeHub().clear();
    other?.clear();
    other = null;
    await Promise.allSettled(backplanes.map((b) => b.stop()));
    backplanes.length = 0;
    await Promise.allSettled(
      clients.map(async (c) => {
        if (c.isOpen) await c.quit();
      }),
    );
    clients.length = 0;
  });

  it("éjecter un compte sur B : ses deux onglets servis par A sortent, Bob reste ; puis terminer le canal", async () => {
    const tab1 = await tab("alice", true);
    const tab2 = await tab("alice");
    const bob = await tab("bob");
    for (const h of [tab1, tab2, bob]) await h.subscribe("chat:general");
    const { a, b } = await pods();

    b.evictUser("chat:general", "alice");
    await until(
      () => closedOf(tab1).length === 1 && closedOf(tab2).length === 1,
      "les deux onglets d'Alice reçoivent evicted",
    );
    expect(closedOf(tab1)).to.deep.equal([
      { channel: "chat:general", reason: "evicted" },
    ]);
    expect(a.channelMembers("chat:general").map((c) => c.userId)).to.deep.equal(
      ["bob"],
    );

    b.closeChannel("chat:general");
    await until(() => closedOf(bob).length === 1, "Bob reçoit ended");
    expect(closedOf(bob)).to.deep.equal([
      { channel: "chat:general", reason: "ended" },
    ]);
    expect(a.probe().ingressRejectedTotal).toBe(0);
  });

  it("secret posé : un ordre NON scellé publié par un intrus n'éjecte personne", async () => {
    const alice = await tab("alice", true);
    await alice.subscribe("chat:general");
    await alice.subscribe("chat:sentinel");
    await pods();
    const evil = await connected();
    await evil.publish(
      bus,
      JSON.stringify({
        channel: PLATFORM_BUS_CHANNELS.control,
        payload: { op: "evictUser", channel: "chat:general", user: "alice" },
        originId: "evil",
      }),
    );
    // Sentinelle SCELLÉE publiée après : quand elle agit, l'intrus est passé.
    await evil.publish(
      bus,
      sealBackplaneEnvelope(
        {
          channel: PLATFORM_BUS_CHANNELS.control,
          payload: { op: "close", channel: "chat:sentinel" },
          originId: "pod-b",
        },
        SECRET,
      ),
    );
    await until(() => closedOf(alice).length > 0, "la sentinelle agit");
    expect(closedOf(alice)).to.deep.equal([
      { channel: "chat:sentinel", reason: "ended" },
    ]);
  });

  it("⚠️ RISQUE ACCEPTÉ (S-rt-48) : une éjection scellée captée puis rejouée recoupe le compte réadmis sur un canal durable", async () => {
    // Ce test DÉCRIT le risque écrit dans l'ADR-0022 §6 d4. Il doit basculer
    // le jour où la génération d'appartenance (champ `generation`) est livrée.
    const alice = await tab("alice", true);
    await alice.subscribe("chat:general");
    const { b } = await pods();
    const spy = await connected();
    const captured: string[] = [];
    await spy.subscribe(bus, (raw) => {
      if (raw.includes(PLATFORM_BUS_CHANNELS.control)) captured.push(raw);
    });

    b.evictUser("chat:general", "alice");
    await until(() => closedOf(alice).length === 1, "première éjection");
    await until(() => captured.length === 1, "l'espion capte l'ordre scellé");

    await alice.subscribe("chat:general"); // réadmise
    const replayer = await connected();
    await replayer.publish(bus, captured[0] ?? "");
    await until(() => closedOf(alice).length === 2, "le rejeu recoupe");
    expect(closedOf(alice)[1]).to.deep.equal({
      channel: "chat:general",
      reason: "evicted",
    });
  });
});
