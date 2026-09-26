import { redisTestUrl } from "../helpers/redisTestUrl";
import { FakeRedis } from "../helpers/fakeRedis";
import {
  RedisTokenStore,
  type RedisClientLike,
} from "../../src/RedisTokenStore";
import { runTokenStoreContract } from "../../../../security/tests/support/tokenStoreContract";

/**
 * Enveloppe Redis du **banc de contrat UNIQUE** du store de jetons — le banc vit
 * chez `@nodefony/security`, et la mémoire, Drizzle et Mongoose branchent
 * EXACTEMENT le même. Redis y déclare sa différence voulue : l'expiration est
 * portée par le TTL natif (`nativeTtl`), donc `gc()` n'a rien à balayer.
 *
 * Deux décors, parce qu'ils prouvent des choses différentes :
 * - le **double** fidèle, dont le TTL suit l'horloge du banc — seul moyen
 *   d'éprouver l'expiration sans attendre ;
 * - le **serveur réel**, qui prouve les commandes et la vraie concurrence, mais
 *   dont on n'avance pas le temps (`clockDrivenExpiry: false`).
 */
describe("RedisTokenStore — contrat ITokenStore (double à horloge injectée)", () => {
  let clock: () => number = () => 0;
  let fake = new FakeRedis(() => clock());
  runTokenStoreContract({
    create: (now, retention) => {
      clock = now;
      return new RedisTokenStore(() => fake, now, retention);
    },
    clear: async () => {
      fake = new FakeRedis(() => clock());
    },
    nativeTtl: true,
  });
});

// Base DÉDIÉE (cf `redisTestUrl`) : ce fichier purge la sienne.
const URL = redisTestUrl(7);
describe.skipIf(!URL)(
  "RedisTokenStore — contrat ITokenStore (serveur réel)",
  () => {
    let client: RedisClientLike & {
      connect(): Promise<unknown>;
      flushDb(): Promise<unknown>;
      close(): Promise<unknown>;
    };

    beforeAll(async () => {
      const { createClient } = await import("redis");
      client = createClient({ url: URL! });
      await client.connect();
      await client.flushDb();
    });

    afterAll(async () => {
      await client?.flushDb();
      await client?.close();
    });

    runTokenStoreContract({
      create: (now, retention) =>
        new RedisTokenStore(() => client, now, retention),
      clear: async () => {
        await client.flushDb();
      },
      nativeTtl: true,
      clockDrivenExpiry: false,
    });
  },
);
