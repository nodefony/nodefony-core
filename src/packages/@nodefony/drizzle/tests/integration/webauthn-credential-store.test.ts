import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IWebAuthnCredential } from "@nodefony/security";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleWebAuthnCredentialStore } from "../../nodefony/src/DrizzleWebAuthnCredentialStore";
import {
  registerWebAuthnCredentialEntity,
  WEBAUTHN_CREDENTIAL_ENTITY,
} from "../../nodefony/entity/webAuthnCredentialEntity";

const ORM = "wac_test";

/** Construit un `IWebAuthnCredential` complet avec surcharges. */
function makeCredential(
  over: Partial<IWebAuthnCredential> & Pick<IWebAuthnCredential, "id">,
): IWebAuthnCredential {
  return {
    userId: "u1",
    publicKey: `pk-${over.id}`,
    signCount: 0,
    transports: ["internal", "hybrid"],
    backupEligible: true,
    backupState: false,
    uvInitialized: true,
    createdAt: 1_000_000,
    lastUsedAt: null,
    ...over,
  };
}

describe("Drizzle DrizzleWebAuthnCredentialStore — IWebAuthnCredentialStore portable (J9)", () => {
  let orm: DrizzleOrm;
  let store: DrizzleWebAuthnCredentialStore;

  beforeAll(async () => {
    registerWebAuthnCredentialEntity(ORM); // AVANT connect (création de la table)
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
    store = DrizzleWebAuthnCredentialStore.from(orm);
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister(WEBAUTHN_CREDENTIAL_ENTITY);
    ormRegistry.unregister(ORM);
  });

  describe("save / findById", () => {
    it("save + findById restitue le credential (transports JSON + booléens)", async () => {
      const cred = makeCredential({ id: "c1", signCount: 7 });
      await store.save(cred);
      const found = await store.findById("c1");
      assert.deepEqual(found, cred);
      assert.deepEqual(found?.transports, ["internal", "hybrid"]);
      assert.equal(found?.backupEligible, true);
      assert.equal(found?.backupState, false);
      assert.equal(found?.lastUsedAt, null);
    });

    it("omet nickname quand la colonne est NULL (≠ null dans le contrat)", async () => {
      await store.save(makeCredential({ id: "c2" })); // pas de nickname
      const found = await store.findById("c2");
      assert.equal("nickname" in (found as object), false);
    });

    it("conserve un nickname et un lastUsedAt non nuls", async () => {
      await store.save(
        makeCredential({ id: "c3", nickname: "MacBook", lastUsedAt: 42 }),
      );
      const found = await store.findById("c3");
      assert.equal(found?.nickname, "MacBook");
      assert.equal(found?.lastUsedAt, 42);
    });

    it("findById d'un credential inconnu renvoie null", async () => {
      assert.equal(await store.findById("nope"), null);
    });

    it("save écrase un credential existant (upsert)", async () => {
      await store.save(makeCredential({ id: "c4", signCount: 1 }));
      await store.save(makeCredential({ id: "c4", signCount: 99 }));
      const found = await store.findById("c4");
      assert.equal(found?.signCount, 99);
      assert.equal(
        await store
          .findByUser("u1")
          .then((l) => l.filter((c) => c.id === "c4").length),
        1,
      );
    });
  });

  describe("findByUser", () => {
    it("renvoie tous les credentials d'un utilisateur", async () => {
      await store.save(makeCredential({ id: "a", userId: "alice" }));
      await store.save(makeCredential({ id: "b", userId: "alice" }));
      await store.save(makeCredential({ id: "z", userId: "bob" }));
      const alice = await store.findByUser("alice");
      assert.deepEqual(alice.map((c) => c.id).sort(), ["a", "b"]);
      assert.deepEqual(
        (await store.findByUser("bob")).map((c) => c.id),
        ["z"],
      );
    });

    it("renvoie [] pour un utilisateur sans credential", async () => {
      assert.deepEqual(await store.findByUser("ghost"), []);
    });
  });

  describe("update", () => {
    it("met à jour signCount / backupState / uvInitialized / lastUsedAt", async () => {
      await store.save(
        makeCredential({ id: "u", signCount: 0, uvInitialized: false }),
      );
      await store.update("u", {
        signCount: 42,
        backupState: true,
        uvInitialized: true,
        lastUsedAt: 9_999,
      });
      const found = await store.findById("u");
      assert.equal(found?.signCount, 42);
      assert.equal(found?.backupState, true);
      assert.equal(found?.uvInitialized, true);
      assert.equal(found?.lastUsedAt, 9_999);
    });

    it("no-op si le credentialId est inconnu", async () => {
      await store.update("absent", {
        signCount: 1,
        backupState: false,
        uvInitialized: false,
        lastUsedAt: 1,
      });
      assert.equal(await store.findById("absent"), null);
    });
  });

  describe("delete", () => {
    it("supprime le credential", async () => {
      await store.save(makeCredential({ id: "d1", userId: "dave" }));
      await store.save(makeCredential({ id: "d2", userId: "dave" }));
      await store.delete("d1");
      assert.equal(await store.findById("d1"), null);
      assert.deepEqual(
        (await store.findByUser("dave")).map((c) => c.id),
        ["d2"],
      );
    });

    it("est idempotent sur un credential inconnu", async () => {
      await store.delete("never"); // ne throw pas
      assert.equal(await store.findById("never"), null);
    });
  });
});
