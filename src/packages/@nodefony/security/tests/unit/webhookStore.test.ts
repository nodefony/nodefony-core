import assert from "node:assert/strict";
import { MemoryWebhookStore } from "../../nodefony/src/webhook/MemoryWebhookStore";
import type { IWebhookEndpoint } from "../../nodefony/contracts/IWebhookEndpoint";

/** Store mémoire des endpoints webhook — CRUD + copie défensive en lecture. */

function makeEndpoint(id: string): IWebhookEndpoint {
  const now = Date.now();
  return {
    id,
    url: "https://example.com/h",
    secretEnc: "gcm1.deadbeef",
    events: ["*"],
    enabled: true,
    description: null,
    tenantId: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    lastDeliveryAt: null,
    lastDeliveryStatus: null,
    lastDeliveryError: null,
    failureCount: 0,
    metadata: {},
  };
}

describe("MemoryWebhookStore — CRUD", () => {
  it("save + findById", async () => {
    const store = new MemoryWebhookStore();
    await store.save(makeEndpoint("wh_1"));
    assert.equal((await store.findById("wh_1"))?.id, "wh_1");
  });

  it("findById absent → null", async () => {
    const store = new MemoryWebhookStore();
    assert.equal(await store.findById("wh_x"), null);
  });

  it("update applique le patch", async () => {
    const store = new MemoryWebhookStore();
    await store.save(makeEndpoint("wh_1"));
    await store.update("wh_1", { enabled: false, failureCount: 3 });
    const e = await store.findById("wh_1");
    assert.equal(e?.enabled, false);
    assert.equal(e?.failureCount, 3);
  });

  it("update id absent → no-op (pas de création)", async () => {
    const store = new MemoryWebhookStore();
    await store.update("wh_absent", { enabled: false });
    assert.equal(await store.findById("wh_absent"), null);
  });

  it("delete", async () => {
    const store = new MemoryWebhookStore();
    await store.save(makeEndpoint("wh_1"));
    await store.delete("wh_1");
    assert.equal(await store.findById("wh_1"), null);
  });

  it("listAll", async () => {
    const store = new MemoryWebhookStore();
    await store.save(makeEndpoint("wh_1"));
    await store.save(makeEndpoint("wh_2"));
    assert.equal((await store.listAll()).length, 2);
  });

  it("copie défensive : muter le retour n'altère pas le store", async () => {
    const store = new MemoryWebhookStore();
    await store.save(makeEndpoint("wh_1"));
    const read = await store.findById("wh_1");
    (read as { enabled: boolean }).enabled = false;
    assert.equal((await store.findById("wh_1"))?.enabled, true);
  });
});
