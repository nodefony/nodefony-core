import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IAuditEvent } from "@nodefony/security";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleAuditStore } from "../../nodefony/src/DrizzleAuditStore";
import {
  registerAuditEntities,
  AUDIT_ENTITY_NAMES,
} from "../../nodefony/entity/auditEventEntity";

const ORM = "audit_test";

/** Horloge contrôlée (epoch ms) → tests déterministes (rétention). */
let CLOCK = 1_000_000;
const now = () => CLOCK;

/** Construit un `IAuditEvent` complet avec surcharges. */
function makeEvent(
  over: Partial<IAuditEvent> & Pick<IAuditEvent, "id">,
): IAuditEvent {
  return {
    ts: CLOCK,
    category: "auth",
    action: "login.success",
    outcome: "success",
    actor: "alice",
    ...over,
  };
}

describe("Drizzle DrizzleAuditStore — IAuditStore append-only (P6.14)", () => {
  let orm: DrizzleOrm;
  let store: DrizzleAuditStore;

  beforeAll(async () => {
    registerAuditEntities(ORM); // AVANT connect (création de la table au boot)
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
    // rétention 1000 ms pour tester le gc de façon déterministe.
    store = DrizzleAuditStore.from(orm, now, 1000);
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister(AUDIT_ENTITY_NAMES.events);
    ormRegistry.unregister(ORM);
  });

  it("append + query restitue l'événement (le plus récent d'abord)", async () => {
    await store.append(makeEvent({ id: "e1", ts: 100 }));
    await store.append(makeEvent({ id: "e2", ts: 200 }));
    const page = await store.query();
    assert.equal(page.total, 2);
    assert.deepEqual(
      page.events.map((e) => e.id),
      ["e2", "e1"], // ts DESC
    );
    assert.equal(page.nextBefore, null);
  });

  it("JSON (flags/metadata) désérialisé ; NULL → champ absent", async () => {
    await store.append(
      makeEvent({
        id: "e3",
        ts: 300,
        flags: { hasCookie: true },
        metadata: { zone: "admin" },
      }),
    );
    const page = await store.query({ limit: 1 });
    const event = page.events[0]!;
    assert.equal(event.id, "e3");
    assert.deepEqual(event.flags, { hasCookie: true });
    assert.deepEqual(event.metadata, { zone: "admin" });
    // e1 n'avait ni flags ni metadata → absents (pas de clé null).
    const older = await store.query({ before: "e3" });
    assert.equal("flags" in older.events[0]!, false);
    assert.equal("metadata" in older.events[0]!, false);
  });

  it("pagination par curseur (before) + nextBefore + total stable", async () => {
    // Journal courant : e3(300), e2(200), e1(100).
    const first = await store.query({ limit: 2 });
    assert.equal(first.total, 3);
    assert.deepEqual(
      first.events.map((e) => e.id),
      ["e3", "e2"],
    );
    assert.equal(first.nextBefore, "e2");
    const second = await store.query({ limit: 2, before: first.nextBefore! });
    assert.deepEqual(
      second.events.map((e) => e.id),
      ["e1"],
    );
    assert.equal(second.nextBefore, null);
    assert.equal(second.total, 3); // total = hors pagination
  });

  it("ordre total (ts DESC, id DESC) départage les collisions à la ms", async () => {
    await store.append(makeEvent({ id: "a", ts: 500 }));
    await store.append(makeEvent({ id: "b", ts: 500 }));
    const page = await store.query({ since: 500, until: 500 });
    assert.deepEqual(
      page.events.map((e) => e.id),
      ["b", "a"], // même ts → id DESC
    );
  });

  it("filtres AND : category / outcome / actor / action / requestId", async () => {
    await store.append(
      makeEvent({
        id: "denied1",
        ts: 600,
        category: "authz",
        action: "access.denied",
        outcome: "denied",
        actor: "bob",
        requestId: "req-42",
      }),
    );
    const byOutcome = await store.query({ outcome: "denied" });
    assert.deepEqual(
      byOutcome.events.map((e) => e.id),
      ["denied1"],
    );
    const byActor = await store.query({ actor: "bob" });
    assert.deepEqual(
      byActor.events.map((e) => e.id),
      ["denied1"],
    );
    const byReq = await store.query({ requestId: "req-42" });
    assert.equal(byReq.total, 1);
    const byCategory = await store.query({ category: "authz" });
    assert.equal(byCategory.total, 1);
    const none = await store.query({ actor: "ghost" });
    assert.deepEqual(none, { events: [], nextBefore: null, total: 0 });
  });

  it("gc purge les événements hors rétention et renvoie le compte", async () => {
    // Rétention 1000 ms ; now=CLOCK=1_000_000 → seuil 999_000. Tous les
    // événements de ce test (ts ≤ 600) sont < seuil → purgés.
    const purged = await store.gc();
    assert.ok(purged >= 6); // e1,e2,e3,a,b,denied1
    const after = await store.query();
    assert.equal(after.total, 0);
  });

  it("dégradation gracieuse — ORM non connecté (db null)", async () => {
    const soft = new DrizzleAuditStore(() => null);
    await soft.append(makeEvent({ id: "lost" })); // ne throw pas
    assert.deepEqual(await soft.query(), {
      events: [],
      nextBefore: null,
      total: 0,
    });
    assert.equal(await soft.gc(), 0);
  });
});
