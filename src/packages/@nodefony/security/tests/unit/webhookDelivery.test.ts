import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { deliverWebhook } from "../../nodefony/src/webhook/webhookDelivery";

/**
 * Émetteur HTTP réel (serveur local). Prouve les 3 propriétés de sécurité face à
 * `fetch` : **pin de l'IP** (un hostname non résolvable est livré via l'IP
 * validée → anti-rebinding), **3xx NON suivi** (anti-SSRF par redirection), et le
 * timeout dur. + comportement 2xx/5xx + refus de protocole.
 */

let server: Server;
let port = 0;
let last: { headers: Record<string, unknown>; body: string; url?: string } = {
  headers: {},
  body: "",
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      last = {
        headers: req.headers as Record<string, unknown>,
        body: Buffer.concat(chunks).toString("utf8"),
        url: req.url,
      };
      if (req.url === "/ok") (res.writeHead(200), res.end("ok"));
      else if (req.url === "/500") (res.writeHead(500), res.end("boom"));
      else if (req.url === "/302")
        (res.writeHead(302, { location: "http://169.254.169.254/" }),
          res.end());
      else if (req.url === "/hang") {
        /* ne répond jamais → timeout côté client */
      } else (res.writeHead(404), res.end());
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const opts = (extra: Record<string, unknown> = {}) => ({
  timeoutMs: 2000,
  addresses: ["127.0.0.1"],
  allowHttp: true,
  ...extra,
});

describe("webhookDelivery — pin d'IP (anti-rebinding)", () => {
  it("hostname NON résolvable → livré via l'IP pinnée (200)", async () => {
    const r = await deliverWebhook(
      `http://does-not-resolve.invalid:${port}/ok`,
      '{"x":1}',
      { "content-type": "application/json", "webhook-id": "msg_1" },
      opts(),
    );
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(last.body).x, 1);
    assert.equal(last.headers["content-type"], "application/json");
    assert.equal(last.headers["webhook-id"], "msg_1");
  });
});

describe("webhookDelivery — pas de suivi de redirection (anti-SSRF)", () => {
  it("302 vers 169.254.169.254 → rendu tel quel, JAMAIS suivi", async () => {
    const r = await deliverWebhook(
      `http://h.invalid:${port}/302`,
      "{}",
      {},
      opts(),
    );
    assert.equal(r.ok, false);
    assert.equal(r.status, 302); // pas de saut vers les métadonnées cloud
  });
});

describe("webhookDelivery — statut & timeout", () => {
  it("5xx → ok:false", async () => {
    const r = await deliverWebhook(
      `http://h.invalid:${port}/500`,
      "{}",
      {},
      opts(),
    );
    assert.equal(r.ok, false);
    assert.equal(r.status, 500);
  });
  it("timeout → ok:false, status null, error", async () => {
    const r = await deliverWebhook(
      `http://h.invalid:${port}/hang`,
      "{}",
      {},
      opts({ timeoutMs: 150 }),
    );
    assert.equal(r.ok, false);
    assert.equal(r.status, null);
    assert.ok((r.error ?? "").length > 0);
  });
});

describe("webhookDelivery — politique de protocole", () => {
  it("http refusé sans allowHttp", async () => {
    const r = await deliverWebhook(
      `http://h.invalid:${port}/ok`,
      "{}",
      {},
      opts({ allowHttp: false }),
    );
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /protocole/);
  });
});

describe("webhookDelivery — capture du corps de réponse (historique)", () => {
  it("2xx → responseBody = corps du destinataire", async () => {
    const r = await deliverWebhook(
      `http://h.invalid:${port}/ok`,
      "{}",
      {},
      opts(),
    );
    assert.equal(r.ok, true);
    assert.equal(r.responseBody, "ok");
  });
  it("5xx → responseBody capturé (corps d'erreur)", async () => {
    const r = await deliverWebhook(
      `http://h.invalid:${port}/500`,
      "{}",
      {},
      opts(),
    );
    assert.equal(r.ok, false);
    assert.equal(r.responseBody, "boom");
  });
});
