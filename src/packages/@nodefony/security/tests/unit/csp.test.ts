import assert from "node:assert/strict";
import {
  parseCsp,
  serializeCsp,
  mergeCspFragments,
  type CspFragment,
} from "../../nodefony/src/csp";

/**
 * Fusion CSP pure (étape B) — un module DÉCLARE ses besoins (origines Vite dev,
 * `'unsafe-eval'`…) et security MERGE sans en connaître la sémantique. Vérifie : le
 * merge structuré (pas une concat — une directive répétée serait ignorée), la
 * déduplication, l'ajout de directive, et la PRÉSERVATION du token `'nonce-{{nonce}}'`.
 */

describe("csp — parse / serialize", () => {
  it("parse en directives ordonnées", () => {
    assert.deepEqual(
      parseCsp("default-src 'self'; script-src 'self' 'nonce-{{nonce}}'"),
      [
        ["default-src", ["'self'"]],
        ["script-src", ["'self'", "'nonce-{{nonce}}'"]],
      ],
    );
  });
  it("normalise espaces/`;` superflus et ignore les vides", () => {
    assert.deepEqual(parseCsp("  default-src   'self' ;; "), [
      ["default-src", ["'self'"]],
    ]);
  });
  it("round-trip parse→serialize stable", () => {
    const csp = "default-src 'self'; img-src 'self' data:";
    assert.equal(serializeCsp(parseCsp(csp)), csp);
  });
});

describe("csp — mergeCspFragments", () => {
  it("complète une directive existante (ordre base puis ajouts)", () => {
    const out = mergeCspFragments("script-src 'self'", [
      { "script-src": ["'unsafe-eval'", "http://127.0.0.1:5173"] },
    ]);
    assert.equal(out, "script-src 'self' 'unsafe-eval' http://127.0.0.1:5173");
  });
  it("déduplique les sources déjà présentes", () => {
    const out = mergeCspFragments("script-src 'self'", [
      { "script-src": ["'self'", "blob:"] },
    ]);
    assert.equal(out, "script-src 'self' blob:");
  });
  it("ajoute une directive absente en fin", () => {
    const out = mergeCspFragments("default-src 'self'", [
      { "connect-src": ["ws://127.0.0.1:5173"] },
    ]);
    assert.equal(out, "default-src 'self'; connect-src ws://127.0.0.1:5173");
  });
  it("PRÉSERVE le placeholder de nonce intact", () => {
    const out = mergeCspFragments(
      "default-src 'self'; script-src 'self' 'nonce-{{nonce}}'",
      [{ "script-src": ["http://127.0.0.1:5173"] }],
    );
    assert.ok(out.includes("'nonce-{{nonce}}'"));
    assert.equal(
      out,
      "default-src 'self'; script-src 'self' 'nonce-{{nonce}}' http://127.0.0.1:5173",
    );
  });
  it("fusionne plusieurs fragments (multi-modules)", () => {
    const fragments: CspFragment[] = [
      { "script-src": ["http://a:5173"], "connect-src": ["ws://a:5173"] },
      { "script-src": ["http://b:5177"], "connect-src": ["ws://b:5177"] },
    ];
    const out = mergeCspFragments(
      "default-src 'self'; script-src 'self'",
      fragments,
    );
    assert.equal(
      out,
      "default-src 'self'; script-src 'self' http://a:5173 http://b:5177; connect-src ws://a:5173 ws://b:5177",
    );
  });
  it("ignore fragments/sources vides", () => {
    const out = mergeCspFragments("default-src 'self'", [
      { "script-src": [] },
      {},
    ]);
    assert.equal(out, "default-src 'self'");
  });
});
