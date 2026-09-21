import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IdempotentResponse } from "nodefony";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import { MongooseIdempotencyStore } from "../../nodefony/src/MongooseIdempotencyStore";
import {
  registerIdempotencyEntities,
  IDEMPOTENCY_ENTITY_NAME,
} from "../../nodefony/entity/idempotencyEntity";

/**
 * Dédup d'idempotence **CROSS-POD**, la raison d'être de ce store.
 *
 * Deux `MongooseOrm` = **deux connexions distinctes** = deux pools, donc deux
 * pods au sens où la dédup doit tenir : chacun a son propre client Mongo, et
 * rien côté JavaScript ne les sérialise. C'est la seule configuration qui
 * éprouve ce qu'on affirme — un `Promise.all` sur UNE connexion partage un pool
 * et peut masquer une atomicité qui n'en est pas une.
 *
 * Jumeau de `drizzle/tests/integration/idempotency-mysql.e2e.test.ts` (2 pools
 * distincts) : c'est cette symétrie qui rend les deux backends comparables.
 *
 * ⚠️ Exige un **vrai serveur MongoDB** : la garantie vient de la contrainte
 * d'unicité de `_id`, arbitrée par le serveur. Aucun double ne peut la rendre.
 */

const ORM_A = "idem_pod_a";
const ORM_B = "idem_pod_b";
// Les DEUX pods parlent à la MÊME base — sinon il n'y a rien à dédupliquer.
const URI = mongoTestUri("idem_multipod");

const LEASE_MS = 60_000;
const TTL_MS = 600_000;
const RESPONSE: IdempotentResponse = { status: 201, body: { id: "a" } };

describe.skipIf(!URI)(
  "Mongoose — idempotence CROSS-POD (deux connexions, une base)",
  () => {
    let ormA: MongooseOrm;
    let ormB: MongooseOrm;
    let podA: MongooseIdempotencyStore;
    let podB: MongooseIdempotencyStore;
    // Horloge PARTAGÉE : les deux pods voient le même temps, comme deux
    // exemplaires du même service. Avancer l'horloge fait expirer les baux des
    // deux côtés à la fois — ce qui est bien ce que fait l'écoulement du temps.
    let clock = 30_000_000;

    beforeAll(async () => {
      registerIdempotencyEntities(ORM_A);
      registerIdempotencyEntities(ORM_B);
      ormA = new MongooseOrm(ORM_A, URI!);
      ormB = new MongooseOrm(ORM_B, URI!);
      await ormA.connect();
      await ormB.connect();
      await ormA.getRepository(IDEMPOTENCY_ENTITY_NAME).delete({});
      podA = MongooseIdempotencyStore.from(ormA, () => clock, LEASE_MS, TTL_MS);
      podB = MongooseIdempotencyStore.from(ormB, () => clock, LEASE_MS, TTL_MS);
    });

    afterAll(async () => {
      await ormA?.disconnect();
      await ormB?.disconnect();
      entityRegistry.unregister(IDEMPOTENCY_ENTITY_NAME, ORM_A);
      entityRegistry.unregister(IDEMPOTENCY_ENTITY_NAME, ORM_B);
      ormRegistry.unregister(ORM_A);
      ormRegistry.unregister(ORM_B);
    });

    it("les deux pods écrivent bien dans la MÊME collection", async () => {
      // Test TÉMOIN : deux bases distinctes rendraient tous les cas suivants
      // verts pour la pire des raisons — il n'y aurait simplement rien à
      // dédupliquer, et l'absence de conflit passerait pour de l'atomicité.
      await podA.begin("temoin", "fp");
      const vuParB = await podB.listPage({ limit: 10, q: "temoin" });
      assert.equal(
        vuParB.items.length,
        1,
        "le pod B ne voit pas l'écriture du pod A — les pods ne partagent pas la base",
      );
      await podA.abort("temoin");
    });

    it("un begin sur A rend l'autre pod in-flight (dédup cross-pod)", async () => {
      await podA.begin("k1", "fp");
      assert.deepEqual(await podB.begin("k1", "fp"), { state: "in-flight" });
    });

    it("une réponse mémorisée par A est REJOUÉE par B", async () => {
      await podA.begin("k2", "fp");
      await podA.complete("k2", RESPONSE);
      // C'est tout l'intérêt d'un store partagé : le client qui rejoue peut
      // atterrir sur n'importe quel exemplaire et recevoir la même réponse.
      assert.deepEqual(await podB.begin("k2", "fp"), {
        state: "replayed",
        response: RESPONSE,
      });
    });

    it("un mismatch détecté par A l'est aussi par B", async () => {
      await podA.begin("k3", "fp-a");
      assert.deepEqual(await podB.begin("k3", "AUTRE"), { state: "mismatch" });
    });

    it("B vole l'entrée MORTE de A (bail expiré) et en devient le détenteur", async () => {
      await podA.begin("k4", "fp-4");
      clock += LEASE_MS + 1; // le bail in-flight de A expire
      assert.deepEqual(
        await podB.begin("k4", "fp-4-new"),
        { state: "fresh" },
        "l'AUTRE pod doit pouvoir reprendre une réservation abandonnée",
      );
      // Et la clé volée est bien VIVANTE pour son nouveau propriétaire.
      assert.deepEqual(await podA.begin("k4", "fp-4-new"), {
        state: "in-flight",
      });
    });

    it("concurrence 2 pods × 10 rounds : EXACTEMENT 1 fresh par round", async () => {
      // LE test anti double-effet. Six `begin` entrelacés sur deux connexions
      // distinctes : si deux d'entre eux obtenaient `fresh`, la mutation
      // s'exécuterait deux fois — le défaut que ce store existe pour empêcher.
      for (let round = 0; round < 10; round += 1) {
        const key = `race-${round}`;
        const outcomes = await Promise.all([
          podA.begin(key, "fp-race"),
          podB.begin(key, "fp-race"),
          podA.begin(key, "fp-race"),
          podB.begin(key, "fp-race"),
          podA.begin(key, "fp-race"),
          podB.begin(key, "fp-race"),
        ]);
        const fresh = outcomes.filter((o) => o.state === "fresh").length;
        const contended = outcomes.filter(
          (o) => o.state === "in-flight",
        ).length;
        assert.equal(fresh, 1, `round ${round} : un seul fresh`);
        assert.equal(contended, 5, `round ${round} : le reste en contention`);
      }
    });

    it("concurrence 2 pods sur une clé MORTE : un seul vol par round", async () => {
      // Variante moins évidente : ici la clé EXISTE, mais elle est échue. Le
      // chemin du code n'est pas l'insertion mais la reprise conditionnelle —
      // et il doit être tout aussi atomique.
      for (let round = 0; round < 5; round += 1) {
        const key = `steal-${round}`;
        await podA.begin(key, "fp");
        clock += LEASE_MS + 1;
        const outcomes = await Promise.all([
          podA.begin(key, "fp2"),
          podB.begin(key, "fp2"),
          podA.begin(key, "fp2"),
          podB.begin(key, "fp2"),
        ]);
        assert.equal(
          outcomes.filter((o) => o.state === "fresh").length,
          1,
          `round ${round} : un seul vol`,
        );
      }
    });

    it("le gc d'un pod purge ce que l'autre a écrit", async () => {
      clock += TTL_MS + LEASE_MS + 1; // tout expire
      const purged = await podB.gc();
      assert.ok(
        purged > 0,
        `le gc doit purger les entrées des deux pods — reçu ${purged}`,
      );
      assert.equal((await podA.listPage({ limit: 50 })).items.length, 0);
    });
  },
);
