import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculateJwkThumbprint } from "jose";
import { JwtKeystore } from "../../nodefony/src/token/JwtKeystore";

/**
 * Keystore Ed25519 — gates :
 * - kid = thumbprint RFC 7638 du JWK public.
 * - JWKS exposé = PUBLIC seulement (jamais `d`) — RFC 8037/7517.
 * - persistance fichier (chmod 600) + rechargement du MÊME kid (refresh durables).
 * - source env (keySetJson) + erreurs explicites.
 */

const noop = (): void => {};

describe("JwtKeystore — mémoire (défaut dev)", () => {
  it("génère une clé, JWKS public SANS `d`, kid = thumbprint 7638, warning éphémère", async () => {
    const warns: string[] = [];
    const ks = new JwtKeystore({}, (m, s) => {
      if (s === "WARNING") warns.push(m);
    });
    const signing = await ks.getSigningKey();
    assert.equal(signing.alg, "EdDSA");
    assert.ok(signing.kid.length > 0);
    assert.ok(signing.key);

    const jwks = await ks.getPublicJWKS();
    assert.equal(jwks.keys.length, 1);
    const jwk = jwks.keys[0]!;
    assert.equal(jwk.kty, "OKP");
    assert.equal(jwk.crv, "Ed25519");
    assert.equal(jwk.use, "sig");
    assert.equal(jwk.alg, "EdDSA");
    assert.equal(jwk.kid, signing.kid);
    assert.equal(
      (jwk as { d?: string }).d,
      undefined,
      "le JWKS public ne doit JAMAIS porter la clé privée `d`",
    );

    const expected = await calculateJwkThumbprint(
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x } as Parameters<
        typeof calculateJwkThumbprint
      >[0],
      "sha256",
    );
    assert.equal(signing.kid, expected, "kid doit être le thumbprint RFC 7638");
    assert.ok(
      warns.some((w) => /éphémère/i.test(w)),
      "le mode mémoire doit avertir (refresh non durables)",
    );
  });

  it("mémoïsation : deux résolutions concurrentes → un seul keyset", async () => {
    const ks = new JwtKeystore({}, noop);
    const [a, b] = await Promise.all([ks.getSigningKey(), ks.getSigningKey()]);
    assert.equal(a.kid, b.kid);
  });
});

describe("JwtKeystore — fichier (opt-in)", () => {
  it("génère keyset.json (chmod 600, avec `d`) puis recharge le MÊME kid", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nf-jwt-"));
    try {
      const ks1 = new JwtKeystore({ dir }, noop);
      const k1 = await ks1.getSigningKey();
      const file = join(dir, "keyset.json");
      assert.equal(
        statSync(file).mode & 0o777,
        0o600,
        "keyset.json doit être en 0600",
      );
      const raw = JSON.parse(readFileSync(file, "utf8")) as {
        active: string;
        keys: Array<{ d?: string }>;
      };
      assert.equal(raw.active, k1.kid);
      assert.ok(raw.keys[0]!.d, "le fichier porte la clé PRIVÉE (`d`)");

      // 2e keystore depuis le même dossier → recharge sans régénérer.
      const ks2 = new JwtKeystore({ dir }, noop);
      const k2 = await ks2.getSigningKey();
      assert.equal(k2.kid, k1.kid, "même clé rechargée (refresh durables)");
      const jwks2 = await ks2.getPublicJWKS();
      assert.equal((jwks2.keys[0] as { d?: string }).d, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("JwtKeystore — env (keySetJson) + erreurs", () => {
  it("charge un keyset JSON injecté (kid stable)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nf-jwt-"));
    let keySetJson: string;
    let kid: string;
    try {
      const seed = new JwtKeystore({ dir }, noop);
      kid = (await seed.getSigningKey()).kid;
      keySetJson = readFileSync(join(dir, "keyset.json"), "utf8");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const ks = new JwtKeystore({ keySetJson }, noop);
    assert.equal((await ks.getSigningKey()).kid, kid);
  });

  it("keyset JSON invalide / vide → throw explicite", async () => {
    await assert.rejects(
      () => new JwtKeystore({ keySetJson: "{ not json" }, noop).getSigningKey(),
      /keyset JSON invalide/,
    );
    await assert.rejects(
      () =>
        new JwtKeystore(
          { keySetJson: JSON.stringify({ keys: [] }) },
          noop,
        ).getSigningKey(),
      /malformé/,
    );
  });
});
