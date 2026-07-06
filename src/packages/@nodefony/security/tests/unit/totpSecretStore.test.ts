import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryTotpSecretStore } from "../../nodefony/src/totp/MemoryTotpSecretStore";
import { FileTotpSecretStore } from "../../nodefony/src/totp/FileTotpSecretStore";
import { getTotpStoreFactory } from "../../nodefony/src/totp/totpSecretStoreRegistry";
import type { ITotpStoreFactoryContext } from "../../nodefony/src/totp/totpSecretStoreRegistry";
import type { ITotpSecret } from "../../nodefony/contracts/ITotpSecret";

/**
 * Store de secrets TOTP en mémoire — clé = `userId` (un secret par utilisateur,
 * contrairement à WebAuthn qui en a N). Vérifie le CRUD, l'upsert, le patch
 * partiel et le snapshot/restore (base de la persistance fichier).
 */

function sample(
  userId: string,
  overrides: Partial<ITotpSecret> = {},
): ITotpSecret {
  return {
    userId,
    secretEnc: "enc::deadbeef",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    recoveryCodes: ["h1", "h2", "h3"],
    confirmedAt: null,
    lastUsedStep: null,
    createdAt: 1_700_000_000_000,
    lastUsedAt: null,
    ...overrides,
  };
}

describe("MemoryTotpSecretStore — CRUD par userId", () => {
  it("findByUser → null si absent", async () => {
    const store = new MemoryTotpSecretStore();
    assert.equal(await store.findByUser("ghost"), null);
  });

  it("save puis findByUser retourne le secret", async () => {
    const store = new MemoryTotpSecretStore();
    await store.save(sample("alice"));
    const found = await store.findByUser("alice");
    assert.equal(found?.userId, "alice");
    assert.equal(found?.secretEnc, "enc::deadbeef");
  });

  it("save est un upsert (écrase le pending au re-enrôlement)", async () => {
    const store = new MemoryTotpSecretStore();
    await store.save(sample("alice", { secretEnc: "v1" }));
    await store.save(sample("alice", { secretEnc: "v2" }));
    const found = await store.findByUser("alice");
    assert.equal(found?.secretEnc, "v2");
  });

  it("update applique un patch partiel (confirmation + anti-rejeu)", async () => {
    const store = new MemoryTotpSecretStore();
    await store.save(sample("alice"));
    await store.update("alice", { confirmedAt: 123, lastUsedStep: 42 });
    const found = await store.findByUser("alice");
    assert.equal(found?.confirmedAt, 123);
    assert.equal(found?.lastUsedStep, 42);
    // champs non patchés inchangés
    assert.equal(found?.digits, 6);
  });

  it("update sur recoveryCodes (consommation d'un code)", async () => {
    const store = new MemoryTotpSecretStore();
    await store.save(sample("alice"));
    await store.update("alice", { recoveryCodes: ["h2", "h3"] });
    const found = await store.findByUser("alice");
    assert.deepEqual(found?.recoveryCodes, ["h2", "h3"]);
  });

  it("update sur un userId absent est un no-op silencieux", async () => {
    const store = new MemoryTotpSecretStore();
    await store.update("ghost", { confirmedAt: 1 });
    assert.equal(await store.findByUser("ghost"), null);
  });

  it("delete retire le secret", async () => {
    const store = new MemoryTotpSecretStore();
    await store.save(sample("alice"));
    await store.delete("alice");
    assert.equal(await store.findByUser("alice"), null);
  });
});

describe("MemoryTotpSecretStore — snapshot/restore", () => {
  it("snapshot puis restore reconstruit l'état", async () => {
    const store = new MemoryTotpSecretStore();
    await store.save(sample("alice", { confirmedAt: 5 }));
    await store.save(sample("bob"));
    const snap = store.snapshot();

    const fresh = new MemoryTotpSecretStore();
    fresh.restore(snap);
    assert.equal((await fresh.findByUser("alice"))?.confirmedAt, 5);
    assert.equal((await fresh.findByUser("bob"))?.userId, "bob");
  });
});

describe("FileTotpSecretStore / registry — emplacement + résilience boot", () => {
  it("location expose le chemin physique du fichier", () => {
    const file = join(tmpdir(), "nf-totp-loc.json");
    assert.equal(new FileTotpSecretStore(file).location, file);
  });

  it("fabrique « file » SANS kernel → repli var/totp, JAMAIS de throw", () => {
    // getKernel() null hors boot : la fabrique ne doit pas crasher (sinon boot KO).
    const ctx = { config: { totp: {} } } as unknown as ITotpStoreFactoryContext;
    const store = getTotpStoreFactory("file")!(ctx) as FileTotpSecretStore;
    assert.ok(store.location.endsWith(join("var", "totp", "secrets.json")));
  });

  it("totp.storePath explicite → respecté", () => {
    const custom = join(tmpdir(), "nf-custom-totp.json");
    const ctx = {
      config: { totp: { storePath: custom } },
    } as unknown as ITotpStoreFactoryContext;
    const store = getTotpStoreFactory("file")!(ctx) as FileTotpSecretStore;
    assert.equal(store.location, custom);
  });
});
