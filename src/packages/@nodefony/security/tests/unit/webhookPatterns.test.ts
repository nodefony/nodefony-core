import assert from "node:assert/strict";
import { vi } from "vitest";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import * as core from "nodefony";
import { WebhookService } from "../../nodefony/service/webhooks";
import { matchesSubscription } from "../../nodefony/src/webhook/WebhookDispatcher";

/**
 * Motifs d'abonnement webhook — grammaire commune aux canaux (ADR-0023 W2) :
 * compilés UNE fois par liste, jamais par événement, et refusés à l'enregistrement
 * au-delà de trois `*`.
 */
vi.mock("nodefony", async (importOriginal) => {
  const mod = await importOriginal<typeof import("nodefony")>();
  return { ...mod, compileChannelPattern: vi.fn(mod.compileChannelPattern) };
});

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
  it("un motif n'est compilé qu'UNE fois pour 1 000 événements", () => {
    const compile = vi.mocked(core.compileChannelPattern);
    compile.mockClear();
    const events: readonly string[] = ["commande:*", "login.*"];
    for (let i = 0; i < 1000; i += 1)
      matchesSubscription(events, `commande:${i}`);
    assert.equal(compile.mock.calls.length, 2); // un appel par motif, pas par événement
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
