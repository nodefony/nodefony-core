import { createHmac } from "node:crypto";
import { Buffer } from "node:buffer";

/**
 * Signature des webhooks sortants — schéma **Standard Webhooks v1**
 * (standardwebhooks.com), choisi plutôt que RFC 9421 (trop lourd pour un webhook,
 * friction consommateur) ou un HMAC maison (GitHub/Stripe). Symétrique HMAC-SHA256
 * par défaut (`v1`) ; slot asymétrique Ed25519 (`v1a`) réservé.
 *
 * Base signée = `{id}.{timestamp}.{body}` → le `webhook-id` et le
 * `webhook-timestamp` sont **couverts** (anti-replay : le consommateur vérifie le
 * timestamp dans une tolérance et déduplique par id). Le consommateur recalcule le
 * HMAC avec le secret partagé et compare en temps constant.
 */

const SECRET_PREFIX = "whsec_";

/**
 * Décode un secret `whsec_<base64>` en octets de clé HMAC. Tolère un secret déjà
 * sans préfixe (base64 brut).
 */
export function parseWebhookSecret(secret: string): Buffer {
  const b64 = secret.startsWith(SECRET_PREFIX)
    ? secret.slice(SECRET_PREFIX.length)
    : secret;
  return Buffer.from(b64, "base64");
}

/** Construit la base à signer : `{id}.{timestamp}.{body}` (Standard Webhooks). */
export function buildSignatureBase(
  id: string,
  timestampS: number,
  body: string,
): string {
  return `${id}.${timestampS}.${body}`;
}

/**
 * Signe un message webhook (Standard Webhooks `v1`). Retourne la valeur du header
 * `webhook-signature` : `v1,<base64(HMAC-SHA256(secret, base))>`.
 *
 * @param secret - secret `whsec_…` de l'endpoint (en clair).
 * @param id - identifiant du message (`webhook-id`).
 * @param timestampS - horodatage epoch **secondes** (`webhook-timestamp`).
 * @param body - corps JSON sérialisé envoyé.
 */
export function signStandardWebhook(
  secret: string,
  id: string,
  timestampS: number,
  body: string,
): string {
  const key = parseWebhookSecret(secret);
  const base = buildSignatureBase(id, timestampS, body);
  const sig = createHmac("sha256", key).update(base).digest("base64");
  return `v1,${sig}`;
}

/** En-têtes de signature Standard Webhooks à poser sur la requête sortante. */
export function webhookSignatureHeaders(
  secret: string,
  id: string,
  timestampS: number,
  body: string,
): Record<string, string> {
  return {
    "webhook-id": id,
    "webhook-timestamp": String(timestampS),
    "webhook-signature": signStandardWebhook(secret, id, timestampS, body),
  };
}
