import assert from "node:assert/strict";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { SessionsService } from "@nodefony/http";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
// L'import du storage déclenche son auto-enregistrement dans le registre http (IoC).
import MongooseSessionStorage from "../../nodefony/src/SessionStorage";
import {
  SESSION_CONNECTOR,
  type SessionRow,
} from "../../nodefony/entity/sessionEntity";
import {
  runSessionPaginationContract,
  type PaginatedSessionStorage,
} from "../../../http/nodefony/tests/support/sessionPaginationContract";
import { runSessionStoreContract } from "../../../http/nodefony/tests/support/sessionStoreContract";

/** Manager minimal (le storage n'utilise que les timeouts session + `log`). */
const fakeManager = {
  options: { idleTimeoutS: 3600, absoluteTimeoutS: 0, store: "mongoose" },
  log: () => {},
} as unknown as SessionsService;

/**
 * Source du Mongo de test, portable hors poste local (CI GitHub/GitLab, Docker) :
 * - `NF_MONGO_TEST_URI` défini → on tape CE serveur (conteneur de service CI ou
 *   `docker run -p 27017:27017 mongo:7`) : **aucun binaire téléchargé**, glibc
 *   géré par l'image ;
 * - sinon → `mongodb-memory-server` lance un `mongod` éphémère in-process
 *   (dev local zéro-config ; binaire mis en cache après le 1ᵉʳ run).
 *
 * Le store de session n'utilise aucune transaction → un Mongo **standalone**
 * suffit (pas besoin d'un replica set ici, contrairement au banc orm-core).
 *
 * Serveur Mongo PARTAGÉ par `globalSetup` (1× pour toute la suite) scopé sur la
 * base `session_test` ; `NF_MONGO_TEST_URI` (CI/Docker) le court-circuite en amont.
 * `null` → infra absente → suite skippée.
 */
const URI = mongoTestUri("session_test");

