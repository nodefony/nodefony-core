import assert from "node:assert/strict";
import { redisConfigSchema } from "../../config/config";
import { defineRedisConfig } from "../../config/defineModuleConfig";
import { configJsonSchema } from "../../config/configSchema";
import { applyEnvShortcuts, collectEnvShortcuts } from "nodefony";
import { buildClientOptions } from "../../src/buildClientOptions";

// Isolation : ces tests unitaires doivent être déterministes quelle que soit la
// façon dont vitest est lancé (ex. `NF_REDIS_PASSWORD=... vitest run` pour
// l'intégration). On purge les variables d'env Redis ambiantes au chargement ;
// le bloc « env layering » les pose lui-même et restaure ensuite.
// `NF_REDIS_URL` est PRIORITAIRE sur `REDIS_URL` (resolveInfra) : l'omettre de
// cette purge laissait un poste qui la pose faire échouer « REDIS_URL surcharge
// l'url » — le test aurait mesuré l'environnement, pas le code.
for (const k of [
  "NF_REDIS_URL",
  "REDIS_URL",
  "NF_REDIS_HOST",
  "NF_REDIS_PORT",
  "NF_REDIS_PASSWORD",
]) {
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
    assert.equal(c.connections.main!.database, 0);
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

  it("les noms courts sont DÉCLARÉS dans le schéma, sur le champ qu'ils règlent", () => {
    const found = collectEnvShortcuts(configJsonSchema());
    assert.deepEqual(
      Object.fromEntries(found.map((s) => [s.env, s.path.join(".")])),
      {
        NF_REDIS_HOST: "globalOptions.socket.host",
        NF_REDIS_PORT: "globalOptions.socket.port",
        NF_REDIS_PASSWORD: "globalOptions.password",
        NF_REDIS_KEY_NAMESPACE: "keyNamespace",
      },
    );
    const secret = Object.fromEntries(found.map((s) => [s.env, s.secret]));
    assert.equal(secret.NF_REDIS_PASSWORD, true);
    // Le nom contient « KEY » : sans `secret: false` déclaré, la cloison serait
    // masquée partout (journal, rapport, notice) alors qu'elle n'a rien de secret.
    assert.equal(secret.NF_REDIS_KEY_NAMESPACE, false);
  });

  it("posés comme le Kernel les pose, puis validés par le builder", () => {
    const options: Record<string, unknown> = {};
    applyEnvShortcuts(options, configJsonSchema(), {
      NF_REDIS_HOST: "redis.internal",
      NF_REDIS_PORT: "6380",
      NF_REDIS_PASSWORD: "s3cret",
    });
    const c = defineRedisConfig(options);
    assert.equal(c.globalOptions.socket.host, "redis.internal");
    assert.equal(c.globalOptions.socket.port, 6380);
    assert.equal(c.globalOptions.password, "s3cret");
  });

  it("le builder ne lit PLUS ces variables lui-même — le Kernel les pose", () => {
    // Une seule lecture : la lire aussi ici rétablirait la double écriture,
    // et une valeur fausse y échapperait à la validation.
    process.env.NF_REDIS_HOST = "redis.internal";
    const c = defineRedisConfig({});
    assert.equal(c.globalOptions.socket.host, "localhost");
  });

  it("REDIS_URL surcharge l'url", () => {
    process.env.REDIS_URL = "redis://u:p@h:6390/2";
    const c = defineRedisConfig({});
    assert.equal(c.url, "redis://u:p@h:6390/2");
  });

  it("un NF_REDIS_PORT invalide arrête le démarrage, il n'est plus ignoré", () => {
    // Ignoré, il laissait le port par défaut s'appliquer en silence :
    // l'exploitant croyait avoir réglé ce qu'il n'avait pas réglé.
    const options: Record<string, unknown> = {};
    applyEnvShortcuts(options, configJsonSchema(), {
      NF_REDIS_PORT: "not-a-port",
    });
    assert.throws(
      () => defineRedisConfig(options),
      (e: unknown) => (e as Error).name === "BootConfigurationError",
    );
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
    const opts = buildClientOptions(config, config.connections.main!);
    assert.equal(opts.name, "main");
    assert.equal(opts.database, 3);
    assert.equal(opts.password, "pw");
    const socket = opts.socket as {
      host?: string;
      port?: number;
      reconnectStrategy?: (retries: number) => number | Error;
    };
    assert.equal(socket.host, "override");
    assert.equal(socket.port, 1111);
    assert.equal(typeof socket.reconnectStrategy, "function");
  });

  it("url prend précédence (pas de host/port posés)", () => {
    const config = defineRedisConfig({
      url: "redis://h:6400",
      connections: { main: { name: "main" } },
    });
    const opts = buildClientOptions(config, config.connections.main!);
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
    const opts = buildClientOptions(config, config.connections.main!);
    const strat = (
      opts.socket as { reconnectStrategy: (n: number) => number | Error }
    ).reconnectStrategy;
    assert.equal(strat(0), 100);
    assert.equal(strat(1), 200);
    assert.equal(strat(2), 250); // borné à maxMs
    assert.ok(strat(3) instanceof Error); // abandon
  });
});
