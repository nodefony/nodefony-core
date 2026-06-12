import assert from "node:assert/strict";
import {
  Argon2idEncoder,
  BcryptEncoder,
  MigratingEncoder,
  encoderFromConfig,
} from "../../index";

// Coûts plancher — on teste la TRADUCTION config→instances, pas le hash.
const FAST_ARGON = { memoryKiB: 64, timeCost: 1, parallelism: 1 } as const;

describe("encoderFromConfig (P6 J3 — pont config.encoders)", () => {
  it("liste vide → Argon2id aux défauts OWASP (défaut sûr)", () => {
    const enc = encoderFromConfig([]);
    assert.ok(enc instanceof Argon2idEncoder);
    assert.equal((enc as Argon2idEncoder).memoryKiB, 19456);
  });

  it("1 spec → l'encodeur seul, coûts propagés (pas de composite inutile)", () => {
    const enc = encoderFromConfig([{ type: "argon2id", ...FAST_ARGON }]);
    assert.ok(enc instanceof Argon2idEncoder);
    const argon = enc as Argon2idEncoder;
    assert.equal(argon.memoryKiB, 64);
    assert.equal(argon.timeCost, 1);
    assert.equal(argon.parallelism, 1);
  });

  it("1 spec bcrypt → BcryptEncoder", () => {
    const enc = encoderFromConfig([{ type: "bcrypt", rounds: 4 }]);
    assert.ok(enc instanceof BcryptEncoder);
  });

  it("N specs → MigratingEncoder : 1re = principal, suivantes = legacy", () => {
    const enc = encoderFromConfig([
      { type: "argon2id", ...FAST_ARGON },
      { type: "bcrypt", rounds: 4 },
    ]);
    assert.ok(enc instanceof MigratingEncoder);
    const composite = enc as MigratingEncoder;
    assert.ok(composite.primary instanceof Argon2idEncoder);
    assert.equal(composite.legacy.length, 1);
    assert.ok(composite.legacy[0] instanceof BcryptEncoder);
  });

  it("specs partielles → défauts des constructeurs (spec sûre)", () => {
    const enc = encoderFromConfig([{ type: "argon2id" }]);
    const argon = enc as Argon2idEncoder;
    assert.equal(argon.memoryKiB, 19456);
    assert.equal(argon.timeCost, 3);
  });
});
