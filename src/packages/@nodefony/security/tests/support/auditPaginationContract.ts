import assert from "node:assert/strict";
import type { IAuditEvent } from "../../nodefony/contracts/IAuditEvent";
import type { IAuditStore } from "../../nodefony/contracts/IAuditStore";

/**
 * **Banc de contrat UNIQUE** du journal d'audit paginé (`IAuditStore.listPage`).
 * Backend-agnostique : se branche sur n'importe quel store via un harness
 * (mémoire, Drizzle × sqlite/postgres/mysql). Vit chez le propriétaire du contrat.
 *
 * **Une seule capacité ici** : le journal est un flux ordonné → pagination par
 * **curseur** exclusivement (jamais `offset` : des événements s'insèrent pendant
 * qu'on parcourt, un décalage numérique glisserait). Les deux backends savent
 * compter → `total` exact attendu partout.
 *
 * Ce banc verrouille surtout deux propriétés que la convergence a apportées et
 * qu'un backend pourrait perdre en silence :
 *  - le curseur est **auto-portant** : une page reste juste même si l'événement
 *    qui l'a produite a été purgé entre-temps (`gc`) — l'ancien curseur-id
 *    rembobinait à la page 1, ce qui boucle côté console ;
 *  - l'ordre est **total** `(ts DESC, id DESC)` : deux événements de la même
 *    milliseconde (rafale de login) ne peuvent ni se répéter ni se perdre.
 *
 * Seed déterministe : 12 événements `evt-00`…`evt-11`, `ts` croissants, dont
 * **trois à la même milliseconde** (collision volontaire), catégories `auth`/
 * `authz`, issues `success`/`failure`/`denied`, deux acteurs.
 */

/** Fabrique un événement complet (défauts sûrs) — seul l'`id` est requis. */
export function makeAuditEvent(
  over: Partial<IAuditEvent> & { id: string },
): IAuditEvent {
  return {
    id: over.id,
    ts: over.ts ?? 0,
    category: over.category ?? "auth",
    action: over.action ?? "login.success",
    outcome: over.outcome ?? "success",
    actor: over.actor ?? null,
    resource: over.resource ?? null,
    reason: over.reason ?? null,
    ip: over.ip ?? null,
    userAgent: over.userAgent ?? null,
    requestId: over.requestId ?? null,
    ...(over.flags !== undefined ? { flags: over.flags } : {}),
    ...(over.metadata !== undefined ? { metadata: over.metadata } : {}),
  };
}

/**
 * Le seed déterministe partagé par tous les backends. Les événements `evt-04`,
 * `evt-05` et `evt-06` partagent le MÊME `ts` : c'est la rafale qui met l'ordre
 * total et le curseur composite à l'épreuve.
 */
export function auditSeed(): IAuditEvent[] {
  const out: IAuditEvent[] = [];
  for (let i = 0; i < 12; i += 1) {
    const collision = i >= 4 && i <= 6;
    out.push(
      makeAuditEvent({
        id: `evt-${String(i).padStart(2, "0")}`,
        ts: collision ? 1_000_004 : 1_000_000 + i,
        category: i % 3 === 0 ? "authz" : "auth",
        outcome: i % 4 === 0 ? "denied" : i % 2 === 0 ? "failure" : "success",
        action: i % 3 === 0 ? "access.denied" : "login.success",
        actor: i % 2 === 0 ? "alice" : "bob",
        requestId: `req-${i % 3}`,
      }),
    );
  }
  return out;
}

export interface AuditPaginationHarness {
  /** Le store sous test (résolu paresseusement). */
  store: () => IAuditStore;
  /** Vide le store avant le seed (banc idempotent). */
  clear: () => Promise<void>;
}

/** Collecte toutes les pages en suivant les curseurs, avec garde anti-boucle. */
async function collectByCursor(
  store: IAuditStore,
  base: Record<string, unknown> = {},
  limit = 5,
): Promise<IAuditEvent[]> {
  const all: IAuditEvent[] = [];
  let cursor: string | undefined;
  let guard = 0;
  do {
    const page = await store.listPage({ ...base, limit, cursor });
    all.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    guard += 1;
  } while (cursor && guard < 100);
  assert.ok(guard < 100, "pagination non convergente (curseur qui boucle)");
  return all;
}

