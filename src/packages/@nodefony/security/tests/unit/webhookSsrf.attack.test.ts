import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  assertPublicUrl,
  isBlockedAddress,
} from "../../nodefony/src/net/ssrfGuard";
import { SsrfError } from "../../nodefony/errors/SsrfError";
import {
  deriveKey,
  encryptSecret,
  decryptSecret,
} from "../../nodefony/src/crypto/secretCipher";

/**
 * RED-TEAM SSRF + crypto (P6.13 webhooks Slice A) — matrice threat-first. Chaque
 * cas = une attaque conçue depuis OWASP SSRF / CAPEC-664 + la mécanique IPv6, avec
 * son verdict attendu. Rouge = bypass réel (l'attaquant atteint une cible interne).
 */

const webhookDomain = {
  salt: "nodefony.webhook.hkdf.v1",
  info: "webhook-secret-encryption",
};

// ── Vecteur : IPv4-mapped IPv6 sous TOUTES ses formes (anti-bypass) ──────────
describe("attack/SSRF — IPv4-mapped IPv6 (toutes notations → loopback/metadata)", () => {
  const mapped = [
    "::ffff:127.0.0.1", // pointée compressée
    "::ffff:7f00:1", // hex compressée
    "::FFFF:7F00:0001", // hex MAJ + zéros
    "::ffff:169.254.169.254", // métadonnées cloud (pointée)
    "::ffff:a9fe:a9fe", // métadonnées cloud (hex)
    "0:0:0:0:0:ffff:127.0.0.1", // ⚠️ forme LONGUE non compressée (pointée)
    "0:0:0:0:0:ffff:7f00:1", // ⚠️ forme LONGUE non compressée (hex)
  ];
  for (const ip of mapped) {
    it(`bloque ${ip}`, () => assert.equal(isBlockedAddress(ip), true));
  }
});

// ── Vecteur : confusion userinfo (host "de confiance" avant @) ───────────────
describe("attack/SSRF — confusion userinfo @", () => {
  it("https://trusted.com@169.254.169.254/ → SsrfError", () =>
    assert.rejects(
      () => assertPublicUrl("https://trusted.com@169.254.169.254/"),
      SsrfError,
    ));
  it("https://1.1.1.1@127.0.0.1/ → SsrfError", () =>
    assert.rejects(
      () => assertPublicUrl("https://1.1.1.1@127.0.0.1/"),
      SsrfError,
    ));
});

// ── Vecteur : encodage d'IP dans le hostname (octal/dword/hex) ───────────────
// Le contrat : on compare l'IP RÉSOLUE (output getaddrinfo), pas le hostname brut.
// Resolver injecté = simule getaddrinfo qui décode ces formes vers l'IP réelle.
describe("attack/SSRF — IP encodée résolue vers une cible interne", () => {
  const toLoopback = async () => ["127.0.0.1"];
  for (const host of [
    "http://2130706433/", // dword = 127.0.0.1
    "http://0x7f000001/", // hex = 127.0.0.1
    "http://0177.0.0.1/", // octal
    "http://127.1/", // forme abrégée
  ]) {
    it(`${host} (→127.0.0.1) → SsrfError`, () =>
      assert.rejects(
        () => assertPublicUrl(host, { allowHttp: true, resolver: toLoopback }),
        SsrfError,
      ));
  }
  it("dword réel sans resolver → SsrfError (résolu interne OU non résolvable)", () =>
    assert.rejects(
      () => assertPublicUrl("http://2130706433/", { allowHttp: true }),
      SsrfError,
    ));
});

// ── Vecteur : notations spéciales & zone-id ──────────────────────────────────
describe("attack/SSRF — notations spéciales", () => {
  it("0.0.0.0 → bloqué", () => assert.equal(isBlockedAddress("0.0.0.0"), true));
  it("https://0.0.0.0/ → SsrfError", () =>
    assert.rejects(() => assertPublicUrl("https://0.0.0.0/"), SsrfError));
  it("IPv6 zone-id [fe80::1%25eth0] → SsrfError", () =>
    assert.rejects(
      () => assertPublicUrl("https://[fe80::1%25eth0]/"),
      SsrfError,
    ));
  it("[::ffff:7f00:1] littéral via URL → SsrfError", () =>
    assert.rejects(
      () => assertPublicUrl("https://[::ffff:7f00:1]/"),
      SsrfError,
    ));
});

// ── Vecteur : schémas non-http exotiques ─────────────────────────────────────
describe("attack/SSRF — schémas exotiques", () => {
  for (const u of [
    "dict://1.1.1.1:11211/",
    "ftp://1.1.1.1/",
    "data:text/plain,hi",
    "ws://1.1.1.1/",
    "redis://1.1.1.1:6379/",
  ]) {
    it(`${u} → SsrfError`, () =>
      assert.rejects(() => assertPublicUrl(u), SsrfError));
  }
});

// ── Contrôle POSITIF (sinon "tout bloquer" est trivialement vert) ────────────
describe("attack/SSRF — contrôle positif (le légitime passe)", () => {
  it("https://1.1.1.1/hook (public littéral) → OK", async () => {
    const r = await assertPublicUrl("https://1.1.1.1/hook");
    assert.deepEqual(r.addresses, ["1.1.1.1"]);
  });
  it("hôte résolvant public → OK", async () => {
    const r = await assertPublicUrl("https://hooks.example/x", {
      resolver: async () => ["93.184.216.34"],
    });
    assert.deepEqual(r.addresses, ["93.184.216.34"]);
  });
});

// ── Vecteur : crypto (downgrade / troncature / confusion de domaine) ─────────
describe("attack/crypto — secretCipher", () => {
  const key = deriveKey("matériel-test", webhookDomain);
  it("downgrade de version (gcm0.) → throw", () =>
    assert.throws(() => decryptSecret("gcm0.AAAA", key)));
  it("blob tronqué (gcm1. vide) → throw", () =>
    assert.throws(() => decryptSecret("gcm1.", key)));
  it("base64 garbage → throw", () =>
    assert.throws(() => decryptSecret("gcm1.!!!!notbase64!!!!", key)));
  it("blob sans séparateur → throw", () =>
    assert.throws(() => decryptSecret("gcm1AAAA", key)));
  it("confusion de domaine (clé totp ≠ webhook) → throw", () => {
    const totpKey = deriveKey("matériel-test", {
      salt: "nodefony.totp.hkdf.v1",
      info: "totp-secret-encryption",
    });
    const blob = encryptSecret(Buffer.from("whsec_x"), key);
    assert.throws(() => decryptSecret(blob, totpKey));
  });
});
