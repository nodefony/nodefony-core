import { createClient } from "redis";
import { RedisWebAuthnCredentialStore } from "../../src/RedisWebAuthnCredentialStore";
import type { RedisClientLike } from "../../src/RedisWebAuthnCredentialStore";
import { runWebAuthnPaginationContract } from "../../../../security/tests/support/webauthnPaginationContract";
import { redisTestUrl } from "../helpers/redisTestUrl";

/**
 * Le banc de contrat unique du listing des passkeys (`@nodefony/security`),
 * déroulé sur le store Redis en mode **curseur**.
 *
 * **Double backend, un seul fichier** :
 * - par défaut → `FakePaginatingRedis` (déterministe, SCAN qui pagine réellement
 *   par COUNT) → le banc tourne TOUJOURS (non-régression) ;
 * - avec `REDIS_TEST_URL` → **vrai serveur Redis** : la preuve que le `SCAN` réel
 *   (curseur RESP = string opaque) est câblé de bout en bout. Un double trop
 *   permissif a déjà masqué deux bugs sur les stores frères — le curseur passé en
 *   `number` (refusé par node-redis v6) et le débordement de page (`SCAN COUNT`
 *   est un indice d'effort, pas un plafond).
 */
// Base DÉDIÉE : ce banc purge (`flushDb`). Partager la base d'un autre fichier
// rendrait le résultat dépendant de l'ORDRE d'exécution (vert en isolation,
// rouge en suite) — le pire symptôme, car il fait suspecter le code.
const REAL_URL = redisTestUrl(10);

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
  readonly #sets = new Map<string, Set<string>>();

  del(key: string): Promise<number> {
    const had = this.#hashes.delete(key) || this.#sets.delete(key);
    return Promise.resolve(had ? 1 : 0);
  }
  hSet(key: string, fields: Record<string, string>): Promise<number> {
    this.#hashes.set(key, { ...fields });
    return Promise.resolve(Object.keys(fields).length);
  }
  hGetAll(key: string): Promise<Record<string, string>> {
    return Promise.resolve(this.#hashes.get(key) ?? {});
  }
  exists(key: string): Promise<number> {
    return Promise.resolve(
      this.#hashes.has(key) || this.#sets.has(key) ? 1 : 0,
    );
  }
  sAdd(key: string, member: string): Promise<number> {
    let set = this.#sets.get(key);
    if (!set) {
      set = new Set();
      this.#sets.set(key, set);
    }
    const had = set.has(member);
    set.add(member);
    return Promise.resolve(had ? 0 : 1);
  }
  sRem(key: string, member: string): Promise<number> {
    const set = this.#sets.get(key);
    return Promise.resolve(set && set.delete(member) ? 1 : 0);
  }
  sMembers(key: string): Promise<string[]> {
    const set = this.#sets.get(key);
    return Promise.resolve(set ? [...set] : []);
  }
  sCard(key: string): Promise<number> {
    return Promise.resolve(this.#sets.get(key)?.size ?? 0);
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
    this.#sets.clear();
  }
}

const fake = new FakePaginatingRedis();
let realClient: ReturnType<typeof createClient> | null = null;
let store: RedisWebAuthnCredentialStore;

beforeAll(async () => {
  if (REAL_URL) {
    realClient = createClient({ url: REAL_URL });
    await realClient.connect();
    store = new RedisWebAuthnCredentialStore(
      () => realClient as unknown as RedisClientLike,
    );
  } else {
    store = new RedisWebAuthnCredentialStore(
      () => fake as unknown as RedisClientLike,
    );
  }
});

afterAll(async () => {
  if (realClient) {
    await realClient.flushDb();
    await realClient.close();
  }
});

runWebAuthnPaginationContract({
  store: () => store,
  clear: async () => {
    if (realClient) await realClient.flushDb();
    else fake.flush();
  },
  mode: "cursor",
});
