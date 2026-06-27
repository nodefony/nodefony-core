import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { Buffer } from "node:buffer";

/**
 * Chiffrement **réversible** de secrets applicatifs au repos — AES-256-GCM
 * (authentifié). Brique générique partagée par tous les domaines qui doivent
 * **relire** un secret en clair (≠ mots de passe, hachés à sens unique) : TOTP
 * (clé `K` relue à chaque vérification), webhooks (secret de signature relu à
 * chaque livraison), etc.
 *
 * GCM apporte confidentialité ET intégrité : un blob altéré, ou déchiffré avec
 * la mauvaise clé, fait échouer `final()` (tag invalide) → toute manipulation du
 * secret stocké est détectée.
 *
 * **Séparation de domaine cryptographique** : chaque domaine dérive sa clé via
 * {@link deriveKey} avec un `info`/`salt` HKDF distinct. Une même clé maître de
 * config produit ainsi des sous-clés **indépendantes** par domaine (un blob
 * webhook ne se déchiffre jamais avec la clé TOTP, par construction).
 *
 * Format du blob : `gcm1.<base64url(iv ‖ tag ‖ ciphertext)>` — préfixe versionné
 * pour permettre une rotation d'algorithme future sans casser les secrets existants.
 */

const VERSION = "gcm1";
const IV_BYTES = 12; // 96 bits — taille nominale d'un nonce GCM (NIST SP 800-38D §5.2.1.1).
const TAG_BYTES = 16; // 128 bits — tag d'authentification GCM.
const KEY_BYTES = 32; // AES-256.

/** Contexte de dérivation HKDF — distingue les domaines cryptographiques. */
export interface IKeyDerivation {
  /** Sel HKDF (RFC 5869 §3.1) — constante par domaine. */
  readonly salt: string | Buffer;
  /** Info HKDF (RFC 5869 §3.2) — lie la sous-clé à son usage (séparation de domaine). */
  readonly info: string | Buffer;
}

/**
 * Dérive une clé AES-256 (32 octets) d'un matériel de clé applicatif via
 * HKDF-SHA256 (RFC 5869). Accepte toute longueur/forme (passphrase, hex, base64)
 * sans jamais l'utiliser brute comme clé AES. **Déterministe** : tous les pods
 * d'un cluster dérivent la même clé du même secret de config + même domaine
 * (secret lisible cross-pod). Domaines distincts (`info` différent) → clés
 * indépendantes.
 *
 * @param material - matériel de clé brut (secret de config).
 * @param derivation - sel + info propres au domaine (TOTP, webhook…).
 * @returns clé AES-256 (32 octets).
 */
export function deriveKey(
  material: string | Buffer,
  derivation: IKeyDerivation,
): Buffer {
  const ikm =
    typeof material === "string" ? Buffer.from(material, "utf8") : material;
  const salt =
    typeof derivation.salt === "string"
      ? Buffer.from(derivation.salt)
      : derivation.salt;
  const info =
    typeof derivation.info === "string"
      ? Buffer.from(derivation.info)
      : derivation.info;
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, KEY_BYTES));
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
    throw new Error(`secret cipher: format/version invalide (« ${version} »)`);
  }
  const raw = Buffer.from(blob.slice(dot + 1), "base64url");
  if (raw.length < IV_BYTES + TAG_BYTES) {
    throw new Error("secret cipher: blob tronqué");
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
