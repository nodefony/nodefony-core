import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  deriveTotpKey,
  generateEphemeralKey,
  encryptSecret,
  decryptSecret,
} from "../../nodefony/src/totp/totpCipher";

/**
 * Chiffrement **réversible** du secret TOTP au repos (AES-256-GCM). Le secret
 * doit être relu en clair par le serveur pour calculer le code → chiffré, jamais
 * haché. On prouve : round-trip, IV unique (jamais de réutilisation de nonce),
 * détection d'altération / mauvaise clé (tag GCM), dérivation HKDF déterministe.
 */

const key = deriveTotpKey("clé-applicative-de-test-totp-0123456789");

describe("totpCipher — round-trip & IV", () => {
  it("decrypt(encrypt(secret)) === secret", () => {
    const secret = Buffer.from("12345678901234567890");
    assert.deepEqual(decryptSecret(encryptSecret(secret, key), key), secret);
  });

  it("IV aléatoire : deux chiffrements du même secret diffèrent", () => {
    const secret = Buffer.from("12345678901234567890");
    assert.notEqual(encryptSecret(secret, key), encryptSecret(secret, key));
  });

  it("blob versionné (préfixe gcm1.)", () => {
    assert.match(encryptSecret(Buffer.from("x"), key), /^gcm1\./);
  });
});

describe("totpCipher — intégrité (tag GCM)", () => {
  it("mauvaise clé → throw", () => {
    const blob = encryptSecret(Buffer.from("secret-totp-abcd"), key);
    const other = deriveTotpKey("une-clé-totalement-différente-9876543210");
    assert.throws(() => decryptSecret(blob, other));
  });

  it("blob altéré (1 octet flippé) → throw", () => {
    const blob = encryptSecret(Buffer.from("secret-totp-abcd"), key);
    const dot = blob.indexOf(".");
    const raw = Buffer.from(blob.slice(dot + 1), "base64url");
    raw[raw.length - 1] = (raw[raw.length - 1] as number) ^ 0xff;
    const tampered = `${blob.slice(0, dot)}.${raw.toString("base64url")}`;
    assert.throws(() => decryptSecret(tampered, key));
  });

  it("format / version invalides → throw explicite", () => {
    assert.throws(() => decryptSecret("pas-un-blob", key), /format|version/);
    assert.throws(() => decryptSecret("gcm9.abcd", key), /format|version/);
  });
});

describe("totpCipher — dérivation de clé (HKDF-SHA256)", () => {
  it("déterministe : même matériel → même clé 32 octets", () => {
    const k1 = deriveTotpKey("secret-app");
    const k2 = deriveTotpKey("secret-app");
    assert.equal(k1.length, 32);
    assert.deepEqual(k1, k2);
  });

  it("matériels différents → clés différentes", () => {
    assert.notDeepEqual(deriveTotpKey("a"), deriveTotpKey("b"));
  });

  it("generateEphemeralKey : 32 octets aléatoires non répétés", () => {
    assert.equal(generateEphemeralKey().length, 32);
    assert.notDeepEqual(generateEphemeralKey(), generateEphemeralKey());
  });
});
