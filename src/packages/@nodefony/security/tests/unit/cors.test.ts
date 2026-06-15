import assert from "node:assert/strict";
import { Cors, type ICorsOptions } from "../../nodefony/service/cors";

/**
 * Politique CORS (P6 J5) — matrice de la logique PURE (Fetch Standard) : reflet
 * d'origine vs `*`, credentials, en-têtes preflight vs requête réelle, origine
 * refusée, `Vary: Origin`. Invariant OWASP `*`+credentials interdit au boot (Zod).
 */

const base: ICorsOptions = {
  enabled: true,
  origins: [],
  credentials: false,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "X-Requested-With"],
  exposedHeaders: [],
  maxAgeS: 600,
};
const make = (o: Partial<ICorsOptions> = {}): Cors =>
  new Cors({ ...base, ...o });

const SELF = "https://app.example.com";

describe("Cors — whitelist (origine de confiance reflétée)", () => {
  const c = make({ origins: [SELF] });
  it("preflight origine autorisée → en-têtes complets + Vary: Origin", () => {
    const h = c.preflightHeaders(SELF);
    assert.ok(h);
    assert.equal(h["Access-Control-Allow-Origin"], SELF);
    assert.equal(h["Access-Control-Allow-Methods"], base.methods.join(", "));
    assert.equal(
      h["Access-Control-Allow-Headers"],
      base.allowedHeaders.join(", "),
    );
    assert.equal(h["Access-Control-Max-Age"], "600");
    assert.equal(h["Vary"], "Origin");
    assert.equal(h["Access-Control-Allow-Credentials"], undefined);
  });
  it("preflight origine NON autorisée → null (réponse non partageable)", () => {
    assert.equal(c.preflightHeaders("https://evil.com"), null);
  });
  it("requête réelle origine autorisée → Allow-Origin + Vary", () => {
    const h = c.actualHeaders(SELF);
    assert.ok(h);
    assert.equal(h["Access-Control-Allow-Origin"], SELF);
    assert.equal(h["Vary"], "Origin");
  });
  it("requête réelle origine NON autorisée → null", () => {
    assert.equal(c.actualHeaders("https://evil.com"), null);
  });
});

describe("Cors — wildcard sans credentials", () => {
  const c = make({ origins: ["*"] });
  it("preflight → Allow-Origin '*' SANS Vary", () => {
    const h = c.preflightHeaders("https://anything.com");
    assert.ok(h);
    assert.equal(h["Access-Control-Allow-Origin"], "*");
    assert.equal(h["Vary"], undefined);
  });
  it("requête réelle → Allow-Origin '*'", () => {
    const h = c.actualHeaders("https://anything.com");
    assert.equal(h?.["Access-Control-Allow-Origin"], "*");
  });
});

describe("Cors — credentials (reflet obligatoire, jamais '*')", () => {
  const c = make({ origins: [SELF], credentials: true });
  it("preflight → origine reflétée + Allow-Credentials true + Vary", () => {
    const h = c.preflightHeaders(SELF);
    assert.ok(h);
    assert.equal(h["Access-Control-Allow-Origin"], SELF);
    assert.equal(h["Access-Control-Allow-Credentials"], "true");
    assert.equal(h["Vary"], "Origin");
  });
  it("wildcard + credentials → reflète l'origine (jamais '*')", () => {
    const wc = make({ origins: ["*"], credentials: true });
    const h = wc.actualHeaders("https://x.com");
    assert.equal(h?.["Access-Control-Allow-Origin"], "https://x.com");
    assert.equal(h?.["Access-Control-Allow-Credentials"], "true");
  });
});

describe("Cors — exposedHeaders", () => {
  it("requête réelle expose les en-têtes configurés", () => {
    const c = make({
      origins: [SELF],
      exposedHeaders: ["X-Total-Count", "ETag"],
    });
    const h = c.actualHeaders(SELF);
    assert.equal(h?.["Access-Control-Expose-Headers"], "X-Total-Count, ETag");
  });
  it("preflight n'expose PAS (Expose-Headers = requête réelle only)", () => {
    const c = make({ origins: [SELF], exposedHeaders: ["X-Total-Count"] });
    assert.equal(
      c.preflightHeaders(SELF)?.["Access-Control-Expose-Headers"],
      undefined,
    );
  });
});

describe("Cors.reflectsOrigin", () => {
  const c = make();
  it("'*' ne reflète pas (pas de Vary)", () =>
    assert.equal(c.reflectsOrigin("*"), false));
  it("une origine concrète reflète (⇒ Vary)", () =>
    assert.equal(c.reflectsOrigin(SELF), true));
});
