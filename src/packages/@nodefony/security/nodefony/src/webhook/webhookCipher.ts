import { Buffer } from "node:buffer";
import {
  decryptSecret,
  deriveKey,
  encryptSecret,
  generateEphemeralKey,
} from "../crypto/secretCipher";

/**
 * Chiffrement réversible du secret de signature webhook au repos — façade de
 * domaine au-dessus de {@link ../crypto/secretCipher} (calque {@link ../totp/totpCipher}).
 *
 * Le secret de signature (HMAC) doit être **relu** par le serveur à chaque
 * livraison → chiffré (AES-256-GCM), jamais haché. Le contexte HKDF est **propre
 * au domaine webhook** : un blob webhook ne se déchiffre pas avec la clé TOTP, et
 * réciproquement (séparation de domaine cryptographique). Ne pas modifier
 * {@link WEBHOOK_DERIVATION} sous peine de rendre illisibles les secrets stockés.
 */

/** Contexte HKDF figé du domaine webhook. **Constantes — ne pas changer.** */
const WEBHOOK_DERIVATION = {
  salt: Buffer.from("nodefony.webhook.hkdf.v1"),
  info: Buffer.from("webhook-secret-encryption"),
} as const;

/**
 * Dérive la clé AES-256 du domaine webhook via HKDF-SHA256 (RFC 5869).
 * Déterministe (clé lisible cross-pod).
 */
export function deriveWebhookKey(material: string | Buffer): Buffer {
  return deriveKey(material, WEBHOOK_DERIVATION);
}

export { encryptSecret, decryptSecret, generateEphemeralKey };
