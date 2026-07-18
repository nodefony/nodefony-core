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

  it("append + listPage restitue l'événement (le plus récent d'abord)", async () => {
    await store.append(makeEvent({ id: "e1", ts: 100 }));
    await store.append(makeEvent({ id: "e2", ts: 200 }));
    const page = await store.listPage({ limit: 100 });
    assert.equal(page.total, 2);
    assert.deepEqual(
      page.items.map((e) => e.id),
      ["e2", "e1"], // ts DESC
    );
    assert.equal(page.nextCursor, null);
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
    const page = await store.listPage({ limit: 1 });
    const event = page.items[0]!;
    assert.equal(event.id, "e3");
    assert.deepEqual(event.flags, { hasCookie: true });
    assert.deepEqual(event.metadata, { zone: "admin" });
    // e1 n'avait ni flags ni metadata → absents (pas de clé null).
    const older = await store.listPage({ limit: 100, cursor: "300:e3" });
    assert.equal("flags" in older.items[0]!, false);
    assert.equal("metadata" in older.items[0]!, false);
  });

  // La pagination (curseur composite, ordre total, filtres sous curseur) est
  // prouvée par le banc de contrat PARTAGÉ `audit-pagination.test.ts`, déroulé
  // sur les 3 dialectes ET sur le store mémoire. Ne pas la redupliquer ici.

  it("ordre total (ts DESC, id DESC) départage les collisions à la ms", async () => {
    await store.append(makeEvent({ id: "a", ts: 500 }));
    await store.append(makeEvent({ id: "b", ts: 500 }));
    const page = await store.listPage({ limit: 100, since: 500, until: 500 });
    assert.deepEqual(
      page.items.map((e) => e.id),
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
    const byOutcome = await store.listPage({ limit: 100, outcome: "denied" });
    assert.deepEqual(
      byOutcome.items.map((e) => e.id),
      ["denied1"],
    );
    const byActor = await store.listPage({ limit: 100, actor: "bob" });
    assert.deepEqual(
      byActor.items.map((e) => e.id),
      ["denied1"],
    );
    const byReq = await store.listPage({ limit: 100, requestId: "req-42" });
    assert.equal(byReq.total, 1);
    const byCategory = await store.listPage({ limit: 100, category: "authz" });
    assert.equal(byCategory.total, 1);
    const none = await store.listPage({ limit: 100, actor: "ghost" });
    assert.deepEqual(none, {
      items: [],
      limit: 100,
      hasNext: false,
      nextCursor: null,
      total: 0,
    });
  });

  it("gc purge les événements hors rétention et renvoie le compte", async () => {
    // Rétention 1000 ms ; now=CLOCK=1_000_000 → seuil 999_000. Tous les
    // événements de ce test (ts ≤ 600) sont < seuil → purgés.
    const purged = await store.gc();
    assert.ok(purged >= 6); // e1,e2,e3,a,b,denied1
    const after = await store.listPage({ limit: 100 });
    assert.equal(after.total, 0);
  });

  it("dégradation gracieuse — ORM non connecté (db null)", async () => {
    const soft = new DrizzleAuditStore(() => null);
    await soft.append(makeEvent({ id: "lost" })); // ne throw pas
    assert.deepEqual(await soft.listPage({ limit: 100 }), {
      items: [],
      limit: 100,
      hasNext: false,
      nextCursor: null,
      total: 0,
    });
    assert.equal(await soft.gc(), 0);
  });
});
