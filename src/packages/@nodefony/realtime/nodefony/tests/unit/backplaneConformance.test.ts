import { describe, it, expect } from "vitest";
import { ClusterRelay, type IRelayWorker } from "nodefony";
import {
  runBackplaneConformance,
  BACKPLANE_CONFORMANCE_CASES,
  type BackplanePeerFactory,
  type IBackplaneConformanceOptions,
} from "../../testing/index.js";
import {
  ClusterBackplane,
  type IClusterBackplaneTransport,
} from "../../src/backplane/ClusterBackplane.js";
import { RedisBackplane } from "../../src/backplane/RedisBackplane.js";
import { FakeRedisBus } from "../helpers/fakeRedisBus.js";
import { memoryBus, type MemoryBusFlaw } from "../helpers/memoryBus.js";

/**
 * Suite de conformité des drivers (`@nodefony/realtime/testing`) — jouée contre
 * les drivers livrés, puis éprouvée elle-même : un faux driver correct la passe,
 * chaque défaut connu la fait tomber sur le cas qui le vise.
 *
 * Le driver `loopback` n'y figure pas : il n'a, par définition, aucun pair — la
 * suite décrit un bus, et un bus sans pair n'a rien à diffuser.
 */

/**
 * Cluster : des workers reliés par le VRAI relais du maître (`ClusterRelay`),
 * clonage structuré entre les deux bords comme l'IPC `advanced`.
 */
function clusterBus(): BackplanePeerFactory {
  const relay = new ClusterRelay();
  let next = 0;
  return () => {
    const id = (next += 1);
    let toWorker: ((msg: unknown) => void) | null = null;
    let toMaster: ((msg: unknown) => void) | null = null;
    const worker: IRelayWorker = {
      id,
      send: (msg) => toWorker?.(structuredClone(msg)),
      onMessage: (cb) => {
        toMaster = cb;
      },
    };
    const transport: IClusterBackplaneTransport = {
      send: (env) => queueMicrotask(() => toMaster?.(structuredClone(env))),
      onReceive: (cb) => {
        toWorker = cb;
      },
    };
    relay.attach(worker);
    return new ClusterBackplane(transport, `worker-${id}`);
  };
}

/** Redis sur un bus en mémoire (le Redis réel : `tests/integration/RedisBackplane.test.ts`). */
function redisBus(): BackplanePeerFactory {
  const bus = new FakeRedisBus();
  let next = 0;
  return (secret) =>
    new RedisBackplane(
      bus.transport(),
      `pod-${(next += 1)}`,
      undefined,
      secret,
    );
}

runBackplaneConformance("cluster", clusterBus(), {
  describe,
  it,
  sealed: false,
  quietMs: 20,
});
runBackplaneConformance("redis (bus en mémoire)", redisBus(), {
  describe,
  it,
  quietMs: 20,
});
runBackplaneConformance("mémoire (banc de la suite)", memoryBus().makePeer, {
  describe,
  it,
  quietMs: 20,
});

/** Joue un cas de la suite hors du lanceur, pour constater qu'il ÉCHOUE. */
async function runCase(
  makePeer: BackplanePeerFactory,
  name: string,
  extra: Partial<IBackplaneConformanceOptions> = {},
): Promise<void> {
  const cases = new Map<string, () => Promise<void>>();
  runBackplaneConformance("épreuve", makePeer, {
    describe: (_n, body) => body(),
    it: (n, body) => cases.set(n, body),
    quietMs: 20,
    timeoutMs: 200,
    ...extra,
  });
  const body = cases.get(name);
  if (body === undefined) throw new Error(`cas inconnu : ${name}`);
  await body();
}

describe("suite de conformité — vue ROUGE sur des drivers défectueux", () => {
  const C = BACKPLANE_CONFORMANCE_CASES;
  const flawed = (flaw: MemoryBusFlaw): BackplanePeerFactory =>
    memoryBus(flaw).makePeer;

  it("un bus qui ne livre qu'à UN pair (groupe de lecteurs partagé) tombe sur la diffusion", async () => {
    await expect(runCase(flawed("unicast"), C.fanout)).rejects.toThrow(
      /répartit/,
    );
  });

  it("un bus qui REJOUE l'historique au démarrage tombe sur le rejeu", async () => {
    await expect(runCase(flawed("replay"), C.noReplay)).rejects.toThrow(
      /rejeu au démarrage/,
    );
  });

  it("un bus qui ignore le secret tombe sur le sceau", async () => {
    await expect(runCase(flawed("unsealed"), C.seal)).rejects.toThrow(
      /non scellé ou mal scellé/,
    );
  });

  it("un bus qui quitte la machine ne peut pas se dispenser du sceau", async () => {
    const crossPod: BackplanePeerFactory = (secret) => {
      const peer = memoryBus().makePeer(secret);
      peer.describe = () => ({
        driver: "memory",
        kind: "local",
        originId: peer.originId,
        crossPod: true,
      });
      return peer;
    };
    await expect(runCase(crossPod, C.seal, { sealed: false })).rejects.toThrow(
      /doit sceller/,
    );
  });
});
