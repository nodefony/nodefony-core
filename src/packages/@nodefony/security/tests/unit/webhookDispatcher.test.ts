import assert from "node:assert/strict";
import {
  WebhookDispatcher,
  matchesSubscription,
  classifyDelivery,
  backoffMs,
  type IWebhookDispatcherDeps,
  type IWebhookDeliveryRecord,
} from "../../nodefony/src/webhook/WebhookDispatcher";
import type { IWebhookEndpoint } from "../../nodefony/contracts/IWebhookEndpoint";
import type { IAuditEvent } from "../../nodefony/contracts/IAuditEvent";
import type { IWebhookDeliveryPolicy } from "../../nodefony/service/webhooks";
import type { IDeliveryResult } from "../../nodefony/src/webhook/webhookDelivery";

/**
 * Dispatcher webhooks — logique pure (matching/classification/backoff), flux
 * d'orchestration (signature, retry, auto-marquage) ET **bornes de perf** (RÈGLE
 * ABSOLUE : concurrence + file bornées, court-circuit 0-alloc). E/S injectées →
 * aucun réseau ni timer réel.
 */

const flush = () => new Promise((r) => setTimeout(r, 0));

function endpoint(over: Partial<IWebhookEndpoint> = {}): IWebhookEndpoint {
  return {
    id: "wh_1",
    url: "https://hooks.example/x",
    secretEnc: "gcm1.x",
    events: ["*"],
    enabled: true,
    description: null,
    tenantId: null,
    createdBy: null,
    createdAt: 0,
    updatedAt: 0,
    lastDeliveryAt: null,
    lastDeliveryStatus: null,
    lastDeliveryError: null,
    failureCount: 0,
    metadata: {},
    ...over,
  };
}

const auditEvent = (action: string): IAuditEvent => ({
  id: "ae_1",
  ts: 1_700_000_000_000,
  category: "auth",
  action,
  outcome: "success",
  actor: "alice",
});

interface Harness {
  deps: IWebhookDispatcherDeps;
  deliverCalls: Array<{ headers: Record<string, string>; body: string }>;
  marks: IDeliveryResult[];
  records: IWebhookDeliveryRecord[];
  scheduled: number;
  cancels: number;
  gates: Array<(r: IDeliveryResult) => void>;
}

type Mode = IDeliveryResult | IDeliveryResult[] | "defer";

function harness(
  endpoints: IWebhookEndpoint[],
  mode: Mode,
  policyOver: Partial<IWebhookDeliveryPolicy> = {},
  over: Partial<IWebhookDispatcherDeps> = {},
): Harness {
  const h: Harness = {
    deliverCalls: [],
    marks: [],
    records: [],
    scheduled: 0,
    cancels: 0,
    gates: [],
    deps: undefined as unknown as IWebhookDispatcherDeps,
  };
  let i = 0;
  h.deps = {
    endpointCount: () => endpoints.length,
    getSnapshot: () => endpoints,
    secretOf: () => "whsec_dGVzdHNlY3JldA==",
    policy: {
      timestampToleranceS: 300,
      maxRetries: 2,
      autoDisableThreshold: 20,
      deliveryTimeoutMs: 1000,
      maxConcurrent: 8,
      maxQueue: 1000,
      allowHttp: false,
      denyPrivateIps: true,
      ...policyOver,
    },
    resolveTarget: async () => ["1.2.3.4"],
    deliver: (_url, body, headers) => {
      h.deliverCalls.push({ headers, body });
      if (mode === "defer") {
        return new Promise<IDeliveryResult>((res) => h.gates.push(res));
      }
      const result = Array.isArray(mode)
        ? (mode[Math.min(i++, mode.length - 1)] as IDeliveryResult)
        : mode;
      return Promise.resolve(result);
    },
    markDelivery: (_id, r) => {
      h.marks.push(r);
    },
    recordDelivery: (_id, rec) => {
      h.records.push(rec);
    },
    now: () => 1_700_000_000_000,
    newMessageId: () => "msg_test",
    schedule: (fn) => {
      h.scheduled++;
      queueMicrotask(fn);
      return () => {
        h.cancels++;
      };
    },
    log: () => {},
    ...over,
  };
  return h;
}

const ok: IDeliveryResult = { ok: true, status: 200, error: null };
const retryable: IDeliveryResult = {
  ok: false,
  status: 503,
  error: "HTTP 503",
};
const fatal: IDeliveryResult = { ok: false, status: 404, error: "HTTP 404" };

