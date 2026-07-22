import { describe, it, expect, afterEach } from "vitest";
import { createClient, type RedisClientType } from "redis";
import {
  RedisBackplane,
  createRedisServiceTransport,
} from "../../src/backplane/RedisBackplane.js";
import { sealBackplaneEnvelope } from "../../src/backplane/envelope.js";
import { RealtimeHub } from "../../src/server/RealtimeHub.js";
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

    a.publish("nodefony:syslog", { line: "hello" });

    // pub/sub Redis = best-effort async → on attend la livraison
    await wait(150);
    expect(
      gotA,
      "anti-echo : l'émetteur ignore son propre message",
    ).to.have.lengthOf(0);
    expect(gotB).to.deep.equal([
      {
        channel: "nodefony:syslog",
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

/**
 * F83 — **injection depuis le bus**, sur Redis RÉEL. L'attaquant n'est pas un pod :
 * c'est un client Redis brut (autre application d'un Redis mutualisé, credential
 * fuité, SSRF vers le port) qui écrit directement sur le canal de transport. On
 * mesure au bout de la chaîne : ce qu'un abonné du hub reçoit vraiment.
 */
describe.skipIf(!REDIS_UP)("F83 — injection tierce sur le bus Redis", () => {
  const clients: RedisClientType[] = [];
  const backplanes: RedisBackplane[] = [];
  const hubs: RealtimeHub[] = [];
  const channel = `nodefony:rt:f83:${Date.now()}`;
  const SECRET = `f83-${"k".repeat(32)}`;
  const factory = (): (() => void) => () => {};

  /** Pod complet : hub + backplane Redis, comme en production. */
  async function mkHubPod(
    originId: string,
    secret: string | null,
  ): Promise<{ hub: RealtimeHub; bp: RedisBackplane }> {
    const pub = mkClient();
    const sub = mkClient();
    await pub.connect();
    await sub.connect();
    clients.push(pub, sub);
    const bp = new RedisBackplane(
      createRedisServiceTransport(pub, sub),
      originId,
      channel,
      secret,
    );
    await bp.start();
    const hub = new RealtimeHub();
    hub.setBackplane(bp);
    backplanes.push(bp);
    hubs.push(hub);
    return { hub, bp };
  }

  /** L'attaquant : un client Redis nu qui publie ce qu'il veut sur le canal. */
  async function mkAttacker(): Promise<RedisClientType> {
    const c = mkClient();
    await c.connect();
    clients.push(c);
    return c;
  }

  afterEach(async () => {
    for (const h of hubs) h.clear();
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

  it("CONTRÔLE NÉGATIF : sans secret, l'injection tierce ARRIVE aux abonnés", async () => {
    // Reproduit la faille d'origine sur du vrai Redis — sans ce cas, on ne
    // prouverait pas que le banc sait détecter une injection.
    const { hub } = await mkHubPod("pod-victime", null);
    hub.markBroadcastChannel("chat:");
    const got: unknown[] = [];
    hub.subscribe("chat:room1", (p) => got.push(p), factory);
    const evil = await mkAttacker();
    await wait(80);

    await evil.publish(
      channel,
      JSON.stringify({
        channel: "chat:room1",
        payload: { msg: "je suis l'admin" },
        originId: "evil",
      }),
    );
    await wait(150);

    expect(got).to.deep.equal([{ msg: "je suis l'admin" }]);
  });

  it("secret posé : la même injection NON SCELLÉE est ignorée", async () => {
    const { hub } = await mkHubPod("pod-victime", SECRET);
    hub.markBroadcastChannel("chat:");
    const got: unknown[] = [];
    hub.subscribe("chat:room1", (p) => got.push(p), factory);
    const evil = await mkAttacker();
    await wait(80);

    await evil.publish(
      channel,
      JSON.stringify({
        channel: "chat:room1",
        payload: { msg: "je suis l'admin" },
        originId: "evil",
      }),
    );
    await wait(150);

    expect(got).to.deep.equal([]);
  });

  it("secret VOLÉ : le canal système reste hors d'atteinte (admission du hub)", async () => {
    // Défense en profondeur : l'attaquant scelle correctement (il a le secret),
    // mais `nodefony:audit` n'est pas un canal broadcast → le hub refuse.
    const { hub } = await mkHubPod("pod-victime", SECRET);
    const got: unknown[] = [];
    hub.subscribe("nodefony:audit", (p) => got.push(p), factory);
    const evil = await mkAttacker();
    await wait(80);

    await evil.publish(
      channel,
      sealBackplaneEnvelope(
        {
          channel: "nodefony:audit",
          payload: { action: "faux évènement d'audit" },
          originId: "evil",
        },
        SECRET,
      ),
    );
    await wait(150);

    expect(got).to.deep.equal([]);
    expect(hub.probe().ingressRejectedTotal).to.equal(1);
  });

  it("NOMINAL : deux pods au même secret gardent leur fan-out cross-pod", async () => {
    const a = await mkHubPod("pod-A", SECRET);
    const b = await mkHubPod("pod-B", SECRET);
    a.hub.markBroadcastChannel("chat:");
    b.hub.markBroadcastChannel("chat:");
    const got: unknown[] = [];
    b.hub.subscribe("chat:room1", (p) => got.push(p), factory);
    await wait(80);

    a.hub.publish("chat:room1", { msg: "vrai message" });
    await wait(150);

    expect(got).to.deep.equal([{ msg: "vrai message" }]);
    expect(b.hub.probe().ingressRejectedTotal).to.equal(0);
  });
});
