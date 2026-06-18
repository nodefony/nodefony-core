import assert from "node:assert/strict";
import { CsrfTokenManager } from "../../nodefony/src/csrfToken";

/**
 * Synchronizer token CSRF (`@CsrfProtect`) — double-submit signé HMAC. Logique
 * pure : émission `nonce.signature`, vérif en-tête ≡ cookie + signature valide.
 */

const SECRET = "unit-test-secret-please-change-32b";
const mgr = new CsrfTokenManager(SECRET);

describe("CsrfTokenManager — émission", () => {
  it("émet un token de forme nonce.signature (2 segments base64url)", () => {
    const t = mgr.issue();
    const parts = t.split(".");
    assert.equal(parts.length, 2);
    assert.match(parts[0], /^[A-Za-z0-9_-]+$/);
    assert.match(parts[1], /^[A-Za-z0-9_-]+$/);
  });
  it("deux émissions → tokens différents (nonce aléatoire)", () => {
    assert.notEqual(mgr.issue(), mgr.issue());
  });
});

describe("CsrfTokenManager — vérification (double-submit)", () => {
  it("token valide rejoué à l'identique (header ≡ cookie) → true", () => {
    const t = mgr.issue();
    assert.equal(mgr.verify(t, t), true);
  });
  it("header ≠ cookie (double-submit cassé) → false", () => {
    assert.equal(mgr.verify(mgr.issue(), mgr.issue()), false);
  });
  it("en-tête absent → false", () => {
    const t = mgr.issue();
    assert.equal(mgr.verify(undefined, t), false);
  });
  it("cookie absent → false", () => {
    const t = mgr.issue();
    assert.equal(mgr.verify(t, undefined), false);
  });
  it("signature falsifiée → false", () => {
    const t = mgr.issue();
    const forged = `${t.split(".")[0]}.AAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    assert.equal(mgr.verify(forged, forged), false);
  });
  it("nonce modifié (signature ne correspond plus) → false", () => {
    const t = mgr.issue();
    const sig = t.split(".")[1];
    const tampered = `tampered-nonce.${sig}`;
    assert.equal(mgr.verify(tampered, tampered), false);
  });
  it("token sans séparateur → false", () => {
    assert.equal(mgr.verify("garbage", "garbage"), false);
  });
  it("token signé par un AUTRE secret → false (HMAC keyé)", () => {
    const other = new CsrfTokenManager("a-completely-different-secret-16");
    const t = other.issue();
    assert.equal(mgr.verify(t, t), false);
  });
});