describe("dispatcher — fonctions pures", () => {
  it("matchesSubscription: *, exact, préfixe, miss", () => {
    assert.equal(matchesSubscription(["*"], "login.success"), true);
    assert.equal(matchesSubscription(["login.success"], "login.success"), true);
    assert.equal(matchesSubscription(["login.*"], "login.success"), true);
    assert.equal(matchesSubscription(["login.*"], "logout.success"), false);
    assert.equal(matchesSubscription(["user.created"], "login.success"), false);
  });
  it("classifyDelivery: succès / retry / fail", () => {
    assert.equal(classifyDelivery(ok), "success");
    assert.equal(
      classifyDelivery({ ok: false, status: null, error: "x" }),
      "retry",
    );
    assert.equal(classifyDelivery(retryable), "retry");
    assert.equal(
      classifyDelivery({ ok: false, status: 429, error: "" }),
      "retry",
    );
    assert.equal(classifyDelivery(fatal), "fail");
    assert.equal(
      classifyDelivery({ ok: false, status: 302, error: "" }),
      "fail",
    );
  });
  it("backoffMs croît puis plafonne", () => {
    assert.ok(backoffMs(0) < backoffMs(1));
    assert.ok(backoffMs(1) < backoffMs(2));
    assert.equal(backoffMs(99), backoffMs(100)); // cap
  });
});

describe("dispatcher — filtrage (hot-path)", () => {
  it("0 endpoint → court-circuit, getSnapshot jamais lu", async () => {
    let snapshotReads = 0;
    const h = harness(
      [],
      ok,
      {},
      {
        endpointCount: () => 0,
        getSnapshot: () => {
          snapshotReads++;
          return [];
        },
      },
    );
    new WebhookDispatcher(h.deps).onAuditEvent(auditEvent("login.success"));
    await flush();
    assert.equal(h.deliverCalls.length, 0);
    assert.equal(snapshotReads, 0); // 0-alloc : on ne lit même pas le snapshot
  });
  it("endpoint désactivé → ignoré", async () => {
    const h = harness([endpoint({ enabled: false })], ok);
    new WebhookDispatcher(h.deps).onAuditEvent(auditEvent("login.success"));
    await flush();
    assert.equal(h.deliverCalls.length, 0);
  });
  it("action non souscrite → ignoré", async () => {
    const h = harness([endpoint({ events: ["user.created"] })], ok);
    new WebhookDispatcher(h.deps).onAuditEvent(auditEvent("login.success"));
    await flush();
    assert.equal(h.deliverCalls.length, 0);
  });
});

describe("dispatcher — livraison & signature", () => {
  it("match → livraison signée (headers Standard Webhooks + body type/data)", async () => {
    const h = harness([endpoint()], ok);
    new WebhookDispatcher(h.deps).onAuditEvent(auditEvent("login.success"));
    await flush();
    assert.equal(h.deliverCalls.length, 1);
    const { headers, body } = h.deliverCalls[0]!;
    assert.equal(headers["webhook-id"], "msg_test");
    assert.match(headers["webhook-signature"]!, /^v1,/);
    assert.ok(headers["webhook-timestamp"]);
    const parsed = JSON.parse(body);
    assert.equal(parsed.type, "login.success");
    assert.equal(parsed.data.actor, "alice");
    assert.equal(h.marks.length, 1);
    assert.equal(h.marks[0]!.ok, true);
  });
});

describe("dispatcher — retry & auto-marquage", () => {
  it("erreur réessayable → retries jusqu'à maxRetries puis échec définitif", async () => {
    const h = harness([endpoint()], retryable);
    new WebhookDispatcher(h.deps).onAuditEvent(auditEvent("login.success"));
    await flush();
    assert.equal(h.deliverCalls.length, 3); // attempt 0 + 2 retries
    assert.equal(h.scheduled, 2);
    assert.equal(h.marks.length, 1);
    assert.equal(h.marks[0]!.ok, false);
  });
  it("retry puis succès → 1 seul markDelivery (ok)", async () => {
    const h = harness([endpoint()], [retryable, ok]);
    new WebhookDispatcher(h.deps).onAuditEvent(auditEvent("login.success"));
    await flush();
    assert.equal(h.deliverCalls.length, 2);
    assert.equal(h.marks.length, 1);
    assert.equal(h.marks[0]!.ok, true);
  });
  it("erreur 4xx → échec définitif sans retry", async () => {
    const h = harness([endpoint()], fatal);
    new WebhookDispatcher(h.deps).onAuditEvent(auditEvent("login.success"));
    await flush();
    assert.equal(h.deliverCalls.length, 1);
    assert.equal(h.scheduled, 0);
    assert.equal(h.marks[0]!.ok, false);
  });
});

