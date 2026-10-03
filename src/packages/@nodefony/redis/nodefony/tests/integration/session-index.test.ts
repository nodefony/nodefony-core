import { createClient } from "redis";
import { SessionsService } from "@nodefony/http";
import RedisSessionStorage from "../../src/SessionStorage";
import { SessionIndex } from "../../src/sessionIndex";
import { redisTestUrl } from "../helpers/redisTestUrl";

/**
 * L'index de comptage des sessions Redis (`sessionIndex.ts`), contre un VRAI
 * serveur : ses scripts sont du Lua, qu'aucun double n'exécute.
 *
 * Ce que le contrat de pagination ne voit pas : les transitions. Une session
 * qui change de propriétaire, un utilisateur qui se déconnecte de son dernier
 * appareil, une session expirée, des sessions écrites AVANT l'index — chacune
 * fait mentir un compteur si l'index l'oublie.
 */
const REAL_URL = redisTestUrl(6);

let client: ReturnType<typeof createClient>;
let storage: RedisSessionStorage;
let logs: string[];

function makeManager(c: unknown): SessionsService {
  return {
    options: { idleTimeoutS: 3600, absoluteTimeoutS: 0, store: "redis" },
    log: (msg: string) => logs.push(msg),
    get: (name: string) => (name === "redis" ? { getClient: () => c } : null),
  } as unknown as SessionsService;
}

const session = (user: string) => ({
  Attributes: {},
  flashBag: {},
  metaBag: {},
  user,
});

describe.skipIf(!REAL_URL)("Redis — index de comptage des sessions", () => {
  beforeAll(async () => {
    client = createClient({ url: REAL_URL ?? "" });
    await client.connect();
  });
  afterAll(async () => {
    await client.flushDb();
    await client.close();
  });
  beforeEach(async () => {
    await client.flushDb();
    logs = [];
    storage = new RedisSessionStorage(makeManager(client));
  });

  it("compte toutes, authentifiées, anonymes, par utilisateur, et les PERSONNES", async () => {
    await storage.write("a1", session("alice"));
    await storage.write("a2", session("alice"));
    await storage.write("b1", session("bob"));
    await storage.write("x1", session(""));
    expect(await storage.countSessions()).toBe(4);
    expect(await storage.countSessions({ authenticated: true })).toBe(3);
    expect(await storage.countSessions({ authenticated: false })).toBe(1);
    expect(await storage.countSessions({ user: "alice" })).toBe(2);
    expect(await storage.countDistinctUsers()).toBe(2);
  });

  it("🔴 changement de propriétaire (connexion d'une session anonyme) : plus compté anonyme", async () => {
    await storage.write("s1", session(""));
    await storage.write("s1", session("alice"));
    expect(await storage.countSessions({ authenticated: false })).toBe(0);
    expect(await storage.countSessions({ user: "alice" })).toBe(1);
    await storage.write("s1", session("bob"));
    expect(await storage.countSessions({ user: "alice" })).toBe(0);
    expect(await storage.countDistinctUsers(), "alice ne porte plus rien").toBe(
      1,
    );
  });

  it("🔴 déconnexion du DERNIER appareil : l'utilisateur sort du compte des personnes", async () => {
    await storage.write("a1", session("alice"));
    await storage.write("a2", session("alice"));
    await storage.write("b1", session("bob"));
    await storage.destroy("a1");
    expect(await storage.countDistinctUsers(), "il reste a2").toBe(2);
    await storage.destroy("a2");
    expect(await storage.countDistinctUsers()).toBe(1);
    expect(await storage.countSessions()).toBe(1);
  });

  it("une session EXPIRÉE n'est pas comptée, et la purge vide l'index", async () => {
    const index = new SessionIndex(prefixOf(storage));
    const past = Date.now() - 1000;
    await index.add(client, { id: "old", user: "carol", expiresAt: past });
    await storage.write("live", session("dave"));
    expect(await storage.countSessions()).toBe(1);
    expect(await storage.countDistinctUsers()).toBe(1);
    // RESP3 rend 0/1, pas un booléen.
    expect(await client.hExists(`${index.base}:owner`, "old")).toBe(0);
  });

  it("🔴 sessions écrites AVANT l'index : reconstruites au premier comptage, une fois", async () => {
    const prefix = prefixOf(storage);
    // Une session posée comme le faisait la version précédente : clé seule.
    await client.set(`${prefix}:legacy`, JSON.stringify(session("erin")), {
      expiration: { type: "EX", value: 600 },
    });
    expect(await storage.countSessions()).toBe(1);
    expect(await storage.countDistinctUsers()).toBe(1);
    expect(logs.some((l) => l.includes("index reconstruit"))).toBe(true);
    logs = [];
    expect(await storage.countSessions()).toBe(1);
    expect(logs, "pas de seconde reconstruction").toEqual([]);
  });

  it("touch d'une session antérieure à l'index : elle y entre", async () => {
    const prefix = prefixOf(storage);
    await client.set(index(prefix).builtKey, "1"); // index déclaré complet…
    await client.set(`${prefix}:old`, JSON.stringify(session("fred")), {
      expiration: { type: "EX", value: 600 },
    });
    expect(await storage.countSessions(), "…mais il l'ignore").toBe(0);
    await storage.touch("old");
    expect(await storage.countSessions({ user: "fred" })).toBe(1);
  });

  it("🔴 comptages CONCURRENTS au premier appel : tous attendent la reconstruction, aucun « inconnu »", async () => {
    await client.set(
      `${prefixOf(storage)}:legacy`,
      JSON.stringify(session("gus")),
      {
        expiration: { type: "EX", value: 600 },
      },
    );
    const counts = await Promise.all([
      storage.countSessions(),
      storage.countSessions({ authenticated: true }),
      storage.countSessions({ authenticated: false }),
      storage.countDistinctUsers(),
    ]);
    expect(counts).toEqual([1, 1, 0, 1]);
  });

  it("un autre pod reconstruit : le compte est « inconnu », jamais partiel", async () => {
    const prefix = prefixOf(storage);
    await client.set(index(prefix).lockKey, "autre-pod");
    expect(await storage.countSessions()).toBe(-1);
    expect(await storage.countDistinctUsers()).toBe(-1);
  });

  it("le listing ne voit PAS les clés de l'index (pas de WRONGTYPE)", async () => {
    await storage.write("a1", session("alice"));
    await storage.countSessions(); // pose le marqueur et les ZSET
    const page = await storage.listPage({ limit: 50 });
    expect(page.items.map((i) => i.id)).toEqual(["a1"]);
  });
});

/**
 * Le préfixe effectif du store : le double de service n'expose pas `keyPrefix`,
 * le store garde donc son préfixe historique (cf `#prefix`).
 */
function prefixOf(_s: RedisSessionStorage): string {
  return "nf:sess";
}

function index(prefix: string): SessionIndex {
  return new SessionIndex(prefix);
}
