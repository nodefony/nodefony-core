import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IWebhookEndpoint } from "@nodefony/security";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleWebhookStore } from "../../nodefony/src/DrizzleWebhookStore";
import {
  registerWebhookEndpointEntity,
  WEBHOOK_ENDPOINT_ENTITY,
} from "../../nodefony/entity/webhookEndpointEntity";

const ORM = "wh_test";

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

describe("Drizzle DrizzleWebhookStore — IWebhookStore portable (P6.13)", () => {
  let orm: DrizzleOrm;
  let store: DrizzleWebhookStore;

  beforeAll(async () => {
    registerWebhookEndpointEntity(ORM); // AVANT connect (création de la table)
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
    store = DrizzleWebhookStore.from(orm);
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister(WEBHOOK_ENDPOINT_ENTITY);
    ormRegistry.unregister(ORM);
  });

  describe("save / findById", () => {
    it("restitue l'endpoint (events + metadata JSON, booléen, nulls)", async () => {
      const ep = makeEndpoint({
        id: "wh_1",
        events: ["*"],
        metadata: { team: "core", n: 3 },
        description: "prod",
      });
      await store.save(ep);
      const found = await store.findById("wh_1");
      assert.deepEqual(found, ep);
      assert.deepEqual(found?.events, ["*"]);
      assert.deepEqual(found?.metadata, { team: "core", n: 3 });
      assert.equal(found?.enabled, true);
      assert.equal(found?.lastDeliveryAt, null);
      assert.equal(found?.description, "prod");
    });

    it("findById d'un endpoint inconnu renvoie null", async () => {
      assert.equal(await store.findById("nope"), null);
    });

    it("save écrase un endpoint existant (upsert)", async () => {
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
      // Deux écritures simultanées du même endpoint (rejeu d'un formulaire
      // d'admin) : un `findOne` + `create` laisse les deux voir « absent » →
      // deux INSERT sur la PK `id` → le perdant lève « UNIQUE constraint failed ».
      const results = await Promise.allSettled([
        store.save(makeEndpoint({ id: "wh_conc", failureCount: 1 })),
        store.save(makeEndpoint({ id: "wh_conc", failureCount: 2 })),
      ]);
      const rejected = results.filter((r) => r.status === "rejected");
      assert.deepEqual(
        rejected.map((r) => (r as PromiseRejectedResult).reason?.message),
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

  describe("delete", () => {
    it("supprime l'endpoint", async () => {
      await store.save(makeEndpoint({ id: "wh_d1" }));
      await store.save(makeEndpoint({ id: "wh_d2" }));
      await store.delete("wh_d1");
      assert.equal(await store.findById("wh_d1"), null);
      assert.equal((await store.findById("wh_d2")) !== null, true);
    });

    it("est idempotent sur un endpoint inconnu", async () => {
      await store.delete("never"); // ne throw pas
      assert.equal(await store.findById("never"), null);
    });
  });

  describe("listAll", () => {
    it("renvoie les endpoints persistés (snapshot dispatcher) avec secretEnc", async () => {
      await store.save(makeEndpoint({ id: "wh_la1" }));
      await store.save(makeEndpoint({ id: "wh_la2", enabled: false }));
      const all = await store.listAll();
      const ids = all.map((e) => e.id);
      assert.ok(ids.includes("wh_la1"), "wh_la1 listé");
      assert.ok(ids.includes("wh_la2"), "wh_la2 listé");
      // Le store EST la source de vérité → il porte `secretEnc` (la redaction du
      // secret est la responsabilité de la couche service `toSummary`, pas du store).
      assert.equal(
        all.find((e) => e.id === "wh_la1")?.secretEnc,
        "gcm1.wh_la1",
      );
    });
  });
});
