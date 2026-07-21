import { describe, it, expect } from "vitest";
import {
  registerBackplaneDriver,
  getBackplaneDriver,
  listBackplaneDrivers,
  type IBackplaneFactoryContext,
} from "../../src/backplane/backplaneRegistry.js";
import { LoopbackBackplane } from "../../src/backplane/LoopbackBackplane.js";
import { ClusterBackplane } from "../../src/backplane/ClusterBackplane.js";
import { RedisBackplane } from "../../src/backplane/RedisBackplane.js";
// Importer l'entry du module enregistre les drivers natifs (side-effect voulu).
import "../../../index.js";

function ctx(
  over: Partial<IBackplaneFactoryContext> = {},
): IBackplaneFactoryContext {
  return {
    module: {
      log() {},
      kernel: { container: { get: () => undefined } },
    } as never,
    originId: "pid-test",
    role: "MONO",
    config: { backplane: { driver: "loopback" } } as never,
    ...over,
  };
}

describe("backplaneRegistry (résolution driver SANS if en dur)", () => {
  it("les drivers natifs sont enregistrés sous le nom porté par leur classe", () => {
    const names = listBackplaneDrivers();
    expect(names).to.include(LoopbackBackplane.driver); // "loopback"
    expect(names).to.include(ClusterBackplane.driver); // "cluster"
    expect(names).to.include(RedisBackplane.driver); // "redis"
    // "kafka" n'existe pas tant que le driver n'est pas codé (pas de littéral mort).
    expect(names).to.not.include("kafka");
  });

  it("loopback → null (hub local, 0 backplane objet)", async () => {
    const factory = getBackplaneDriver(LoopbackBackplane.driver)!;
    expect(await factory(ctx())).to.equal(null);
  });

  it("cluster → null hors worker, instance en worker NODEFONY_CLUSTER=1", async () => {
    const factory = getBackplaneDriver(ClusterBackplane.driver)!;
    expect(await factory(ctx({ role: "MONO" })), "mono → inactif").to.equal(
      null,
    );

    const prev = process.env.NODEFONY_CLUSTER;
    process.env.NODEFONY_CLUSTER = "1";
    try {
      const bp = await factory(ctx({ role: "WORKER" }));
      expect(bp).to.be.instanceOf(ClusterBackplane);
    } finally {
      if (prev === undefined) delete process.env.NODEFONY_CLUSTER;
      else process.env.NODEFONY_CLUSTER = prev;
    }
  });

  it("redis → null + warn fail-soft si module @nodefony/redis absent", async () => {
    const factory = getBackplaneDriver(RedisBackplane.driver)!;
    expect(await factory(ctx())).to.equal(null); // container.get('redis') = undefined
  });

  it("redis → instance quand RedisService expose publish/subscribe", async () => {
    const fakeClient = {
      publish() {},
      subscribe() {},
      unsubscribe() {},
    };
    const redisService = { getClient: () => fakeClient };
    const factory = getBackplaneDriver(RedisBackplane.driver)!;
    const bp = await factory(
      ctx({
        module: {
          log() {},
          kernel: { container: { get: () => redisService } },
        } as never,
      }),
    );
    expect(bp).to.be.instanceOf(RedisBackplane);
  });

  it("driver inconnu → undefined (le wiring warn fail-soft)", () => {
    expect(getBackplaneDriver("does-not-exist")).to.equal(undefined);
  });

  it("describe() : carte d'identité par driver (driver/kind/originId/crossPod/channel)", () => {
    expect(new LoopbackBackplane("p").describe()).to.deep.equal({
      driver: "loopback",
      kind: "local",
      originId: "p",
      crossPod: false,
    });
    expect(new ClusterBackplane(undefined, "p").describe()).to.deep.equal({
      driver: "cluster",
      kind: "ipc",
      originId: "p",
      crossPod: false,
    });
    const redis = new RedisBackplane(
      { publish() {}, subscribe() {}, unsubscribe() {} },
      "p",
      "app:rt",
    ).describe();
    expect(redis).to.deep.equal({
      driver: "redis",
      kind: "redis-pubsub",
      originId: "p",
      crossPod: true,
      channel: "app:rt",
      // Bus partagé sans secret : la carte d'identité l'annonce, et Studio
      // l'affiche — un transport non authentifié ne doit jamais être discret.
      sealed: false,
    });
  });

  it("registre OUVERT : un driver custom s'enregistre et se résout", async () => {
    const sentinel = { originId: "x" } as never;
    registerBackplaneDriver("nats-test", () => sentinel);
    const factory = getBackplaneDriver("nats-test")!;
    expect(await factory(ctx())).to.equal(sentinel);
    expect(listBackplaneDrivers()).to.include("nats-test");
  });
});
