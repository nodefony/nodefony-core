import assert from "node:assert/strict";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IWebAuthnCredential } from "@nodefony/security";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import { MongooseWebAuthnCredentialStore } from "../../nodefony/src/MongooseWebAuthnCredentialStore";
import {
  registerWebAuthnCredentialEntity,
  WEBAUTHN_CREDENTIAL_ENTITY,
} from "../../nodefony/entity/webAuthnCredentialEntity";

const ORM = "wac_test";
// Serveur Mongo partagé (globalSetup) scopé sur la base `wac_test` ; `null`
// → infra indisponible → suite skippée.
const URI = mongoTestUri(ORM);

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

describe.skipIf(!URI)(
  "Mongoose MongooseWebAuthnCredentialStore — IWebAuthnCredentialStore portable (J9)",
  () => {
    let orm: MongooseOrm;
    let store: MongooseWebAuthnCredentialStore;

    beforeAll(async () => {
      registerWebAuthnCredentialEntity(ORM); // AVANT connect (compilation du modèle)
      orm = new MongooseOrm(ORM, URI!);
      await orm.connect();
      await orm.getRepository(WEBAUTHN_CREDENTIAL_ENTITY).delete({}); // ardoise propre
      store = MongooseWebAuthnCredentialStore.from(orm);
    });

    afterAll(async () => {
      await orm?.disconnect();
      entityRegistry.unregister(WEBAUTHN_CREDENTIAL_ENTITY);
      ormRegistry.unregister(ORM);
    });

    describe("save / findById", () => {
      it("save + findById restitue le credential (_id = credentialId)", async () => {
        const cred = makeCredential({ id: "c1", signCount: 7 });
        await store.save(cred);
        const found = await store.findById("c1");
        assert.deepEqual(found, cred);
        assert.equal(found?.id, "c1");
        assert.deepEqual(found?.transports, ["internal", "hybrid"]);
        assert.equal(found?.lastUsedAt, null);
      });

      it("omet nickname quand le champ est null (≠ null dans le contrat)", async () => {
        await store.save(makeCredential({ id: "c2" }));
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

      it("save écrase un credential existant (upsert, même _id)", async () => {
        await store.save(makeCredential({ id: "c4", signCount: 1 }));
        await store.save(makeCredential({ id: "c4", signCount: 99 }));
        const found = await store.findById("c4");
        assert.equal(found?.signCount, 99);
        const u1 = await store.findByUser("u1");
        assert.equal(u1.filter((c) => c.id === "c4").length, 1);
      });

      it("save CONCURRENT du même id : aucun rejet, une seule ligne (réservation atomique)", async () => {
        // Deux enregistrements de la même passkey en vol : un findOne + create
        // laisse les deux voir « absent » → E11000 sur `_id` pour le perdant.
        const results = await Promise.allSettled([
          store.save(makeCredential({ id: "c-conc", signCount: 1 })),
          store.save(makeCredential({ id: "c-conc", signCount: 2 })),
        ]);
        assert.deepEqual(
          results
            .filter((r) => r.status === "rejected")
            .map((r) => (r as PromiseRejectedResult).reason?.message),
          [],
          "aucun save concurrent ne doit être rejeté",
        );
        const all = await store.findByUser("u1");
        assert.equal(
          all.filter((c) => c.id === "c-conc").length,
          1,
          "une seule ligne pour la PK",
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

    describe("countByUser", () => {
      // Un COMPTE est absolu : contrairement aux autres blocs (qui vérifient la
      // présence d'ids connus et tolèrent les documents des tests précédents),
      // celui-ci exige une ardoise propre à chaque cas.
      beforeEach(async () => {
        await orm.getRepository(WEBAUTHN_CREDENTIAL_ENTITY).delete({});
      });

      it("compte par porteur (countDocuments), 0 si inconnu", async () => {
        await store.save(makeCredential({ id: "c1", userId: "alice" }));
        await store.save(makeCredential({ id: "c2", userId: "alice" }));
        await store.save(makeCredential({ id: "c3", userId: "bob" }));
        assert.equal(await store.countByUser("alice"), 2);
        assert.equal(await store.countByUser("bob"), 1);
        assert.equal(await store.countByUser("ghost"), 0);
      });

      it("suit save (upsert) et delete — la borne du plafond d'enrôlement", async () => {
        await store.save(makeCredential({ id: "n1", userId: "alice" }));
        await store.save(makeCredential({ id: "n1", userId: "alice" }));
        assert.equal(await store.countByUser("alice"), 1);
        await store.save(makeCredential({ id: "n2", userId: "alice" }));
        assert.equal(await store.countByUser("alice"), 2);
        await store.delete("n1");
        assert.equal(await store.countByUser("alice"), 1);
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
  },
);
