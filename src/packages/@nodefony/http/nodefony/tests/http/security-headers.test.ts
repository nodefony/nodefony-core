/// <reference types="node" />
import { expect } from "vitest";
import http from "node:http";

/**
 * En-têtes de sécurité (P6 J5) — banc d'INTÉGRATION RÉEL (port 5151). Prouve la
 * SÉPARATION transport/applicatif sur une vraie réponse :
 *  - socle TRANSPORT (@nodefony/http, posé sur toute réponse) : nosniff, frame-options ;
 *  - APPLICATIF (@nodefony/security, pipeline) : CSP, Referrer-Policy, COOP/CORP,
 *    Permissions-Policy (avancés activés côté module test).
 * Le socle transport couvre AUSSI les erreurs (404) ; l'applicatif est sur le pipeline.
 */

const BASE = { hostname: "localhost", port: 5151 };

function head(
  path: string,
): Promise<Record<string, string | string[] | undefined>> {
  return new Promise((resolve, reject) => {
    const r = http.request({ ...BASE, method: "GET", path }, (res) => {
      res.on("data", () => {});
      res.on("end", () => resolve(res.headers));
    });
    r.on("error", reject);
    r.end();
  });
}

describe("Security headers — socle transport (http) + applicatif (security)", () => {
  it("TRANSPORT : X-Content-Type-Options + X-Frame-Options sur une réponse normale", async () => {
    const h = await head("/nodefony/test/index");
    expect(h["x-content-type-options"]).to.equal("nosniff");
    expect(h["x-frame-options"]).to.be.a("string");
  });

  it("TRANSPORT : présent AUSSI sur une erreur 404 (hors pipeline applicatif)", async () => {
    const h = await head("/nodefony/test/__does_not_exist__");
    expect(h["x-content-type-options"]).to.equal("nosniff");
  });

  it("APPLICATIF : Content-Security-Policy posé par security", async () => {
    const h = await head("/nodefony/test/index");
    expect(h["content-security-policy"]).to.be.a("string");
  });

  it("APPLICATIF : Referrer-Policy posé par security", async () => {
    const h = await head("/nodefony/test/index");
    expect(h["referrer-policy"]).to.equal("no-referrer");
  });

  it("APPLICATIF : COOP / CORP sur une page (avancés opt-in activés côté test)", async () => {
    const h = await head("/nodefony/test/html");
    expect(h["cross-origin-opener-policy"]).to.equal("same-origin");
    expect(h["cross-origin-resource-policy"]).to.equal("same-origin");
  });

  it("APPLICATIF : Permissions-Policy posé sur un DOCUMENT (page HTML)", async () => {
    const h = await head("/nodefony/test/html");
    expect(h["permissions-policy"]).to.contain("camera=()");
  });

  it("PAS de COEP (require-corp non activé → assets tiers non cassés)", async () => {
    const h = await head("/nodefony/test/index");
    expect(h["cross-origin-embedder-policy"]).to.equal(undefined);
  });
});

