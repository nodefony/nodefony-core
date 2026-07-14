import assert from "node:assert/strict";
import {
  WebhookDispatcher,
  type IWebhookDispatcherDeps,
} from "../../nodefony/src/webhook/WebhookDispatcher";
import type { IWebhookEndpoint } from "../../nodefony/contracts/IWebhookEndpoint";
import type { IAuditEvent } from "../../nodefony/contracts/IAuditEvent";
import type { IWebhookDeliveryPolicy } from "../../nodefony/service/webhooks";
import type { IDeliveryResult } from "../../nodefony/src/webhook/webhookDelivery";

/**
 * RED-TEAM dispatcher webhooks (P6.13 Slice B) — la brique attaque le FRAMEWORK
 * lui-même : un endpoint mort/lent ne doit JAMAIS le mettre en danger (RÈGLE PERF).
 * Vecteurs : DoS par burst d'envois ratés (mémoire + sockets bornées), fuite du
 * secret de signature, amplification (boucle d'audit), injection de payload.
 */

const flush = () => new Promise((r) => setTimeout(r, 0));
const SECRET = "whsec_dGVzdHNlY3JldA=="; // "testsecret"

function ep(id: string, events: string[] = ["*"]): IWebhookEndpoint {
  return {
    id,
    url: "https://hooks.example/x",
    secretEnc: "gcm1.x",
    events,
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
  };
}

const event = (
  action: string,
  actor: string | null = "alice",
): IAuditEvent => ({
  id: "ae",
  ts: 1_700_000_000_000,
  category: "auth",
  action,
  outcome: "success",
  actor,
});

function deps(
  endpoints: IWebhookEndpoint[],
  deliver: IWebhookDispatcherDeps["deliver"],
  policyOver: Partial<IWebhookDeliveryPolicy> = {},
  sink?: { calls: Array<{ headers: Record<string, string>; body: string }> },
): IWebhookDispatcherDeps {
  return {
    endpointCount: () => endpoints.length,
    getSnapshot: () => endpoints,
    secretOf: () => SECRET,
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
    deliver: (url, body, headers, o) => {
      sink?.calls.push({ headers, body });
      return deliver(url, body, headers, o);
    },
    // Sondes d'observabilité inertes : ces bancs mesurent les BORNES (file,
    // concurrence, mémoire), pas l'historique — aucune assertion n'en dépend.
    // L'historique par livraison est couvert par `webhookDispatcher.test.ts`.
    markDelivery: () => {},
    recordDelivery: () => {},
    now: () => 1_700_000_000_000,
    newMessageId: () => "msg_x",
    schedule: (fn) => {
      queueMicrotask(fn);
      return () => {};
    },
    log: () => {},
  };
}

describe("attack/DoS — burst d'envois ratés ne met PAS le framework en danger", () => {
  it("5000 events vers un endpoint mort : mémoire bornée (file) + sockets bornées (concurrence)", async () => {
    let inFlight = 0;
    let peak = 0;
    // endpoint mort : la livraison ne résout jamais (pending) → tient une "socket".
    const deliver = () =>
      new Promise<IDeliveryResult>(() => {
        inFlight++;
        peak = Math.max(peak, inFlight);
      });
    const d = new WebhookDispatcher(
      deps([ep("wh_dead")], deliver, { maxConcurrent: 8, maxQueue: 1000 }),
    );
    for (let i = 0; i < 5000; i++) d.onAuditEvent(event("login.success"));
    await flush();
    // File plafonnée → 4000 abandons (pas de croissance mémoire illimitée).
    assert.equal(d.droppedCount(), 4000);
    // Au plus maxConcurrent connexions simultanées (pas d'explosion de sockets/FD).
    assert.ok(peak <= 8, `peak=${peak} > 8`);
  });
});

describe("attack/secret — le secret de signature ne FUITE jamais", () => {
  it("ni dans le body, ni dans une valeur d'en-tête (hors HMAC dérivé)", async () => {
    const sink = {
      calls: [] as Array<{ headers: Record<string, string>; body: string }>,
    };
    const d = new WebhookDispatcher(
      deps(
        [ep("wh_1")],
        async () => ({ ok: true, status: 200, error: null }),
        {},
        sink,
      ),
    );
    d.onAuditEvent(event("login.success"));
    await flush();
    assert.equal(sink.calls.length, 1);
    const { headers, body } = sink.calls[0]!;
    assert.ok(!body.includes("whsec_"), "secret dans le body");
    assert.ok(!body.includes("testsecret"), "secret décodé dans le body");
    for (const v of Object.values(headers)) {
      assert.ok(!v.includes("whsec_"), "secret dans un header");
      assert.ok(!v.includes("testsecret"), "secret décodé dans un header");
    }
    // la signature est bien présente (HMAC, pas le secret).
    assert.match(headers["webhook-signature"]!, /^v1,[A-Za-z0-9+/=]+$/);
  });
});

describe("attack/amplification — pas de boucle d'audit", () => {
  it("la livraison n'émet aucun nouvel événement (le dispatcher ne réinjecte rien)", async () => {
    let onAuditCalls = 0;
    const counting = deps([ep("wh_1")], async () => ({
      ok: true,
      status: 200,
      error: null,
    }));
    const d = new WebhookDispatcher(counting);
    const wrapped = (e: IAuditEvent) => {
      onAuditCalls++;
      d.onAuditEvent(e);
    };
    wrapped(event("login.success")); // 1 seul déclenchement externe
    await flush();
    await flush();
    assert.equal(onAuditCalls, 1); // aucune ré-entrée auto-générée
  });
});

describe("attack/amplification — événement webhook IGNORÉ (anti-boucle)", () => {
  it("un événement category=webhook ne déclenche AUCUNE livraison", async () => {
    const sink = {
      calls: [] as Array<{ headers: Record<string, string>; body: string }>,
    };
    const d = new WebhookDispatcher(
      deps(
        [ep("wh_1")],
        async () => ({ ok: true, status: 200, error: null }),
        {},
        sink,
      ),
    );
    const webhookEvt: IAuditEvent = {
      ...event("webhook.disabled"),
      category: "webhook",
    };
    d.onAuditEvent(webhookEvt);
    await flush();
    assert.equal(sink.calls.length, 0); // pas d'auto-amplification
  });
});

describe("attack/injection — payload d'audit malveillant", () => {
  it("un actor contenant des métacaractères JSON est échappé (structure intacte)", async () => {
    const sink = {
      calls: [] as Array<{ headers: Record<string, string>; body: string }>,
    };
    const d = new WebhookDispatcher(
      deps(
        [ep("wh_1")],
        async () => ({ ok: true, status: 200, error: null }),
        {},
        sink,
      ),
    );
    d.onAuditEvent(event("login.success", '","injected":true,"x":"'));
    await flush();
    const parsed = JSON.parse(sink.calls[0]!.body);
    // pas d'injection de clé au top-level : la valeur reste une string.
    assert.equal(parsed.injected, undefined);
    assert.equal(parsed.data.actor, '","injected":true,"x":"');
  });
});
