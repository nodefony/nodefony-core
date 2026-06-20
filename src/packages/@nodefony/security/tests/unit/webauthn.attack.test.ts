import assert from "node:assert/strict";
import { MemoryWebAuthnCredentialStore } from "../../nodefony/src/webauthn/MemoryWebAuthnCredentialStore";
import type { IWebAuthnCredential } from "../../nodefony/contracts/IWebAuthnCredential";

/**
 * Matrice d'ATTAQUE (red-team) WebAuthn — niveau STORE (`MemoryWebAuthnCredentialStore`).
 * Dérivée de la MENACE (W3C WebAuthn L3 §6.1/§7.2 + OWASP Access Control),
 * PAS de l'implémentation. Complète `webAuthnCredentialStore.test.ts` (matrice
 * fonctionnelle save/find/update/delete) par les vecteurs ADVERSES propres au
 * store de credentials :
 *
 *   A1 — Account-takeover via `update` : la mise à jour post-authentification ne
 *        porte QUE l'état mutable (signCount/backupState/UV/lastUsedAt). Elle ne
 *        doit JAMAIS pouvoir réassigner le PROPRIÉTAIRE (`userId`) ni la CLÉ
 *        PUBLIQUE (`publicKey`) — sinon une cérémonie d'auth réécrirait à qui
 *        appartient le passkey = prise de contrôle de compte.
 *   A2 — IDOR / isolation : `findByUser` ne fuit jamais le credential d'autrui ;
 *        `findById` résout sans filtrer par user (c'est au SERVICE de matcher le
 *        propriétaire — documenté ici comme limite de responsabilité du store).
 *   A3 — Anti-clone (§6.1.1) : le store écrit `signCount` AVEUGLÉMENT (accepte une
 *        régression 5→1). PROUVE que la détection de clone (counter régressif) est
 *        la responsabilité du SERVICE (`verifyAuthentication`), pas du store.
 *   A4 — Collision d'index : un `id` de credential égal au `userId` d'un autre
 *        compte ne doit pas mélanger les index (`#byId` vs `#idsByUser` disjoints).
 *
 * La vérification cryptographique des assertions (signature ES256/RS256/EdDSA,
 * challenge, origin/rpId) est déléguée à `@simplewebauthn/server` (lib auditée) ;
 * les invariants que Nodefony impose AUTOUR (origin allowlist, anti-clone, usage
 * unique du challenge) sont couverts au niveau service (lecture) + e2e (replay).
 */

const makeCred = (
  o: Partial<IWebAuthnCredential> = {},
): IWebAuthnCredential => ({
  id: "cred-1",
  userId: "alice",
  publicKey: "cHVibGljLWFsaWNl", // clé PUBLIQUE base64url factice (alice)
  signCount: 10,
  transports: ["internal"],
  backupEligible: false,
  backupState: false,
  uvInitialized: true,
  createdAt: 1,
  lastUsedAt: null,
  ...o,
});

describe("WebAuthn — red-team STORE (MemoryWebAuthnCredentialStore)", () => {
  // A1 — Account-takeover : update ne touche QUE l'état mutable.
  it("A1 — update n'altère NI le propriétaire (userId) NI la clé publique (anti-takeover)", async () => {
    const store = new MemoryWebAuthnCredentialStore();
    await store.save(
      makeCred({ id: "k1", userId: "alice", publicKey: "cHViLWFsaWNl" }),
    );
    // Patch d'auth légitime (le SEUL contrat de mutation : WebAuthnAuthUpdate).
    await store.update("k1", {
      signCount: 42,
      backupState: true,
      uvInitialized: true,
      lastUsedAt: 1234,
    });
    const c = await store.findById("k1");
    // L'état mutable a bien suivi…
    assert.equal(c?.signCount, 42, "signCount mis à jour");
    assert.equal(c?.backupState, true, "backupState mis à jour");
    assert.equal(c?.lastUsedAt, 1234, "lastUsedAt mis à jour");
    // …mais l'identité du credential est INVIOLABLE par update.
    assert.equal(
      c?.userId,
      "alice",
      "userId NON réassignable par update (anti-takeover)",
    );
    assert.equal(
      c?.publicKey,
      "cHViLWFsaWNl",
      "publicKey NON réécrivable par update",
    );
    assert.equal(c?.id, "k1", "id inchangé");
    assert.equal(
      c?.backupEligible,
      false,
      "backupEligible (BE flag) immuable §6.1.3",
    );
    // L'index par user n'a pas migré non plus (le passkey reste à alice).
    assert.deepEqual(
      (await store.findByUser("alice")).map((x) => x.id),
      ["k1"],
    );
  });

  // A2 — IDOR : un credential ne fuit jamais vers un autre compte via findByUser.
  it("A2 — findByUser isole strictement : le passkey d'alice jamais résolu pour bob (IDOR)", async () => {
    const store = new MemoryWebAuthnCredentialStore();
    await store.save(makeCred({ id: "alice-key", userId: "alice" }));
    await store.save(makeCred({ id: "bob-key", userId: "bob" }));
    assert.deepEqual(
      (await store.findByUser("alice")).map((c) => c.id),
      ["alice-key"],
    );
    assert.deepEqual(
      (await store.findByUser("bob")).map((c) => c.id),
      ["bob-key"],
    );
    // Utilisateur inconnu → liste vide (jamais d'erreur révélatrice, jamais de fuite).
    assert.deepEqual(await store.findByUser("mallory"), []);
    // findById résout par id SANS filtrer le user : le matching du propriétaire
    // est la responsabilité du SERVICE (verifyAuthentication compare userId).
    const cross = await store.findById("alice-key");
    assert.equal(
      cross?.userId,
      "alice",
      "findById expose le userId → le service DOIT le matcher",
    );
  });

  // A3 — Anti-clone : le store accepte une régression de compteur → garde ailleurs.
  it("A3 — le store accepte un signCount régressif (5→1) → la détection de clone incombe au SERVICE", async () => {
    const store = new MemoryWebAuthnCredentialStore();
    await store.save(makeCred({ id: "k", signCount: 5 }));
    // Un authenticator cloné rejouerait un compteur PLUS PETIT (§6.1.1). Le store,
    // simple persistance, ne juge pas la monotonie : il écrit ce qu'on lui donne.
    await store.update("k", {
      signCount: 1, // RÉGRESSION
      backupState: false,
      uvInitialized: true,
      lastUsedAt: 2,
    });
    const c = await store.findById("k");
    assert.equal(
      c?.signCount,
      1,
      "store écrit aveuglément → l'anti-clone DOIT être appliqué AVANT update (service)",
    );
  });

  // A4 — Pas de collision entre l'index par id et l'index par user.
  it("A4 — un id de credential égal au userId d'un autre compte ne mélange pas les index", async () => {
    const store = new MemoryWebAuthnCredentialStore();
    // credential dont l'id == "bob" (le userId d'un autre compte)
    await store.save(makeCred({ id: "bob", userId: "alice" }));
    await store.save(makeCred({ id: "real-bob-key", userId: "bob" }));
    // findById("bob") = le CREDENTIAL d'id "bob" (appartient à alice), pas l'index de bob.
    const byId = await store.findById("bob");
    assert.equal(
      byId?.userId,
      "alice",
      "id 'bob' résout le credential d'alice, pas l'index user",
    );
    // findByUser("bob") = les credentials de bob, sans le leurre d'id homonyme.
    assert.deepEqual(
      (await store.findByUser("bob")).map((c) => c.id),
      ["real-bob-key"],
    );
    assert.deepEqual(
      (await store.findByUser("alice")).map((c) => c.id),
      ["bob"],
    );
  });
});
