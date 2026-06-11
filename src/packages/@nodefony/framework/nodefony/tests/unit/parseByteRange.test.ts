/// <reference types="node" />
import { expect } from "chai";
import { parseByteRange } from "../../src/Controller";

// R1 (vague 5) — parsing du header `Range` mono-plage (RFC 9110 §14.1.2).
// Contrat : { start, end } clampés | "unsatisfiable" (→ 416 §15.5.17) |
// null = header IGNORÉ (→ 200 complet, §14.2). Un Range client ne produit
// JAMAIS un 500.

const LEN = 1000; // représentation de 1000 octets : positions valides 0-999

describe("parseByteRange — RFC 9110 §14", () => {
  describe("plages valides → { start, end }", () => {
    it("bytes=0-499 → 0-499", () => {
      expect(parseByteRange("bytes=0-499", LEN)).to.deep.equal({
        start: 0,
        end: 499,
      });
    });

    it("bytes=500- (open-ended) → 500-999", () => {
      expect(parseByteRange("bytes=500-", LEN)).to.deep.equal({
        start: 500,
        end: 999,
      });
    });

    it("bytes=-100 (suffixe) → les 100 derniers octets (900-999)", () => {
      expect(parseByteRange("bytes=-100", LEN)).to.deep.equal({
        start: 900,
        end: 999,
      });
    });

    it("suffixe plus grand que la représentation → représentation entière", () => {
      expect(parseByteRange("bytes=-5000", LEN)).to.deep.equal({
        start: 0,
        end: 999,
      });
    });

    it("end ≥ length → clampé à length-1 (§14.1.2)", () => {
      expect(parseByteRange("bytes=0-999999999", LEN)).to.deep.equal({
        start: 0,
        end: 999,
      });
    });

    it("unité insensible à la casse + espaces tolérés", () => {
      expect(parseByteRange("Bytes = 0-1", LEN)).to.deep.equal({
        start: 0,
        end: 1,
      });
    });
  });

  describe('plages hors représentation → "unsatisfiable" (416)', () => {
    it("start ≥ length", () => {
      expect(parseByteRange(`bytes=${LEN}-`, LEN)).to.equal("unsatisfiable");
      expect(parseByteRange("bytes=999999999-", LEN)).to.equal("unsatisfiable");
    });

    it("suffixe -0 (zéro dernier octet)", () => {
      expect(parseByteRange("bytes=-0", LEN)).to.equal("unsatisfiable");
    });

    it("représentation vide (length 0)", () => {
      expect(parseByteRange("bytes=0-", 0)).to.equal("unsatisfiable");
      expect(parseByteRange("bytes=-100", 0)).to.equal("unsatisfiable");
    });
  });

  describe("header à IGNORER → null (200 complet, jamais 500)", () => {
    it("unité inconnue (items=0-50)", () => {
      expect(parseByteRange("items=0-50", LEN)).to.equal(null);
    });

    it("syntaxe invalide (bytes=abc-def — l'ancien parseInt donnait NaN → 500)", () => {
      expect(parseByteRange("bytes=abc-def", LEN)).to.equal(null);
    });

    it("first > last (bytes=500-100, invalide §14.1.2)", () => {
      expect(parseByteRange("bytes=500-100", LEN)).to.equal(null);
    });

    it("multi-range (bytes=0-50,100-150 — multipart/byteranges non supporté)", () => {
      expect(parseByteRange("bytes=0-50,100-150", LEN)).to.equal(null);
    });

    it("spec vide (bytes=-)", () => {
      expect(parseByteRange("bytes=-", LEN)).to.equal(null);
    });
  });
});
