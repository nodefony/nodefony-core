import assert from "node:assert/strict";
import { createClient } from "redis";
import type { SessionsService, ISerializedSession } from "@nodefony/http";
import RedisSessionStorage from "../../src/SessionStorage";
import { redisTestUrl } from "../helpers/redisTestUrl";

/**
 * **Chemins de DÉGRADATION et de ROBUSTESSE** du store de session Redis —
 * ce que le contrat comportemental ne peut pas exercer parce qu'il suppose, lui,
 * un backend sain.
 *
 * Deux familles, et c'est le principe « résilience sans dégradation silencieuse »
 * qui est en jeu :
 *
 * 1. **Connexion absente** (service Redis non connecté, boot/shutdown) : chaque
 *    verbe doit se dégrader en douceur — jamais une exception qui ferait tomber
 *    une requête HTTP pour une session indisponible. C'est du **fail-soft**.
 * 2. **Donnée hostile en base** (valeur corrompue, curseur étranger) : une clé
 *    illisible ne doit ni casser la console admin ni faire disparaître les
 *    sessions saines qui l'entourent.
 *
 * Ces chemins ne se déclenchent jamais dans un banc nominal : ils sont donc
 * restés NON couverts alors qu'ils sont précisément ceux qui décident du
 * comportement le jour où l'infra va mal.
 *
 * GATE : `REDIS_TEST_URL` pour la partie « donnée hostile » (elle exige un vrai
 * serveur). La partie « connexion absente » n'a besoin d'aucune infra.
 */

const IDLE = 120;

/** Session complète — `ISerializedSession` exige ses trois sacs. */
function body(user: string): ISerializedSession {
  return { user, Attributes: {}, metaBag: {}, flashBag: {} };
}

