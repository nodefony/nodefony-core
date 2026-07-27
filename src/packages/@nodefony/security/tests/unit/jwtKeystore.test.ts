import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculateJwkThumbprint } from "jose";
import { JwtKeystore } from "../../nodefony/src/token/JwtKeystore";

/**
 * Keystore Ed25519 — gates :
 * - kid = thumbprint RFC 7638 du JWK public.
 * - JWKS exposé = PUBLIC seulement (jamais `d`) — RFC 8037/7517.
 * - persistance fichier : mode 600 appliqué OU annoncé (le disque peut l'ignorer)
 *   + rechargement du MÊME kid (refresh durables).
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
  it("génère keyset.json (mode 600 constaté ou annoncé, avec `d`) puis recharge le MÊME kid", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nf-jwt-"));
    try {
      const warns: string[] = [];
      const ks1 = new JwtKeystore({ dir }, (m, s) => {
        if (s === "WARNING") warns.push(m);
      });
      const k1 = await ks1.getSigningKey();
      const file = join(dir, "keyset.json");
      // Le mode POSIX est une INTENTION : NTFS l'ignore (le job Windows rendait
      // 0666), tout comme un montage FAT/exFAT ou NFS sans mapping. La garantie
      // testée est donc : soit la restriction a pris, soit elle est ANNONCÉE.
      const mode = statSync(file).mode & 0o777;
      const told = warns.filter((w) => /PAS restreint/.test(w));
      if (mode === 0o600) {
        assert.equal(
          told.length,
          0,
          "mode 600 effectif → aucun avertissement de restriction",
        );
      } else {
        assert.equal(
          told.length,
          1,
          `mode ${mode.toString(8)} non restreint → doit avertir exactement une fois`,
        );
        assert.match(told[0]!, /clé PRIVÉE/);
        assert.match(
          told[0]!,
          /keySetJson/,
          "l'avertissement doit dire la sortie",
        );
      }
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

  // Fait MORDRE le bras « avertissement » sur les TROIS plateformes : sous POSIX
  // le 0644 demandé est appliqué, sous Windows NTFS rend 0666 — dans les deux
  // cas le fichier n'est pas restreint au propriétaire, et le keystore doit le
  // dire au lieu de charger la clé privée en silence.
  it("keyset déposé avec des droits trop larges → avertit au CHARGEMENT", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nf-jwt-"));
    try {
      await new JwtKeystore({ dir }, noop).getSigningKey(); // génère le fichier
      const file = join(dir, "keyset.json");
      chmodSync(file, 0o644);
      assert.notEqual(
        statSync(file).mode & 0o777,
        0o600,
        "décor invalide : le fichier est resté restreint",
      );

      const warns: string[] = [];
      const ks = new JwtKeystore({ dir }, (m, s) => {
        if (s === "WARNING") warns.push(m);
      });
      await ks.getSigningKey();
      assert.equal(
        warns.filter((w) => /PAS restreint/.test(w)).length,
        1,
        "un keyset lisible par d'autres comptes doit être signalé",
      );
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
