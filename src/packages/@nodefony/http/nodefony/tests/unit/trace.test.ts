/// <reference types="node" />
import { expect } from "chai";
import { parseTraceparent, resolveTraceparent } from "../../service/trace.js";

// W3C Trace Context — https://www.w3.org/TR/trace-context/
// Format : <version>-<traceId(32hex)>-<parentId(16hex)>-<flags>
const TP_RE = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
const VALID = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

describe("parseTraceparent — W3C Trace Context (P2.7)", () => {
  it("parse un header valide en ses 4 composants", () => {
    expect(parseTraceparent(VALID)).to.deep.equal({
      version: "00",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      parentId: "00f067aa0ba902b7",
      flags: "01",
    });
  });

  it("retourne null pour un header absent (null / undefined / non-string)", () => {
    expect(parseTraceparent(null)).to.equal(null);
    expect(parseTraceparent(undefined)).to.equal(null);
    expect(parseTraceparent(123 as unknown as string)).to.equal(null);
  });

  it("retourne null pour un format malformé", () => {
    expect(parseTraceparent("")).to.equal(null);
    expect(parseTraceparent("garbage")).to.equal(null);
    // traceId 31 hex (un caractère trop court)
    expect(
      parseTraceparent(
        "00-4bf92f3577b34da6a3ce929d0e0e473-00f067aa0ba902b7-01",
      ),
    ).to.equal(null);
    // caractère non-hex dans le traceId
    expect(
      parseTraceparent(
        "00-4bf92f3577b34da6a3ce929d0e0e473g-00f067aa0ba902b7-01",
      ),
    ).to.equal(null);
    // champ manquant (3 segments)
    expect(parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-01")).to.equal(
      null,
    );
  });

  it("rejette la version réservée ff (W3C : invalide)", () => {
    expect(
      parseTraceparent(
        "ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      ),
    ).to.equal(null);
  });

  it("rejette un traceId tout-à-zéro (MUST NOT propagate)", () => {
    expect(
      parseTraceparent(
        "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
      ),
    ).to.equal(null);
  });

  it("rejette un parentId tout-à-zéro (MUST NOT propagate)", () => {
    expect(
      parseTraceparent(
        "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
      ),
    ).to.equal(null);
  });

  it("normalise la casse en minuscules", () => {
    const p = parseTraceparent(
      "00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01",
    );
    expect(p?.traceId).to.equal("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(p?.parentId).to.equal("00f067aa0ba902b7");
  });

  it("trim les espaces autour du header", () => {
    expect(parseTraceparent(`  ${VALID}  `)).to.not.equal(null);
  });

  it("accepte un flag non échantillonné (00)", () => {
    const p = parseTraceparent(
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
    );
    expect(p?.flags).to.equal("00");
  });
});

describe("resolveTraceparent — frontière de requête (P2.7)", () => {
  it("propage un header valide : conserve version/traceId/flags, régénère le span", () => {
    const out = resolveTraceparent(VALID);
    expect(out).to.match(TP_RE);
    const p = parseTraceparent(out);
    expect(p?.version).to.equal("00");
    expect(p?.traceId).to.equal("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(p?.flags).to.equal("01");
    // nouveau spanId enfant, différent du parent entrant
    expect(p?.parentId).to.not.equal("00f067aa0ba902b7");
    expect(p?.parentId).to.match(/^[0-9a-f]{16}$/);
  });

  it("conserve les flags entrants (00 = non échantillonné)", () => {
    const out = resolveTraceparent(
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
    );
    expect(parseTraceparent(out)?.flags).to.equal("00");
  });

  it("forge un traceparent neuf si header absent (version 00, flags 01 sampled)", () => {
    const out = resolveTraceparent(undefined);
    expect(out).to.match(TP_RE);
    const p = parseTraceparent(out);
    expect(p?.version).to.equal("00");
    expect(p?.flags).to.equal("01");
    expect(p?.traceId).to.match(/^[0-9a-f]{32}$/);
    expect(p?.traceId).to.not.match(/^0+$/);
    expect(p?.parentId).to.match(/^[0-9a-f]{16}$/);
  });

  it("forge un traceparent neuf si header invalide", () => {
    const out = resolveTraceparent("garbage");
    expect(out).to.match(TP_RE);
    expect(parseTraceparent(out)).to.not.equal(null);
  });

  it("génère des traceId uniques à chaque appel sans header", () => {
    const a = parseTraceparent(resolveTraceparent(null));
    const b = parseTraceparent(resolveTraceparent(null));
    expect(a?.traceId).to.not.equal(b?.traceId);
  });
});
