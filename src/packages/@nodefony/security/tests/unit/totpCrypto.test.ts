import assert from "node:assert/strict";
import {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  hotp,
  totpCounter,
  totpCode,
  verifyTotp,
  buildOtpauthUri,
  generateRecoveryCodes,
  hashRecoveryCode,
  matchRecoveryCode,
  TOTP_DEFAULTS,
} from "../../nodefony/src/totp/totpCrypto";

/**
 * Cœur crypto TOTP — conformité RFC 6238 / RFC 4226. La preuve maîtresse =
 * les **vecteurs de test officiels** (RFC 6238 Appendix B) : si l'implémentation
 * maison diverge d'un bit, ils sautent.
 */

// RFC 6238 Appendix B — secrets ASCII par algorithme (digits=8, step=30, T0=0).
const SECRET_SHA1 = Buffer.from("12345678901234567890");
const SECRET_SHA256 = Buffer.from("12345678901234567890123456789012");
const SECRET_SHA512 = Buffer.from(
  "1234567890123456789012345678901234567890123456789012345678901234",
);

describe("base32 (RFC 4648, sans padding)", () => {
  it("encode le vecteur connu « 12345678901234567890 »", () => {
    assert.equal(base32Encode(SECRET_SHA1), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("round-trip encode→decode sur secret aléatoire", () => {
    const buf = generateTotpSecret();
    assert.deepEqual(base32Decode(base32Encode(buf)), buf);
  });

  it("décode en ignorant casse, espaces et tirets (saisie manuelle)", () => {
    const expected = base32Decode("GEZDGNBVGY3TQOJQ");
    assert.deepEqual(base32Decode("gezd gnbv-gy3t qojq"), expected);
  });

  it("rejette un caractère hors alphabet", () => {
    assert.throws(() => base32Decode("GEZD0189"), /caractère invalide/);
  });
});

describe("totpCounter (RFC 6238 §4.2)", () => {
  it("T = floor((epoch - T0) / step)", () => {
    assert.equal(totpCounter(59), 1);
    assert.equal(totpCounter(1111111109), 0x023523ec);
    assert.equal(totpCounter(20000000000), 0x27bc86aa);
  });
});

describe("Vecteurs de test RFC 6238 — Appendix B", () => {
  // [epochSec, SHA1, SHA256, SHA512] (8 chiffres). null = non listé dans l'extrait.
  const VECTORS: Array<[number, string, string | null, string | null]> = [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", null, null],
  ];

  for (const [epochSec, sha1, sha256, sha512] of VECTORS) {
    it(`t=${epochSec} → SHA1 ${sha1}`, () => {
      assert.equal(
        totpCode(SECRET_SHA1, { epochMs: epochSec * 1000, digits: 8 }),
        sha1,
      );
    });
    if (sha256) {
      it(`t=${epochSec} → SHA256 ${sha256}`, () => {
        assert.equal(
          totpCode(SECRET_SHA256, {
            epochMs: epochSec * 1000,
            digits: 8,
            algorithm: "SHA256",
          }),
          sha256,
        );
      });
    }
    if (sha512) {
      it(`t=${epochSec} → SHA512 ${sha512}`, () => {
        assert.equal(
          totpCode(SECRET_SHA512, {
            epochMs: epochSec * 1000,
            digits: 8,
            algorithm: "SHA512",
          }),
          sha512,
        );
      });
    }
  }
});

describe("hotp (RFC 4226 §5.3, troncature dynamique)", () => {
  it("zero-pad à gauche sur 6 chiffres", () => {
    const code = hotp(SECRET_SHA1, 1);
    assert.equal(code.length, 6);
    assert.match(code, /^\d{6}$/);
  });
});

describe("verifyTotp — fenêtre, anti-rejeu, robustesse", () => {
  const t = 1234567890 * 1000;

  it("accepte le code de la tranche courante et renvoie son step", () => {
    const code = totpCode(SECRET_SHA1, { epochMs: t });
    const res = verifyTotp(code, SECRET_SHA1, { epochMs: t });
    assert.equal(res.valid, true);
    assert.equal(res.step, totpCounter(1234567890));
  });

  it("tolère ±1 pas (dérive d'horloge, RFC 6238 §5.2)", () => {
    const prev = totpCode(SECRET_SHA1, { epochMs: t - 30000 });
    const next = totpCode(SECRET_SHA1, { epochMs: t + 30000 });
    assert.equal(verifyTotp(prev, SECRET_SHA1, { epochMs: t }).valid, true);
    assert.equal(verifyTotp(next, SECRET_SHA1, { epochMs: t }).valid, true);
  });

  it("rejette hors fenêtre (±2 pas)", () => {
    const far = totpCode(SECRET_SHA1, { epochMs: t - 60000 });
    assert.equal(verifyTotp(far, SECRET_SHA1, { epochMs: t }).valid, false);
  });

  it("le step renvoyé permet l'anti-rejeu (prev ≠ courant)", () => {
    const prev = totpCode(SECRET_SHA1, { epochMs: t - 30000 });
    const res = verifyTotp(prev, SECRET_SHA1, { epochMs: t });
    assert.equal(res.step, totpCounter(1234567890) - 1);
  });

  it("rejette une longueur ou un format invalides sans throw", () => {
    assert.equal(verifyTotp("123", SECRET_SHA1, { epochMs: t }).valid, false);
    assert.equal(
      verifyTotp("abcdef", SECRET_SHA1, { epochMs: t }).valid,
      false,
    );
  });

  it("ignore les espaces dans le code présenté", () => {
    const code = totpCode(SECRET_SHA1, { epochMs: t });
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    assert.equal(verifyTotp(spaced, SECRET_SHA1, { epochMs: t }).valid, true);
  });
});

describe("buildOtpauthUri (Key Uri Format)", () => {
  it("compose un otpauth://totp avec label issuer:account et params", () => {
    const uri = buildOtpauthUri({
      issuer: "Nodefony",
      account: "alice@example.com",
      secretBase32: "GEZDGNBVGY3TQOJQ",
      digits: 6,
    });
    assert.match(uri, /^otpauth:\/\/totp\/Nodefony:alice%40example\.com\?/);
    assert.match(uri, /secret=GEZDGNBVGY3TQOJQ/);
    assert.match(uri, /issuer=Nodefony/);
    assert.match(uri, /algorithm=SHA1/);
    assert.match(uri, /digits=6/);
    assert.match(uri, /period=30/);
  });
});

describe("Codes de récupération (NIST SP 800-63B §5.1.2)", () => {
  it("génère N codes au format XXXXX-XXXXX", () => {
    const codes = generateRecoveryCodes(10);
    assert.equal(codes.length, 10);
    for (const c of codes) assert.match(c, /^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
  });

  it("hash déterministe et insensible casse/tirets", () => {
    const code = "ABCDE-FGHJK";
    assert.equal(hashRecoveryCode(code), hashRecoveryCode("abcde fghjk"));
    assert.equal(hashRecoveryCode(code), hashRecoveryCode("ABCDEFGHJK"));
  });

  it("matchRecoveryCode trouve l'index et -1 sinon", () => {
    const codes = generateRecoveryCodes(5);
    const hashes = codes.map(hashRecoveryCode);
    assert.equal(matchRecoveryCode(codes[2] as string, hashes), 2);
    assert.equal(matchRecoveryCode("ZZZZZ-ZZZZZ", hashes), -1);
  });
});

describe("generateTotpSecret", () => {
  it("génère 160 bits par défaut (RFC 4226 R6)", () => {
    assert.equal(generateTotpSecret().length, TOTP_DEFAULTS.secretBytes);
    assert.equal(TOTP_DEFAULTS.secretBytes, 20);
  });
});
