import assert from "node:assert/strict";
import {
  SecurityHeaders,
  type ISecurityHeadersOptions,
} from "../../nodefony/service/securityHeaders";

/**
 * En-têtes de sécurité APPLICATIFS (P6 J5, étape A) — la table figée émise par
 * security. Vérifie la SÉPARATION transport/applicatif : nosniff/frame/HSTS NE
 * sont JAMAIS émis ici (socle @nodefony/http). CSP statique (nonce = étape B).
 */

const base: ISecurityHeadersOptions = {
  enabled: true,
  csp: "default-src 'self'",
  cspNonces: true,
  referrerPolicy: "no-referrer",
};
const make = (o: Partial<ISecurityHeadersOptions> = {}): SecurityHeaders =>
  new SecurityHeaders({ ...base, ...o });

describe("SecurityHeaders — défauts (CSP + Referrer)", () => {
  const h = make().headers;
  it("pose Content-Security-Policy (string config, sans nonce en étape A)", () => {
    assert.equal(h["Content-Security-Policy"], "default-src 'self'");
  });
  it("pose Referrer-Policy", () => {
    assert.equal(h["Referrer-Policy"], "no-referrer");
  });
  it("n'émet JAMAIS le socle transport (nosniff/frame/HSTS = @nodefony/http)", () => {
    assert.equal(h["X-Content-Type-Options"], undefined);
    assert.equal(h["X-Frame-Options"], undefined);
    assert.equal(h["Strict-Transport-Security"], undefined);
  });
  it("avancés absents par défaut (opt-in)", () => {
    assert.equal(h["Cross-Origin-Opener-Policy"], undefined);
    assert.equal(h["Cross-Origin-Embedder-Policy"], undefined);
    assert.equal(h["Cross-Origin-Resource-Policy"], undefined);
    assert.equal(h["Origin-Agent-Cluster"], undefined);
    assert.equal(h["Permissions-Policy"], undefined);
  });
});

describe("SecurityHeaders — avancés (opt-in)", () => {
  const h = make({
    coop: "same-origin",
    coep: "require-corp",
    corp: "same-origin",
    originAgentCluster: true,
    permissionsPolicy: "camera=(), microphone=()",
  }).headers;
  it("COOP/COEP/CORP posés", () => {
    assert.equal(h["Cross-Origin-Opener-Policy"], "same-origin");
    assert.equal(h["Cross-Origin-Embedder-Policy"], "require-corp");
    assert.equal(h["Cross-Origin-Resource-Policy"], "same-origin");
  });
  it("Origin-Agent-Cluster → '?1' (structured field bool, RFC 8941)", () => {
    assert.equal(h["Origin-Agent-Cluster"], "?1");
  });
  it("Permissions-Policy posé", () => {
    assert.equal(h["Permissions-Policy"], "camera=(), microphone=()");
  });
});

describe("SecurityHeaders — bords", () => {
  it("originAgentCluster false → absent", () => {
    assert.equal(
      make({ originAgentCluster: false }).headers["Origin-Agent-Cluster"],
      undefined,
    );
  });
  it("CSP vide → pas d'en-tête CSP imposé", () => {
    assert.equal(
      make({ csp: "" }).headers["Content-Security-Policy"],
      undefined,
    );
  });
  it("table figée (Object.freeze)", () => {
    const h = make().headers;
    assert.throws(() => {
      (h as Record<string, string>)["X-Injected"] = "x";
    });
  });
});

describe("SecurityHeaders — nonce CSP par requête (étape B)", () => {
  const NONCE_CSP = "default-src 'self'; script-src 'self' 'nonce-{{nonce}}'";

  it("nonce activé + placeholder → CSP dynamique (hors table figée)", () => {
    const sh = make({ csp: NONCE_CSP, cspNonces: true });
    assert.equal(sh.hasNonce, true);
    // Recomposé par requête → PAS dans la table figée (sinon nonce gelé au boot).
    assert.equal(sh.headers["Content-Security-Policy"], undefined);
  });
  it("cspFor injecte le nonce de la requête au placeholder", () => {
    const sh = make({ csp: NONCE_CSP, cspNonces: true });
    assert.equal(
      sh.cspFor("AbC123=="),
      "default-src 'self'; script-src 'self' 'nonce-AbC123=='",
    );
  });
  it("nonces différents → CSP différents (unicité par requête)", () => {
    const sh = make({ csp: NONCE_CSP, cspNonces: true });
    assert.notEqual(sh.cspFor("aaa"), sh.cspFor("bbb"));
  });
  it("nonce désactivé + placeholder → token purgé, CSP statique propre", () => {
    const sh = make({ csp: NONCE_CSP, cspNonces: false });
    assert.equal(sh.hasNonce, false);
    assert.equal(
      sh.headers["Content-Security-Policy"],
      "default-src 'self'; script-src 'self'",
    );
  });
  it("nonce activé MAIS pas de placeholder → CSP statique (pas de nonce mensonger)", () => {
    const sh = make({ csp: "default-src 'self'", cspNonces: true });
    assert.equal(sh.hasNonce, false);
    assert.equal(sh.headers["Content-Security-Policy"], "default-src 'self'");
  });
});

describe("SecurityHeaders — cspForExtra (@Csp per-route)", () => {
  const NONCE_CSP =
    "default-src 'self'; script-src 'self' 'nonce-{{nonce}}'; frame-src 'none'";

  it("fusionne une directive existante (sources complétées, pas dupliquée)", () => {
    const sh = make({ csp: NONCE_CSP, cspNonces: true });
    assert.equal(
      sh.cspForExtra("N0nce==", { "frame-src": ["https://youtube.com"] }),
      "default-src 'self'; script-src 'self' 'nonce-N0nce=='; frame-src 'none' https://youtube.com",
    );
  });
  it("ajoute une directive absente en fin", () => {
    const sh = make({ csp: NONCE_CSP, cspNonces: true });
    assert.equal(
      sh.cspForExtra("N0nce==", { "img-src": ["https://cdn.x"] }),
      "default-src 'self'; script-src 'self' 'nonce-N0nce=='; frame-src 'none'; img-src https://cdn.x",
    );
  });
  it("substitue le nonce de la requête dans le fragment mergé", () => {
    const sh = make({ csp: NONCE_CSP, cspNonces: true });
    assert.match(
      sh.cspForExtra("UNIQUE==", { "img-src": ["https://cdn.x"] }),
      /'nonce-UNIQUE=='/,
    );
  });
  it("CSP statique (sans nonce) → extra mergé + résiduel nonce purgé", () => {
    const sh = make({ csp: NONCE_CSP, cspNonces: false });
    assert.equal(
      sh.cspForExtra("", { "frame-src": ["https://youtube.com"] }),
      "default-src 'self'; script-src 'self'; frame-src 'none' https://youtube.com",
    );
  });
  it("base CSP vide + extra → CSP issu du seul fragment de route", () => {
    const sh = make({ csp: "", cspNonces: true });
    assert.equal(
      sh.cspForExtra("", { "frame-src": ["https://youtube.com"] }),
      "frame-src https://youtube.com",
    );
  });
});
