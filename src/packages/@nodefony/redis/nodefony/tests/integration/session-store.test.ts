import assert from "node:assert/strict";
import { createClient } from "redis";
import { SessionsService } from "@nodefony/http";
import RedisSessionStorage from "../../src/SessionStorage";
import { redisTestUrl } from "../helpers/redisTestUrl";
import { runSessionStoreContract } from "../../../../http/nodefony/tests/support/sessionStoreContract";

/**
 * Contrat comportemental du store de session déroulé sur **Redis**, plus ce qui
 * lui est propre et ne peut pas vivre dans un banc partagé : le **TTL natif**.
 *
 * L'atout de ce backend est aussi son point de vigilance — l'expiration n'est pas
 * réalisée par notre code mais par Redis. Deux façons de la casser sans que rien
 * ne le signale : écrire une clé **sans** `EX` (session immortelle), ou laisser
 * `touch` la recréer sans TTL. Ces deux pièges sont testés ici, par `TTL`.
 *
 * GATE : `REDIS_TEST_URL` (ex. `redis://:pass@127.0.0.1:6379/15`) — sans serveur
 * réel, ces assertions n'auraient aucun sens (un double « valide » toujours).
 */
// Base DÉDIÉE : ce banc purge (`flushDb`) — partager la base d'un autre fichier
// effacerait son seed en parallèle (vert en isolation, rouge en suite).
const REAL_URL = redisTestUrl(13);
const IDLE = 120;

let client: ReturnType<typeof createClient> | null = null;
let storage: RedisSessionStorage;

function makeManager(c: unknown): SessionsService {
  return {
    options: { idleTimeoutS: IDLE, absoluteTimeoutS: 0, store: "redis" },
    log: () => {},
    get: (name: string) => (name === "redis" ? { getClient: () => c } : null),
  } as unknown as SessionsService;
}

describe.skipIf(!REAL_URL)("Redis SessionStorage — contrat + TTL natif", () => {
  beforeAll(async () => {
    client = createClient({ url: REAL_URL! });
    await client.connect();
    storage = new RedisSessionStorage(makeManager(client));
  });

  afterAll(async () => {
    if (client) {
      await client.flushDb();
      await client.close();
    }
  });

  runSessionStoreContract({
    storage: () => storage,
    clear: async () => {
      await client!.flushDb();
    },
    expiry: "native-ttl",
    touch: true,
  });

  describe("TTL natif (propre à Redis)", () => {
    beforeAll(async () => {
      await client!.flushDb();
    });

    it("write pose un TTL — une session n'est JAMAIS écrite sans expiration", async () => {
      await storage.write("ttl-1", {
        Attributes: {},
        metaBag: {},
        flashBag: {},
        user: "alice",
      });
      const ttl = await client!.ttl("nf:sess:ttl-1");
      assert.ok(
        ttl > 0 && ttl <= IDLE,
        `TTL attendu dans ]0, ${IDLE}], obtenu ${ttl} ` +
          `(-1 = clé sans expiration → session immortelle)`,
      );
    });

    it("touch REPOUSSE le TTL (idle glissant) sans réécrire le blob", async () => {
      // On rabaisse le TTL à la main, puis on `touch` : s'il ne repositionnait
      // pas l'expiration, une session activement utilisée mourrait quand même.
      await client!.expire("nf:sess:ttl-1", 5);
      assert.ok((await client!.ttl("nf:sess:ttl-1")) <= 5);
      await storage.touch("ttl-1", IDLE);
      const ttl = await client!.ttl("nf:sess:ttl-1");
      assert.ok(ttl > 5, `TTL doit être repoussé (obtenu ${ttl})`);
    });

    it("une clé expirée disparaît de l'énumération (pas de fantôme)", async () => {
      await storage.write("ttl-2", {
        Attributes: {},
        metaBag: {},
        flashBag: {},
        user: "bob",
      });
      await client!.expire("nf:sess:ttl-2", 0); // expiration immédiate
      const page = await storage.listPage({ limit: 50 });
      assert.ok(!page.items.some((r) => r.id === "ttl-2"));
    });
  });
});