describe("dispatcher — SSRF au point de livraison (rebinding)", () => {
  it("resolveTarget rejette → pas de livraison, marqué en échec", async () => {
    const h = harness(
      [endpoint()],
      ok,
      {},
      {
        resolveTarget: async () => {
          throw new Error("cible non publique");
        },
      },
    );
    new WebhookDispatcher(h.deps).onAuditEvent(auditEvent("login.success"));
    await flush();
    assert.equal(h.deliverCalls.length, 0);
    assert.equal(h.marks.length, 1);
    assert.equal(h.marks[0]!.ok, false);
    assert.match(h.marks[0]!.error ?? "", /ssrf/);
  });
});

describe("dispatcher — historique des livraisons (recordDelivery)", () => {
  it("succès → 1 trace (ok, type, payload signé, durée)", async () => {
    const h = harness([endpoint()], {
      ok: true,
      status: 200,
      error: null,
      responseBody: '{"ack":true}',
    });
    new WebhookDispatcher(h.deps).onAuditEvent(auditEvent("login.success"));
    await flush();
    assert.equal(h.records.length, 1);
    const rec = h.records[0]!;
    assert.equal(rec.ok, true);
    assert.equal(rec.status, 200);
    assert.equal(rec.type, "login.success");
    assert.equal(rec.attempt, 0);
    assert.equal(rec.responseBody, '{"ack":true}');
    // Le corps tracé = l'enveloppe envoyée {id,timestamp,type,data}.
    assert.match(rec.requestBody, /"type":"login\.success"/);
    assert.ok(typeof rec.durationMs === "number");
  });

  it("retry puis succès → 1 SEULE trace (issue finale), pas les intermédiaires", async () => {
    const h = harness([endpoint()], [retryable, ok]);
    new WebhookDispatcher(h.deps).onAuditEvent(auditEvent("login.success"));
    await flush();
    assert.equal(h.records.length, 1);
    assert.equal(h.records[0]!.ok, true);
  });

  it("rejet SSRF → 1 trace en échec (status null, responseBody null)", async () => {
    const h = harness(
      [endpoint()],
      ok,
      {},
      {
        resolveTarget: async () => {
          throw new Error("cible non publique");
        },
      },
    );
    new WebhookDispatcher(h.deps).onAuditEvent(auditEvent("login.success"));
    await flush();
    assert.equal(h.records.length, 1);
    assert.equal(h.records[0]!.ok, false);
    assert.equal(h.records[0]!.status, null);
    assert.equal(h.records[0]!.responseBody, null);
    assert.match(h.records[0]!.error ?? "", /ssrf/);
  });
});

describe("dispatcher — bornes de PERF (anti-DoS du framework)", () => {
  it("concurrence bornée : au plus maxConcurrent livraisons en vol", async () => {
    const eps = Array.from({ length: 4 }, (_, k) =>
      endpoint({ id: `wh_${k}` }),
    );
    const h = harness(eps, "defer", { maxConcurrent: 2 });
    new WebhookDispatcher(h.deps).onAuditEvent(auditEvent("login.success"));
    await flush();
    assert.equal(h.deliverCalls.length, 2); // 2 en vol, 2 en file
    h.gates.forEach((g) => g(ok)); // libère → les 2 suivants partent
    await flush();
    assert.equal(h.deliverCalls.length, 4);
  });

  it("file bornée : au-delà de maxQueue, livraisons ABANDONNÉES (best-effort)", async () => {
    const eps = Array.from({ length: 5 }, (_, k) =>
      endpoint({ id: `wh_${k}` }),
    );
    const h = harness(eps, "defer", { maxConcurrent: 1, maxQueue: 2 });
    const d = new WebhookDispatcher(h.deps);
    d.onAuditEvent(auditEvent("login.success")); // 5 enqueue ; file plafonnée à 2
    await flush();
    assert.equal(d.droppedCount(), 3); // 5 - 2 admis = 3 abandonnés
    assert.ok(h.deliverCalls.length <= 1); // maxConcurrent=1
  });
});

describe("dispatcher — shutdown", () => {
  it("annule les retries en vol + stoppe l'admission", async () => {
    const h = harness(
      [endpoint()],
      retryable,
      {},
      {
        schedule: () => () => h.cancels++,
      },
    );
    const d = new WebhookDispatcher(h.deps);
    d.onAuditEvent(auditEvent("login.success"));
    await flush();
    d.shutdown();
    assert.ok(h.cancels >= 1);
    const before = h.deliverCalls.length;
    d.onAuditEvent(auditEvent("login.success"));
    await flush();
    assert.equal(h.deliverCalls.length, before); // plus aucune admission
  });
});
