import { createClient } from "redis";
import { RedisTokenStore } from "../../src/RedisTokenStore";
import type { RedisClientLike } from "../../src/RedisTokenStore";
import { runTokenPaginationContract } from "../../../../security/tests/support/tokenPaginationContract";
import { redisTestUrl } from "../helpers/redisTestUrl";

/**
 * Le banc de contrat unique de pagination des jetons (`@nodefony/security`),
 * déroulé sur le store Redis en mode **curseur**.
 *
 * **Double backend, un seul fichier** :
 * - par défaut → `FakePaginatingRedis` (déterministe, SCAN qui pagine réellement par
 *   COUNT) → le banc tourne TOUJOURS (non-régression) ;
 * - avec `NF_REDIS_TEST_URL` (ex. `redis://:pass@127.0.0.1:6379/15`) → **vrai serveur
 *   Redis** : la preuve que le `SCAN` réel (curseur RESP = string opaque) est câblé
 *   correctement de bout en bout. La DB dédiée est purgée par `flushDb`.
 */
// Base DÉDIÉE : ce banc purge (`flushDb`). Partager la base d'un autre fichier
// rendrait le résultat dépendant de l'ORDRE d'exécution (vert en isolation,
// rouge en suite) — le pire symptôme, car il fait suspecter le code.
const REAL_URL = redisTestUrl(12);
const RETENTION_MS = 30 * 24 * 3_600_000;

function globToRegExp(glob: string | undefined): RegExp | null {
  if (!glob) return null;
  const escaped = glob
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/** Double déterministe : SCAN paginant (curseur = index sérialisé en string, "0" = fin). */
class FakePaginatingRedis {
  readonly #hashes = new Map<string, Record<string, string>>();
  readonly #strings = new Map<string, string>();
  readonly #sets = new Map<string, Set<string>>();

  del(key: string): Promise<number> {
    const had =
      this.#hashes.delete(key) ||
      this.#strings.delete(key) ||
      this.#sets.delete(key);
    return Promise.resolve(had ? 1 : 0);
  }
  hSet(key: string, fields: Record<string, string>): Promise<number> {
    this.#hashes.set(key, { ...fields });
    return Promise.resolve(Object.keys(fields).length);
  }
  hGetAll(key: string): Promise<Record<string, string>> {
    return Promise.resolve(this.#hashes.get(key) ?? {});
  }
  expire(): Promise<boolean> {
    return Promise.resolve(true);
  }
  set(key: string, value: string): Promise<unknown> {
    this.#strings.set(key, value);
    return Promise.resolve("OK");
  }
  sAdd(key: string, member: string): Promise<number> {
    let set = this.#sets.get(key);
    if (!set) {
      set = new Set();
      this.#sets.set(key, set);
    }
    set.add(member);
    return Promise.resolve(1);
  }
  scan(
    cursor: string,
    options?: { MATCH?: string; COUNT?: number },
  ): Promise<{ cursor: string; keys: string[] }> {
    const start = Number.parseInt(cursor, 10) || 0;
    const count = options?.COUNT ?? 10;
    const re = globToRegExp(options?.MATCH);
    const all = [...this.#hashes.keys()].filter((k) => !re || re.test(k));
    const slice = all.slice(start, start + count);
    const nextIndex = start + count;
    return Promise.resolve({
      cursor: nextIndex >= all.length ? "0" : String(nextIndex),
      keys: slice,
    });
  }
  flush(): void {
    this.#hashes.clear();
    this.#strings.clear();
    this.#sets.clear();
  }
}

const fake = new FakePaginatingRedis();
let realClient: ReturnType<typeof createClient> | null = null;
let store: RedisTokenStore;

beforeAll(async () => {
  if (REAL_URL) {
    realClient = createClient({ url: REAL_URL });
    await realClient.connect();
    store = new RedisTokenStore(
      () => realClient as unknown as RedisClientLike,
      Date.now,
      RETENTION_MS,
    );
  } else {
    store = new RedisTokenStore(
      () => fake as unknown as RedisClientLike,
      Date.now,
      RETENTION_MS,
    );
  }
});

afterAll(async () => {
  if (realClient) {
    await realClient.flushDb();
    await realClient.close();
  }
});

runTokenPaginationContract({
  store: () => store,
  clear: async () => {
    if (realClient) await realClient.flushDb();
    else fake.flush();
  },
  mode: "cursor",
});
