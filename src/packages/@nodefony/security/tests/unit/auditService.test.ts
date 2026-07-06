import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import AuditService from "../../nodefony/service/auditService";
import { MemoryAuditStore } from "../../nodefony/src/audit/MemoryAuditStore";
import type {
  IAuditEvent,
  IAuditEventDraft,
} from "../../nodefony/contracts/IAuditEvent";

/**
 * Journal d'audit de sécurité (P6.14 — Lot 1 socle) :
 * - `MemoryAuditStore` : append append-only, query (filtres + pagination curseur
 *   + ordre récent→ancien), borne de volume (FIFO anti-fuite), gc par rétention,
 *   snapshot/restore ;
 * - `AuditService` : no-op à coût nul si désactivé, stamp id+ts, fan-out live
 *   (subscribe/dispose, isolation des listeners qui throw), pose `auditStore`.
 */

// ── Fabriques déterministes ────────────────────────────────────────────────────

const makeEvent = (o: Partial<IAuditEvent> = {}): IAuditEvent => ({
  id: o.id ?? "e0",
  ts: o.ts ?? 1_000,
  category: o.category ?? "auth",
  action: o.action ?? "login.success",
  outcome: o.outcome ?? "success",
  actor: o.actor ?? "alice",
  ...o,
});

// Construit un store rempli de N events numérotés (id `e<i>`, ts croissant).
const filled = (
  n: number,
  step = 10,
  over: (i: number) => Partial<IAuditEvent> = () => ({}),
): MemoryAuditStore => {
  const store = new MemoryAuditStore();
  for (let i = 0; i < n; i++) {
    void store.append(
      makeEvent({ id: `e${i}`, ts: 1_000 + i * step, ...over(i) }),
    );
  }
  return store;
};

// Instancie AuditService avec un kernel/module simulés (pattern apiKeyService.test).
function buildAudit(
  audit: Record<string, unknown>,
  environment?: string,
): {
  svc: AuditService;
  container: Container;
} {
  const container = new Container();
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const kernel = {
    container,
    environment,
    once(ev: string, cb: (...a: unknown[]) => void) {
      handlers[ev] = cb;
    },
    registerStoreResolution() {},
  };
  container.set("kernel", kernel);
  const module = {
    container,
    notificationsCenter: false,
    options: { audit },
  } as unknown as Module;
  const svc = new AuditService(module);
  handlers["onBoot"]?.();
  return { svc, container };
}

// ════════════════════════════════════════════════════════════════════════════
describe("MemoryAuditStore — append & query", () => {
  it("rend les événements du plus récent au plus ancien", async () => {
    const store = filled(3);
    const { events, total, nextBefore } = await store.query();
    assert.equal(total, 3);
    assert.deepEqual(
      events.map((e) => e.id),
      ["e2", "e1", "e0"],
    );
    assert.equal(nextBefore, null);
  });

  it("filtre par category / outcome / actor / action (AND)", async () => {
    const store = new MemoryAuditStore();
    void store.append(
      makeEvent({
        id: "a",
        category: "auth",
        outcome: "success",
        actor: "alice",
      }),
    );
    void store.append(
      makeEvent({
        id: "b",
        category: "authz",
        outcome: "denied",
        actor: "bob",
        action: "access.denied",
      }),
    );
    void store.append(
      makeEvent({
        id: "c",
        category: "authz",
        outcome: "denied",
        actor: "alice",
        action: "access.denied",
      }),
    );

    assert.deepEqual(
      (await store.query({ category: "authz" })).events.map((e) => e.id),
      ["c", "b"],
    );
    assert.deepEqual(
      (await store.query({ outcome: "denied", actor: "alice" })).events.map(
        (e) => e.id,
      ),
      ["c"],
    );
    assert.deepEqual(
      (await store.query({ action: "access.denied" })).events.map((e) => e.id),
      ["c", "b"],
    );
    assert.equal((await store.query({ category: "auth" })).total, 1);
  });

  it("filtre par fenêtre temporelle since/until (inclus)", async () => {
    const store = filled(5); // ts 1000,1010,1020,1030,1040
    const res = await store.query({ since: 1_010, until: 1_030 });
    assert.deepEqual(
      res.events.map((e) => e.id),
      ["e3", "e2", "e1"],
    );
  });
});

describe("MemoryAuditStore — pagination par curseur", () => {
  it("limite la page et expose le curseur du plus ancien", async () => {
    const store = filled(5); // e0..e4
    const page1 = await store.query({ limit: 2 });
    assert.deepEqual(
      page1.events.map((e) => e.id),
      ["e4", "e3"],
    );
    assert.equal(page1.total, 5);
    assert.equal(page1.nextBefore, "e3"); // plus ancien de la page

    const page2 = await store.query({ limit: 2, before: page1.nextBefore! });
    assert.deepEqual(
      page2.events.map((e) => e.id),
      ["e2", "e1"],
    );
    assert.equal(page2.nextBefore, "e1");

    const page3 = await store.query({ limit: 2, before: page2.nextBefore! });
    assert.deepEqual(
      page3.events.map((e) => e.id),
      ["e0"],
    );
    assert.equal(page3.nextBefore, null); // épuisé
  });

  it("borne limit dans [1, 500]", async () => {
    const store = filled(3);
    assert.equal((await store.query({ limit: 0 })).events.length, 1); // plancher 1
    assert.equal((await store.query({ limit: 9_999 })).events.length, 3); // plafond n'altère pas < 500
  });
});