describe("Portée — la politique suit le type de la réponse (ADR-0024 §C11)", () => {
  /** Politique courte attendue : l'encadrement suit `X-Frame-Options` (§C5). */
  const narrow = (h: Record<string, string | string[] | undefined>): string => {
    const xfo = String(h["x-frame-options"] ?? "").toUpperCase();
    const ancestors =
      xfo === "DENY" ? "'none'" : xfo === "SAMEORIGIN" ? "'self'" : null;
    return ancestors === null
      ? "default-src 'none'"
      : `default-src 'none'; frame-ancestors ${ancestors}`;
  };

  it("JSON : politique courte, sans nonce ni Permissions-Policy", async () => {
    const h = await head("/nodefony/test/index");
    expect(h["content-type"]).to.match(/^application\/json/);
    expect(h["content-security-policy"]).to.equal(narrow(h));
    expect(h["permissions-policy"]).to.equal(undefined);
    // COOP n'est lu que sur un document ; CORP est l'en-tête des ressources.
    expect(h["cross-origin-opener-policy"]).to.equal(undefined);
    expect(h["cross-origin-resource-policy"]).to.equal("same-origin");
    expect(h["referrer-policy"]).to.equal("no-referrer");
  });

  it("HTML : politique complète avec nonce", async () => {
    const h = await head("/nodefony/test/html");
    expect(h["content-type"]).to.match(/^text\/html/);
    expect(h["content-security-policy"]).to.match(
      /script-src 'nonce-[^']+' 'strict-dynamic' 'self'/,
    );
  });

  it("HTML statique : sans nonce ni 'strict-dynamic', 'self' décide (ADR-0024 §C1)", async () => {
    // Le fichier n'est passé par aucun gabarit : sous 'strict-dynamic', ses
    // `<script src>` same-origin seraient bloqués faute de nonce.
    const h = await head("/test/static-page.html");
    expect(h["content-type"]).to.match(/^text\/html/);
    const csp = String(h["content-security-policy"]);
    expect(csp).to.match(/script-src 'self'/);
    expect(csp).to.not.contain("nonce");
    expect(csp).to.not.contain("strict-dynamic");
    // C'est un document : ses en-têtes de document restent.
    expect(h["permissions-policy"]).to.not.equal(undefined);
  });

  it("JavaScript : politique complète SANS nonce", async () => {
    const h = await head("/nodefony/test/debugbar.js");
    expect(h["content-type"]).to.match(/^text\/javascript/);
    const csp = String(h["content-security-policy"]);
    expect(csp).to.match(/script-src /);
    expect(csp).to.not.contain("nonce");
    expect(h["permissions-policy"]).to.equal(undefined);
  });

  it("204 sans contenu : politique courte", async () => {
    const h = await head("/nodefony/test/nocontent");
    expect(h["content-security-policy"]).to.equal(narrow(h));
  });

  it("fichier statique (média) : politique courte", async () => {
    const h = await head("/test/oceans-clip.webm");
    expect(h["content-type"]).to.match(/^video\/webm/);
    expect(h["content-security-policy"]).to.equal(narrow(h));
  });
});

describe("CSP per-route (@Csp) — directives additionnelles fusionnées", () => {
  it("@Csp ajoute frame-src ET complète img-src de la route décorée", async () => {
    const h = await head("/nodefony/test/csp-embed");
    const csp = h["content-security-policy"] as string;
    // frame-src ABSENTE de la base → ajoutée par @Csp.
    expect(csp).to.contain("frame-src https://www.youtube.com");
    // img-src existe dans la base ('self' data: blob: + origines Vite en dev) → la
    // source de la route est AJOUTÉE à CETTE directive (pas une 2ᵉ img-src dupliquée).
    expect(csp).to.match(/img-src[^;]*\bhttps:\/\/cdn\.example\.test\b/);
    expect(csp.match(/(?:^|;)\s*img-src\b/g)).to.have.lengthOf(1);
    // Base préservée + nonce/req toujours substitué (régime étape B inchangé).
    expect(csp).to.contain("default-src 'self'");
    expect(csp).to.match(/script-src 'nonce-[^']+' 'strict-dynamic' 'self'/);
  });

  it("ISOLATION : une route SANS @Csp ne porte PAS les directives de la route décorée", async () => {
    const csp = (await head("/nodefony/test/index"))[
      "content-security-policy"
    ] as string;
    expect(csp).to.not.contain("https://www.youtube.com");
    expect(csp).to.not.contain("https://cdn.example.test");
  });

  it("nonce per-requête conservé : 2 requêtes @Csp → 2 nonces différents", async () => {
    const grab = async () => {
      const csp = (await head("/nodefony/test/csp-embed"))[
        "content-security-policy"
      ] as string;
      return /'nonce-([^']+)'/.exec(csp)?.[1];
    };
    const [a, b] = await Promise.all([grab(), grab()]);
    expect(a).to.be.a("string");
    expect(a).to.not.equal(b);
  });
});
