import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import AuditService from "../../nodefony/service/auditService";
import { AuditRefusalAggregator } from "../../nodefony/src/audit/AuditRefusalAggregator";
import type { IAuditEventDraft } from "../../nodefony/contracts/IAuditEvent";
import type { IAuditStore } from "../../nodefony/contracts/IAuditStore";

/**
 * Agrégation des REFUS du journal d'audit : un flot d'une même source s'écrit
 * en `burst` lignes puis UNE synthèse par fenêtre, au lieu d'une ligne par
 * requête (OWASP Logging Cheat Sheet : la journalisation ne doit pas épuiser
 * les ressources). Les succès ne sont jamais agrégés.
 */

const refusal = (o: Partial<IAuditEventDraft> = {}): IAuditEventDraft => ({
  category: "auth",
  action: "login.failure",
  outcome: "failure",
  actor: "alice",
  resource: "api",
  reason: "invalid_credentials",
  ip: "203.0.113.7",
  ...o,
});

const OPTIONS = { windowMs: 60_000, burst: 10, maxKeys: 100 };

function aggregator(options = OPTIONS): {
  agg: AuditRefusalAggregator;
  emitted: IAuditEventDraft[];
} {
  const emitted: IAuditEventDraft[] = [];
  return {
    agg: new AuditRefusalAggregator(options, (d) => emitted.push(d)),
    emitted,
  };
}

/** `count` refus d'une même source, une milliseconde d'écart. */
function flood(
  agg: AuditRefusalAggregator,
  count: number,
  draft: IAuditEventDraft,
  t0 = 1_000,
): number {
  let written = 0;
  for (let i = 0; i < count; i++) if (agg.admit(draft, t0 + i)) written++;
  return written;
}

describe("AuditRefusalAggregator — une source bavarde, une synthèse", () => {
  it("1 000 refus d'une IP : 10 écrits, puis UNE synthèse qui compte les 990 autres", () => {
    const { agg, emitted } = aggregator();
    assert.equal(flood(agg, 1_000, refusal()), 10);
    assert.equal(
      emitted.length,
      0,
      "rien n'est résumé avant la fin de fenêtre",
    );
    agg.sweep(1_000 + 60_000);
    assert.equal(emitted.length, 1);
    const summary = emitted[0]!;
    assert.deepEqual(summary.metadata, {
      aggregated: {
        count: 990,
        firstTs: 1_010,
        lastTs: 1_999,
        windowMs: 60_000,
      },
    });
    assert.equal(summary.ip, "203.0.113.7");
    assert.equal(summary.actor, null, "la synthèse ne prête aucun acteur");
    assert.equal(summary.reason, "invalid_credentials");
    assert.equal(agg.size, 0, "la clé est libérée");
  });

  it("deux IP sont deux sources : chacune garde sa rafale", () => {
    const { agg } = aggregator();
    assert.equal(flood(agg, 50, refusal({ ip: "198.51.100.1" })), 10);
    assert.equal(flood(agg, 50, refusal({ ip: "198.51.100.2" })), 10);
    assert.equal(agg.size, 2);
  });

  it("l'acteur n'entre pas dans la clé : un bourrage d'identifiants reste UNE source", () => {
    const { agg } = aggregator();
    let written = 0;
    for (let i = 0; i < 100; i++) {
      if (agg.admit(refusal({ actor: `user${i}` }), 1_000 + i)) written++;
    }
    assert.equal(written, 10);
  });

  it("une fenêtre échue en rouvre une : la rafale repart, la synthèse de la précédente part", () => {
    const { agg, emitted } = aggregator();
    flood(agg, 30, refusal());
    assert.equal(agg.admit(refusal(), 1_000 + 60_000), true);
    assert.equal(emitted.length, 1);
    assert.equal(
      (emitted[0]!.metadata as { aggregated: { count: number } }).aggregated
        .count,
      20,
    );
  });

  it("sous la rafale, aucune synthèse : un refus isolé reste une ligne et rien de plus", () => {
    const { agg, emitted } = aggregator();
    assert.equal(flood(agg, 10, refusal()), 10);
    agg.sweep(1_000 + 60_000);
    assert.equal(emitted.length, 0);
  });

  it("mémoire bornée : au-delà de maxKeys, les refus se regroupent sous l'IP `*`", () => {
    const { agg, emitted } = aggregator({ ...OPTIONS, maxKeys: 3 });
    for (let i = 0; i < 1_000; i++) {
      agg.admit(refusal({ ip: `10.0.${i >> 8}.${i & 255}` }), 1_000);
    }
    assert.equal(agg.size, 4, "3 clés + la clé de repli, jamais plus");
    agg.flush();
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]!.ip, "*");
  });

  it("flush (arrêt) résume ce qui a été compté, sans attendre la fin de fenêtre", () => {
    const { agg, emitted } = aggregator();
    flood(agg, 25, refusal());
    agg.flush();
    assert.equal(emitted.length, 1);
    assert.equal(agg.size, 0);
  });
});

// ── Branché dans le service réel ─────────────────────────────────────────────

function buildAudit(audit: Record<string, unknown>): {
  svc: AuditService;
  container: Container;
  terminate: () => void;
} {
  const container = new Container();
  const handlers: Record<string, () => void> = {};
  const kernel = {
    container,
    once(ev: string, cb: () => void) {
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
  return { svc, container, terminate: () => handlers["onTerminate"]?.() };
}

describe("AuditService — agrégation des refus", () => {
  it("un flot de 500 refus : 10 lignes en vol, la synthèse part à l'arrêt", async () => {
    const { svc, container, terminate } = buildAudit({
      enabled: true,
      store: "memory",
    });
    const live: string[] = [];
    svc.subscribe((e) => live.push(e.id));
    for (let i = 0; i < 500; i++) svc.record(refusal());
    assert.equal((await svc.listPage({ limit: 500 })).total, 10);
    assert.equal(live.length, 10, "un refus compté n'est pas diffusé non plus");
    const store = container.get<IAuditStore>("auditStore");
    assert.ok(store);
    terminate();
    const page = await store.listPage({ limit: 500 });
    assert.equal(page.total, 11);
    const summary = page.items.find((e) => e.metadata?.["aggregated"]);
    assert.ok(summary, "la synthèse est au journal");
  });

  it("les succès ne sont JAMAIS agrégés", async () => {
    const { svc } = buildAudit({ enabled: true, store: "memory" });
    for (let i = 0; i < 50; i++) {
      svc.record(refusal({ action: "login.success", outcome: "success" }));
    }
    assert.equal((await svc.listPage({ limit: 100 })).total, 50);
  });

  it("aggregate.enabled: false : une ligne par refus, comme avant", async () => {
    const { svc } = buildAudit({
      enabled: true,
      store: "memory",
      aggregate: { enabled: false },
    });
    for (let i = 0; i < 50; i++) svc.record(refusal());
    assert.equal((await svc.listPage({ limit: 100 })).total, 50);
  });
});
