import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import { WebhookService } from "../../nodefony/service/webhooks";

/**
 * Un `tenantId` rempli est REFUSÉ tant que le multi-tenant n'existe pas (ADR-0023 W2).
 *
 * SYMPTÔME : `register({ tenantId: "A" })` était accepté puis ignoré — le
 * dispatcher ne le lit pas, l'abonnement recevait TOUT. Un champ qui a l'air de
 * cloisonner sans cloisonner ; et le jour où il serait appliqué, l'abonnement
 * cesserait de recevoir ce qu'il recevait : une rupture.
 *
 * RÈGLE : refusé maintenant, accepté ET appliqué le jour du multi-tenant — un ajout.
 * URLs = IP littérales publiques (1.1.1.1) → aucun DNS réel dans les tests.
 */

function buildService(): WebhookService {
  const container = new Container();
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const kernel = {
    container,
    once(ev: string, cb: (...a: unknown[]) => void) {
      handlers[ev] = cb;
    },
    registerStoreResolution() {},
  };
  container.set("kernel", kernel);
  const module = {
    container,
    notificationsCenter: false,
    options: {
      webhooks: { encryptionKey: "clé-de-test-webhook-0123456789abcdef" },
    },
  } as unknown as Module;
  const svc = new WebhookService(module);
  handlers["onBoot"]?.();
  return svc;
}

describe("webhooks — le périmètre d'un locataire n'est pas encore appliqué", () => {
  it("refuse un tenantId rempli, sans rien enregistrer", async () => {
    const svc = buildService();
    await assert.rejects(
      svc.register({
        url: "https://1.1.1.1/a",
        events: ["*"],
        tenantId: "A",
      }),
      /tenantId/,
    );
    const page = await svc.listPage({ limit: 10, offset: 0 });
    assert.equal(page.total, 0);
  });

  it("accepte tenantId absent ou null (abonnement sans périmètre)", async () => {
    const svc = buildService();
    const a = await svc.register({ url: "https://1.1.1.1/a", events: ["*"] });
    const b = await svc.register({
      url: "https://1.1.1.1/b",
      events: ["*"],
      tenantId: null,
    });
    assert.equal(a.endpoint.tenantId, null);
    assert.equal(b.endpoint.tenantId, null);
  });
});
