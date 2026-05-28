import { describe, it, expect, afterEach } from "vitest";
import { createClient, type RedisClientType } from "redis";
import {
  RedisBackplane,
  createRedisServiceTransport,
} from "../../src/backplane/RedisBackplane.js";
import type { IBackplaneMessage } from "../../interfaces/IBackplane.js";

/**
 * Tests d'INTÉGRATION (Redis réel) — exigent l'infra :
 *   docker compose -f src/packages/@nodefony/redis/docker/docker-compose.yml up -d
 *
 * Prouve le fan-out **cross-pod** RÉEL via pub/sub Redis v5 : deux paires de
 * clients (pod A, pod B) → `createRedisServiceTransport` → deux `RedisBackplane`.
 * Auto-skip si Redis injoignable (CI sans docker) — probe au chargement.
 */
const PASSWORD = process.env.REDIS_PASSWORD ?? "nodefony-dev";
const HOST = process.env.REDIS_HOST ?? "localhost";
const PORT = Number.parseInt(process.env.REDIS_PORT ?? "6379", 10);

function mkClient(): RedisClientType {
  const c = createClient({
    socket: { host: HOST, port: PORT, reconnectStrategy: false },
    password: PASSWORD,
  }) as RedisClientType;
  c.on("error", () => {}); // silence (probe / teardown)
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
      await probe.destroy();
    } catch {
      /* déjà fermé */
    }
    return false;
  }
}

const REDIS_UP = await redisReachable();
const wait = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

describe.skipIf(!REDIS_UP)("RedisBackplane — intégration (Redis réel)", () => {
  const clients: RedisClientType[] = [];
  const backplanes: RedisBackplane[] = [];
  // canal Redis unique par run (évite la diaphonie entre exécutions parallèles)
  const channel = `nodefony:rt:test:${Date.now()}`;

  /** Crée un "pod" : publisher + subscriber dédiés branchés sur un RedisBackplane. */
  async function mkPod(originId: string): Promise<RedisBackplane> {
    const pub = mkClient();
    const sub = mkClient();
    await pub.connect();
    await sub.connect();
    clients.push(pub, sub);
    const bp = new RedisBackplane(
      createRedisServiceTransport(pub, sub),
      originId,
      channel,
    );
    backplanes.push(bp);
    return bp;
  }

  afterEach(async () => {
    await Promise.allSettled(backplanes.map((b) => b.stop()));
    backplanes.length = 0;
    await Promise.allSettled(
      clients.map(async (c) => {
        if (c.isOpen) await c.quit();
      }),
    );
    clients.length = 0;
  });

  it("fan-out cross-pod RÉEL : A.publish → B reçoit, A filtre son echo", async () => {
    const a = await mkPod("pod-A");
    const b = await mkPod("pod-B");
    const gotA: IBackplaneMessage[] = [];
    const gotB: IBackplaneMessage[] = [];
    a.onMessage((m) => gotA.push(m));
    b.onMessage((m) => gotB.push(m));
    await a.start();
    await b.start();
    await wait(80); // garantit l'abonnement effectif avant publication

    a.publish("syslog:stream", { line: "hello" });

    // pub/sub Redis = best-effort async → on attend la livraison
    await wait(150);
    expect(
      gotA,
      "anti-echo : l'émetteur ignore son propre message",
    ).to.have.lengthOf(0);
    expect(gotB).to.deep.equal([
      {
        channel: "syslog:stream",
        payload: { line: "hello" },
        originId: "pod-A",
      },
    ]);
  });

  it("stop() coupe la réception (B ne reçoit plus après stop)", async () => {
    const a = await mkPod("pod-A");
    const b = await mkPod("pod-B");
    let fired = 0;
    b.onMessage(() => (fired += 1));
    await a.start();
    await b.start();
    await wait(80);
    await b.stop();
    await wait(30);

    a.publish("c", 1);
    await wait(120);
    expect(fired).to.equal(0);
  });
});
