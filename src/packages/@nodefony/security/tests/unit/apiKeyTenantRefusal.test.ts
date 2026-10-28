import assert from "node:assert/strict";
import { accountDirectory } from "../support/accountDirectory";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import { ApiKeyService } from "../../nodefony/service/apiKeys";
import { ApiKeyError } from "../../nodefony/errors/ApiKeyError";
import { MemoryTokenStore } from "../../nodefony/src/token/MemoryTokenStore";

/**
 * Un `tenantId` rempli est REFUSÉ tant que le multi-tenant n'existe pas.
 *
 * SYMPTÔME : `createForSubject(…, { tenantId: "A" })` était accepté, recopié en
 * attribut du jeton par `ApiKeyAuthenticator` — et relu par personne. Une clé
 * qui a l'air de cloisonner sans cloisonner ; et le jour où le champ serait
 * appliqué, elle perdrait des accès qu'elle avait : une rupture.
 *
 * RÈGLE : refusé maintenant, accepté ET appliqué le jour du multi-tenant — un
 * ajout. Même règle que les webhooks (`webhookTenantRefusal.test.ts`).
 */

function buildService(): { svc: ApiKeyService; store: MemoryTokenStore } {
  const container = new Container();
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const kernel = {
    container,
    once(ev: string, cb: (...a: unknown[]) => void) {
      handlers[ev] = cb;
    },
  };
  container.set("kernel", kernel);
  container.set("users", accountDirectory());
  const store = new MemoryTokenStore();
  container.set("tokenStore", store);
  const module = {
    container,
    notificationsCenter: false,
    options: { apiKeys: { enabled: true } },
  } as unknown as Module;
  const svc = new ApiKeyService(module);
  handlers["onBoot"]?.();
  return { svc, store };
}

describe("clés d'API — le périmètre d'un locataire n'est pas encore appliqué", () => {
  it("refuse un tenantId rempli (400), sans rien écrire au store", async () => {
    const { svc, store } = buildService();
    await assert.rejects(
      svc.createForSubject("alice", "user", { name: "k", tenantId: "A" }),
      (err: unknown) =>
        err instanceof ApiKeyError &&
        err.code === 400 &&
        err.message.includes("tenantId"),
    );
    assert.equal((await store.findBySubject("alice")).length, 0);
  });

  it("accepte tenantId absent ou null (clé sans périmètre)", async () => {
    const { svc } = buildService();
    const a = await svc.createForSubject("alice", "user", { name: "a" });
    const b = await svc.createForSubject("alice", "user", {
      name: "b",
      tenantId: null,
    });
    assert.equal(a.tenantId, null);
    assert.equal(b.tenantId, null);
  });
});
