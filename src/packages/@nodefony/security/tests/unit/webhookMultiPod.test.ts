import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import { WebhookService } from "../../nodefony/service/webhooks";
import { MemoryWebhookStore } from "../../nodefony/src/webhook/MemoryWebhookStore";
import type { IWebhookEndpoint } from "../../nodefony/contracts/IWebhookEndpoint";

/**
 * Webhooks à PLUSIEURS PODS — ce que le cache d'endpoints garantit, et ce qu'il
 * ne garantit pas.
 *
 * Le store est partagé (une base), le cache ne l'est pas (une Map par process).
 * Un endpoint créé sur le pod A n'existe donc pour le pod B qu'après relecture.
 * Sans borne de fraîcheur, B ne livrerait jamais rien pour cet abonnement — et
 * le cas le plus courant est le pire : des pods démarrés AVANT toute création
 * court-circuitent sur `endpointCount() === 0` et ne rechargent jamais.
 *
 * Ce banc monte deux services sur le MÊME store (chacun son container, comme
 * deux pods sur une base commune) et verrouille les trois propriétés :
 *  1. la propagation existe, bornée par `webhooks.snapshotTtlS` ;
 *  2. elle n'est PAS immédiate — la limite est assumée, donc testée ;
 *  3. la relecture ne se démultiplie pas (rafale, ni store en panne).
 *
 * L'horloge seule est simulée (`toFake: ["Date"]`) : les microtâches restent
 * réelles, sinon la relecture — asynchrone et non attendue — ne partirait jamais.
 */

/** Monte un « pod » : container propre, store partagé, TTL choisi. */
function buildPod(
  store: unknown,
  webhooks: Record<string, unknown> = {},
): WebhookService {
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
  container.set("webhookStore", store);
  const module = {
    container,
    notificationsCenter: false,
    options: {
      webhooks: {
        encryptionKey: "clé-de-test-webhook-0123456789abcdef",
        ...webhooks,
      },
    },
  } as unknown as Module;
  const svc = new WebhookService(module);
  handlers["onBoot"]?.();
  return svc;
}

/** Laisse partir la relecture en arrière-plan (microtâches réelles). */
function settle(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

/** Store partagé qui COMPTE ses lectures — la relecture doit rester rare. */
class CountingStore extends MemoryWebhookStore {
  reads = 0;
  failing = false;

  async listAll(): Promise<IWebhookEndpoint[]> {
    this.reads++;
    if (this.failing) throw new Error("store indisponible");
    return super.listAll();
  }
}

describe("Webhooks multi-pod — fraîcheur du cache d'endpoints", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("un endpoint créé sur le pod A parvient au pod B après le TTL", async () => {
    const store = new CountingStore();
    const podA = buildPod(store, { snapshotTtlS: 30 });
    const podB = buildPod(store, { snapshotTtlS: 30 });
    await settle();

    await podA.register({ url: "https://1.1.1.1/hook", events: ["*"] });
    assert.equal(podA.endpointCount(), 1, "le pod auteur voit son endpoint");

    // (2) La propagation n'est PAS immédiate — limite assumée, donc verrouillée.
    assert.equal(
      podB.endpointCount(),
      0,
      "avant le TTL, l'autre pod garde son cache",
    );

    // (1) Passé le TTL, la lecture déclenche la relecture en arrière-plan.
    vi.setSystemTime(Date.now() + 31_000);
    podB.endpointCount(); // déclenche, ne bloque pas
    await settle();

    assert.equal(podB.endpointCount(), 1, "le pod B a rattrapé l'endpoint");
    assert.equal(
      podB.getSnapshot()[0]!.url,
      "https://1.1.1.1/hook",
      "et c'est bien celui créé par A",
    );
  });

  it("une rafale après expiration ne déclenche qu'UNE relecture", async () => {
    const store = new CountingStore();
    const pod = buildPod(store, { snapshotTtlS: 30 });
    await settle();
    const atBoot = store.reads;

    vi.setSystemTime(Date.now() + 31_000);
    for (let i = 0; i < 200; i++) pod.endpointCount();
    await settle();

    assert.equal(
      store.reads - atBoot,
      1,
      "un seul rechargement en vol, quelle que soit la cadence des événements",
    );
  });

  it("un store en panne n'est pas martelé — il attend le TTL suivant", async () => {
    const store = new CountingStore();
    const pod = buildPod(store, { snapshotTtlS: 30 });
    await settle();
    store.failing = true;
    const afterBoot = store.reads;

    // Expiration : une tentative, qui échoue.
    vi.setSystemTime(Date.now() + 31_000);
    pod.endpointCount();
    await settle();
    assert.equal(store.reads - afterBoot, 1, "une tentative après expiration");

    // Le trafic continue : sans horodatage de l'échec, chaque événement
    // relancerait une lecture — une base indisponible se ferait mitrailler.
    for (let i = 0; i < 50; i++) pod.endpointCount();
    await settle();
    assert.equal(
      store.reads - afterBoot,
      1,
      "l'échec compte comme une tentative : pas de rafale contre un store à terre",
    );

    // Guérison au TTL suivant.
    store.failing = false;
    vi.setSystemTime(Date.now() + 31_000);
    pod.endpointCount();
    await settle();
    assert.equal(
      store.reads - afterBoot,
      2,
      "et la lecture repart au cycle suivant",
    );
  });
});
