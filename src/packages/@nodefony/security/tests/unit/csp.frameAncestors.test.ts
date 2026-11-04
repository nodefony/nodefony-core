import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Container, Event } from "nodefony";
import type { Module } from "nodefony";
import type { ContextType } from "@nodefony/http";
import { Firewall } from "../../nodefony/service/firewall";
import {
  frameAncestorsFor,
  parseCsp,
  withFrameAncestors,
} from "../../nodefony/src/csp";

/**
 * ADR-0024 §C5 — un seul réglage, `http.securityHeaders.frameOptions`, pilote
 * `X-Frame-Options` ET `frame-ancestors`. Le pare-feu lit ce que le noyau HTTP
 * ÉMET (contrat `describeTransportSecurityHeaders`) et suit ses éditions à chaud.
 */

/** Directive `frame-ancestors` d'une politique, ou `undefined`. */
const frameAncestorsOf = (csp: string): string[] | undefined =>
  parseCsp(csp).find(([name]) => name === "frame-ancestors")?.[1];

describe("csp — frameAncestorsFor / withFrameAncestors (pur)", () => {
  it("DENY → 'none', SAMEORIGIN → 'self', insensible à la casse", () => {
    assert.equal(frameAncestorsFor("DENY"), "'none'");
    assert.equal(frameAncestorsFor("deny"), "'none'");
    assert.equal(frameAncestorsFor("SAMEORIGIN"), "'self'");
    assert.equal(frameAncestorsFor(" sameorigin "), "'self'");
  });

  it("en-tête coupé ou valeur intraduisible → rien", () => {
    assert.equal(frameAncestorsFor(null), null);
    assert.equal(frameAncestorsFor("ALLOW-FROM https://a.example"), null);
  });

  it("ajoute la directive à la fin, sans `;` doublé", () => {
    assert.equal(
      withFrameAncestors("default-src 'self';  ", "DENY"),
      "default-src 'self'; frame-ancestors 'none'",
    );
  });

  it("l'application garde la main : sa directive écrite n'est pas touchée", () => {
    const csp = "default-src 'self'; frame-ancestors https://portail.example";
    assert.equal(withFrameAncestors(csp, "DENY"), csp);
  });

  it("politique vide ou en-tête coupé → politique inchangée", () => {
    assert.equal(withFrameAncestors("", "DENY"), "");
    assert.equal(
      withFrameAncestors("default-src 'self'", null),
      "default-src 'self'",
    );
  });
});

/** Pare-feu réel ; le noyau HTTP factice déclare ce qu'il émet en `X-Frame-Options`. */
const firewall = (
  frameOptions: { value: string | null } | null,
  options: Record<string, unknown> = {},
): Firewall => {
  const container = new Container();
  const kernel = new EventEmitter();
  container.set("kernel", kernel);
  if (frameOptions !== null) {
    container.set("HttpKernel", {
      describeTransportSecurityHeaders: () => ({
        strictTransportSecurity: null,
        frameOptions: frameOptions.value,
        contentTypeOptions: "nosniff",
      }),
    });
  }
  const fw = new Firewall({
    container,
    notificationsCenter: new Event(),
    options,
  } as unknown as Module);
  kernel.emit("onBoot");
  return fw;
};

/** La CSP que le pare-feu pose sur une réponse. */
const cspOf = (fw: Firewall): string => {
  const headers: Record<string, string> = {};
  fw.applySecurityHeaders({
    cspNonce: "N0nce==",
    cspDirectives: null,
    response: {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    },
  } as unknown as ContextType);
  return headers["Content-Security-Policy"] ?? "";
};

describe("pare-feu — frame-ancestors suit http.frameOptions (ADR-0024 §C5)", () => {
  it("défaut DENY → frame-ancestors 'none' dans la politique posée", () => {
    assert.deepEqual(frameAncestorsOf(cspOf(firewall({ value: "DENY" }))), [
      "'none'",
    ]);
  });

  it("SAMEORIGIN → frame-ancestors 'self'", () => {
    assert.deepEqual(
      frameAncestorsOf(cspOf(firewall({ value: "SAMEORIGIN" }))),
      ["'self'"],
    );
  });

  it("frameOptions null → aucune des deux protections", () => {
    assert.equal(frameAncestorsOf(cspOf(firewall({ value: null }))), undefined);
  });

  it("sans noyau HTTP, rien n'est deviné", () => {
    assert.equal(frameAncestorsOf(cspOf(firewall(null))), undefined);
  });

  it("la directive écrite par l'application l'emporte", () => {
    const fw = firewall(
      { value: "DENY" },
      {
        headers: {
          csp: "default-src 'self'; frame-ancestors https://portail.example",
        },
      },
    );
    assert.deepEqual(frameAncestorsOf(cspOf(fw)), ["https://portail.example"]);
  });

  it("survit à la contribution d'un module", () => {
    const fw = firewall({ value: "DENY" });
    fw.registerCspOrigins("realtime", {
      "connect-src": ["wss://rt.example"],
    });
    const csp = cspOf(fw);
    assert.deepEqual(frameAncestorsOf(csp), ["'none'"]);
    assert.match(csp, /connect-src 'self' wss:\/\/rt\.example/);
  });

  it("édition à chaud : la politique suit, contributions comprises", () => {
    const emitted = { value: "DENY" as string | null };
    const fw = firewall(emitted);
    fw.registerCspOrigins("realtime", {
      "connect-src": ["wss://rt.example"],
    });
    emitted.value = "SAMEORIGIN";
    fw.onTransportHeadersChanged();
    const csp = cspOf(fw);
    assert.deepEqual(frameAncestorsOf(csp), ["'self'"]);
    assert.match(csp, /wss:\/\/rt\.example/);
    emitted.value = null;
    fw.onTransportHeadersChanged();
    assert.equal(frameAncestorsOf(cspOf(fw)), undefined);
  });
});
