import assert from "node:assert/strict";
import {
  generateApiKey,
  parseApiKey,
  hashApiKey,
  looksLikeApiKey,
} from "../../nodefony/src/apikey/apiKeyFormat";

/**
 * Format des clés API (PAT) — logique pure. Cible : la **forme** est un rempart
 * (rejet O(1) sans store, anti-DoS) et le secret 256 bits n'apparaît qu'une fois.
 * Indices du token `nf_<pubid(8)><secret(43)><crc(6)>` : prefix 0-2, pubid 3-10,
 * secret 11-53, crc 54-59.
 */

describe("apiKeyFormat — génération", () => {
  it("format <prefix>_<body=57> avec un seul séparateur", () => {
    const g = generateApiKey("nf");
    assert.ok(g.token.startsWith("nf_"));
    assert.equal(g.token.length, "nf_".length + 57);
    assert.equal(g.pubid.length, 8);
    assert.equal(g.publicPrefix, `nf_${g.pubid}`);
  });

  it("secretHash = sha256 hex du token entier", () => {
    const g = generateApiKey("nf");
    assert.equal(g.secretHash, hashApiKey(g.token));
    assert.match(g.secretHash, /^[0-9a-f]{64}$/);
  });

  it("haute entropie : deux clés diffèrent (token ET hash)", () => {
    const a = generateApiKey("nf");
    const b = generateApiKey("nf");
    assert.notEqual(a.token, b.token);
    assert.notEqual(a.secretHash, b.secretHash);
  });

  it("préfixe custom respecté", () => {
    assert.ok(generateApiKey("acme").token.startsWith("acme_"));
  });
});

describe("apiKeyFormat — parse (round-trip)", () => {
  it("une clé générée se reparse, secretHash/pubid cohérents", () => {
    const g = generateApiKey("nf");
    const p = parseApiKey(g.token, "nf");
    assert.ok(p);
    assert.equal(p!.secretHash, g.secretHash);
    assert.equal(p!.pubid, g.pubid);
    assert.equal(p!.publicPrefix, g.publicPrefix);
  });
});

describe("apiKeyFormat — rejets de forme (anti-DoS : aucun store touché)", () => {
  it("préfixe absent → null", () => {
    assert.equal(parseApiKey("garbage", "nf"), null);
    assert.equal(parseApiKey("", "nf"), null);
  });

  it("mauvais préfixe → null", () => {
    const g = generateApiKey("nf");
    assert.equal(parseApiKey(g.token, "acme"), null);
  });

  it("longueur invalide (tronqué / rallongé) → null", () => {
    const g = generateApiKey("nf");
    assert.equal(parseApiKey(g.token.slice(0, -1), "nf"), null);
    assert.equal(parseApiKey(`${g.token}x`, "nf"), null);
  });

  it("charset non base64url (point injecté) → null", () => {
    const g = generateApiKey("nf");
    const tampered = `${g.token.slice(0, 11)}.${g.token.slice(12)}`;
    assert.equal(tampered.length, g.token.length);
    assert.equal(parseApiKey(tampered, "nf"), null);
  });

  it("CRC altéré (1 caractère du secret flippé) → null", () => {
    const g = generateApiKey("nf");
    const i = 30; // dans le secret (11..53)
    const swap = g.token[i] === "A" ? "B" : "A";
    const tampered = `${g.token.slice(0, i)}${swap}${g.token.slice(i + 1)}`;
    assert.notEqual(tampered, g.token);
    assert.equal(tampered.length, g.token.length);
    assert.equal(parseApiKey(tampered, "nf"), null);
  });
});

describe("apiKeyFormat — discriminant bon marché", () => {
  it("looksLikeApiKey : préfixe seul (un JWT a.b.c n'est jamais une clé)", () => {
    assert.equal(looksLikeApiKey("nf_xxx", "nf"), true);
    assert.equal(looksLikeApiKey("abc.def.ghi", "nf"), false);
    assert.equal(looksLikeApiKey("nfx", "nf"), false);
  });

  it("hashApiKey : déterministe, 64 hex", () => {
    assert.equal(hashApiKey("nf_abc"), hashApiKey("nf_abc"));
    assert.match(hashApiKey("x"), /^[0-9a-f]{64}$/);
  });
});
