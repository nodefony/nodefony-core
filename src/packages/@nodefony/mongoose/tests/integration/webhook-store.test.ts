import assert from "node:assert/strict";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IWebhookEndpoint } from "@nodefony/security";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import { MongooseWebhookStore } from "../../nodefony/src/MongooseWebhookStore";
import {
  registerWebhookEndpointEntity,
  WEBHOOK_ENDPOINT_ENTITY,
} from "../../nodefony/entity/webhookEndpointEntity";
import { runWebhookPaginationContract } from "../../../security/tests/support/webhookPaginationContract";

const ORM = "wh_test";
// Serveur Mongo partagé (globalSetup) scopé sur la base `wh_test` ; `null`
// → infra indisponible → suite skippée.
const URI = mongoTestUri(ORM);

/** Construit un `IWebhookEndpoint` complet avec surcharges. */
function makeEndpoint(
  over: Partial<IWebhookEndpoint> & Pick<IWebhookEndpoint, "id">,
): IWebhookEndpoint {
  return {
    url: `https://hook.example.com/${over.id}`,
    secretEnc: `gcm1.${over.id}`,
    events: ["login.success", "user.created"],
    enabled: true,
    description: null,
    tenantId: null,
    createdBy: "admin1",
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    lastDeliveryAt: null,
    lastDeliveryStatus: null,
    lastDeliveryError: null,
    failureCount: 0,
    metadata: {},
    ...over,
  };
}

describe.skipIf(!URI)(
  "Mongoose MongooseWebhookStore — IWebhookStore portable (P6.13)",
  () => {
    let orm: MongooseOrm;
    let store: MongooseWebhookStore;

    beforeAll(async () => {
      registerWebhookEndpointEntity(ORM); // AVANT connect (compilation du modèle)
      orm = new MongooseOrm(ORM, URI!);
      await orm.connect();
      await orm.getRepository(WEBHOOK_ENDPOINT_ENTITY).delete({}); // ardoise propre
      store = MongooseWebhookStore.from(orm);
    });

    afterAll(async () => {
      await orm?.disconnect();
      entityRegistry.unregister(WEBHOOK_ENDPOINT_ENTITY);
      ormRegistry.unregister(ORM);
    });

    describe("save / findById", () => {
      it("restitue l'endpoint (_id = id ; events/metadata, booléen, nulls)", async () => {
        const ep = makeEndpoint({
          id: "wh_1",
          events: ["*"],
          metadata: { team: "core", n: 3 },
          description: "prod",
        });
        await store.save(ep);
        const found = await store.findById("wh_1");
        assert.deepEqual(found, ep);
        assert.equal(found?.id, "wh_1");
        assert.deepEqual(found?.events, ["*"]);
        assert.deepEqual(found?.metadata, { team: "core", n: 3 });
        assert.equal(found?.enabled, true);
        assert.equal(found?.lastDeliveryAt, null);
        assert.equal(found?.description, "prod");
      });

      it("findById d'un endpoint inconnu renvoie null", async () => {
        assert.equal(await store.findById("nope"), null);
      });

      it("save écrase un endpoint existant (upsert, même _id)", async () => {
        await store.save(makeEndpoint({ id: "wh_up", failureCount: 1 }));
        await store.save(makeEndpoint({ id: "wh_up", failureCount: 9 }));
        const found = await store.findById("wh_up");
        assert.equal(found?.failureCount, 9);
        assert.equal(
          (await store.listAll()).filter((e) => e.id === "wh_up").length,
          1,
        );
      });

      it("save CONCURRENT du même id : aucun rejet, une seule ligne (réservation atomique)", async () => {
        // Rejeu d'un formulaire d'admin : un findOne + create laisse les deux
        // voir « absent » → E11000 sur `_id` pour le perdant.
        const results = await Promise.allSettled([
          store.save(makeEndpoint({ id: "wh_conc", failureCount: 1 })),
          store.save(makeEndpoint({ id: "wh_conc", failureCount: 2 })),
        ]);
        assert.deepEqual(
          results
            .filter((r) => r.status === "rejected")
            .map((r) => (r as PromiseRejectedResult).reason?.message),
          [],
          "aucun save concurrent ne doit être rejeté",
        );
        assert.equal(
          (await store.listAll()).filter((e) => e.id === "wh_conc").length,
          1,
          "une seule ligne pour la PK",
        );
      });

      it("ne partage pas les références JSON avec l'appelant (copie défensive)", async () => {
        const events = ["a"];
        const metadata: Record<string, unknown> = { k: 1 };
        await store.save(makeEndpoint({ id: "wh_ref", events, metadata }));
        events.push("MUTATED");
        metadata.k = 999;
        const found = await store.findById("wh_ref");
        assert.deepEqual(found?.events, ["a"]);
        assert.deepEqual(found?.metadata, { k: 1 });
      });
    });

    describe("update", () => {
      it("applique un patch partiel (enabled/url/events/failureCount/lastDelivery*)", async () => {
        await store.save(makeEndpoint({ id: "wh_u", enabled: true }));
        await store.update("wh_u", {
          enabled: false,
          url: "https://new.example.com/hook",
          events: ["session.opened"],
          failureCount: 4,
          lastDeliveryAt: 5_555,
          lastDeliveryStatus: 500,
          lastDeliveryError: "boom",
          updatedAt: 2_000_000,
        });
        const found = await store.findById("wh_u");
        assert.equal(found?.enabled, false);
        assert.equal(found?.url, "https://new.example.com/hook");
        assert.deepEqual(found?.events, ["session.opened"]);
        assert.equal(found?.failureCount, 4);
        assert.equal(found?.lastDeliveryAt, 5_555);
        assert.equal(found?.lastDeliveryStatus, 500);
        assert.equal(found?.lastDeliveryError, "boom");
        assert.equal(found?.updatedAt, 2_000_000);
      });

      it("met à jour metadata (copie défensive)", async () => {
        await store.save(makeEndpoint({ id: "wh_m", metadata: { a: 1 } }));
        const next: Record<string, unknown> = { a: 2, b: true };
        await store.update("wh_m", { metadata: next });
        next.a = 999;
        const found = await store.findById("wh_m");
        assert.deepEqual(found?.metadata, { a: 2, b: true });
      });

      it("no-op si l'id est inconnu", async () => {
        await store.update("absent", { enabled: false });
        assert.equal(await store.findById("absent"), null);
      });
    });

    describe("delete / listAll", () => {
      it("supprime l'endpoint, idempotent sur inconnu", async () => {
        await store.save(makeEndpoint({ id: "wh_d1" }));
        await store.save(makeEndpoint({ id: "wh_d2" }));
        await store.delete("wh_d1");
        assert.equal(await store.findById("wh_d1"), null);
        assert.equal((await store.findById("wh_d2")) !== null, true);
        await store.delete("never"); // ne throw pas
      });

      it("listAll renvoie les endpoints persistés avec secretEnc", async () => {
        const all = await store.listAll();
        const one = all.find((e) => e.id === "wh_d2");
        // Le store EST la source de vérité → il porte `secretEnc` (la redaction
        // du secret est la responsabilité de la couche service, pas du store).
        assert.equal(one?.secretEnc, "gcm1.wh_d2");
      });
    });

    // Standard de pagination : LE banc du propriétaire du contrat
    // (`@nodefony/security`), déroulé ici sur MongoDB. Déclaré en DERNIER (son
    // seed doit survivre aux écritures des describes précédents).
    runWebhookPaginationContract({
      store: () => store,
      clear: async () => {
        await orm.getRepository(WEBHOOK_ENDPOINT_ENTITY).delete({});
      },
    });
  },
);
