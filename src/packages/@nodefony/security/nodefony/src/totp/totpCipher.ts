import { Buffer } from "node:buffer";
import {
  decryptSecret,
  deriveKey,
  encryptSecret,
  generateEphemeralKey,
} from "../crypto/secretCipher";

/**
 * Chiffrement réversible du secret TOTP au repos — façade de domaine au-dessus
 * de la brique générique {@link ../crypto/secretCipher}.
 *
 * Le secret TOTP `K` doit être **relu en clair** par le serveur à chaque
 * vérification de code → il est *chiffré* (AES-256-GCM), jamais haché. Ce module
 * fige le contexte de dérivation HKDF **propre au domaine TOTP** : ne JAMAIS
 * modifier {@link TOTP_DERIVATION} (sel/info), sous peine de rendre illisibles
 * tous les secrets TOTP déjà stockés.
 */

/**
 * Contexte HKDF figé du domaine TOTP. **Constantes historiques — ne pas changer.**
 */
const TOTP_DERIVATION = {
  salt: Buffer.from("nodefony.totp.hkdf.v1"),
  info: Buffer.from("totp-secret-encryption"),
} as const;

/**
 * Dérive la clé AES-256 du domaine TOTP via HKDF-SHA256 (RFC 5869).
 * Déterministe (clé lisible cross-pod). Délègue à {@link deriveKey} avec le
 * contexte figé du domaine TOTP.
 */
export function deriveTotpKey(material: string | Buffer): Buffer {
  return deriveKey(material, TOTP_DERIVATION);
}

// Réexport des primitives génériques (clé déjà dérivée par domaine) — préserve
// l'API consommée par totpOperations/totpService.
export { encryptSecret, decryptSecret, generateEphemeralKey };
