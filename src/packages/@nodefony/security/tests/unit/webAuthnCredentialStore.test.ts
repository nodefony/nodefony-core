import assert from "node:assert/strict";
import { MemoryWebAuthnCredentialStore } from "../../nodefony/src/webauthn/MemoryWebAuthnCredentialStore";
import type { IWebAuthnCredential } from "../../nodefony/contracts/IWebAuthnCredential";

/**
 * Store mémoire des credentials WebAuthn (J9) — couvre la persistance/index
 * (save/find/update/delete + isolation par utilisateur). La vérification
 * cryptographique des cérémonies est couverte en amont par `@simplewebauthn`.
 */

const makeCred = (
  o: Partial<IWebAuthnCredential> = {},
): IWebAuthnCredential => ({
  id: "cred-1",
  userId: "alice",
  publicKey: "cHVibGljLWtleQ", // base64url factice (clé PUBLIQUE)
  signCount: 0,
  transports: ["internal"],
  backupEligible: true,
  backupState: true,
  uvInitialized: true,
  createdAt: 1,
  lastUsedAt: null,
  ...o,
});

describe("MemoryWebAuthnCredentialStore", () => {
  it("save puis findById retourne le credential ; inconnu → null", async () => {
    const store = new MemoryWebAuthnCredentialStore();
    const cred = makeCred();
    await store.save(cred);
    assert.deepEqual(await store.findById("cred-1"), cred);
    assert.equal(await store.findById("absent"), null);
  });

  it("findByUser regroupe par utilisateur (isolation entre comptes)", async () => {
    const store = new MemoryWebAuthnCredentialStore();
    await store.save(makeCred({ id: "a1", userId: "alice" }));
    await store.save(makeCred({ id: "a2", userId: "alice" }));
    await store.save(makeCred({ id: "b1", userId: "bob" }));
    const alice = await store.findByUser("alice");
    assert.deepEqual(alice.map((c) => c.id).sort(), ["a1", "a2"]);
    assert.equal((await store.findByUser("bob")).length, 1);
    assert.deepEqual(await store.findByUser("carol"), []);
  });

  it("countByUser compte par porteur (borne du plafond d'enrôlement)", async () => {
    const store = new MemoryWebAuthnCredentialStore();
    await store.save(makeCred({ id: "a1", userId: "alice" }));
    await store.save(makeCred({ id: "a2", userId: "alice" }));
    await store.save(makeCred({ id: "b1", userId: "bob" }));
    assert.equal(await store.countByUser("alice"), 2);
    assert.equal(await store.countByUser("bob"), 1);
    assert.equal(await store.countByUser("carol"), 0);
    // Un re-save du même id n'ajoute rien ; un delete libère une place.
    await store.save(makeCred({ id: "a1", userId: "alice" }));
    assert.equal(await store.countByUser("alice"), 2);
    await store.delete("a1");
    assert.equal(await store.countByUser("alice"), 1);
  });

  it("update applique compteur/sauvegarde/UV/usage (anti-clone §6.1.1)", async () => {
    const store = new MemoryWebAuthnCredentialStore();
    await store.save(makeCred({ signCount: 0, lastUsedAt: null }));
    await store.update("cred-1", {
      signCount: 5,
      backupState: false,
      uvInitialized: true,
      lastUsedAt: 999,
    });
    const c = await store.findById("cred-1");
    assert.equal(c?.signCount, 5);
    assert.equal(c?.backupState, false);
    assert.equal(c?.lastUsedAt, 999);
  });

  it("update sur un credential absent ne lève pas (idempotent)", async () => {
    const store = new MemoryWebAuthnCredentialStore();
    await store.update("absent", {
      signCount: 1,
      backupState: false,
      uvInitialized: false,
      lastUsedAt: 1,
    });
    assert.equal(await store.findById("absent"), null);
  });

  it("delete retire le credential et purge l'index utilisateur", async () => {
    const store = new MemoryWebAuthnCredentialStore();
    await store.save(makeCred({ id: "a1", userId: "alice" }));
    await store.save(makeCred({ id: "a2", userId: "alice" }));
    await store.delete("a1");
    assert.equal(await store.findById("a1"), null);
    assert.deepEqual(
      (await store.findByUser("alice")).map((c) => c.id),
      ["a2"],
    );
    await store.delete("a2");
    // dernier credential retiré → l'entrée d'index disparaît (pas de Set vide).
    assert.deepEqual(await store.findByUser("alice"), []);
  });
});
