import assert from "node:assert/strict";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { SessionsService } from "@nodefony/http";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
// L'import du storage déclenche son auto-enregistrement dans le registre http (IoC).
import MongooseSessionStorage from "../../nodefony/src/SessionStorage";
import {
  SESSION_ORM,
  type SessionRow,
} from "../../nodefony/entity/sessionEntity";

/** Manager minimal (le storage n'utilise que `options.gc_maxlifetime` + `log`). */
const fakeManager = {
  options: { gc_maxlifetime: 3600, handler: "mongoose" },
  log: () => {},
} as unknown as SessionsService;

/**
 * Source du Mongo de test, portable hors poste local (CI GitHub/GitLab, Docker) :
 * - `MONGO_TEST_URI` défini → on tape CE serveur (conteneur de service CI ou
 *   `docker run -p 27017:27017 mongo:7`) : **aucun binaire téléchargé**, glibc
 *   géré par l'image ;
 * - sinon → `mongodb-memory-server` lance un `mongod` éphémère in-process
 *   (dev local zéro-config ; binaire mis en cache après le 1ᵉʳ run).
 *
 * Le store de session n'utilise aucune transaction → un Mongo **standalone**
 * suffit (pas besoin d'un replica set ici, contrairement au banc orm-core).
 *
 * Serveur Mongo PARTAGÉ par `globalSetup` (1× pour toute la suite) scopé sur la
 * base `session_test` ; `MONGO_TEST_URI` (CI/Docker) le court-circuite en amont.
 * `null` → infra absente → suite skippée.
 */
const URI = mongoTestUri("session_test");

describe.skipIf(!URI)(
  "Mongoose SessionStorage — IoC + CRUD + sondes (Ph.2)",
  () => {
    let orm: MongooseOrm;
    let storage: MongooseSessionStorage;

    beforeAll(async () => {
      orm = new MongooseOrm(SESSION_ORM, URI!);
      await orm.connect(); // compile le modèle `session` (entité @entity auto-enregistrée)
      // Ardoise propre : un Mongo externe partagé peut porter des résidus d'un run précédent.
      await orm.getRepository<SessionRow>("session").delete({});
      storage = new MongooseSessionStorage(fakeManager);
    });

    afterAll(async () => {
      // Nettoyage des documents de session sur un Mongo externe (no-op sur memory-server jetable).
      await orm
        ?.getRepository<SessionRow>("session")
        .delete({})
        .catch(() => {});
      await orm?.disconnect();
      entityRegistry.unregister("session");
      ormRegistry.unregister(SESSION_ORM);
    });

    // ── Inversion de contrôle : le storage s'est auto-enregistré dans http ─────
    describe("registre (IoC)", () => {
      it("le storage Mongoose s'auto-enregistre sous 'mongoose'", () => {
        assert.equal(
          SessionsService.getStorage("mongoose"),
          MongooseSessionStorage,
        );
      });

      it("la résolution du handler est insensible à la casse", () => {
        assert.equal(
          SessionsService.getStorage("MONGOOSE"),
          MongooseSessionStorage,
        );
      });

      it("un handler inconnu renvoie undefined (pas d'import en dur)", () => {
        assert.equal(SessionsService.getStorage("inexistant"), undefined);
      });
    });

    // ── CRUD du storage backé par le repository orm-core Mongoose ──────────────
    describe("CRUD", () => {
      it("write puis read restitue Attributes/metaBag/flashBag/user", async () => {
        await storage.write(
          "sid1",
          {
            Attributes: { a: 1 },
            metaBag: { m: 2 },
            flashBag: { f: 3 },
            user: "bob",
          },
          "default",
        );
        const r = (await storage.read("sid1", "default")) as Record<
          string,
          unknown
        >;
        assert.deepEqual(r.Attributes, { a: 1 });
        assert.deepEqual(r.metaBag, { m: 2 });
        assert.deepEqual(r.flashBag, { f: 3 });
        assert.equal(r.user, "bob");
        assert.ok(r.createdAt instanceof Date);
      });

      it("write sur le même id met à jour sans doublon (upsert)", async () => {
        await storage.write(
          "sid1",
          { Attributes: { a: 9 }, metaBag: {}, flashBag: {}, user: "bob2" },
          "default",
        );
        assert.equal(await storage.open("default"), 1); // toujours 1 ligne
        const r = (await storage.read("sid1", "default")) as Record<
          string,
          unknown
        >;
        assert.deepEqual(r.Attributes, { a: 9 });
        assert.equal(r.user, "bob2");
      });

      it("destroy supprime ; read renvoie un objet vide", async () => {
        assert.equal(await storage.destroy("sid1", "default"), true);
        const r = (await storage.read("sid1", "default")) as Record<
          string,
          unknown
        >;
        assert.deepEqual(r, {});
        assert.equal(await storage.open("default"), 0);
      });
    });

    // ── GC : opérateur riche portable ($lt) sur updatedAt (ms epoch) ───────────
    describe("garbage collector", () => {
      it("gc supprime les sessions expirées et garde les fraîches", async () => {
        const repo = orm.getRepository<SessionRow>("session");
        const now = Date.now();
        await repo.create({
          session_id: "old",
          context: "default",
          Attributes: {},
          flashBag: {},
          metaBag: {},
          user: null,
          createdAt: now - 10_000,
          updatedAt: now - 10_000,
        } as Partial<SessionRow>);
        await repo.create({
          session_id: "fresh",
          context: "default",
          Attributes: {},
          flashBag: {},
          metaBag: {},
          user: null,
          createdAt: now,
          updatedAt: now,
        } as Partial<SessionRow>);

        await storage.gc(1, "default"); // cutoff = now - 1s → "old" (now-10s) supprimé

        const rows = await repo.find({ context: "default" });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].session_id, "fresh");
      });
    });

    // ── Sondes data plane (Studio) : describeConnection + describeEntity ───────
    describe("sondes data plane", () => {
      it("describeConnection : driver mongodb + cible SANS credentials + version", () => {
        const info = orm.describeConnection();
        assert.equal(info.driver, "mongodb");
        assert.ok(
          !info.target.includes("@"),
          "target ne doit pas fuiter d'auth",
        );
        assert.match(info.ormVersion ?? "", /\d+\.\d+/); // version mongoose résolue
      });

      it("describeEntity('session') : _id PK + colonnes logiques", () => {
        const cols = orm.describeEntity("session");
        const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
        assert.equal(byName._id.primaryKey, true);
        assert.ok(byName.session_id, "colonne session_id présente");
        assert.ok(byName.context, "colonne context présente");
      });
    });
  },
);
