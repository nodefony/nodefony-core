/// <reference types="node" />
import { expect } from "chai";
import {
  parseForwarded,
  forwardedNodeIp,
  resolveForwarded,
} from "../../src/context/forwarded";
import { buildTrustProxy } from "../../src/context/trustProxy";

// RFC 7239 — Forwarded HTTP Extension. Parsing du header standard + résolution
// canonique unifiée (Forwarded prioritaire, repli X-Forwarded-* de-facto).
describe("parseForwarded — RFC 7239 §4 (syntaxe)", () => {
  it("absent / vide → null", () => {
    expect(parseForwarded(undefined)).to.equal(null);
    expect(parseForwarded("")).to.equal(null);
    expect(parseForwarded("   ")).to.equal(null);
  });

  it("élément simple — for/proto/by", () => {
    const r = parseForwarded("for=192.0.2.43;proto=http;by=203.0.113.43");
    expect(r).to.deep.equal([
      { for: "192.0.2.43", proto: "http", by: "203.0.113.43" },
    ]);
  });

  it("plusieurs forwarded-elements (gauche→droite = client→dernier proxy)", () => {
    const r = parseForwarded("for=192.0.2.43, for=198.51.100.17");
    expect(r).to.deep.equal([{ for: "192.0.2.43" }, { for: "198.51.100.17" }]);
  });

  it("noms de paramètres insensibles à la casse (§7.1)", () => {
    const r = parseForwarded("For=192.0.2.43;PROTO=HTTPS;Host=example.com");
    expect(r).to.deep.equal([
      { for: "192.0.2.43", proto: "https", host: "example.com" },
    ]);
  });

  it("IPv6 quoté avec crochets et port (§6) — quoted-string déquotée", () => {
    const r = parseForwarded('for="[2001:db8:cafe::17]:4711";proto=https');
    expect(r).to.deep.equal([
      { for: "[2001:db8:cafe::17]:4711", proto: "https" },
    ]);
  });

  it("virgule À L'INTÉRIEUR d'une quoted-string n'est PAS un séparateur", () => {
    const r = parseForwarded('host="a,b";for=192.0.2.43');
    expect(r).to.deep.equal([{ host: "a,b", for: "192.0.2.43" }]);
  });

  it("paramètre d'extension inconnu (§5.4) ignoré", () => {
    const r = parseForwarded("for=192.0.2.43;secret=xyz;proto=https");
    expect(r).to.deep.equal([{ for: "192.0.2.43", proto: "https" }]);
  });

  it("header répété (array) → concaténé puis parsé", () => {
    const r = parseForwarded(["for=192.0.2.43", "for=198.51.100.17"]);
    expect(r).to.deep.equal([{ for: "192.0.2.43" }, { for: "198.51.100.17" }]);
  });
});

describe("forwardedNodeIp — RFC 7239 §6 (node identifiers)", () => {
  it("IPv4 nue", () => {
    expect(forwardedNodeIp("192.0.2.43")).to.equal("192.0.2.43");
  });
  it("IPv4 avec port → port retiré", () => {
    expect(forwardedNodeIp("192.0.2.43:47011")).to.equal("192.0.2.43");
  });
  it("IPv6 entre crochets → crochets retirés", () => {
    expect(forwardedNodeIp("[2001:db8::1]")).to.equal("2001:db8::1");
  });
  it("IPv6 entre crochets avec port → IPv6 seule", () => {
    expect(forwardedNodeIp("[2001:db8:cafe::17]:4711")).to.equal(
      "2001:db8:cafe::17",
    );
  });
  it("'unknown' → null (§6.2)", () => {
    expect(forwardedNodeIp("unknown")).to.equal(null);
  });
  it("identifiant obfusqué (_secret, §6.3) → null", () => {
    expect(forwardedNodeIp("_hidden")).to.equal(null);
  });
  it("absent / vide → null", () => {
    expect(forwardedNodeIp(undefined)).to.equal(null);
    expect(forwardedNodeIp("  ")).to.equal(null);
  });
});

describe("resolveForwarded — résolution canonique unifiée", () => {
  const loopback = buildTrustProxy("loopback");

  it("Forwarded PRIORITAIRE sur X-Forwarded-* (proto + IP)", () => {
    const r = resolveForwarded(
      {
        forwarded: "for=203.0.113.9;proto=https;host=example.com",
        "x-forwarded-proto": "http",
        "x-forwarded-for": "1.2.3.4",
        "x-forwarded-host": "evil.com",
      },
      "127.0.0.1",
      loopback,
    );
    expect(r.fromStandard).to.equal(true);
    expect(r.proto).to.equal("https");
    expect(r.host).to.equal("example.com");
    expect(r.clientIp).to.equal("203.0.113.9");
  });

  it("🔴 anti-spoof via Forwarded — for forgé en tête, IP réelle from-right", () => {
    // client forge for=1.2.3.4 ; le proxy (loopback) append son for=203.0.113.9.
    const r = resolveForwarded(
      { forwarded: 'for=1.2.3.4, for="203.0.113.9"' },
      "127.0.0.1",
      loopback,
    );
    expect(r.clientIp).to.equal("203.0.113.9");
  });

  it("for obfusqué (_hidden) = barrière → dernier proxy de confiance, jamais null", () => {
    const r = resolveForwarded(
      { forwarded: "for=203.0.113.9, for=_hidden" },
      "127.0.0.1",
      loopback,
    );
    expect(r.clientIp).to.equal("127.0.0.1");
  });

  it("IPv6 quoté résolu from-right", () => {
    const r = resolveForwarded(
      { forwarded: 'for="[2001:db8::1]"' },
      "127.0.0.1",
      loopback,
    );
    expect(r.clientIp).to.equal("2001:db8::1");
  });

  it("repli X-Forwarded-* quand pas de Forwarded (fromStandard=false)", () => {
    const r = resolveForwarded(
      { "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.9" },
      "127.0.0.1",
      loopback,
    );
    expect(r.fromStandard).to.equal(false);
    expect(r.proto).to.equal("https");
    expect(r.clientIp).to.equal("203.0.113.9");
  });

  it("#5 priorité canonique : x-forwarded-proto > x-forwarded-scheme", () => {
    expect(
      resolveForwarded(
        { "x-forwarded-proto": "https", "x-forwarded-scheme": "http" },
        "127.0.0.1",
        loopback,
      ).proto,
    ).to.equal("https");
    // x-forwarded-scheme seul → utilisé en repli
    expect(
      resolveForwarded({ "x-forwarded-scheme": "https" }, "127.0.0.1", loopback)
        .proto,
    ).to.equal("https");
  });

  it("proto multi-valeurs → premier token (côté client)", () => {
    const r = resolveForwarded(
      { "x-forwarded-proto": "https, http" },
      "127.0.0.1",
      loopback,
    );
    expect(r.proto).to.equal("https");
  });

  it("socket non fiable + Forwarded forgé → garde le socket (pas de spoof)", () => {
    const r = resolveForwarded(
      { forwarded: "for=1.2.3.4;proto=https" },
      "203.0.113.50",
      loopback,
    );
    // socket public non fiable → from-right s'arrête au socket
    expect(r.clientIp).to.equal("203.0.113.50");
    // proto reste lu (le scheme effectif n'est pas une IP), mais gating proxy est
    // fait par l'appelant (resolveForwarded n'est invoqué que si socket trusted).
    expect(r.proto).to.equal("https");
  });
});