/** Manager minimal ; `client` à `null` simule un service Redis non connecté. */
function makeManager(client: unknown): SessionsService {
  const logged: string[] = [];
  const manager = {
    options: { idleTimeoutS: IDLE, absoluteTimeoutS: 0, store: "redis" },
    log: (message: unknown) => {
      logged.push(String(message));
    },
    get: (name: string) =>
      name === "redis" ? { getClient: () => client } : null,
    logged,
  };
  return manager as unknown as SessionsService & { logged: string[] };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Connexion absente — fail-soft, sans infra
// ════════════════════════════════════════════════════════════════════════════
describe("Redis SessionStorage — connexion absente (dégradation gracieuse)", () => {
  const storage = (): RedisSessionStorage =>
    new RedisSessionStorage(makeManager(null));

  it("read rend une session VIDE, jamais une erreur", async () => {
    assert.deepEqual(await storage().read("absent"), {});
  });

  it("start se comporte comme read", async () => {
    assert.deepEqual(await storage().start("absent"), {});
  });

  it("write ne jette pas et rend la charge qu'on lui a confiée", async () => {
    const payload = { ...body("alice"), Attributes: { a: 1 } };
    const out = await storage().write("s1", payload);
    assert.equal(out.user, "alice");
  });

  it("touch est un no-op silencieux", async () => {
    await storage().touch("s1");
  });

  // `destroy` rend `true` même sans connexion : le contrat le veut IDEMPOTENT
  // (« la session n'est plus là » est vrai dans les deux cas), et l'appelant est
  // un logout — le faire échouer laisserait l'utilisateur croire qu'il est resté
  // connecté. Vérifié ici pour que ce choix reste explicite, pas accidentel.
  it("destroy reste idempotent (true) même sans connexion", async () => {
    assert.equal(await storage().destroy("s1"), true);
  });

  it("close rend true (la connexion appartient au RedisService, pas au store)", async () => {
    assert.equal(await storage().close(), true);
  });

  // `gc` est un no-op VOLONTAIRE sur ce backend (l'idle est porté par le TTL
  // Redis, l'absolute est refusé à la lecture) : il ne purge rien et n'a rien à
  // signaler, y compris sans connexion. Ce n'est donc pas une dégradation
  // silencieuse — il n'y a rien à dégrader.
  it("gc ne jette pas et reste un no-op, même sans connexion", async () => {
    await new RedisSessionStorage(makeManager(null)).gc();
  });

  it("open annonce le backend actif et rend 0 (aucun comptage O(keyspace))", async () => {
    const manager = makeManager(null) as SessionsService & { logged: string[] };
    assert.equal(await new RedisSessionStorage(manager).open(), 0);
    assert.ok(
      manager.logged.some((l) => l.includes("TTL natif")),
      "le backend retenu doit être tracé au boot",
    );
  });

  it("listAll rend [] (console admin vide, jamais en erreur)", async () => {
    assert.deepEqual(await storage().listAll(), []);
  });

  it("listPage rend une page vide cohérente avec le contrat", async () => {
    const page = await storage().listPage({ limit: 10 });
    assert.deepEqual(page.items, []);
    assert.equal(page.limit, 10);
    assert.equal(page.hasNext, false);
    assert.equal(page.nextCursor, null);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Donnée hostile — exige un vrai serveur (un double « valide » toujours)
// ════════════════════════════════════════════════════════════════════════════
// Base 8 : ce fichier `flushDb`, il lui faut la sienne. Il partageait la 12 avec
// `token-pagination` — deux purges concurrentes sur le même keyspace, donc vert
// en isolation et rouge en suite, le symptôme qui fait suspecter le code.
const REAL_URL = redisTestUrl(8);

describe.skipIf(!REAL_URL)(
  "Redis SessionStorage — données hostiles en base",
  () => {
    let client: ReturnType<typeof createClient> | null = null;
    let storage: RedisSessionStorage;

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

    beforeEach(async () => {
      await client!.flushDb();
    });

    it("listAll énumère les sessions et expose leur id (sans le préfixe de clé)", async () => {
      await storage.write("s-a", body("alice"));
      await storage.write("s-b", body("bob"));
      const all = await storage.listAll();
      assert.equal(all.length, 2);
      assert.deepEqual(
        all.map((r) => r.id).sort(),
        ["s-a", "s-b"],
        "l'id rendu est celui de la session, pas la clé Redis",
      );
    });

    it("listAll filtre par user", async () => {
      await storage.write("s-a", body("alice"));
      await storage.write("s-b", body("bob"));
      const alice = await storage.listAll({ user: "alice" });
      assert.equal(alice.length, 1);
      assert.equal(alice[0]!.id, "s-a");
    });

    // Le cas qui compte : une clé illisible (écrite par un autre outil, une
    // version antérieure, une corruption) ne doit pas faire tomber la console
    // admin NI emporter les sessions saines qui l'entourent.
    it("🔒 une valeur CORROMPUE est ignorée — les sessions saines sortent quand même", async () => {
      await storage.write("s-ok", body("alice"));
      await client!.set("nf:sess:s-broken", "{ ceci n'est pas du JSON");
      const all = await storage.listAll();
      assert.deepEqual(
        all.map((r) => r.id),
        ["s-ok"],
        "la corrompue est écartée, la saine est servie",
      );
    });

    it("🔒 listPage ignore aussi les valeurs corrompues", async () => {
      await storage.write("s-ok", body("alice"));
      await client!.set("nf:sess:s-broken", "<html>pas du json</html>");
      const page = await storage.listPage({ limit: 50 });
      assert.deepEqual(
        page.items.map((r) => r.id),
        ["s-ok"],
      );
    });

    // Le curseur du contrat est composite (`skip:scanCursor`). Un client qui
    // repasse un curseur Redis NU (ancien format, outil externe) doit être
    // honoré plutôt que rejeté — la pagination reste utilisable.
    it("un curseur Redis NU (sans séparateur) est honoré, pas rejeté", async () => {
      for (let i = 0; i < 5; i += 1) {
        await storage.write(`s-${i}`, body("alice"));
      }
      const page = await storage.listPage({ limit: 50, cursor: "0" });
      assert.ok(page.items.length > 0, "le scan repart du début, pas d'erreur");
    });

    it("un curseur MALFORMÉ ne fait pas échouer la lecture", async () => {
      await storage.write("s-a", body("alice"));
      const page = await storage.listPage({
        limit: 10,
        cursor: "n'importe:quoi",
      });
      assert.ok(Array.isArray(page.items));
    });

    it("gc ne supprime AUCUNE session (l'expiration est portée par le TTL)", async () => {
      await storage.write("s-vivante", body("alice"));
      await storage.gc();
      assert.equal(
        (await storage.listAll()).length,
        1,
        "gc ne doit pas toucher aux sessions : Redis expire seul",
      );
    });
  },
);
