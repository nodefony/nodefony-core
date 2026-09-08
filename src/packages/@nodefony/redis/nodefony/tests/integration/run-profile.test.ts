import assert from "node:assert/strict";
import {
  Container,
  CONSOLE_RUN_PROFILE,
  CONSOLE_DATA_RUN_PROFILE,
} from "nodefony";
import { createClient } from "redis";
import RedisService from "../../service/redis";
import { defineRedisConfig } from "../../config/defineModuleConfig";
import type { Module } from "nodefony";
import type { IRedisConfigInput } from "../../interfaces/IRedisConfig";

/**
 * Le profil du run gouverne ce que le BOOT ouvre de lui-même.
 *
 * Un pod porte souvent `NF_REDIS_URL` dans son environnement ; sans cette garde,
 * un `nodefony inspect` y ouvrait trois sockets Redis pour ne rien en faire.
 * Ce banc éprouve les DEUX sens — c'est le seul moyen de distinguer une garde
 * qui mord d'une garde qui refuse tout.
 */
const PASSWORD = process.env.NF_REDIS_PASSWORD ?? "nodefony-dev";
const HOST = process.env.NF_REDIS_HOST ?? "localhost";
const PORT = Number.parseInt(process.env.NF_REDIS_PORT ?? "6379", 10);

async function redisJoignable(): Promise<boolean> {
  const sonde = createClient({
    socket: {
      host: HOST,
      port: PORT,
      connectTimeout: 1500,
      reconnectStrategy: false,
    },
    password: PASSWORD,
  });
  sonde.on("error", () => {});
  try {
    await sonde.connect();
    await sonde.ping();
    await sonde.quit();
    return true;
  } catch {
    try {
      await sonde.destroy();
    } catch {
      /* déjà fermé */
    }
    return false;
  }
}

const REDIS_UP = await redisJoignable();

/** Module minimal porteur d'un kernel dont on choisit le profil de run. */
function moduleAvecProfil(
  redis: IRedisConfigInput,
  profil: typeof CONSOLE_RUN_PROFILE | null,
): Module {
  const config = defineRedisConfig(redis);
  return {
    container: new Container(),
    kernel:
      profil === null
        ? null
        : // `once` : le service s'abonne à `onTerminate` dès son constructeur.
          { runProfile: { ...profil }, once: () => undefined },
    options: config,
    config,
  } as unknown as Module;
}

describe.skipIf(!REDIS_UP)(
  "@nodefony/redis — le profil du run gouverne le boot",
  () => {
    const config: IRedisConfigInput = {
      globalOptions: { socket: { host: HOST, port: PORT }, password: PASSWORD },
    };

    it("n'ouvre AUCUNE connexion quand le run ne déclare pas externalServices", async () => {
      const service = new RedisService(
        moduleAvecProfil(config, CONSOLE_RUN_PROFILE),
      );
      await service.init();
      try {
        // Le décor est bon : Redis répond (REDIS_UP), la config déclare bien des
        // connexions — seul le profil explique le zéro. Sans cette seconde
        // assertion, un test vert dirait seulement « rien n'a marché ».
        assert.ok(
          Object.keys(defineRedisConfig(config).connections).length > 0,
          "le décor doit déclarer des connexions, sinon le zéro ne prouve rien",
        );
        assert.deepEqual(Object.keys(service.connections), []);
        assert.equal(service.getClient("main"), null);
      } finally {
        await service.closeConnections();
      }
    });

    it("ouvre les connexions quand le run déclare externalServices", async () => {
      const service = new RedisService(
        moduleAvecProfil(config, CONSOLE_DATA_RUN_PROFILE),
      );
      await service.init();
      try {
        assert.ok(Object.keys(service.connections).length > 0);
        assert.ok(service.getClient("main")?.isOpen);
      } finally {
        await service.closeConnections();
      }
    });

    it("sert le chemin du backplane realtime sous un profil SERVEUR", async () => {
      // Le backplane temps réel consomme `getClient("publish"/"subscribe")` — il ne
      // passe par AUCUN store, donc `CONNECTED_STORES` ne le protège pas. Tout run
      // serveur déclare `externalServices` (`DevCommand`, `runtimeLauncher`), mais
      // le banc du backplane crée ses clients au client `redis` NU : il est aveugle
      // à ce chemin. C'est donc ici, et nulle part ailleurs, qu'il est éprouvé.
      const service = new RedisService(
        moduleAvecProfil(config, {
          ...CONSOLE_DATA_RUN_PROFILE,
          servers: true,
          lifetime: "longrunning",
        }),
      );
      await service.init();
      try {
        assert.ok(service.getClient("publish")?.isOpen, "canal de publication");
        assert.ok(service.getClient("subscribe")?.isOpen, "canal d'abonnement");
      } finally {
        await service.closeConnections();
      }
    });

    it("ouvre les connexions hors kernel — l'appel est alors un ORDRE", async () => {
      const service = new RedisService(moduleAvecProfil(config, null));
      await service.init();
      try {
        assert.ok(service.getClient("main")?.isOpen);
      } finally {
        await service.closeConnections();
      }
    });
  },
);
