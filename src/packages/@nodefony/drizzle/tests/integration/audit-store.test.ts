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

type DbResolver = ConstructorParameters<typeof DrizzleAuditStore>[0];

/**
 * Le handle réel de l'ORM, vu à travers un compteur d'`INSERT` — et, si
 * `failFirst`, un premier `INSERT` qui échoue.
 */
function countingDb(
  orm: DrizzleOrm,
  failFirst = false,
): { resolve: DbResolver; inserts: () => number } {
  const real = orm.getNativeConnection() as NonNullable<ReturnType<DbResolver>>;
  let inserts = 0;
  const proxy = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "insert") {
        inserts += 1;
        if (failFirst && inserts === 1) {
          return () => {
            throw new Error("panne d'écriture voulue");
          };
        }
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
  return { resolve: () => proxy, inserts: () => inserts };
}

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
    const event = page.items[0];
    assert.equal(event!.id, "e3");
    assert.deepEqual(event!.flags, { hasCookie: true });
    assert.deepEqual(event!.metadata, { zone: "admin" });
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

  it("les append d'un même tour partent en UN INSERT, et se lisent avant même leur écriture", async () => {
    const db = countingDb(orm);
    const batched = new DrizzleAuditStore(db.resolve, now, 1000);
    const writes: Promise<void>[] = [];
    for (let i = 0; i < 50; i++) {
      writes.push(batched.append(makeEvent({ id: `lot-${i}`, ts: 700 })));
    }
    // Aucun `await` des écritures : la lecture doit voir le lot reçu.
    const page = await batched.listPage({ limit: 100, since: 700, until: 700 });
    assert.equal(page.total, 50, "lecture après écriture rompue");
    await Promise.all(writes);
    assert.equal(db.inserts(), 1, `${db.inserts()} INSERT pour un seul tour`);
  });

  it("un INSERT en échec rejette les append de SON lot, pas ceux du suivant", async () => {
    const db = countingDb(orm, true);
    const batched = new DrizzleAuditStore(db.resolve, now, 1000);
    const lost = [
      batched.append(makeEvent({ id: "perdu-1", ts: 710 })),
      batched.append(makeEvent({ id: "perdu-2", ts: 710 })),
    ];
    const outcomes = await Promise.allSettled(lost);
    assert.deepEqual(
      outcomes.map((o) => o.status),
      ["rejected", "rejected"],
    );
    await batched.append(makeEvent({ id: "sauve", ts: 711 }));
    const page = await batched.listPage({ limit: 100, since: 710, until: 711 });
    assert.deepEqual(
      page.items.map((e) => e.id),
      ["sauve"],
    );
  });

  it("un lot de plus de 200 lignes part en plusieurs INSERT, sans perte", async () => {
    const db = countingDb(orm);
    const batched = new DrizzleAuditStore(db.resolve, now, 1000);
    await Promise.all(
      Array.from({ length: 450 }, (_, i) =>
        batched.append(makeEvent({ id: `gros-${i}`, ts: 720 })),
      ),
    );
    assert.equal(db.inserts(), 3);
    const page = await batched.listPage({
      limit: 10,
      since: 720,
      until: 720,
    });
    assert.equal(page.total, 450);
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
