/// <reference types="node" />
import { expect } from "chai";
import {
  binaryByteLength,
  formatWsLogContent,
  WS_LOG_CONTENT_CAP,
} from "../../src/context/websocket/wsLogContent.js";

// Durcissement aux limites du formatage de contenu WS (seam Suivi de requête).
// Spec : string tronquée ; TOUTE charge binaire (Buffer/ArrayBuffer/TypedArray/
// DataView/Blob/Buffer[]) → `[binary N B]` (jamais sérialisée) ; null → "" ;
// objet JSON compact borné ; valeurs exotiques (cycle/bigint/fonction) → repli.

describe("binaryByteLength — détection binaire robuste (doc ws)", () => {
  it("Buffer → length", () => {
    expect(binaryByteLength(Buffer.from("abc"))).to.equal(3);
    expect(binaryByteLength(Buffer.alloc(0))).to.equal(0);
  });
  it("ArrayBuffer → byteLength", () => {
    expect(binaryByteLength(new ArrayBuffer(8))).to.equal(8);
  });
  it("TypedArray (Uint8Array/Float64Array) → byteLength (≠ length)", () => {
    expect(binaryByteLength(new Uint8Array([1, 2, 3, 4]))).to.equal(4);
    // 2 éléments × 8 octets = 16 (piège: .length = 2)
    expect(binaryByteLength(new Float64Array([1, 2]))).to.equal(16);
  });
  it("DataView → byteLength", () => {
    expect(binaryByteLength(new DataView(new ArrayBuffer(5)))).to.equal(5);
  });
  it("Buffer[] (fragments ws) → somme ; [] → 0", () => {
    expect(binaryByteLength([Buffer.from("ab"), Buffer.from("cde")])).to.equal(
      5,
    );
    expect(binaryByteLength([])).to.equal(0);
  });
  it("non binaire → -1 (string, objet, number, tableau JSON)", () => {
    expect(binaryByteLength("str")).to.equal(-1);
    expect(binaryByteLength({ a: 1 })).to.equal(-1);
    expect(binaryByteLength(42)).to.equal(-1);
    expect(binaryByteLength([1, 2, 3])).to.equal(-1);
    expect(binaryByteLength(null)).to.equal(-1);
  });
});

describe("formatWsLogContent — bornage & sûreté", () => {
  it("string courte ou = cap → inchangée", () => {
    expect(formatWsLogContent("hello", 10)).to.equal("hello");
    expect(formatWsLogContent("x".repeat(10), 10)).to.equal("x".repeat(10));
  });
  it("string > cap → tronquée + ellipse (longueur = cap+1)", () => {
    const out = formatWsLogContent("x".repeat(50), 4);
    expect(out).to.equal("xxxx…");
    expect(out.endsWith("…")).to.equal(true);
    expect(out.length).to.equal(5);
  });
  it("default cap = 4096 appliqué", () => {
    const out = formatWsLogContent("a".repeat(5000));
    expect(out.length).to.equal(WS_LOG_CONTENT_CAP + 1);
    expect(out.endsWith("…")).to.equal(true);
  });

  it("Buffer / TypedArray / ArrayBuffer / DataView → [binary N B] (jamais de dump)", () => {
    expect(formatWsLogContent(Buffer.from("hello"))).to.equal("[binary 5 B]");
    expect(formatWsLogContent(new Uint8Array(1024))).to.equal(
      "[binary 1024 B]",
    );
    expect(formatWsLogContent(new ArrayBuffer(16))).to.equal("[binary 16 B]");
    expect(formatWsLogContent(new DataView(new ArrayBuffer(3)))).to.equal(
      "[binary 3 B]",
    );
  });
  it("gros TypedArray → résumé, PAS un objet indexé géant", () => {
    const out = formatWsLogContent(new Uint8Array(100000));
    expect(out).to.equal("[binary 100000 B]");
    expect(out.length).to.be.lessThan(20); // surtout pas {"0":0,"1":0,...}
  });
  it("Buffer[] fragments → [binary somme B]", () => {
    expect(
      formatWsLogContent([Buffer.from("ab"), Buffer.from("cdef")]),
    ).to.equal("[binary 6 B]");
  });

  it("null / undefined → chaîne vide", () => {
    expect(formatWsLogContent(null)).to.equal("");
    expect(formatWsLogContent(undefined)).to.equal("");
  });

  it("objet JSON → compact ; tronqué si > cap", () => {
    expect(formatWsLogContent({ a: 1, b: "x" })).to.equal('{"a":1,"b":"x"}');
    const out = formatWsLogContent({ big: "y".repeat(5000) }, 20);
    expect(out.length).to.equal(21);
    expect(out.endsWith("…")).to.equal(true);
  });
  it("tableau JSON (non binaire) → sérialisé", () => {
    expect(formatWsLogContent([1, 2, 3])).to.equal("[1,2,3]");
  });

  it("valeurs exotiques → repli String sans throw (cycle, bigint, fonction)", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => formatWsLogContent(cyclic)).to.not.throw();
    expect(formatWsLogContent(cyclic)).to.equal(String(cyclic));
    expect(formatWsLogContent(10n)).to.equal("10");
    expect(formatWsLogContent(42)).to.equal("42");
    expect(formatWsLogContent(true)).to.equal("true");
    const fn = formatWsLogContent(() => 1);
    expect(fn).to.be.a("string").and.not.equal("");
  });
});
