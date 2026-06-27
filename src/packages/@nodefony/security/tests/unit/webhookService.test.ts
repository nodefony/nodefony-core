import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import { WebhookService } from "../../nodefony/service/webhooks";
import { SsrfError } from "../../nodefony/errors/SsrfError";

/**
 * Service webhooks sur store mémoire + clé de test déterministe. Cibles : le
 * secret n'est jamais dans la vue publique, SSRF appliqué à register/update,
 * rotation/révélation du secret réversible, garde-fous (service désactivé).
 * URLs = IP littérales publiques (1.1.1.1) → aucun DNS réel dans les tests.
 */

function buildService(webhooks: Record<string, unknown> = {}): WebhookService {
  const container = new Container();
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const kernel = {
    container,
    once(ev: string, cb: (...a: unknown[]) => void) {
      handlers[ev] = cb;
    },
  };
  container.set("kernel", kernel);
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

describe("WebhookService — register & secret", () => {
  it("génère un secret whsec_ ; le summary n'expose PAS secretEnc", async () => {
    const svc = buildService();
    const { endpoint, secret } = await svc.register({
      url: "https://1.1.1.1/hook",
      events: ["login.success"],
    });
    assert.match(secret, /^whsec_/);
    assert.equal((endpoint as Record<string, unknown>).secretEnc, undefined);
    assert.match(endpoint.id, /^wh_/);
    assert.equal(endpoint.enabled, true);
  });

  it("rejette une URL SSRF (loopback)", () => {
    const svc = buildService();
    return assert.rejects(
      () => svc.register({ url: "https://127.0.0.1/x", events: ["*"] }),
      SsrfError,
    );
  });

  it("rejette http (allowHttp défaut false)", () => {
    const svc = buildService();
    return assert.rejects(
      () => svc.register({ url: "http://1.1.1.1/x", events: ["*"] }),
      SsrfError,
    );
  });
});

describe("WebhookService — lecture & mutations", () => {
  it("list / getEndpoint", async () => {
    const svc = buildService();
    const { endpoint } = await svc.register({
      url: "https://1.1.1.1/h",
      events: ["*"],
    });
    assert.equal((await svc.list()).length, 1);
    assert.equal((await svc.getEndpoint(endpoint.id))?.id, endpoint.id);
    assert.equal(await svc.getEndpoint("wh_absent"), null);
  });

  it("rotateSecret change le secret", async () => {
    const svc = buildService();
    const { endpoint, secret } = await svc.register({
      url: "https://1.1.1.1/h",
      events: ["*"],
    });
    const rotated = await svc.rotateSecret(endpoint.id);
    assert.ok(rotated);
    assert.notEqual(rotated.secret, secret);
    assert.match(rotated.secret, /^whsec_/);
  });

  it("revealSecret rend le secret en clair (réversible)", async () => {
    const svc = buildService();
    const { endpoint, secret } = await svc.register({
      url: "https://1.1.1.1/h",
      events: ["*"],
    });
    assert.equal(await svc.revealSecret(endpoint.id), secret);
  });

  it("update url re-valide SSRF", async () => {
    const svc = buildService();
    const { endpoint } = await svc.register({
      url: "https://1.1.1.1/h",
      events: ["*"],
    });
    await assert.rejects(
      () => svc.update(endpoint.id, { url: "https://10.0.0.1/x" }),
      SsrfError,
    );
  });

  it("setEnabled(false) désactive", async () => {
    const svc = buildService();
    const { endpoint } = await svc.register({
      url: "https://1.1.1.1/h",
      events: ["*"],
    });
    assert.equal((await svc.setEnabled(endpoint.id, false))?.enabled, false);
  });

  it("delete (idempotent : 2e → false)", async () => {
    const svc = buildService();
    const { endpoint } = await svc.register({
      url: "https://1.1.1.1/h",
      events: ["*"],
    });
    assert.equal(await svc.delete(endpoint.id), true);
    assert.equal(await svc.delete(endpoint.id), false);
    assert.equal((await svc.list()).length, 0);
  });
});

describe("WebhookService — garde-fous", () => {
  it("service désactivé → register throw", () => {
    const svc = buildService({ enabled: false });
    assert.equal(svc.isReady(), false);
    return assert.rejects(() =>
      svc.register({ url: "https://1.1.1.1/h", events: ["*"] }),
    );
  });
});
