import { afterEach, describe, expect, it } from "vitest";
import { PLATFORM_BUS_CHANNELS } from "nodefony";
import {
  RedisBackplane,
  createRedisServiceTransport,
  type IRedisBackplaneTransport,
} from "../../src/backplane/RedisBackplane.js";
import { RealtimeHub } from "../../src/server/RealtimeHub.js";
import {
  PRESENCE_FORGET_FACTOR,
  PRESENCE_INTERVAL_MS,
} from "../../src/server/presenceBus.js";
import {
  presenceClient as client,
  presenceView as view,
} from "../helpers/presenceClient.js";
import {
  redisReachable,
  redisTestClient,
  type RedisTestClient,
} from "../helpers/redisDecor.js";

/**
 * #760 lot D3 sur un Redis RÉEL — la présence répartie entre deux pods reliés
 * par le bus scellé : arrêt propre, pod tué, écho coupé (ADR-0025 P2, P5).
 * Horloge RÉELLE : l'intervalle par défaut (5 s) fixe la durée des cas d'oubli.
 * Auto-skip si Redis est injoignable — et `gateReporter` le dit.
 *
 *   docker compose -f docker/docker-compose.yml up -d redis
 */

const REDIS_UP = await redisReachable();
const FORGET_MS = PRESENCE_FORGET_FACTOR * PRESENCE_INTERVAL_MS;
const wait = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Attend une condition — jamais un délai fixe asserté (pub/sub sans borne sous charge). */
async function until(
  cond: () => boolean,
  what: string,
  timeout = 5000,
): Promise<void> {
  const end = Date.now() + timeout;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`délai dépassé : ${what}`);
    await wait(20);
  }
}

/**
 * Porte de réception commutable : les messages traversent le vrai Redis, et la
 * porte de CE pod les jette tant qu'elle est fermée — écho compris, comme une
 * connexion d'abonnement perdue.
 */
interface IDoor {
  deaf: boolean;
  /** Fermer la porte juste APRÈS le prochain message qui contient ces marques. */
  closeAfter: readonly string[] | null;
}

function withDoor(
  inner: IRedisBackplaneTransport,
  door: IDoor,
): IRedisBackplaneTransport {
  return {
    publish: (channel, message) => inner.publish(channel, message),
    subscribe: (channel, onMessage) =>
      inner.subscribe(channel, (message) => {
        if (door.deaf) return;
        onMessage(message);
        const marks = door.closeAfter;
        if (marks?.every((m) => message.includes(m)) === true) {
          door.closeAfter = null;
          door.deaf = true;
        }
      }),
    unsubscribe: (channel) => inner.unsubscribe(channel),
  };
}

