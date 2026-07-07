import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IWebhookEndpoint } from "@nodefony/security";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleWebhookStore } from "../../nodefony/src/DrizzleWebhookStore";
import {
  registerWebhookEndpointEntity,
  WEBHOOK_ENDPOINT_ENTITY,
  type WebhookEndpointRow,
} from "../../nodefony/entity/webhookEndpointEntity";

/**
 * e2e **Postgres** du store d'endpoints webhook (S3 multi-dialecte) — le
 * `DrizzleWebhookStore` (100 % repository, 0 SQL natif) sur un PG réel :
 * DDL dérivé (jsonb/boolean/bigint), round-trips, `updateOne` borné
 * `#pickOne`, et le **hack OFFSET-sans-LIMIT routé** (`limit(-1)` est
 * sqlite-only — PG le REJETTE ; avant S3 un `find({ offset })` levait
 * `LIMIT must not be negative`).
 *
 * GATE : ne tourne que si `NF_PG_URL` est posée (sinon skip silencieux) :
 *   docker compose -f docker/docker-compose.yml --profile postgres up -d postgres
 *   NF_PG_URL=postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony npm test
 */

const PG_URL = process.env.NF_PG_URL;
const ORM = "wh_pg_e2e";

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

describe.skipIf(!PG_URL)(
  "DrizzleWebhookStore — e2e Postgres (S3 multi-dialecte)",
  () => {
    let orm: DrizzleOrm;
    let store: DrizzleWebhookStore;

    beforeAll(async () => {
      registerWebhookEndpointEntity(ORM, "postgres"); // pgTable, AVANT connect
      orm = new DrizzleOrm(ORM, { dialect: "postgres", url: PG_URL });
      await orm.connect(); // DDL dérivé (jsonb/boolean/bigint)
      store = DrizzleWebhookStore.from(orm);
      // Table persistante entre les runs (IF NOT EXISTS) → purge d'entrée.
      await orm.getRepository(WEBHOOK_ENDPOINT_ENTITY).delete({});
    });

    afterAll(async () => {
      await orm.disconnect();
      entityRegistry.unregister(WEBHOOK_ENDPOINT_ENTITY, ORM);
      ormRegistry.unregister(ORM);
    });

    it("save + findById : round-trip jsonb (events/metadata), boolean, bigint, nulls", async () => {
      await store.save(
        makeEndpoint({
          id: "pg-wh1",
          events: ["*"],
          metadata: { team: "core", n: 3 },
          description: "prod",
          enabled: true,
        }),
      );
      const ep = await store.findById("pg-wh1");
      assert.ok(ep);
      assert.deepEqual(ep.events, ["*"]);
      assert.deepEqual(ep.metadata, { team: "core", n: 3 });
      assert.equal(ep.enabled, true, "boolean natif PG → true JS");
      assert.equal(ep.description, "prod");
      assert.equal(ep.createdAt, 1_000_000, "epoch ms exact via bigint");
      assert.equal(ep.lastDeliveryAt, null, "NULL PG → null JS");
    });

    it("save rejoué = UPDATE (1 ligne, pas de doublon d'id)", async () => {
      await store.save(
        makeEndpoint({ id: "pg-wh1", description: "renamed", enabled: false }),
      );
      const ep = await store.findById("pg-wh1");
      assert.equal(ep?.description, "renamed");
      assert.equal(ep?.enabled, false);
      assert.equal((await store.listAll()).length, 1, "toujours 1 seule ligne");
    });

    it("update : patch partiel (updateOne borné #pickOne sur PG)", async () => {
      await store.update("pg-wh1", {
        events: ["login.failure"],
        failureCount: 2,
        lastDeliveryStatus: 500,
        lastDeliveryError: "boom",
      });
      const ep = await store.findById("pg-wh1");
      assert.deepEqual(ep?.events, ["login.failure"]);
      assert.equal(ep?.failureCount, 2);
      assert.equal(ep?.lastDeliveryStatus, 500);
      assert.equal(ep?.url, "https://hook.example.com/pg-wh1", "non touché");
    });

    it("OFFSET sans LIMIT : routé par dialecte (PG rejette LIMIT -1)", async () => {
      await store.save(makeEndpoint({ id: "pg-wh2" }));
      await store.save(makeEndpoint({ id: "pg-wh3" }));
      const repo = orm.getRepository<WebhookEndpointRow>(
        WEBHOOK_ENDPOINT_ENTITY,
      );
      // Avant S3 : `query.limit(-1)` inconditionnel → PG `LIMIT must not be
      // negative`. Routé sqlite-only, PG émet OFFSET seul (LIMIT ALL implicite).
      const rows = await repo.find({}, { order: [["id", "ASC"]], offset: 1 });
      assert.deepEqual(
        rows.map((r) => r.id),
        ["pg-wh2", "pg-wh3"],
        "saute la 1ʳᵉ ligne, rend TOUT le reste (pas de plafond parasite)",
      );
    });

    it("listAll + delete : registre complet puis retrait", async () => {
      assert.equal((await store.listAll()).length, 3);
      await store.delete("pg-wh1");
      const rest = await store.listAll();
      assert.deepEqual(rest.map((e) => e.id).sort(), ["pg-wh2", "pg-wh3"]);
    });
  },
);
