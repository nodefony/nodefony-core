import assert from "node:assert/strict";
import { Argon2idEncoder } from "../../index";

// Coûts plancher pour des tests rapides (~1 ms/hash) — la logique testée est
// indépendante du coût ; la politique OWASP vit dans les défauts + config Zod.
const FAST = { memoryKiB: 64, timeCost: 1, parallelism: 1 };

describe("Argon2idEncoder (P6 J2)", () => {
  describe("constructor — validation des coûts", () => {
    it("expose les défauts (m=19 MiB OWASP, t=3 RFC 9106, p=1)", () => {
      const enc = new Argon2idEncoder();
      assert.equal(enc.memoryKiB, 19456);
      assert.equal(enc.timeCost, 3);
      assert.equal(enc.parallelism, 1);
    });

    it("accepte des coûts valides et les expose", () => {
      const enc = new Argon2idEncoder(FAST);
      assert.equal(enc.memoryKiB, 64);
      assert.equal(enc.timeCost, 1);
      assert.equal(enc.parallelism, 1);
    });

    it("rejette les bornes techniques violées", () => {
      assert.throws(() => new Argon2idEncoder({ timeCost: 0 }), RangeError);
      assert.throws(() => new Argon2idEncoder({ timeCost: 1.5 }), RangeError);
      assert.throws(() => new Argon2idEncoder({ parallelism: 0 }), RangeError);
      assert.throws(
        () => new Argon2idEncoder({ parallelism: 256 }),
        RangeError,
      );
      // m < 8×p (RFC 9106 : 8 blocs par lane minimum)
      assert.throws(
        () => new Argon2idEncoder({ memoryKiB: 8, parallelism: 2 }),
        RangeError,
      );
      assert.throws(() => new Argon2idEncoder({ memoryKiB: 7 }), RangeError);
    });
  });

  describe("hash / verify", () => {
    it("produit un hash PHC argon2id avec les coûts demandés", async () => {
      const hash = await new Argon2idEncoder(FAST).hash("s3cret");
      assert.match(hash, /^\$argon2id\$v=19\$m=64,t=1,p=1\$/);
    });

    it("verify true pour le bon mot de passe, false sinon", async () => {
      const enc = new Argon2idEncoder(FAST);
      const hash = await enc.hash("s3cret");
      assert.equal(await enc.verify("s3cret", hash), true);
      assert.equal(await enc.verify("wrong", hash), false);
    });

    it("deux hashs du même clair diffèrent (sel aléatoire)", async () => {
      const enc = new Argon2idEncoder(FAST);
      const [a, b] = await Promise.all([enc.hash("x"), enc.hash("x")]);
      assert.notEqual(a, b);
    });

    it("verify lit les coûts DANS le hash (vieux hash vérifiable par encoder fort)", async () => {
      const old = await new Argon2idEncoder(FAST).hash("s3cret");
      const strong = new Argon2idEncoder({ ...FAST, timeCost: 2 });
      assert.equal(await strong.verify("s3cret", old), true);
    });
  });

  describe("supports", () => {
    it("reconnaît tous les variants argon2, rejette le reste", () => {
      const enc = new Argon2idEncoder(FAST);
      assert.equal(enc.supports("$argon2id$v=19$m=64,t=1,p=1$abc$def"), true);
      assert.equal(enc.supports("$argon2i$v=19$m=64,t=1,p=1$abc$def"), true);
      assert.equal(enc.supports("$argon2d$v=19$m=64,t=1,p=1$abc$def"), true);
      assert.equal(enc.supports("$2b$12$abcdefghijklmnopqrstuv"), false);
      assert.equal(enc.supports("plaintext"), false);
      assert.equal(enc.supports(""), false);
    });
  });

  describe("needsRehash", () => {
    it("false quand variant/version/coûts sont à jour", async () => {
      const enc = new Argon2idEncoder(FAST);
      assert.equal(enc.needsRehash(await enc.hash("x")), false);
    });

    it("true quand un coût stocké < coût courant (upgrade)", async () => {
      const stored = await new Argon2idEncoder(FAST).hash("x");
      const moreMemory = new Argon2idEncoder({ ...FAST, memoryKiB: 128 });
      const morePasses = new Argon2idEncoder({ ...FAST, timeCost: 2 });
      assert.equal(moreMemory.needsRehash(stored), true);
      assert.equal(morePasses.needsRehash(stored), true);
    });

    it("false quand les coûts stockés > courants (jamais de downgrade)", () => {
      const enc = new Argon2idEncoder(FAST);
      assert.equal(
        enc.needsRehash("$argon2id$v=19$m=19456,t=3,p=4$abc$def"),
        false,
      );
    });

    it("true pour un variant non-id ou une version antérieure", () => {
      const enc = new Argon2idEncoder(FAST);
      assert.equal(enc.needsRehash("$argon2i$v=19$m=64,t=1,p=1$a$b"), true);
      assert.equal(enc.needsRehash("$argon2d$v=19$m=64,t=1,p=1$a$b"), true);
      assert.equal(enc.needsRehash("$argon2id$v=16$m=64,t=1,p=1$a$b"), true);
    });

    it("true pour un hash de format inconnu / non argon2", () => {
      const enc = new Argon2idEncoder(FAST);
      assert.equal(enc.needsRehash("$2b$12$abcdefghijklmnopqrstuv"), true);
      assert.equal(enc.needsRehash("plaintext"), true);
      assert.equal(enc.needsRehash(""), true);
    });
  });
});
