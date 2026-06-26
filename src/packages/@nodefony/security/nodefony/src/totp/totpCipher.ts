import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { Buffer } from "node:buffer";

/**
 * Chiffrement **réversible** du secret TOTP au repos — AES-256-GCM (authentifié).
 *
 * Contrairement aux mots de passe (hachés, à sens unique), le secret TOTP `K`
 * doit être **relu en clair** par le serveur à chaque vérification de code → il
 * est *chiffré*, jamais haché. GCM apporte confidentialité ET intégrité : un blob
 * altéré, ou déchiffré avec la mauvaise clé, fait échouer `final()` (tag invalide)
 * → impossible de manipuler le secret stocké sans le détecter.
 *
 * Format du blob : `gcm1.<base64url(iv ‖ tag ‖ ciphertext)>` — préfixe versionné
 * pour permettre une rotation d'algorithme future sans casser les secrets existants.
 */

const VERSION = "gcm1";
const IV_BYTES = 12; // 96 bits — taille nominale d'un nonce GCM (NIST SP 800-38D §5.2.1.1).
const TAG_BYTES = 16; // 128 bits — tag d'authentification GCM.
const KEY_BYTES = 32; // AES-256.
const HKDF_SALT = Buffer.from("nodefony.totp.hkdf.v1");
const HKDF_INFO = Buffer.from("totp-secret-encryption");

/**
 * Dérive une clé AES-256 (32 octets) d'un matériel de clé applicatif via
 * HKDF-SHA256 (RFC 5869). Accepte toute longueur/forme (passphrase, hex, base64)
 * sans jamais l'utiliser brute comme clé AES. **Déterministe** : tous les pods
 * d'un cluster dérivent la même clé du même secret de config (secret lisible
 * cross-pod).
 */
export function deriveTotpKey(material: string | Buffer): Buffer {
  const ikm =
    typeof material === "string" ? Buffer.from(material, "utf8") : material;
  return Buffer.from(hkdfSync("sha256", ikm, HKDF_SALT, HKDF_INFO, KEY_BYTES));
}

/** Génère une clé éphémère 32 octets (dev sans clé configurée — non persistée). */
export function generateEphemeralKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/** Chiffre un secret en clair → blob opaque versionné (IV aléatoire à chaque appel). */
export function encryptSecret(plain: Buffer, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${Buffer.concat([iv, tag, ct]).toString("base64url")}`;
}

/**
 * Déchiffre un blob produit par {@link encryptSecret}. Lève si le format/version
 * est invalide, le blob tronqué, ou le tag GCM non valide (altération OU mauvaise
 * clé — GCM ne distingue pas les deux, par construction).
 */
export function decryptSecret(blob: string, key: Buffer): Buffer {
  const dot = blob.indexOf(".");
  const version = dot === -1 ? "" : blob.slice(0, dot);
  if (version !== VERSION) {
    throw new Error(`totp cipher: format/version invalide (« ${version} »)`);
  }
  const raw = Buffer.from(blob.slice(dot + 1), "base64url");
  if (raw.length < IV_BYTES + TAG_BYTES) {
    throw new Error("totp cipher: blob tronqué");
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
