import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import { WebhookService } from "../../nodefony/service/webhooks";
import {
  compiledPatterns,
  matchesSubscription,
} from "../../nodefony/src/webhook/WebhookDispatcher";

/**
 * Motifs d'abonnement webhook — grammaire commune aux canaux (ADR-0023 W2) :
 * compilés UNE fois par liste, jamais par événement, et refusés à l'enregistrement
 * au-delà de trois `*`.
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

describe("webhooks — motifs d'abonnement", () => {
  // Prouvé par l'IDENTITÉ de la liste compilée, pas par un espion de module :
  // sous `isolate: false`, un `vi.mock("nodefony")` n'atteint pas un module déjà
  // chargé par un autre fichier — le compte dépendait de l'ordre des fichiers.
  it("un motif n'est compilé qu'UNE fois pour 1 000 événements", () => {
    const events: readonly string[] = ["commande:*", "login.*"];
    const first = compiledPatterns(events);
    for (let i = 0; i < 1000; i += 1)
      matchesSubscription(events, `commande:${i}`);
    assert.equal(first.length, 2); // un motif, une expression
    assert.equal(compiledPatterns(events), first); // jamais recompilée par événement
    // Un abonnement modifié porte un tableau neuf : il se recompile.
    assert.notEqual(compiledPatterns([...events]), first);
  });

  it("refuse à l'enregistrement un motif à 4 étoiles, en le nommant, sans rien enregistrer", async () => {
    const svc = buildService();
    await assert.rejects(
      svc.register({ url: "https://1.1.1.1/a", events: ["a*b*c*d*"] }),
      /« a\*b\*c\*d\* » porte 4/,
    );
    const page = await svc.listPage({ limit: 10, offset: 0 });
    assert.equal(page.total, 0);
  });

  it("refuse le même motif à la mise à jour", async () => {
    const svc = buildService();
    const { endpoint } = await svc.register({
      url: "https://1.1.1.1/a",
      events: ["*"],
    });
    await assert.rejects(
      svc.update(endpoint.id, { events: ["*.*.*.*"] }),
      /porte 4/,
    );
  });

  it("accepte trois étoiles", async () => {
    const svc = buildService();
    const { endpoint } = await svc.register({
      url: "https://1.1.1.1/a",
      events: ["*:*:*"],
    });
    assert.deepEqual(endpoint.events, ["*:*:*"]);
  });
});
