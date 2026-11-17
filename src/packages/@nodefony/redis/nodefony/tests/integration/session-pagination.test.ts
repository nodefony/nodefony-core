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
const REAL_URL = redisTestUrl(5);

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
    // Les 2 000 écritures partent ENSEMBLE : le client les enchaîne sur la
    // connexion sans attendre chaque réponse. Une à une, c'était 2 000
    // allers-retours — le hook passait 10 s dès que la suite chargeait Redis.
    await Promise.all(
      Array.from({ length: 2000 }, (_, i) => set(`autre-app:cle:${i}`, "x")),
    );
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

// ════════════════════════════════════════════════════════════════════════════
// 🔴 Les sessions d'UN compte : un coût qui ne dépend pas du parc entier
// ════════════════════════════════════════════════════════════════════════════
/**
 * Lister les sessions d'un compte est sur le chemin de la création de compte
 * (`purgeInheritedAccess`), du changement de mot de passe et de « déconnecter
 * partout ». Le store balayait tout le parc et lisait chaque session une à une :
 * 48 s pour un compte parmi 20 000 sessions, mesuré sur Redis réel. Le coût se
 * prouve en COMPTANT les lectures envoyées à Redis — jamais par une durée.
 */
describe.skipIf(!REAL_URL)(
  "les sessions d'UN compte se lisent par l'index (Redis réel)",
  () => {
    const blank = (user: string) => ({
      Attributes: {},
      flashBag: {},
      metaBag: {},
      user,
    });
    let gets = 0;
    let counted: RedisSessionStorage;

    beforeAll(async () => {
      const client = realClient;
      if (client === null) return;
      await client.flushDb();
      await Promise.all(
        Array.from({ length: 2000 }, (_, i) =>
          storage.write(`autre-${i}`, blank(`u${i % 500}`)),
        ),
      );
      for (let i = 0; i < 3; i += 1) {
        await storage.write(`cible-${i}`, blank("cible"));
      }
      // Un client qui COMPTE ses `GET` — le seul appel qui lit une session.
      const counting = new Proxy(client, {
        get(target, prop, receiver) {
          const value: unknown = Reflect.get(target, prop, receiver);
          if (typeof value !== "function") return value;
          if (prop === "get") {
            return (...args: unknown[]) => {
              gets += 1;
              return Reflect.apply(value, target, args);
            };
          }
          return value.bind(target);
        },
      });
      counted = new RedisSessionStorage(makeManager(counting));
    });

    it("3 sessions parmi 2 000 autres : lire le compte ne lit PAS le parc", async () => {
      // L'index se reconstruit une fois par déploiement (balayage unique) :
      // c'est le PREMIER comptage qui le paie, pas chaque liste.
      await counted.countSessions();
      gets = 0;
      const page = await counted.listPage({
        limit: 200,
        user: "cible",
        withTotal: false,
      });
      expect(page.items.map((r) => r.id).sort()).toEqual([
        "cible-0",
        "cible-1",
        "cible-2",
      ]);
      expect(
        gets,
        "sessions lues pour lister les 3 du compte",
      ).toBeLessThanOrEqual(10);
      // Délai LARGE : il ne mesure rien, il laisse l'ancien parcours aller au
      // bout pour que l'échec dise le COMPTE de lectures, pas un délai dépassé.
    }, 60_000);

    it("index en reconstruction sur un autre pod : repli sur le parc, aucune session perdue", async () => {
      const client = realClient;
      if (client === null) return;
      const base = "nf:sess~{idx}";
      await client.del(`${base}:built`);
      await client.set(`${base}:building`, "autre-pod", {
        expiration: { type: "EX", value: 60 },
      });
      try {
        const page = await counted.listPage({ limit: 200, user: "cible" });
        expect(page.items.map((r) => r.id).sort()).toEqual([
          "cible-0",
          "cible-1",
          "cible-2",
        ]);
      } finally {
        await client.del(`${base}:building`);
      }
    });
  },
);

// ════════════════════════════════════════════════════════════════════════════
// 🔴 Révocation sur un keyspace qui BOUGE — serveur Redis réel seulement
// ════════════════════════════════════════════════════════════════════════════
/**
 * Le parcours destructeur de « déconnecter partout » supprime ce qu'il vient de
 * lire : Redis recompose alors le lot du curseur qu'on rejoue. Une reprise par
 * POSITION y sautait des sessions encore vivantes — une session survivait à la
 * révocation d'un compte. Seul un vrai serveur recompose ses lots ; le double,
 * lui, ne recompose rien.
 */
describe.skipIf(!REAL_URL)(
  "révocation sur un keyspace qui bouge (Redis réel)",
  () => {
    const blank = (user: string) => ({
      Attributes: {},
      flashBag: {},
      metaBag: {},
      user,
    });

    /**
     * Sessions créées et détruites en continu jusqu'à `stop()` — de quoi
     * recomposer les lots. Fenêtre BORNÉE (100 vivantes) : un keyspace qui
     * grossit sans fin ralentirait chaque `SCAN`, donc le parcours, donc
     * grossirait encore — le banc mesurerait sa propre dérive.
     */
    function churn(): { stop: () => Promise<void> } {
      // Un objet, pas un `let` : la boucle lit un drapeau que `stop()` lève
      // depuis une autre tâche.
      const flag = { running: true };
      const loop = (async () => {
        let n = 0;
        while (flag.running) {
          await storage.write(`churn-${n}`, blank("voisin"));
          if (n >= 100) await storage.destroy(`churn-${n - 100}`);
          n += 1;
        }
      })();
      return {
        stop: async () => {
          flag.running = false;
          await loop;
        },
      };
    }

    async function seed(n: number): Promise<void> {
      await realClient?.flushDb();
      for (let i = 0; i < n; i += 1) {
        await storage.write(`cible-${i}`, blank("cible"));
        await storage.write(`voisin-${i}`, blank("voisin"));
      }
    }

    it("UN SEUL parcours qui détruit ce qu'il lit visite TOUTES les sessions présentes au départ", async () => {
      await seed(600);
      const background = churn();
      const visited = new Set<string>();
      let cursor: string | null | undefined;
      let pages = 0;
      try {
        do {
          const page = await storage.listPage({
            user: "cible",
            limit: 50,
            cursor: cursor ?? undefined,
          });
          for (const rec of page.items) {
            visited.add(rec.id);
            await storage.destroy(rec.id);
          }
          cursor = page.nextCursor;
          pages += 1;
          expect(pages, "la pagination doit CONVERGER").toBeLessThan(5_000);
        } while (cursor);
      } finally {
        await background.stop();
      }
      const missed = Array.from({ length: 600 }, (_, i) => `cible-${i}`).filter(
        (id) => !visited.has(id),
      );
      expect(missed, "sessions sautées par le parcours").toEqual([]);
    }, 60_000);

    it("destroyByUser : aucune session de l'utilisateur ne survit", async () => {
      await seed(600);
      const svc = Object.create(SessionsService.prototype) as Record<
        string,
        unknown
      >;
      svc.storage = storage;
      svc.log = () => {};
      svc.get = () => null;
      const background = churn();
      let destroyed: number;
      try {
        destroyed = await (svc as unknown as SessionsService).destroyByUser(
          "cible",
        );
      } finally {
        await background.stop();
      }
      expect(destroyed).toBe(600);
      const left = await storage.listPage({ user: "cible", limit: 10 });
      expect(left.items).toEqual([]);
      expect(left.total ?? 0).toBe(0);
    }, 60_000);
  },
);
