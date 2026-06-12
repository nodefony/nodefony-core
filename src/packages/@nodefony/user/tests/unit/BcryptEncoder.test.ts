import assert from "node:assert/strict";
import { BcryptEncoder } from "../../index";

// Coût bas pour des tests rapides — la logique testée est indépendante du coût.
const FAST = 4;

describe("BcryptEncoder (P5.6)", () => {
  describe("constructor — validation du coût", () => {
    it("accepte un coût valide et l'expose", () => {
      assert.equal(new BcryptEncoder(FAST).rounds, 4);
      assert.equal(new BcryptEncoder().rounds, 12); // défaut OWASP
    });

    it("rejette un coût hors [4, 31] ou non entier", () => {
      assert.throws(() => new BcryptEncoder(3), RangeError);
      assert.throws(() => new BcryptEncoder(32), RangeError);
      assert.throws(() => new BcryptEncoder(4.5), RangeError);
      assert.throws(() => new BcryptEncoder(Number.NaN), RangeError);
    });
  });

  describe("hash / verify", () => {
    it("produit un hash bcrypt au coût demandé", async () => {
      const hash = await new BcryptEncoder(FAST).hash("s3cret");
      assert.match(hash, /^\$2[aby]\$04\$/);
      assert.equal(hash.length, 60);
    });

    it("verify true pour le bon mot de passe, false sinon", async () => {
      const enc = new BcryptEncoder(FAST);
      const hash = await enc.hash("s3cret");
      assert.equal(await enc.verify("s3cret", hash), true);
      assert.equal(await enc.verify("wrong", hash), false);
    });

    it("deux hashs du même clair diffèrent (sel aléatoire)", async () => {
      const enc = new BcryptEncoder(FAST);
      const [a, b] = await Promise.all([enc.hash("x"), enc.hash("x")]);
      assert.notEqual(a, b);
    });
  });

  describe("supports", () => {
    it("reconnaît un hash bcrypt, rejette le reste", async () => {
      const enc = new BcryptEncoder(FAST);
      assert.equal(enc.supports(await enc.hash("x")), true);
      assert.equal(enc.supports("$argon2id$v=19$m=64,t=1,p=1$a$b"), false);
      assert.equal(enc.supports("plaintext"), false);
      assert.equal(enc.supports(""), false);
    });
  });

  describe("needsRehash", () => {
    it("false quand le coût stocké == coût courant", async () => {
      const enc = new BcryptEncoder(FAST);
      const hash = await enc.hash("x");
      assert.equal(enc.needsRehash(hash), false);
    });

    it("true quand le coût stocké < coût courant (upgrade)", async () => {
      const stored = await new BcryptEncoder(FAST).hash("x"); // coût 4
      assert.equal(new BcryptEncoder(6).needsRehash(stored), true);
    });

    it("true pour un hash de format inconnu / non bcrypt", () => {
      const enc = new BcryptEncoder(FAST);
      assert.equal(enc.needsRehash("plaintext"), true);
      assert.equal(enc.needsRehash("$argon2id$v=19$..."), true);
      assert.equal(enc.needsRehash(""), true);
    });
  });
});
