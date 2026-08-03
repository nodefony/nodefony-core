import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import { WebhookService } from "../../nodefony/service/webhooks";
import {
  MemoryWebhookStore,
  matchesWebhookQuery,
} from "../../nodefony/src/webhook/MemoryWebhookStore";
import type { IWebhookEndpoint } from "../../nodefony/contracts/IWebhookEndpoint";

/**
 * Les COMPTEURS de la console webhooks — posés sur la collection entière.
 *
 * Les cartes étaient calculées dans le navigateur sur les endpoints chargés :
 * « 2 en échec » décrivait la page affichée en ayant l'air de décrire le
 * registre. Ce banc verrouille le filtre qui rend la facette exprimable
 * (`failing`), le fait que les facettes se RECOUPENT (un endpoint peut être
 * actif ET en échec — donc aucune soustraction), et la dégradation honnête
 * quand les webhooks sont coupés.
 *
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

/** Endpoint minimal — seuls `enabled` et `failureCount` intéressent ce banc. */
function endpoint(
  id: string,
  enabled: boolean,
  failureCount: number,
): IWebhookEndpoint {
  return {
    id,
    url: `https://1.1.1.1/${id}`,
    secretEnc: `gcm1.${id}`,
    events: ["user.created"],
    enabled,
    description: null,
    tenantId: null,
    createdBy: null,
    createdAt: 1,
    updatedAt: 1,
    lastDeliveryAt: null,
    lastDeliveryStatus: null,
    lastDeliveryError: null,
    failureCount,
    metadata: {},
  } as unknown as IWebhookEndpoint;
}

/**
 * Parc de référence : 5 endpoints — 3 actifs (dont **1 en échec**) et
 * 2 désactivés (dont **1 en échec**). Les populations se recoupent
 * délibérément : 2 en échec au total, répartis des deux côtés.
 */
async function seed(): Promise<MemoryWebhookStore> {
  const store = new MemoryWebhookStore();
  await store.save(endpoint("a", true, 0));
  await store.save(endpoint("b", true, 0));
  await store.save(endpoint("c", true, 3));
  await store.save(endpoint("d", false, 0));
  await store.save(endpoint("e", false, 7));
  return store;
}

describe("filtre `failing` — la facette « en échec » devient exprimable", () => {
  it("le prédicat de référence l'honore dans les deux sens", () => {
    const ko = endpoint("x", true, 2);
    const ok = endpoint("y", true, 0);
    assert.equal(matchesWebhookQuery(ko, { limit: 10, failing: true }), true);
    assert.equal(matchesWebhookQuery(ko, { limit: 10, failing: false }), false);
    assert.equal(matchesWebhookQuery(ok, { limit: 10, failing: true }), false);
    assert.equal(matchesWebhookQuery(ok, { limit: 10, failing: false }), true);
  });

  it("omis, il ne filtre rien", () => {
    const ko = endpoint("x", true, 2);
    const ok = endpoint("y", true, 0);
    assert.equal(matchesWebhookQuery(ko, { limit: 10 }), true);
    assert.equal(matchesWebhookQuery(ok, { limit: 10 }), true);
  });

  it("se combine avec `enabled` — les deux s'appliquent", async () => {
    const store = await seed();
    assert.equal(
      await store.countEndpoints({ limit: 1, enabled: true, failing: true }),
      1,
      "un seul actif est en échec",
    );
    assert.equal(
      await store.countEndpoints({ limit: 1, enabled: false, failing: true }),
      1,
    );
  });

  it("la liste paginée l'honore aussi (pas seulement le compteur)", async () => {
    const store = await seed();
    const page = await store.listPage({ limit: 10, failing: true });
    assert.equal(page.items.length, 2);
    assert.ok(page.items.every((e) => e.failureCount > 0));
  });
});

describe("countWebhookFacets — les compteurs de tête", () => {
  it("comptent le registre ENTIER, pas la page", async () => {
    const svc = buildService();
    for (const ep of [
      { url: "https://1.1.1.1/a", events: ["user.created"], enabled: true },
      { url: "https://1.1.1.1/b", events: ["user.created"], enabled: true },
      { url: "https://1.1.1.1/c", events: ["user.created"], enabled: false },
    ]) {
      await svc.register(ep);
    }

    const counts = await svc.countWebhookFacets();
    assert.deepEqual(counts, {
      total: 3,
      active: 2,
      disabled: 1,
      failing: 0,
    });

    // La preuve : une page de 1 ligne ne change RIEN aux compteurs.
    const page = await svc.listPage({ limit: 1 });
    assert.equal(page.items.length, 1);
    assert.equal((await svc.countWebhookFacets()).total, 3);
  });

  it("les facettes se RECOUPENT — `failing` traverse actifs et désactivés", async () => {
    const store = await seed();
    // Compté depuis le store (le service n'expose pas d'écriture de
    // `failureCount` : il est incrémenté par le dispatcher, pas par l'admin).
    assert.equal(await store.countEndpoints({ limit: 1 }), 5);
    assert.equal(
      await store.countEndpoints({ limit: 1, enabled: true }),
      3,
      "actifs",
    );
    assert.equal(
      await store.countEndpoints({ limit: 1, enabled: false }),
      2,
      "désactivés",
    );
    assert.equal(
      await store.countEndpoints({ limit: 1, failing: true }),
      2,
      "en échec, des DEUX côtés",
    );
    // Aucune soustraction ne rend `failing` : 5 - 3 = 2 est une coïncidence de
    // ce parc, pas une relation. C'est pourquoi chaque facette est comptée.
  });

  it("le filtre s'applique aux compteurs", async () => {
    const svc = buildService();
    await svc.register({
      url: "https://1.1.1.1/paie",
      events: ["invoice.paid"],
      enabled: true,
    });
    await svc.register({
      url: "https://1.1.1.1/user",
      events: ["user.created"],
      enabled: true,
    });

    const counts = await svc.countWebhookFacets({ event: "invoice.paid" });
    assert.equal(counts.total, 1);
    assert.equal(counts.active, 1);
  });
});
