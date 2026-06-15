import assert from "node:assert/strict";
import {
  defineSecurityConfig,
  securityConfigJsonSchema,
} from "../../nodefony/config/defineSecurityConfig";

/**
 * Gates des décisions S0 (réalignement 2026-06-12) — ces tests VERROUILLENT les
 * défauts normatifs : si un futur diff inverse un défaut sûr, la suite casse.
 *
 * Réfs : hybride session BFF (IETF browser-based-apps) · Argon2id minimums OWASP
 * (RFC 9106) · CSRF Fetch Metadata (OWASP 2025) · audience RFC 8707.
 */

describe("defineSecurityConfig — défauts sûrs (S0)", () => {
  const config = defineSecurityConfig({
    areas: { app: { pattern: "^/app" } },
    encoders: { user: {} },
  });

  it("zone : session BFF par défaut (stateless=false) — JWT réservé API", () => {
    assert.equal(config.areas.app.stateless, false);
  });

  it("zone : mode 'first' par défaut (le 1er authenticator qui reconnaît gagne)", () => {
    assert.equal(config.areas.app.mode, "first");
  });

  it("zone : mode 'all' accepté (chaîne complète, ex. mtls+jwt)", () => {
    const c = defineSecurityConfig({
      areas: { admin: { pattern: "^/admin", mode: "all" } },
    });
    assert.equal(c.areas.admin.mode, "all");
  });

  it("zone : Zero Trust par défaut (security=true)", () => {
    assert.equal(config.areas.app.security, true);
  });

  it("zone : realtime=true par défaut (Zero Trust — la zone ferme AUSSI le WS)", () => {
    assert.equal(config.areas.app.realtime, true);
  });

  it("zone : realtime=true accepté (aire data plane, verrou WS Étape 3)", () => {
    const c = defineSecurityConfig({
      areas: {
        nodefonyAdmin: { pattern: "^/nodefony/[^/]+/api(/|$)", realtime: true },
      },
    });
    assert.equal(c.areas.nodefonyAdmin.realtime, true);
  });

  it("encoder : Argon2id par défaut (m=19 MiB OWASP, t=3 RFC 9106, p=1)", () => {
    const enc = config.encoders.user;
    assert.equal(enc.type, "argon2id");
    assert.equal(enc.memoryKiB, 19456);
    // t=3 (> minimum OWASP t=2) : +50 % de coût attaquant sans RAM
    // supplémentaire par hash — bench 2026-06 ~56 ms, cible 50-100 ms.
    assert.equal(enc.timeCost, 3);
    assert.equal(enc.parallelism, 1);
  });

  it("encoder : refuse de descendre sous le minimum OWASP (memoryKiB)", () => {
    assert.throws(() =>
      defineSecurityConfig({
        encoders: { user: { type: "argon2id", memoryKiB: 1024 } },
      }),
    );
  });

  it("encoder : bcrypt reste supporté (legacy)", () => {
    const c = defineSecurityConfig({
      encoders: { user: { type: "bcrypt", rounds: 12 } },
    });
    assert.equal(c.encoders.user.type, "bcrypt");
    assert.equal(c.encoders.user.rounds, 12);
  });

  it("csrf : Fetch Metadata = défense primaire (défaut true) + SameSite Lax", () => {
    assert.equal(config.csrf.fetchMetadata, true);
    assert.equal(config.csrf.sameSite, "Lax");
    assert.equal(config.csrf.checkOrigin, true);
  });

  it("csrf : same-site toléré par défaut (strictSameSite=false) + 0 alias", () => {
    assert.equal(config.csrf.strictSameSite, false);
    assert.deepEqual(config.csrf.trustedOrigins, []);
  });

  it("jwt : audiences RFC 8707 présent (défaut = audience de l'app)", () => {
    assert.deepEqual(config.jwt.audiences, []);
  });

  it("passkeys : présent et actif par défaut (MFA phishing-resistant)", () => {
    assert.equal(config.passkeys.enabled, true);
    assert.equal(config.passkeys.userVerification, "preferred");
  });

  it("tokenExchange : slot présent mais INACTIF (P12 non implémenté)", () => {
    assert.equal(config.tokenExchange.enabled, false);
  });

  it("cors : jamais permissif par défaut (origins vide, credentials false)", () => {
    assert.deepEqual(config.cors.origins, []);
    assert.equal(config.cors.credentials, false);
  });

  it("studio : console OFF par défaut ; requireMfa=false honnête (enforcement MFA pas câblé)", () => {
    assert.equal(config.studio.enabled, false);
    // requireMfa=true mentirait : aucun authenticator MFA n'est codé (anti ✅-menteur,
    // audit 2026-06-13). Le vrai MFA = aire mode:"all" + authenticator WebAuthn (J ultérieur).
    assert.equal(config.studio.requireMfa, false);
  });

  it("studio : plus de clé 'authenticators' (la déclaration d'auth vit dans l'aire, pas ici)", () => {
    assert.equal(
      (config.studio as Record<string, unknown>).authenticators,
      undefined,
    );
  });
});

describe("defineSecurityConfig — validation au boot", () => {
  it("refuse deux zones partageant le même pattern (ambiguïté de match)", () => {
    assert.throws(
      () =>
        defineSecurityConfig({
          areas: {
            a: { pattern: "^/api" },
            b: { pattern: "^/api" },
          },
        }),
      /partagent le pattern/,
    );
  });

  it("refuse un mode de zone inconnu", () => {
    assert.throws(() =>
      defineSecurityConfig({
        // @ts-expect-error — mode invalide volontaire (gate runtime Zod)
        areas: { a: { pattern: "^/x", mode: "any" } },
      }),
    );
  });

  it("gèle la config retournée (immuable au runtime)", () => {
    const c = defineSecurityConfig({});
    assert.equal(Object.isFrozen(c), true);
  });

  it("expose un JSON Schema introspectable (formulaire Studio)", () => {
    const schema = securityConfigJsonSchema() as Record<string, unknown>;
    assert.equal(typeof schema, "object");
    const props = schema.properties as Record<string, unknown>;
    for (const key of [
      "areas",
      "csrf",
      "jwt",
      "passkeys",
      "tokenExchange",
      "studio",
    ]) {
      assert.ok(key in props, `section "${key}" absente du JSON Schema`);
    }
  });
});