/** Déroule la suite du contrat de listing du journal sur le store branché. */
export function runAuditPaginationContract(
  harness: AuditPaginationHarness,
): void {
  describe("listPage — contrat de lecture du journal d'audit (curseur)", () => {
    beforeAll(async () => {
      await harness.clear();
      for (const event of auditSeed()) await harness.store().append(event);
    });
    const store = () => harness.store();

    it("borne : une page ne rend jamais plus que `limit`", async () => {
      const page = await store().listPage({ limit: 5 });
      assert.equal(page.items.length, 5);
      assert.equal(page.limit, 5);
      assert.equal(page.hasNext, true);
    });

    it("plafond du store : un `limit` démesuré est ramené au maximum", async () => {
      const page = await store().listPage({ limit: 10_000 });
      assert.ok(page.limit <= 500, `limit non plafonné (${page.limit})`);
    });

    it("ordre : du plus récent au plus ancien, total exact", async () => {
      const page = await store().listPage({ limit: 3 });
      assert.equal(page.total, 12);
      assert.equal(page.items[0]!.id, "evt-11");
      assert.equal(page.items[1]!.id, "evt-10");
      assert.equal(page.items[2]!.id, "evt-09");
    });

    it("parcours complet : 12 événements DISTINCTS, aucun perdu ni répété", async () => {
      const all = await collectByCursor(store());
      assert.equal(all.length, 12);
      assert.equal(new Set(all.map((e) => e.id)).size, 12);
      assert.equal(all[0]!.id, "evt-11");
      assert.equal(all[11]!.id, "evt-00");
    });

    // La rafale : trois événements à la milliseconde près. Sans ordre total
    // (ts, id), le curseur en saute ou en répète — le parcours ci-dessus le
    // prouve globalement, celui-ci localise la garantie.
    it("collision de timestamp : la rafale est traversée sans perte", async () => {
      const all = await collectByCursor(store(), {}, 2);
      const burst = all.filter((e) => e.ts === 1_000_004).map((e) => e.id);
      assert.deepEqual(burst, ["evt-06", "evt-05", "evt-04"]);
    });

    it("dernière page : hasNext false et nextCursor null", async () => {
      const first = await store().listPage({ limit: 10 });
      assert.equal(first.hasNext, true);
      assert.ok(first.nextCursor);
      const last = await store().listPage({
        limit: 10,
        cursor: first.nextCursor,
      });
      assert.equal(last.items.length, 2);
      assert.equal(last.hasNext, false);
      assert.equal(last.nextCursor, null);
    });

    // Ce que l'ancien curseur-id ne savait pas faire : le jeton se suffit à
    // lui-même. On le forge à partir d'un événement JAMAIS journalisé.
    it("🔒 curseur auto-portant : valide même si l'événement a disparu", async () => {
      const page = await store().listPage({
        limit: 100,
        cursor: "1000003:zzz",
      });
      assert.deepEqual(
        page.items.map((e) => e.id),
        ["evt-03", "evt-02", "evt-01", "evt-00"],
      );
    });

    // Un curseur forgé n'a pas à faire tomber une console de consultation ; il
    // ne doit pas non plus élargir le filtre (le filtre reste appliqué).
    it("curseur malformé : page la plus récente, jamais d'erreur", async () => {
      const page = await store().listPage({
        limit: 3,
        cursor: "n'importe quoi",
      });
      assert.equal(page.items[0]!.id, "evt-11");
      assert.equal(page.total, 12);
    });

    it("filtres AND : category, outcome, actor, action, requestId", async () => {
      assert.equal(
        (await store().listPage({ limit: 100, category: "authz" })).total,
        4,
      );
      assert.equal(
        (await store().listPage({ limit: 100, outcome: "denied" })).total,
        3,
      );
      assert.equal(
        (await store().listPage({ limit: 100, actor: "alice" })).total,
        6,
      );
      assert.equal(
        (await store().listPage({ limit: 100, action: "access.denied" })).total,
        4,
      );
      assert.equal(
        (await store().listPage({ limit: 100, requestId: "req-1" })).total,
        4,
      );
      // Intersection stricte (AND) : `authz` = {00,03,06,09}, `alice` = les
      // pairs → il ne reste que 00 et 06.
      const both = await store().listPage({
        limit: 100,
        category: "authz",
        actor: "alice",
      });
      assert.deepEqual(
        both.items.map((e) => e.id),
        ["evt-06", "evt-00"],
      );
      assert.equal(both.total, 2);
    });

    it("fenêtre temporelle : since / until (bornes incluses)", async () => {
      const since = await store().listPage({ limit: 100, since: 1_000_007 });
      assert.deepEqual(
        since.items.map((e) => e.id),
        ["evt-11", "evt-10", "evt-09", "evt-08", "evt-07"],
      );
      const until = await store().listPage({ limit: 100, until: 1_000_001 });
      assert.deepEqual(
        until.items.map((e) => e.id),
        ["evt-01", "evt-00"],
      );
    });

    it("le filtre survit à la pagination (curseur + critère)", async () => {
      const filtered = await collectByCursor(store(), { actor: "alice" }, 2);
      assert.equal(filtered.length, 6);
      assert.ok(filtered.every((e) => e.actor === "alice"));
      assert.equal(new Set(filtered.map((e) => e.id)).size, 6);
    });

    it("withTotal:false → total omis, hasNext toujours fiable", async () => {
      const page = await store().listPage({ limit: 5, withTotal: false });
      assert.equal(page.total, undefined);
      assert.equal(page.items.length, 5);
      assert.equal(page.hasNext, true);
    });

    it("filtre sans résultat : page vide, fin de parcours", async () => {
      const page = await store().listPage({ limit: 10, actor: "personne" });
      assert.deepEqual(page.items, []);
      assert.equal(page.total, 0);
      assert.equal(page.hasNext, false);
      assert.equal(page.nextCursor, null);
    });
  });
}