describe("MemoryAuditStore — borne de volume (anti-fuite)", () => {
  it("droppe le plus ancien au-delà de maxEntries (FIFO)", async () => {
    const store = new MemoryAuditStore(Date.now, 365 * 86_400_000, 3);
    for (let i = 0; i < 5; i++) {
      void store.append(makeEvent({ id: `e${i}`, ts: 1_000 + i }));
    }
    assert.equal(store.size, 3);
    const ids = (await store.query()).events.map((e) => e.id);
    assert.deepEqual(ids, ["e4", "e3", "e2"]); // e0/e1 tombés
  });
});

describe("MemoryAuditStore — gc rétention", () => {
  it("purge les événements plus vieux que la fenêtre", async () => {
    let nowMs = 1_000_000;
    const store = new MemoryAuditStore(() => nowMs, 100); // rétention 100 ms
    void store.append(makeEvent({ id: "old", ts: nowMs - 500 }));
    void store.append(makeEvent({ id: "fresh", ts: nowMs - 10 }));
    const purged = await store.gc();
    assert.equal(purged, 1);
    assert.deepEqual(
      (await store.query()).events.map((e) => e.id),
      ["fresh"],
    );
  });
});

describe("MemoryAuditStore — snapshot / restore", () => {
  it("sérialise puis reconstruit l'état", async () => {
    const store = filled(3);
    const snap = store.snapshot();
    const fresh = new MemoryAuditStore();
    fresh.restore(snap);
    assert.equal(fresh.size, 3);
    assert.deepEqual(
      (await fresh.query()).events.map((e) => e.id),
      ["e2", "e1", "e0"],
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("AuditService — désactivé (coût nul)", () => {
  it("isEnabled=false, record no-op, query vide, pas de store au container", async () => {
    const { svc, container } = buildAudit({ enabled: false });
    assert.equal(svc.isEnabled(), false);
    svc.record({
      category: "auth",
      action: "login.success",
      outcome: "success",
      actor: "x",
    });
    const res = await svc.query();
    assert.deepEqual(res, { events: [], nextBefore: null, total: 0 });
    assert.equal(container.get("auditStore"), null); // store non posé si désactivé
  });

  it("un listener ne reçoit rien quand l'audit est désactivé", () => {
    const { svc } = buildAudit({ enabled: false });
    let seen = 0;
    svc.subscribe(() => seen++);
    svc.record({
      category: "auth",
      action: "login.failure",
      outcome: "failure",
      actor: null,
    });
    assert.equal(seen, 0);
  });
});

describe("AuditService — actif", () => {
  const draft: IAuditEventDraft = {
    category: "authz",
    action: "access.denied",
    outcome: "denied",
    actor: "mallory",
    reason: "veto",
  };

  it("isEnabled=true et pose auditStore au container", () => {
    const { svc, container } = buildAudit({ enabled: true });
    assert.equal(svc.isEnabled(), true);
    assert.ok(container.get("auditStore"));
  });

  it("record pose id+ts et persiste (query le retrouve)", async () => {
    const { svc } = buildAudit({ enabled: true });
    svc.record(draft);
    const res = await svc.query();
    assert.equal(res.total, 1);
    const e = res.events[0]!;
    assert.equal(e.action, "access.denied");
    assert.equal(e.actor, "mallory");
    assert.ok(typeof e.id === "string" && e.id.length > 0);
    assert.ok(typeof e.ts === "number" && e.ts > 0);
  });

  it("ids uniques sur émissions successives", async () => {
    const { svc } = buildAudit({ enabled: true });
    svc.record(draft);
    svc.record(draft);
    svc.record(draft);
    const ids = (await svc.query()).events.map((e) => e.id);
    assert.equal(new Set(ids).size, 3);
  });

  it("fan-out live : subscribe reçoit, dispose coupe", () => {
    const { svc } = buildAudit({ enabled: true });
    const received: string[] = [];
    const dispose = svc.subscribe((e) => received.push(e.action));
    svc.record(draft);
    assert.deepEqual(received, ["access.denied"]);
    dispose();
    svc.record(draft);
    assert.deepEqual(received, ["access.denied"]); // plus rien après dispose
  });

  it("un listener qui throw n'empêche pas les autres ni la persistance", async () => {
    const { svc } = buildAudit({ enabled: true });
    const ok: string[] = [];
    svc.subscribe(() => {
      throw new Error("listener cassé");
    });
    svc.subscribe((e) => ok.push(e.action));
    assert.doesNotThrow(() => svc.record(draft));
    assert.deepEqual(ok, ["access.denied"]);
    assert.equal((await svc.query()).total, 1); // persisté malgré le listener KO
  });
});

// Doctrine d'échec (0.8 lot 4) : store EXPLICITE introuvable = config erronée →
// prod = boot avorté (fail-loud) ; dev = audit désactivé ANNONCÉ. Le store
// "memory" explicite reste accepté en prod (WARNING appuyé, pas de refus).
describe("AuditService — doctrine d'échec store explicite", () => {
  it("dev : store inconnu → audit désactivé, pas de throw", () => {
    const { svc, container } = buildAudit({ enabled: true, store: "granite" });
    assert.equal(svc.isEnabled(), false);
    assert.equal(container.get("auditStore"), null);
  });

  it("prod : store inconnu → throw au boot (fail-loud)", () => {
    assert.throws(
      () => buildAudit({ enabled: true, store: "granite" }, "production"),
      /audit store "granite" inconnu/,
    );
  });

  it("prod : store memory → boot OK (WARNING nommant l'impact, pas de refus)", () => {
    const { svc } = buildAudit(
      { enabled: true, store: "memory" },
      "production",
    );
    assert.equal(svc.isEnabled(), true);
  });
});
