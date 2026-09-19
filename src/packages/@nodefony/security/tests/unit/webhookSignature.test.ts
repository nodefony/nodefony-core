import assert from "node:assert/strict";
import {
  signStandardWebhook,
  parseWebhookSecret,
  webhookSignatureHeaders,
} from "../../nodefony/src/webhook/webhookSignature";

/**
 * Signature Standard Webhooks v1. Le test maître est le **vecteur officiel** de la
 * spec (standardwebhooks.com) → prouve la conformité normative, pas juste la
 * cohérence interne. Un consommateur utilisant n'importe quelle lib Standard
 * Webhooks vérifiera nos signatures.
 */

// Vecteur officiel : github.com/standard-webhooks/standard-webhooks (spec §verify).
//
// 🔴 Le scan de secrets de GitHub le signale comme « Stripe Webhook Signing
// Secret », et c'est un FAUX POSITIF : Stripe a co-écrit Standard Webhooks, donc
// il en partage le préfixe `whsec_`. Cette chaîne est PUBLIÉE — elle figure telle
// quelle dans des centaines de dépôts publics, dont celui de la spec et
// `svix/svix-webhooks`. Elle n'appartient à aucun compte, il n'y a rien à
// révoquer, et la REMPLACER casserait le seul test qui prouve notre conformité
// normative (la signature attendue ci-dessous en dérive). L'alerte est close en
// `used_in_tests` : si elle revient, ne pas la « corriger », la refermer.
const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const MSG_ID = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const TS = 1614265330;
const PAYLOAD = '{"test": 2432232314}';
const EXPECTED = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";

describe("webhookSignature — conformité Standard Webhooks v1", () => {
  it("vecteur officiel → signature attendue", () => {
    assert.equal(signStandardWebhook(SECRET, MSG_ID, TS, PAYLOAD), EXPECTED);
  });

  it("parseWebhookSecret décode la partie base64 après whsec_", () => {
    const raw = parseWebhookSecret(SECRET);
    assert.ok(Buffer.isBuffer(raw));
    assert.ok(raw.length > 0);
    // tolère un secret sans préfixe
    assert.deepEqual(
      parseWebhookSecret("MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"),
      raw,
    );
  });

  it("headers webhook-* complets et cohérents", () => {
    const h = webhookSignatureHeaders(SECRET, MSG_ID, TS, PAYLOAD);
    assert.equal(h["webhook-id"], MSG_ID);
    assert.equal(h["webhook-timestamp"], String(TS));
    assert.equal(h["webhook-signature"], EXPECTED);
  });

  it("toute altération (body/id/ts) change la signature", () => {
    const base = signStandardWebhook(SECRET, MSG_ID, TS, PAYLOAD);
    assert.notEqual(
      signStandardWebhook(SECRET, MSG_ID, TS, PAYLOAD + " "),
      base,
    );
    assert.notEqual(signStandardWebhook(SECRET, MSG_ID, TS + 1, PAYLOAD), base);
    assert.notEqual(
      signStandardWebhook(SECRET, "msg_other", TS, PAYLOAD),
      base,
    );
  });
});
