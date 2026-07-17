import assert from "node:assert/strict";
import { RequestContext, type IProfilerQuery } from "nodefony";
import { SessionsService } from "@nodefony/http";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
// L'import du storage déclenche son auto-enregistrement dans le registre http (IoC).
import DrizzleSessionStorage from "../../nodefony/src/SessionStorage";
import {
  registerSessionEntity,
  SESSION_CONNECTOR,
} from "../../nodefony/entity/sessionEntity";

/**
 * Ce qui est PROPRE à ce fichier, et ne peut donc pas vivre au banc de parité
 * (`session-store-contract.ts`, joué sur les 3 dialectes) :
 *
 * 1. **le registre IoC** — l'auto-enregistrement du storage dans `http` ne dépend
 *    d'aucun dialecte (c'est du câblage, pas du SQL) ;
 * 2. **le compteur de requêtes** — « write seul = 1 UPSERT, 0 SELECT » n'est PAS
 *    un invariant portable : en mysql un `write` en coûte 2 (ODKU puis relecture,
 *    faute de `RETURNING`). Le compter ici, en sqlite, garde le garde-fou
 *    anti-« trou ORM » sans mentir sur les autres backends.
 *
 * Le CRUD (write/read/destroy), le gc (bornes idle ET absolue) et `listAll`
 * (redaction) sont au banc — ils y sont vérifiés sur sqlite + postgres + mysql,
 * au lieu d'une fois ici.
 */

/** Manager minimal (le storage n'utilise que les timeouts session + `log`). */
const fakeManager = {
  options: { idleTimeoutS: 3600, absoluteTimeoutS: 0, store: "drizzle" },
  log: () => {},
} as unknown as SessionsService;

describe("Drizzle SessionStorage — registre IoC + coût en requêtes (sqlite)", () => {
  let orm: DrizzleOrm;
  let storage: DrizzleSessionStorage;

  beforeAll(async () => {
    // Enregistrement DYNAMIQUE (S1 multi-dialecte) — plus de @entity à l'import.
    registerSessionEntity(SESSION_CONNECTOR);
    orm = new DrizzleOrm(SESSION_CONNECTOR, { filename: ":memory:" });
    await orm.connect(); // crée la table `session`
    storage = new DrizzleSessionStorage(fakeManager);
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister("session", SESSION_CONNECTOR);
    ormRegistry.unregister(SESSION_CONNECTOR);
  });

  // ── Inversion de contrôle : le storage s'est auto-enregistré dans http ─────
  describe("registre (IoC)", () => {
    it("le storage Drizzle s'auto-enregistre sous 'drizzle'", () => {
      assert.equal(
        SessionsService.getStorage("drizzle"),
        DrizzleSessionStorage,
      );
    });

    it("la résolution du handler est insensible à la casse", () => {
      assert.equal(
        SessionsService.getStorage("DRIZZLE"),
        DrizzleSessionStorage,
      );
    });

    it("le built-in 'memory' de http est aussi enregistré", () => {
      assert.ok(SessionsService.storageHandlers().includes("memory"));
      assert.ok(SessionsService.storageHandlers().includes("drizzle"));
    });

    it("un handler inconnu renvoie undefined (pas d'import en dur)", () => {
      assert.equal(SessionsService.getStorage("inexistant"), undefined);
    });
  });

  // ── Compteur de queries : anti-« trou ORM » (read→write = 1 SELECT) ─────────
  // Détecte un SELECT redondant dans le cycle de requête. Le SQL paramétré de
  // chaque requête ORM est capturé via le buffer profiler de l'ALS (même seam
  // que la debug bar : `RequestContext.get().queries`). Régression : si `write`
  // refait un findOne d'existence (au lieu de l'UPSERT), le compteur repasse à 2.
  //
  // ⚠️ sqlite/postgres UNIQUEMENT — en mysql l'upsert coûte 2 requêtes (ODKU +
  // relecture, pas de RETURNING) : le nombre de requêtes n'est pas portable.
  describe("compteur de queries (anti-trou ORM)", () => {
    async function capture(fn: () => Promise<void>): Promise<string[]> {
      const queries: IProfilerQuery[] = [];
      await RequestContext.run({ requestId: "qcount", queries }, fn);
      return queries.map((q) => q.sql);
    }
    const selects = (sqls: string[]): string[] =>
      sqls.filter((s) => /^\s*select/i.test(s));

    beforeAll(async () => {
      await storage.write("qc", {
        Attributes: { a: 1 },
        metaBag: {},
        flashBag: {},
        user: "qc-user",
      });
    });

    it("write seul = 1 requête (UPSERT), 0 SELECT", async () => {
      const sqls = await capture(async () => {
        await storage.write("qc", {
          Attributes: { a: 2 },
          metaBag: {},
          flashBag: {},
          user: "qc-user",
        });
      });
      assert.equal(selects(sqls).length, 0, JSON.stringify(sqls));
      assert.equal(
        sqls.length,
        1,
        `1 seule requête attendue (UPSERT) : ${JSON.stringify(sqls)}`,
      );
    });

    it("un cycle read→write ne fait qu'UN SELECT (pas de check d'existence redondant)", async () => {
      const sqls = await capture(async () => {
        await storage.read("qc"); // SELECT #1 — hydratation
        await storage.write("qc", {
          Attributes: { a: 3 },
          metaBag: {},
          flashBag: {},
          user: "qc-user",
        }); // UPSERT (0 SELECT) — plus le 2ᵉ SELECT du findOne d'existence
      });
      assert.equal(
        selects(sqls).length,
        1,
        `1 SELECT attendu (doublon de write éliminé) : ${JSON.stringify(sqls)}`,
      );
    });
  });
});
