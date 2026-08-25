import assert from "node:assert/strict";
import { Container } from "nodefony";
import { createClient } from "redis";
import RedisService from "../../service/redis";
import { defineRedisConfig } from "../../config/defineModuleConfig";
import type { Module } from "nodefony";
import type { IRedisConfigInput } from "../../interfaces/IRedisConfig";

/**
 * Tests d'INTÉGRATION (connexion Redis réelle) — exigent l'infra :
 *   docker compose -f docker/docker-compose.yml up -d   (password "nodefony-dev")
 *
 * Auto-skip si Redis est injoignable (CI sans docker) : on ne fait PAS échouer
 * la suite, on la saute proprement (probe au chargement du fichier).
 */
const PASSWORD = process.env.NF_REDIS_PASSWORD ?? "nodefony-dev";
const HOST = process.env.NF_REDIS_HOST ?? "localhost";
const PORT = Number.parseInt(process.env.NF_REDIS_PORT ?? "6379", 10);

/** Probe : Redis répond-il à un PING authentifié ? */
async function redisReachable(): Promise<boolean> {
  const probe = createClient({
    socket: {
      host: HOST,
      port: PORT,
      connectTimeout: 1500,
      reconnectStrategy: false,
    },
    password: PASSWORD,
  });
  probe.on("error", () => {});
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

/** Construit un Module minimal (faux) suffisant pour RedisService. */
function fakeModule(redis: IRedisConfigInput): Module {
  const container = new Container();
  // Le service lit sa config VALIDÉE via `this.module.config` (comme en prod, où
  // le Module valide à onKernelRegister). On fournit la config validée directement.
  const config = defineRedisConfig(redis);
  return {
    container,
    kernel: null,
    options: config,
    config,
  } as unknown as Module;
}

describe.skipIf(!REDIS_UP)("@nodefony/redis — intégration (Redis réel)", () => {
  const config: IRedisConfigInput = {
    globalOptions: { socket: { host: HOST, port: PORT }, password: PASSWORD },
  };

  it("ouvre les 3 connexions par défaut (main/publish/subscribe)", async () => {
    const service = new RedisService(fakeModule(config));
    await service.init();
    try {
      assert.deepEqual(Object.keys(service.connections).sort(), [
        "main",
        "publish",
        "subscribe",
      ]);
      assert.equal(service.getConnection("main")?.connected, true);
      assert.ok(service.getClient("main")?.isOpen);
    } finally {
      await service.closeConnections();
    }
  });

  it("set/get sur la connexion main", async () => {
    const service = new RedisService(fakeModule(config));
    await service.init();
    try {
      const client = service.getClient("main");
      assert.ok(client);
      const key = `nodefony:test:${Date.now()}`;
      await client!.set(key, "ok", { EX: 30 });
      assert.equal(await client!.get(key), "ok");
      await client!.del(key);
    } finally {
      await service.closeConnections();
    }
  });

  it("pub/sub : publish (publish) → subscribe (subscribe)", async () => {
    const service = new RedisService(fakeModule(config));
    await service.init();
    try {
      const pub = service.getClient("publish");
      const sub = service.getClient("subscribe");
      assert.ok(pub && sub);

      const channel = `nodefony:chan:${Date.now()}`;
      const received = new Promise<string>((resolve) => {
        void sub!.subscribe(channel, (message) => resolve(message));
      });
      // petite latence pour garantir l'abonnement avant publication
      await new Promise((r) => setTimeout(r, 50));
      await pub!.publish(channel, "hello");

      const msg = await Promise.race([
        received,
        new Promise<string>((_, rej) =>
          setTimeout(() => rej(new Error("timeout pub/sub")), 2000),
        ),
      ]);
      assert.equal(msg, "hello");
      await sub!.unsubscribe(channel);
    } finally {
      await service.closeConnections();
    }
  });

  it("closeConnections est idempotent et libère les clients", async () => {
    const service = new RedisService(fakeModule(config));
    await service.init();
    await service.closeConnections();
    await service.closeConnections(); // 2ᵉ appel = no-op
    assert.deepEqual(Object.keys(service.connections), []);
    assert.equal(service.getClient("main"), null);
  });

  it("enabled=false → aucune connexion ouverte", async () => {
    const service = new RedisService(fakeModule({ ...config, enabled: false }));
    await service.init();
    assert.deepEqual(Object.keys(service.connections), []);
  });
});
