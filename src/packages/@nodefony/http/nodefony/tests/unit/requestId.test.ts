/// <reference types="node" />
import { expect } from "chai";
import {
  sanitizeRequestId,
  MAX_REQUEST_ID_LENGTH,
} from "../../src/context/requestId.js";

// Validation du X-Request-Id client (Zero Trust) : la valeur est réfléchie en
// réponse + loguée + propagée en ALS → toute valeur non sûre doit être rejetée
// (retour null → l'appelant garde l'UUID serveur).
describe("sanitizeRequestId — X-Request-Id entrant", () => {
  describe("valeurs acceptées", () => {
    it("UUID v4", () => {
      const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
      expect(sanitizeRequestId(id)).to.equal(id);
    });

    it("token alphanumérique avec . _ -", () => {
      const id = "my-trace.abc_123";
      expect(sanitizeRequestId(id)).to.equal(id);
    });

    it("longueur maximale exacte (128)", () => {
      const id = "a".repeat(MAX_REQUEST_ID_LENGTH);
      expect(sanitizeRequestId(id)).to.equal(id);
    });
  });

  describe("valeurs rejetées (→ null)", () => {
    it("undefined / null / chaîne vide", () => {
      expect(sanitizeRequestId(undefined)).to.equal(null);
      expect(sanitizeRequestId(null)).to.equal(null);
      expect(sanitizeRequestId("")).to.equal(null);
    });

    it("CRLF (response splitting / log injection)", () => {
      expect(sanitizeRequestId("abc\r\nSet-Cookie: evil=1")).to.equal(null);
      expect(sanitizeRequestId("abc\rdef")).to.equal(null);
      expect(sanitizeRequestId("abc\ndef")).to.equal(null);
    });

    it("caractères de contrôle (tab, NUL, DEL)", () => {
      expect(sanitizeRequestId("abc\tdef")).to.equal(null);
      expect(sanitizeRequestId("abc\x00def")).to.equal(null);
      expect(sanitizeRequestId("abc\x7fdef")).to.equal(null);
    });

    it("espace", () => {
      expect(sanitizeRequestId("has space")).to.equal(null);
    });

    it("non-ASCII (throw setHeader natif Node)", () => {
      expect(sanitizeRequestId("café")).to.equal(null);
      expect(sanitizeRequestId("日本")).to.equal(null);
    });

    it('séparateurs de header dangereux (; : , = ")', () => {
      expect(sanitizeRequestId("a;b")).to.equal(null);
      expect(sanitizeRequestId("a:b")).to.equal(null);
      expect(sanitizeRequestId('a"b')).to.equal(null);
    });

    it("longueur > 128", () => {
      expect(sanitizeRequestId("a".repeat(MAX_REQUEST_ID_LENGTH + 1))).to.equal(
        null,
      );
    });
  });
});
