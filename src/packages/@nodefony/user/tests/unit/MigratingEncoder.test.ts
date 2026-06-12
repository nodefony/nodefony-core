import assert from "node:assert/strict";
import { Argon2idEncoder, BcryptEncoder, MigratingEncoder } from "../../index";

// Coûts plancher — la logique de ROUTAGE testée est indépendante du coût.
const FAST_ARGON = { memoryKiB: 64, timeCost: 1, parallelism: 1 };
const FAST_BCRYPT = 4;

const composite = () =>
  new MigratingEncoder(new Argon2idEncoder(FAST_ARGON), [
    new BcryptEncoder(FAST_BCRYPT),
  ]);

describe("MigratingEncoder (P6 J2)", () => {
  describe("hash", () => {
    it("produit TOUJOURS le format du principal (jamais legacy)", async () => {
      const hash = await composite().hash("s3cret");
      assert.match(hash, /^\$argon2id\$/);
    });
  });

  describe("verify — routage par format", () => {
    it("vérifie un hash au format principal (argon2id)", async () => {
      const enc = composite();
      const hash = await enc.hash("s3cret");
      assert.equal(await enc.verify("s3cret", hash), true);
      assert.equal(await enc.verify("wrong", hash), false);
    });

    it("vérifie un hash legacy (bcrypt) pendant la migration", async () => {
      const legacyHash = await new BcryptEncoder(FAST_BCRYPT).hash("s3cret");
      const enc = composite();
      assert.equal(await enc.verify("s3cret", legacyHash), true);
      assert.equal(await enc.verify("wrong", legacyHash), false);
    });

    it("false (sans throw) pour un format inconnu de tous", async () => {
      const enc = composite();
      assert.equal(await enc.verify("s3cret", "plaintext"), false);
      assert.equal(await enc.verify("s3cret", ""), false);
    });
  });

  describe("supports", () => {
    it("union des formats du principal et des legacy", () => {
      const enc = composite();
      assert.equal(enc.supports("$argon2id$v=19$m=64,t=1,p=1$a$b"), true);
      assert.equal(enc.supports("$2b$04$abcdefghijklmnopqrstuv"), true);
      assert.equal(enc.supports("plaintext"), false);
    });
  });

  describe("needsRehash — moteur de la migration", () => {
    it("true pour tout hash qui n'est pas au format principal", async () => {
      const legacyHash = await new BcryptEncoder(FAST_BCRYPT).hash("x");
      assert.equal(composite().needsRehash(legacyHash), true);
      assert.equal(composite().needsRehash("unknown-format"), true);
    });

    it("délègue au principal pour un hash déjà à son format", async () => {
      const enc = composite();
      const fresh = await enc.hash("x");
      assert.equal(enc.needsRehash(fresh), false);
      // hash argon2id produit avec un coût inférieur → le principal juge obsolète
      const weak = await new Argon2idEncoder({
        ...FAST_ARGON,
        timeCost: 1,
      }).hash("x");
      const stronger = new MigratingEncoder(
        new Argon2idEncoder({ ...FAST_ARGON, timeCost: 2 }),
        [new BcryptEncoder(FAST_BCRYPT)],
      );
      assert.equal(stronger.needsRehash(weak), true);
    });
  });
});
