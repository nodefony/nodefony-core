import assert from "node:assert/strict";
import {
  Csrf,
  type ICsrfOptions,
  type ICsrfRequest,
} from "../../nodefony/service/csrf";
import { CsrfError } from "../../nodefony/errors/CsrfError";

/**
 * Défense CSRF (P6 J5) — matrice de décision de la logique PURE `Csrf.enforce`.
 * Fetch Metadata d'abord (Sec-Fetch-Site, infalsifiable), repli Origin/Referer,
 * cohérence avec la whitelist CORS, exemption des méthodes sûres (RFC 9110).
 */

const DEFAULTS: ICsrfOptions = {
  enabled: true,
  fetchMetadata: true,
  checkOrigin: true,
  strictSameSite: false,
};

const make = (
  o: ICsrfOptions = DEFAULTS,
  origins: readonly string[] = [],
): Csrf => new Csrf(o, origins);

const req = (p: Partial<ICsrfRequest> = {}): ICsrfRequest => ({
  method: "POST",
  secFetchSite: undefined,
  origin: undefined,
  referer: undefined,
  host: "app.example.com",
  ...p,
});

const ok = (c: Csrf, r: ICsrfRequest) =>
  assert.doesNotThrow(() => c.enforce(r));
const blocked = (c: Csrf, r: ICsrfRequest) =>
  assert.throws(() => c.enforce(r), CsrfError);

describe("Csrf — méthodes sûres (RFC 9110 §9.2.1)", () => {
  const c = make();
  for (const method of ["GET", "HEAD", "OPTIONS", "TRACE", "get"]) {
    it(`${method} : jamais bloqué, même cross-site`, () => {
      ok(
        c,
        req({ method, secFetchSite: "cross-site", origin: "https://evil.com" }),
      );
    });
  }
  it("méthode absente : no-op", () => {
    ok(c, req({ method: null, secFetchSite: "cross-site" }));
  });
});

describe("Csrf — Fetch Metadata (défense primaire)", () => {
  const c = make();
  it("same-origin → autorisé", () =>
    ok(c, req({ secFetchSite: "same-origin" })));
  it("none (navigation directe / non-navigateur) → autorisé", () =>
    ok(c, req({ secFetchSite: "none" })));
  it("same-site + tolérant (défaut) → autorisé", () =>
    ok(c, req({ secFetchSite: "same-site" })));
  it("cross-site → BLOQUÉ (403)", () =>
    blocked(c, req({ secFetchSite: "cross-site" })));
  it("casse exacte respectée : 'Cross-Site' inconnu → tombe au repli (origin same-host)", () =>
    ok(
      c,
      req({ secFetchSite: "Cross-Site", origin: "https://app.example.com" }),
    ));
});

describe("Csrf — strictSameSite", () => {
  it("same-site + strict → BLOQUÉ", () => {
    const c = make({ ...DEFAULTS, strictSameSite: true });
    blocked(c, req({ secFetchSite: "same-site" }));
  });
  it("same-origin reste autorisé même en strict", () => {
    const c = make({ ...DEFAULTS, strictSameSite: true });
    ok(c, req({ secFetchSite: "same-origin" }));
  });
});

describe("Csrf — origines de confiance (alias multi-domaine ∪ CORS)", () => {
  // Le firewall passe l'union trustedOrigins ∪ cors.origins via `allowedOrigins`.
  const c = make(DEFAULTS, [
    "https://app.example.org",
    "https://trusted.partner.com",
  ]);
  it("alias cross-site déclaré → autorisé MALGRÉ Sec-Fetch-Site: cross-site", () =>
    ok(
      c,
      req({ secFetchSite: "cross-site", origin: "https://app.example.org" }),
    ));
  it("alias cross-site déclaré → autorisé aussi via Referer (fallback)", () =>
    ok(c, req({ referer: "https://app.example.org/form" })));
  it("origine CORS de confiance → autorisée malgré cross-site", () =>
    ok(
      c,
      req({
        secFetchSite: "cross-site",
        origin: "https://trusted.partner.com",
      }),
    ));
  it("origine NON déclarée + cross-site → BLOQUÉ", () =>
    blocked(
      c,
      req({ secFetchSite: "cross-site", origin: "https://evil.com" }),
    ));
});

describe("Csrf — repli Origin/Referer (vieux navigateurs sans Sec-Fetch-*)", () => {
  const c = make();
  it("Origin same-host → autorisé", () =>
    ok(c, req({ origin: "https://app.example.com" })));
  it("Origin host différent → BLOQUÉ", () =>
    blocked(c, req({ origin: "https://evil.com" })));
  it("Referer (Origin absent) same-host → autorisé", () =>
    ok(c, req({ referer: "https://app.example.com/page" })));
  it("Referer host différent → BLOQUÉ", () =>
    blocked(c, req({ referer: "https://evil.com/attack" })));
  it("ni Origin ni Referer (client non-navigateur) → autorisé", () =>
    ok(c, req({})));
  it("Origin PRÉSENT mais illisible → BLOQUÉ (fail-closed : pas same-host)", () =>
    blocked(c, req({ origin: "::::garbage" })));
});

describe("Csrf — fetchMetadata désactivé", () => {
  const c = make({ ...DEFAULTS, fetchMetadata: false });
  it("ignore Sec-Fetch-Site, applique le repli (origin cross → 403)", () =>
    blocked(
      c,
      req({ secFetchSite: "same-origin", origin: "https://evil.com" }),
    ));
});

describe("Csrf — checkOrigin désactivé (Fetch Metadata seul)", () => {
  const c = make({ ...DEFAULTS, checkOrigin: false });
  it("Sec-Fetch-Site inconnu + pas de repli → autorisé (rien d'autre à vérifier)", () =>
    ok(c, req({ secFetchSite: "weird-value", origin: "https://evil.com" })));
  it("cross-site reste bloqué (la primaire tranche avant le repli)", () =>
    blocked(c, req({ secFetchSite: "cross-site" })));
});

describe("Csrf.isStateChanging (court-circuit hot-path)", () => {
  it("GET/HEAD/OPTIONS/TRACE → false", () => {
    for (const m of ["GET", "HEAD", "OPTIONS", "TRACE", "get"])
      assert.equal(Csrf.isStateChanging(m), false);
  });
  it("POST/PUT/PATCH/DELETE → true", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "post"])
      assert.equal(Csrf.isStateChanging(m), true);
  });
  it("null/undefined → false", () => {
    assert.equal(Csrf.isStateChanging(null), false);
    assert.equal(Csrf.isStateChanging(undefined), false);
  });
});