describe.skipIf(!URI)(
  "Mongoose SessionStorage — IoC + CRUD + sondes (Ph.2)",
  () => {
    let orm: MongooseOrm;
    let storage: MongooseSessionStorage;

    beforeAll(async () => {
      orm = new MongooseOrm(SESSION_CONNECTOR, URI!);
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
      ormRegistry.unregister(SESSION_CONNECTOR);
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
        await storage.write("sid1", {
          Attributes: { a: 1 },
          metaBag: { m: 2 },
          flashBag: { f: 3 },
          user: "bob",
        });
        const r = await storage.read("sid1");
        assert.deepEqual(r.Attributes, { a: 1 });
        assert.deepEqual(r.metaBag, { m: 2 });
        assert.deepEqual(r.flashBag, { f: 3 });
        assert.equal(r.user, "bob");
        assert.ok(r.createdAt instanceof Date);
      });

      it("write sur le même id met à jour sans doublon (upsert)", async () => {
        await storage.write("sid1", {
          Attributes: { a: 9 },
          metaBag: {},
          flashBag: {},
          user: "bob2",
        });
        assert.equal(await storage.open(), 1); // toujours 1 ligne
        const r = await storage.read("sid1");
        assert.deepEqual(r.Attributes, { a: 9 });
        assert.equal(r.user, "bob2");
      });

      it("destroy supprime ; read renvoie un objet vide", async () => {
        assert.equal(await storage.destroy("sid1"), true);
        const r = await storage.read("sid1");
        assert.deepEqual(r, {});
        assert.equal(await storage.open(), 0);
      });
    });

    // ── GC : opérateur riche portable ($lt) sur updatedAt (ms epoch) ───────────
    describe("garbage collector", () => {
      it("gc supprime les sessions expirées et garde les fraîches", async () => {
        const repo = orm.getRepository<SessionRow>("session");
        const now = Date.now();
        await repo.create({
          session_id: "old",
          Attributes: {},
          flashBag: {},
          metaBag: {},
          user: null,
          createdAt: now - 10_000,
          updatedAt: now - 10_000,
        } as Partial<SessionRow>);
        await repo.create({
          session_id: "fresh",
          Attributes: {},
          flashBag: {},
          metaBag: {},
          user: null,
          createdAt: now,
          updatedAt: now,
        } as Partial<SessionRow>);

        await storage.gc(1); // cutoff = now - 1s → "old" (now-10s) supprimé

        const rows = await repo.find();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].session_id, "fresh");
      });
    });

    // ── Sondes data plane (Studio) : describeConnection + describeEntity ───────
    describe("sondes data plane", () => {
      it("describeConnection : driver mongodb + cible SANS credentials + version", () => {
        const info = orm.describeConnection();
        assert.equal(info.driver, "mongodb");
        assert.ok(info.target, "target renseignée par l'adapter");
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
      });
    });

    // ── Verbes repository Tier 1+2 (parité avec l'adapter Drizzle) ─────────────
    describe("verbes repository (createMany / exists / deleteOne / findOneAndDelete / increment)", () => {
      const repo = (): IRepository<SessionRow> =>
        orm.getRepository<SessionRow>("session");
      const seed = (
        id: string,
        extra: Partial<SessionRow> = {},
      ): Partial<SessionRow> => {
        const now = Date.now();
        return {
          session_id: id,
          Attributes: {},
          flashBag: {},
          metaBag: {},
          user: null,
          createdAt: now,
          updatedAt: now,
          ...extra,
        } as Partial<SessionRow>;
      };

      it("createMany insère N en une fois (ordre préservé) ; [] = no-op", async () => {
        assert.deepEqual(await repo().createMany([]), []);
        const rows = await repo().createMany([seed("v-cm1"), seed("v-cm2")]);
        assert.deepEqual(
          rows.map((r) => r.session_id),
          ["v-cm1", "v-cm2"],
        );
        assert.equal(await repo().count({ session_id: "v-cm1" }), 1);
      });

      it("exists = true/false", async () => {
        await repo().create(seed("v-ex"));
        assert.equal(await repo().exists({ session_id: "v-ex" }), true);
        assert.equal(await repo().exists({ session_id: "v-nope" }), false);
      });

      it("deleteOne supprime AU PLUS une (true puis false)", async () => {
        await repo().create(seed("v-del"));
        assert.equal(await repo().deleteOne({ session_id: "v-del" }), true);
        assert.equal(await repo().exists({ session_id: "v-del" }), false);
        assert.equal(await repo().deleteOne({ session_id: "v-del" }), false);
      });

      it("findOneAndDelete retourne la ligne puis elle disparaît", async () => {
        await repo().create(seed("v-fad", { user: "popme" }));
        const row = await repo().findOneAndDelete({ session_id: "v-fad" });
        assert.equal(row?.session_id, "v-fad");
        assert.equal(row?.user, "popme");
        assert.equal(await repo().exists({ session_id: "v-fad" }), false);
        assert.equal(
          await repo().findOneAndDelete({ session_id: "v-fad" }),
          null,
        );
      });

      it("increment ajoute un delta atomique (et décrémente) ; null si absent", async () => {
        await repo().create(seed("v-inc", { updatedAt: 1000 }));
        const up = await repo().increment(
          { session_id: "v-inc" },
          { updatedAt: 5 },
        );
        assert.equal(up?.updatedAt, 1005);
        const down = await repo().increment(
          { session_id: "v-inc" },
          { updatedAt: -1000 },
        );
        assert.equal(down?.updatedAt, 5);
        assert.equal(
          await repo().increment({ session_id: "v-nope" }, { updatedAt: 1 }),
          null,
        );
      });
    });

    // Les DEUX bancs partagés de `@nodefony/http` (propriétaire du contrat
    // `ISessionStorage`) : COMPORTEMENT puis PAGINATION — mêmes assertions que la
    // mémoire, les 3 dialectes SQL et Redis. Greffés ICI plutôt que dans un
    // fichier dédié parce que l'entité session Mongoose est un `@entity` figé sur
    // le connecteur `nodefony` — deux fichiers le prendraient au même nom. Placés
    // EN DERNIER : ils purgent la collection à leur démarrage.
    runSessionStoreContract({
      storage: () => storage,
      clear: async () => {
        await orm.getRepository<SessionRow>("session").delete({});
      },
      // `gc()` purge réellement (pas de TTL natif branché ici).
      expiry: "applicative",
      touch: true,
    });

    runSessionPaginationContract({
      mode: "offset",
      storage: () => storage as unknown as PaginatedSessionStorage,
      clear: async () => {
        await orm.getRepository<SessionRow>("session").delete({});
      },
    });
  },
);
