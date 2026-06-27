import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  deriveKey,
  encryptSecret,
  decryptSecret,
  generateEphemeralKey,
} from "../../nodefony/src/crypto/secretCipher";

/**
 * Brique générique de chiffrement réversible (AES-256-GCM + HKDF). On prouve :
 * round-trip, IV unique, détection d'altération / mauvaise clé (tag GCM),
 * dérivation déterministe, et surtout la **séparation de domaine** (un blob d'un
 * domaine ne se déchiffre pas avec la clé d'un autre — info HKDF distinct).
 */

const totpDomain = {
  salt: "nodefony.totp.hkdf.v1",
  info: "totp-secret-encryption",
};
const webhookDomain = {
  salt: "nodefony.webhook.hkdf.v1",
  info: "webhook-secret-encryption",
};
const material = "matériel-de-clé-applicatif-de-test-0123456789";

describe("secretCipher — round-trip & intégrité", () => {
  it("decrypt(encrypt(x)) === x", () => {
    const key = deriveKey(material, webhookDomain);
    const plain = Buffer.from("whsec_abc123");
    assert.deepEqual(decryptSecret(encryptSecret(plain, key), key), plain);
  });

  it("IV aléatoire : deux chiffrements du même secret diffèrent", () => {
    const key = deriveKey(material, webhookDomain);
    assert.notEqual(
      encryptSecret(Buffer.from("x"), key),
      encryptSecret(Buffer.from("x"), key),
    );
  });

  it("altération du blob → throw (tag GCM)", () => {
    const key = deriveKey(material, webhookDomain);
    const blob = encryptSecret(Buffer.from("secret"), key);
    const i = blob.length - 3;
    const tampered =
      blob.slice(0, i) + (blob[i] === "A" ? "B" : "A") + blob.slice(i + 1);
    assert.throws(() => decryptSecret(tampered, key));
  });

  it("mauvaise clé → throw", () => {
    const key = deriveKey(material, webhookDomain);
    const other = deriveKey(
      "autre-matériel-totalement-different",
      webhookDomain,
    );
    const blob = encryptSecret(Buffer.from("secret"), key);
    assert.throws(() => decryptSecret(blob, other));
  });

  it("format/version invalide → throw", () => {
    const key = deriveKey(material, webhookDomain);
    assert.throws(() => decryptSecret("plaintext-sans-version", key));
    assert.throws(() => decryptSecret("xxx.YWJj", key));
  });
});

describe("secretCipher — séparation de domaine (HKDF info)", () => {
  it("même matériel, domaines différents → clés différentes", () => {
    assert.notDeepEqual(
      deriveKey(material, totpDomain),
      deriveKey(material, webhookDomain),
    );
  });

  it("un blob webhook NE se déchiffre PAS avec la clé totp", () => {
    const kt = deriveKey(material, totpDomain);
    const kw = deriveKey(material, webhookDomain);
    const blob = encryptSecret(Buffer.from("secret-webhook"), kw);
    assert.throws(() => decryptSecret(blob, kt));
  });

  it("deriveKey déterministe (même matériel+domaine → même clé)", () => {
    assert.deepEqual(
      deriveKey(material, webhookDomain),
      deriveKey(material, webhookDomain),
    );
    assert.equal(deriveKey(material, webhookDomain).length, 32);
  });

  it("generateEphemeralKey → 32 octets aléatoires", () => {
    const a = generateEphemeralKey();
    assert.equal(a.length, 32);
    assert.notDeepEqual(a, generateEphemeralKey());
  });
});