describe.skipIf(!REDIS_UP)("#760 — présence répartie sur Redis réel", () => {
  const SECRET = `pres-${"k".repeat(32)}`;
  const bus = `nodefony:rt:presence:${Date.now()}`;
  const clients: RedisTestClient[] = [];
  const backplanes: RedisBackplane[] = [];
  const hubs: RealtimeHub[] = [];

  async function connected(): Promise<RedisTestClient> {
    const c = redisTestClient();
    await c.connect();
    clients.push(c);
    return c;
  }

  /** Un pod : un hub qui déclare `room:*` à présence diffusée, branché sur Redis. */
  async function pod(
    originId: string,
    door: IDoor = { deaf: false, closeAfter: null },
  ): Promise<{ hub: RealtimeHub; bp: RedisBackplane }> {
    const bp = new RedisBackplane(
      withDoor(
        createRedisServiceTransport(await connected(), await connected()),
        door,
      ),
      originId,
      bus,
      SECRET,
    );
    await bp.start();
    backplanes.push(bp);
    const hub = new RealtimeHub();
    hub.declareChannelPolicy("room:*", { presence: true }, null);
    hub.markBroadcastChannel("room:");
    hub.setBackplane(bp);
    hubs.push(hub);
    return { hub, bp };
  }

  afterEach(async () => {
    for (const hub of hubs) hub.clear();
    hubs.length = 0;
    await Promise.allSettled(backplanes.map((b) => b.stop()));
    backplanes.length = 0;
    await Promise.allSettled(
      clients.map(async (c) => {
        if (c.isOpen) await c.quit();
      }),
    );
    clients.length = 0;
  });

  it("une identité dans deux onglets sur deux pods = UN présent ; anonyme dans `unnamed` ; arrêt propre de A : retiré chez B par la preuve de vie finale, pas par l'oubli", async () => {
    const { hub: a } = await pod("pod-a");
    const { hub: b } = await pod("pod-b");
    client(a, "room:1", "alice");
    client(a, "room:1", null);
    client(b, "room:1", "alice");
    client(b, "room:1", "bob");
    await until(
      () =>
        JSON.stringify(view(b, "room:1")) ===
          JSON.stringify({ alice: 2, bob: 1 }) &&
        b.presence("room:1")?.unnamed === 1 &&
        b.presence("room:1")?.partial === false,
      "B voit les présents de A",
    );
    await until(
      () =>
        JSON.stringify(view(a, "room:1")) ===
        JSON.stringify({ alice: 2, bob: 1 }),
      "A voit les présents de B",
    );

    a.endPresence();
    await until(
      () =>
        JSON.stringify(view(b, "room:1")) ===
          JSON.stringify({ alice: 1, bob: 1 }) &&
        b.presence("room:1")?.unnamed === 0,
      "les présents de A quittent la vue de B",
    );
    expect(b.probe().presence).to.deep.include({
      endedTotal: 1,
      forgottenTotal: 0,
      presenceRejectedTotal: 0,
      presenceStaleDiscardedTotal: 0,
      gaps: 0,
    });
  });

  it("🔴 A vivant et calme n'est jamais oublié ; A tué (sans arrêt propre) disparaît de B au délai d'oubli", async () => {
    const { hub: a, bp: busA } = await pod("pod-a");
    const { hub: b } = await pod("pod-b");
    client(a, "room:1", "alice");
    client(b, "room:1", "bob");
    await until(
      () =>
        JSON.stringify(view(b, "room:1")) ===
        JSON.stringify({ alice: 1, bob: 1 }),
      "B voit Alice",
    );
    // Calme au-delà du délai d'oubli : seules les preuves de vie circulent.
    await wait(FORGET_MS + PRESENCE_INTERVAL_MS);
    expect(view(b, "room:1")).to.deep.equal({ alice: 1, bob: 1 });
    expect(b.probe().presence?.forgottenTotal).toBe(0);
    // L'écho de Redis a été relevé : le bus est constaté vivant.
    expect(b.probe().backplane?.echoTotal ?? 0).toBeGreaterThan(0);
    expect(b.probe().presence?.busLost).toBe(false);

    // A tué : plus rien ne part, aucune preuve de vie finale.
    a.clear();
    await busA.stop();
    await until(
      () => JSON.stringify(view(b, "room:1")) === JSON.stringify({ bob: 1 }),
      "Alice oubliée chez B",
      FORGET_MS + PRESENCE_INTERVAL_MS * 2,
    );
    expect(b.probe().presence).to.deep.include({
      forgottenTotal: 1,
      endedTotal: 0,
    });
  }, 60_000);

  it("🔴 écho coupé chez B : vue figée et `partial`, aucun pair oublié au-delà du délai ; l'écho revenu réarme et la vue redevient complète", async () => {
    const { hub: a } = await pod("pod-a");
    const door: IDoor = { deaf: false, closeAfter: null };
    const { hub: b } = await pod("pod-b", door);
    client(a, "room:1", "alice");
    client(b, "room:1", "bob");
    await until(
      () =>
        JSON.stringify(view(b, "room:1")) ===
          JSON.stringify({ alice: 1, bob: 1 }) &&
        b.presence("room:1")?.partial === false,
      "B voit Alice",
    );
    // Coupure juste APRÈS une preuve de vie de A : B l'a vu vivant à l'instant,
    // son délai d'oubli court en entier pendant la coupure.
    door.closeAfter = [PLATFORM_BUS_CHANNELS.presenceAlive, "pod-a"];
    await until(
      () => door.deaf,
      "la porte de B se ferme",
      PRESENCE_INTERVAL_MS * 2,
    );
    const cutAt = Date.now();
    await until(
      () => b.probe().presence?.busLost === true,
      "B constate la perte du bus par l'écho",
      PRESENCE_INTERVAL_MS * 3,
    );
    expect(b.presence("room:1")?.partial).toBe(true);
    // Au-delà du délai d'oubli depuis la coupure : personne n'est oublié.
    await wait(Math.max(0, cutAt + FORGET_MS + 1000 - Date.now()));
    expect(view(b, "room:1")).to.deep.equal({ alice: 1, bob: 1 });
    expect(b.probe().presence?.forgottenTotal).toBe(0);

    door.deaf = false;
    await until(
      () =>
        b.probe().presence?.busLost === false &&
        b.presence("room:1")?.partial === false,
      "l'écho revient, la vue redevient complète",
      PRESENCE_INTERVAL_MS * 3,
    );
    expect(b.probe().presence?.rearmTotal).toBeGreaterThan(0);
    expect(view(b, "room:1")).to.deep.equal({ alice: 1, bob: 1 });
    expect(b.probe().presence?.forgottenTotal).toBe(0);
  }, 60_000);
});
