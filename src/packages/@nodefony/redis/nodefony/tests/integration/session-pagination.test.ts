import { createClient } from "redis";
import { SessionsService } from "@nodefony/http";
import RedisSessionStorage from "../../src/SessionStorage";
import { redisTestUrl } from "../helpers/redisTestUrl";
import {
  runSessionPaginationContract,
  type PaginatedSessionStorage,
} from "../../../../http/nodefony/tests/support/sessionPaginationContract";

/**
 * Le banc de contrat unique de pagination des sessions (`@nodefony/http`),
 * déroulé sur le store Redis en mode **curseur** — mêmes invariants que la
 * mémoire et les 4 backends offset (partition, borne, redaction, filtres), plus
 * ce qui est propre au curseur (`nextCursor`, absence de `total`, `-1`).
 *
 * **Double backend, un seul fichier** :
 * - par défaut → `FakePaginatingRedis` (déterministe, `SCAN` qui pagine réellement
 *   par `COUNT`) → le banc tourne TOUJOURS, même sans infra ;
 * - avec `NF_REDIS_TEST_URL` (ex. `redis://127.0.0.1:6379/15`) → **vrai serveur
 *   Redis** : la preuve que le `SCAN` réel est câblé de bout en bout. La DB dédiée
 *   est purgée par `flushDb`.
 *
 * ⚠️ Le double type le curseur en **string**, comme le vrai RESP. Un fake qui le
 * typerait `number` masquerait exactement le bug corrigé sur le store de jetons
 * (node-redis v6 exige une string en argument de commande) — un double doit
 * imiter les contraintes du réel, pas les assouplir.
 */
const REAL_URL = redisTestUrl(14);

function globToRegExp(glob: string | undefined): RegExp | null {
  if (!glob) return null;
  const escaped = glob
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/** Double déterministe : clés string + SCAN paginant (curseur string, "0" = fin). */
class FakePaginatingRedis {
  readonly #strings = new Map<string, string>();

  set(key: string, value: string): Promise<unknown> {
    this.#strings.set(key, value);
    return Promise.resolve("OK");
  }
  get(key: string): Promise<string | null> {
    return Promise.resolve(this.#strings.get(key) ?? null);
  }
  del(key: string): Promise<number> {
    return Promise.resolve(this.#strings.delete(key) ? 1 : 0);
  }
  expire(): Promise<boolean> {
    return Promise.resolve(true);
  }
  scan(
    cursor: string,
    options?: { MATCH?: string; COUNT?: number },
  ): Promise<{ cursor: string; keys: string[] }> {
    const start = Number.parseInt(cursor, 10) || 0;
    const count = options?.COUNT ?? 10;
    const re = globToRegExp(options?.MATCH);
    // Comme le VRAI Redis : `COUNT` dose les emplacements EXAMINÉS sur tout le
    // keyspace, et `MATCH` ne filtre qu'ENSUITE. Filtrer avant de découper
    // (ancienne version de ce double) rendait des lots toujours pleins, et
    // masquait la page vide que produit un keyspace chargé d'autres clés.
    const all = [...this.#strings.keys()];
    const slice = all
      .slice(start, start + count)
      .filter((k) => !re || re.test(k));
    const nextIndex = start + count;
    return Promise.resolve({
      cursor: nextIndex >= all.length ? "0" : String(nextIndex),
      keys: slice,
    });
  }
  flush(): void {
    this.#strings.clear();
  }
}

const fake = new FakePaginatingRedis();
let realClient: ReturnType<typeof createClient> | null = null;
let storage: RedisSessionStorage;

/**
 * Manager minimal : le store lit les timeouts, journalise, et résout le service
 * `redis` par le conteneur (`get("redis")`) pour obtenir le client `main`.
 */
function makeManager(client: unknown): SessionsService {
  return {
    options: { idleTimeoutS: 3600, absoluteTimeoutS: 0, store: "redis" },
    log: () => {},
    get: (name: string) =>
      name === "redis" ? { getClient: () => client } : null,
  } as unknown as SessionsService;
}

beforeAll(async () => {
  if (REAL_URL) {
    realClient = createClient({ url: REAL_URL });
    await realClient.connect();
    storage = new RedisSessionStorage(makeManager(realClient));
  } else {
    storage = new RedisSessionStorage(makeManager(fake));
  }
});

afterAll(async () => {
  if (realClient) {
    await realClient.flushDb();
    await realClient.close();
  }
});

runSessionPaginationContract({
  mode: "cursor",
  // Le vrai serveur compte par l'INDEX (scripts Lua) ; le double, qui ne sait
  // pas exécuter de Lua, garde la capacité réduite annoncée (`-1`).
  exactCounts: REAL_URL !== null && REAL_URL !== undefined,
  storage: () => storage,
  clear: async () => {
    if (realClient) await realClient.flushDb();
    else fake.flush();
  },
});

/**
 * Un keyspace PARTAGÉ — d'autres clés que les sessions (idempotence, jetons,
 * autres applications) — est le cas normal d'un Redis de production.
 *
 * `SCAN COUNT` examine des emplacements sur TOUT ce keyspace : un lot peut ne
 * contenir aucune session du filtre demandé. Une page rendue vide alors que
 * l'ensemble ne l'est pas fait conclure « aucune session » à tout consommateur
 * qui ne suit pas le curseur — la console « Mes sessions » la première.
 */
describe("keyspace chargé d'autres clés — la page se REMPLIT", () => {
  const set = (k: string, v: string) =>
    realClient ? realClient.set(k, v) : fake.set(k, v);

  beforeAll(async () => {
    if (realClient) await realClient.flushDb();
    else fake.flush();
    for (let i = 0; i < 2000; i += 1) await set(`autre-app:cle:${i}`, "x");
    for (let i = 0; i < 30; i += 1) {
      await storage.write(`voisin-${i}`, {
        Attributes: {},
        flashBag: {},
        metaBag: {},
        user: "voisin",
      });
    }
    for (let i = 0; i < 3; i += 1) {
      await storage.write(`cible-${i}`, {
        Attributes: {},
        flashBag: {},
        metaBag: {},
        user: "cible",
      });
    }
  });

  it("filtre user : la PREMIÈRE page porte les sessions, même noyées dans 2 000 clés étrangères", async () => {
    const page = await storage.listPage({ limit: 10, user: "cible" });
    expect(page.items.map((i) => i.data.user)).toEqual([
      "cible",
      "cible",
      "cible",
    ]);
  });

  it("sans filtre : une page pleine dès qu'il y a de quoi la remplir", async () => {
    const page = await storage.listPage({ limit: 10 });
    expect(page.items).toHaveLength(10);
    expect(page.hasNext).toBe(true);
  });
});
