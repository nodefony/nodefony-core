import assert from "node:assert/strict";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IdempotentResponse } from "nodefony";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import { MongooseIdempotencyStore } from "../../nodefony/src/MongooseIdempotencyStore";
import {
  registerIdempotencyEntities,
  IDEMPOTENCY_ENTITY_NAME,
} from "../../nodefony/entity/idempotencyEntity";
import { runIdempotencyPaginationContract } from "../../../../../nodefony/src/tests/support/idempotencyPaginationContract";

const ORM = "idem_test";
// Serveur Mongo partagé (globalSetup) scopé sur la base `idem_test` ; `null`
// → infra indisponible → suite skippée.
const URI = mongoTestUri(ORM);

/** Bail in-flight / rétention de la réponse mémorisée (tests déterministes). */
const LEASE_MS = 60_000;
const TTL_MS = 600_000;

/** Réponse mémorisée de référence (le banc vérifie qu'elle NE SORT PAS). */
const RESPONSE: IdempotentResponse = { status: 201, body: { id: "a" } };

describe.skipIf(!URI)(
  "Mongoose MongooseIdempotencyStore — IIdempotencyStore portable",
  () => {
    let orm: MongooseOrm;
    let store: MongooseIdempotencyStore;
    // Horloge contrôlée : le store filtre les entrées échues à la LECTURE, donc
    // la fenêtre courante fait partie du contrat testé.
    let clock = 30_000_000;

    beforeAll(async () => {
      registerIdempotencyEntities(ORM); // AVANT connect (compilation du modèle)
      orm = new MongooseOrm(ORM, URI!);
      await orm.connect();
      await orm.getRepository(IDEMPOTENCY_ENTITY_NAME).delete({});
      store = MongooseIdempotencyStore.from(orm, () => clock, LEASE_MS, TTL_MS);
    });

    afterAll(async () => {
      await orm?.disconnect();
      entityRegistry.unregister(IDEMPOTENCY_ENTITY_NAME, ORM);
      ormRegistry.unregister(ORM);
    });

    // ── Le banc de contrat PARTAGÉ (mémoire, Drizzle ×3, Redis, et ici) ───────
    runIdempotencyPaginationContract({
      store: () => store,
      mode: "offset",
      // Sur une base RÉELLE la collection survit au run précédent : on purge
      // physiquement puis on repart d'une fenêtre temporelle propre.
      clear: async () => {
        await orm.getRepository(IDEMPOTENCY_ENTITY_NAME).delete({});
        clock = 30_000_000;
      },
      seed: async (prefix, n) => {
        for (let i = 0; i < n; i += 1) {
          const key = `${prefix}-${String(i).padStart(2, "0")}`;
          await store.begin(key, "fp");
          if (i % 2 === 0) await store.complete(key, RESPONSE);
        }
      },
      // Le temps passe au-delà de la plus longue échéance semée : les clés sont
      // encore EN BASE (le GC applicatif n'est pas passé) mais ne sont plus
      // opposables — le listing doit déjà les ignorer.
      expireSeeded: async () => {
        clock += TTL_MS + LEASE_MS + 1;
      },
    });

    // ── La SÉMANTIQUE de la réservation — ce que le banc de listing ne dit pas ─
    describe("begin — les quatre verdicts", () => {
      beforeEach(async () => {
        await orm.getRepository(IDEMPOTENCY_ENTITY_NAME).delete({});
        clock = 30_000_000;
      });

      it("clé neuve → fresh", async () => {
        assert.deepEqual(await store.begin("k1", "fp"), { state: "fresh" });
      });

      it("clé vivante, même empreinte, non complétée → in-flight (409)", async () => {
        await store.begin("k1", "fp");
        assert.deepEqual(await store.begin("k1", "fp"), { state: "in-flight" });
      });

      it("clé complétée → replayed AVEC la réponse mémorisée", async () => {
        await store.begin("k1", "fp");
        await store.complete("k1", RESPONSE);
        assert.deepEqual(await store.begin("k1", "fp"), {
          state: "replayed",
          response: RESPONSE,
        });
      });

      it("clé vivante, AUTRE empreinte → mismatch (422)", async () => {
        await store.begin("k1", "fp");
        assert.deepEqual(await store.begin("k1", "AUTRE"), {
          state: "mismatch",
        });
      });

      it("mismatch vaut AUSSI après complétion (empreinte préservée)", async () => {
        // `complete` ne doit pas toucher `fingerprint` : sinon un rejeu de la
        // clé avec un autre payload passerait pour un rejeu légitime.
        await store.begin("k1", "fp");
        await store.complete("k1", RESPONSE);
        assert.deepEqual(await store.begin("k1", "AUTRE"), {
          state: "mismatch",
        });
      });

      it("bail expiré → la clé est VOLÉE atomiquement (fresh)", async () => {
        await store.begin("k1", "fp");
        clock += LEASE_MS + 1; // le handler a figé sans complete/abort
        assert.deepEqual(await store.begin("k1", "autre-fp"), {
          state: "fresh",
        });
      });

      it("rétention expirée → la clé complétée redevient fresh", async () => {
        await store.begin("k1", "fp");
        await store.complete("k1", RESPONSE);
        clock += TTL_MS + 1;
        assert.deepEqual(await store.begin("k1", "fp"), { state: "fresh" });
      });
    });

    describe("begin — atomicité sous CONCURRENCE (l'invariant capital)", () => {
      beforeEach(async () => {
        await orm.getRepository(IDEMPOTENCY_ENTITY_NAME).delete({});
        clock = 30_000_000;
      });

      it("20 begin simultanés sur une clé NEUVE : exactement UN fresh", async () => {
        // C'est LE test du store : deux `fresh` sur la même clé = la mutation
        // s'exécute deux fois. La garantie ne vient pas du code JS (qui ne
        // sérialise rien ici) mais de la contrainte d'unicité de `_id` côté
        // serveur — d'où l'exigence d'un vrai MongoDB pour ce banc.
        const verdicts = await Promise.all(
          Array.from({ length: 20 }, () => store.begin("course", "fp")),
        );
        const fresh = verdicts.filter((v) => v.state === "fresh");
        assert.equal(
          fresh.length,
          1,
          `${fresh.length} réservations obtenues — double-effet possible`,
        );
        // Les perdants ne voient JAMAIS `fresh`, et jamais `replayed` non plus
        // (rien n'est encore mémorisé).
        for (const v of verdicts.filter((x) => x.state !== "fresh")) {
          assert.equal(v.state, "in-flight");
        }
      });

      it("20 begin simultanés sur une clé MORTE : exactement UN vol", async () => {
        await store.begin("morte", "fp");
        clock += LEASE_MS + 1;
        const verdicts = await Promise.all(
          Array.from({ length: 20 }, () => store.begin("morte", "fp2")),
        );
        assert.equal(verdicts.filter((v) => v.state === "fresh").length, 1);
      });
    });

    describe("complete / abort — gardes d'état", () => {
      beforeEach(async () => {
        await orm.getRepository(IDEMPOTENCY_ENTITY_NAME).delete({});
        clock = 30_000_000;
      });

      it("abort libère la clé (un échec doit pouvoir être réessayé)", async () => {
        await store.begin("k1", "fp");
        await store.abort("k1");
        assert.deepEqual(await store.begin("k1", "fp"), { state: "fresh" });
      });

      it("abort n'efface JAMAIS une réponse déjà mémorisée", async () => {
        await store.begin("k1", "fp");
        await store.complete("k1", RESPONSE);
        await store.abort("k1"); // une autre exécution, en retard
        assert.deepEqual(await store.begin("k1", "fp"), {
          state: "replayed",
          response: RESPONSE,
        });
      });

      it("complete ne ressuscite pas une clé libérée", async () => {
        await store.begin("k1", "fp");
        await store.abort("k1");
        await store.complete("k1", RESPONSE);
        // Rien n'a été mémorisé : la clé est libre, pas « done ».
        assert.deepEqual(await store.begin("k1", "fp"), { state: "fresh" });
      });

      it("PARITÉ — un retardataire écrase une réservation VOLÉE (limite du contrat)", async () => {
        // ⚠️ Ce test constate une limite, il ne célèbre pas une garantie.
        //
        // `complete(key, response)` ne porte AUCUN jeton de réservation : une
        // fois le bail expiré et la clé volée par un autre pod, le handler figé
        // qui se réveille est indiscernable du détenteur légitime — les deux
        // présentent la même clé sur une entrée `in-flight`. Sa réponse est donc
        // mémorisée, et c'est elle qui sera rejouée.
        //
        // Les TROIS backends se comportent à l'identique (mémoire :
        // `framework/nodefony/service/IdempotencyStore.ts` `complete`, garde
        // `kind !== "in-flight"` ; Drizzle : `and(eq(key), eq(state,"if"))`).
        // Diverger ICI serait pire que la limite elle-même : le comportement
        // d'un `@Idempotent` dépendrait du backend choisi.
        //
        // La fenêtre est bornée par le bail (60 s par défaut) et suppose un
        // handler figé au-delà. La fermer exige un jeton au contrat — rupture
        // d'API, donc une décision de majeure, pas un correctif d'adapter.
        await store.begin("k1", "fp");
        clock += LEASE_MS + 1;
        await store.begin("k1", "fp2"); // un autre pod a volé le bail
        await store.complete("k1", RESPONSE); // le figé se réveille, trop tard
        assert.deepEqual(await store.begin("k1", "fp2"), {
          state: "replayed",
          response: RESPONSE,
        });
      });

      it("abort sur une clé inconnue est un no-op", async () => {
        await store.abort("jamais-vue");
      });
    });

    describe("gc — purge des entrées mortes", () => {
      it("supprime les échues et rend leur compte, puis est idempotent", async () => {
        await orm.getRepository(IDEMPOTENCY_ENTITY_NAME).delete({});
        clock = 30_000_000;
        await store.begin("g1", "fp");
        await store.begin("g2", "fp");
        clock += LEASE_MS + 1;
        await store.begin("vivante", "fp");
        assert.equal(await store.gc(), 2);
        assert.equal(await store.gc(), 0);
        const page = await store.listPage({ limit: 10 });
        assert.deepEqual(
          page.items.map((e) => e.key),
          ["vivante"],
        );
      });
    });

    describe("size — compteur local best-effort", () => {
      it("suit les réservations de CE pod et reste borné à 0", async () => {
        await orm.getRepository(IDEMPOTENCY_ENTITY_NAME).delete({});
        clock = 30_000_000;
        const local = MongooseIdempotencyStore.from(
          orm,
          () => clock,
          LEASE_MS,
          TTL_MS,
        );
        assert.equal(local.size, 0);
        await local.begin("s1", "fp");
        await local.begin("s2", "fp");
        assert.equal(local.size, 2);
        await local.complete("s1", RESPONSE);
        await local.abort("s2");
        assert.equal(local.size, 0);
        // Un abort de trop ne doit pas rendre le compteur négatif.
        await local.abort("s2");
        assert.equal(local.size, 0);
      });
    });

    describe("dégradation gracieuse — ORM déconnecté", () => {
      // Le framework fabrique ce store AVANT le connect de l'ORM : il doit
      // traverser cette fenêtre sans crasher une mutation en vol.
      let degrade: MongooseIdempotencyStore;

      beforeAll(() => {
        degrade = new MongooseIdempotencyStore(
          () => null,
          () => clock,
        );
      });

      it("begin rend fresh (la mutation s'exécute SANS dédup)", async () => {
        assert.deepEqual(await degrade.begin("k", "fp"), { state: "fresh" });
      });

      it("complete / abort / gc sont des no-op", async () => {
        await degrade.complete("k", RESPONSE);
        await degrade.abort("k");
        assert.equal(await degrade.gc(), 0);
      });

      it("listPage rend une page vide honnête", async () => {
        const page = await degrade.listPage({ limit: 10 });
        assert.deepEqual(page.items, []);
        assert.equal(page.total, 0);
        assert.equal(page.hasNext, false);
      });
    });

    describe("listPage — le préfixe `q` est LITTÉRAL (échappé)", () => {
      it("ne traite pas les métacaractères d'expression régulière", async () => {
        await orm.getRepository(IDEMPOTENCY_ENTITY_NAME).delete({});
        clock = 30_000_000;
        await store.begin("a.b", "fp");
        await store.begin("axb", "fp");
        // Sans échappement, `a.b` serait un motif et matcherait AUSSI `axb` —
        // et un terme saisi dans une console deviendrait un balayage arbitraire.
        const page = await store.listPage({ limit: 10, q: "a.b" });
        assert.deepEqual(
          page.items.map((e) => e.key),
          ["a.b"],
        );
      });
    });
  },
);
