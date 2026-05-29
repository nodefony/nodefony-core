import assert from "node:assert/strict";
import { redisConfigSchema } from "../../config/schema";
import { defineRedisConfig } from "../../config/defineRedisConfig";
import { buildClientOptions } from "../../src/buildClientOptions";

// Isolation : ces tests unitaires doivent être déterministes quelle que soit la
// façon dont vitest est lancé (ex. `REDIS_PASSWORD=... vitest run` pour
// l'intégration). On purge les variables d'env Redis ambiantes au chargement ;
// le bloc « env layering » les pose lui-même et restaure ensuite.
for (const k of ["REDIS_URL", "REDIS_HOST", "REDIS_PORT", "REDIS_PASSWORD"]) {
  delete process.env[k];
}

describe("@nodefony/redis — schema (Zod)", () => {
  it("applique les défauts sûrs (localhost, 3 connexions)", () => {
    const c = redisConfigSchema.parse({});
    assert.equal(c.enabled, true);
    assert.equal(c.globalOptions.socket.host, "localhost");
    assert.equal(c.globalOptions.socket.port, 6379);
    assert.equal(c.globalOptions.socket.tls, false);
    assert.deepEqual(Object.keys(c.connections).sort(), [
      "main",
      "publish",
      "subscribe",
    ]);
    assert.equal(c.connections.main.database, 0);
  });

  it("applique les sous-défauts de reconnectStrategy", () => {
    const c = redisConfigSchema.parse({});
    assert.deepEqual(c.globalOptions.socket.reconnectStrategy, {
      baseMs: 100,
      maxMs: 10_000,
      maxRetries: 0,
    });
  });

  it("rejette un port hors plage", () => {
    assert.throws(() =>
      redisConfigSchema.parse({ globalOptions: { socket: { port: 70_000 } } }),
    );
  });
});

describe("@nodefony/redis — defineRedisConfig (env layering)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("gèle la config", () => {
    const c = defineRedisConfig({});
    assert.ok(Object.isFrozen(c));
  });

  it("REDIS_HOST / REDIS_PORT / REDIS_PASSWORD surchargent", () => {
    process.env.REDIS_HOST = "redis.internal";
    process.env.REDIS_PORT = "6380";
    process.env.REDIS_PASSWORD = "s3cret";
    const c = defineRedisConfig({});
    assert.equal(c.globalOptions.socket.host, "redis.internal");
    assert.equal(c.globalOptions.socket.port, 6380);
    assert.equal(c.globalOptions.password, "s3cret");
  });

  it("REDIS_URL surcharge l'url", () => {
    process.env.REDIS_URL = "redis://u:p@h:6390/2";
    const c = defineRedisConfig({});
    assert.equal(c.url, "redis://u:p@h:6390/2");
  });

  it("ignore un REDIS_PORT invalide", () => {
    process.env.REDIS_PORT = "not-a-port";
    const c = defineRedisConfig({});
    assert.equal(c.globalOptions.socket.port, 6379);
  });
});

describe("@nodefony/redis — defineRedisConfig (résilience boot)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("hors prod, maxRetries non surchargé → borné (5, pas illimité)", () => {
    delete process.env.NODE_ENV; // !== production
    const c = defineRedisConfig({});
    assert.equal(c.globalOptions.socket.reconnectStrategy.maxRetries, 5);
  });

  it("hors prod, maxRetries explicite de l'app est respecté", () => {
    process.env.NODE_ENV = "development";
    const c = defineRedisConfig({
      globalOptions: { socket: { reconnectStrategy: { maxRetries: 0 } } },
    });
    assert.equal(c.globalOptions.socket.reconnectStrategy.maxRetries, 0);
  });

  it("en production, maxRetries reste illimité (0) par défaut", () => {
    process.env.NODE_ENV = "production";
    const c = defineRedisConfig({});
    assert.equal(c.globalOptions.socket.reconnectStrategy.maxRetries, 0);
  });
});

describe("@nodefony/redis — buildClientOptions", () => {
  it("assemble socket depuis globalOptions + override connexion", () => {
    const config = defineRedisConfig({
      globalOptions: { socket: { host: "g", port: 1111 }, password: "pw" },
      connections: {
        main: { name: "main", database: 3, socket: { host: "override" } },
      },
    });
    const opts = buildClientOptions(config, config.connections.main);
    assert.equal(opts.name, "main");
    assert.equal(opts.database, 3);
    assert.equal(opts.password, "pw");
    const socket = opts.socket as { host?: string; port?: number };
    assert.equal(socket.host, "override");
    assert.equal(socket.port, 1111);
    assert.equal(typeof socket.reconnectStrategy, "function");
  });

  it("url prend précédence (pas de host/port posés)", () => {
    const config = defineRedisConfig({
      url: "redis://h:6400",
      connections: { main: { name: "main" } },
    });
    const opts = buildClientOptions(config, config.connections.main);
    assert.equal(opts.url, "redis://h:6400");
    const socket = opts.socket as { host?: string };
    assert.equal(socket.host, undefined);
  });

  it("reconnectStrategy : back-off borné + abandon sur maxRetries", () => {
    const config = defineRedisConfig({
      globalOptions: {
        socket: {
          reconnectStrategy: { baseMs: 100, maxMs: 250, maxRetries: 3 },
        },
      },
      connections: { main: { name: "main" } },
    });
    const opts = buildClientOptions(config, config.connections.main);
    const strat = (
      opts.socket as { reconnectStrategy: (n: number) => number | Error }
    ).reconnectStrategy;
    assert.equal(strat(0), 100);
    assert.equal(strat(1), 200);
    assert.equal(strat(2), 250); // borné à maxMs
    assert.ok(strat(3) instanceof Error); // abandon
  });
});
