import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { ITotpSecret } from "@nodefony/security";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleTotpSecretStore } from "../../nodefony/src/DrizzleTotpSecretStore";
import {
  registerTotpSecretEntity,
  TOTP_SECRET_ENTITY,
} from "../../nodefony/entity/totpSecretEntity";

const ORM = "totp_test";

/** Construit un `ITotpSecret` complet avec surcharges. */
function makeSecret(over: Partial<ITotpSecret> = {}): ITotpSecret {
  return {
    userId: "u1",
    secretEnc: "iv.tag.cipher",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    recoveryCodes: ["h1", "h2"],
    confirmedAt: null,
    lastUsedStep: null,
    createdAt: 1_000_000,
    lastUsedAt: null,
    ...over,
  };
}

describe("Drizzle DrizzleTotpSecretStore — ITotpSecretStore portable (2FA persistant)", () => {
  let orm: DrizzleOrm;
  let store: DrizzleTotpSecretStore;

  beforeAll(async () => {
    registerTotpSecretEntity(ORM); // AVANT connect (création de la table)
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
    store = DrizzleTotpSecretStore.from(orm);
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister(TOTP_SECRET_ENTITY);
    ormRegistry.unregister(ORM);
  });

  describe("save / findByUser", () => {
    it("save + findByUser restitue le secret (recoveryCodes JSON + nullables)", async () => {
      const secret = makeSecret({ userId: "alice", confirmedAt: 42 });
      await store.save(secret);
      const found = await store.findByUser("alice");
      assert.deepEqual(found, secret);
      assert.deepEqual(found?.recoveryCodes, ["h1", "h2"]);
      assert.equal(found?.confirmedAt, 42);
      assert.equal(found?.lastUsedStep, null);
    });

    it("findByUser d'un utilisateur non enrôlé renvoie null", async () => {
      assert.equal(await store.findByUser("ghost"), null);
    });

    it("save écrase le secret existant (upsert — ré-enrôlement), 1 par user", async () => {
      await store.save(makeSecret({ userId: "bob", secretEnc: "old" }));
      await store.save(
        makeSecret({ userId: "bob", secretEnc: "new", digits: 8 }),
      );
      const found = await store.findByUser("bob");
      assert.equal(found?.secretEnc, "new");
      assert.equal(found?.digits, 8);
    });

    it("save CONCURRENT du même user : aucun rejet, un seul secret (réservation atomique)", async () => {
      // Deux enrôlements 2FA simultanés (double-clic, onglet dupliqué) : un
      // `findOne` + `create` laisse les deux voir « non enrôlé » → deux INSERT
      // sur la PK `userId` → le perdant lève « UNIQUE constraint failed ».
      const results = await Promise.allSettled([
        store.save(makeSecret({ userId: "carol", secretEnc: "A" })),
        store.save(makeSecret({ userId: "carol", secretEnc: "B" })),
      ]);
      const rejected = results.filter((r) => r.status === "rejected");
      assert.deepEqual(
        rejected.map((r) => (r as PromiseRejectedResult).reason?.message),
        [],
        "aucun save concurrent ne doit être rejeté",
      );
      const found = await store.findByUser("carol");
      assert.ok(
        found && ["A", "B"].includes(found.secretEnc),
        "un seul secret, portant l'un des deux écrits",
      );
    });
  });

  describe("update (patch partiel)", () => {
    it("ne touche QUE les champs présents (confirme, anti-rejeu, codes)", async () => {
      await store.save(
        makeSecret({ userId: "carol", confirmedAt: null, lastUsedStep: null }),
      );
      await store.update("carol", { confirmedAt: 111, lastUsedStep: 5 });
      let found = await store.findByUser("carol");
      assert.equal(found?.confirmedAt, 111);
      assert.equal(found?.lastUsedStep, 5);
      // secretEnc/digits inchangés (non patchés).
      assert.equal(found?.secretEnc, "iv.tag.cipher");

      // Un 2e patch sur d'autres champs ne remet pas confirmedAt à null.
      await store.update("carol", { recoveryCodes: ["h3"], lastUsedAt: 999 });
      found = await store.findByUser("carol");
      assert.equal(found?.confirmedAt, 111); // préservé
      assert.deepEqual(found?.recoveryCodes, ["h3"]);
      assert.equal(found?.lastUsedAt, 999);
    });

    it("patch vide → no-op (aucune écriture)", async () => {
      await store.save(makeSecret({ userId: "dave", confirmedAt: 7 }));
      await store.update("dave", {});
      assert.equal((await store.findByUser("dave"))?.confirmedAt, 7);
    });

    it("no-op si l'utilisateur est inconnu", async () => {
      await store.update("absent", { confirmedAt: 1 });
      assert.equal(await store.findByUser("absent"), null);
    });
  });

  describe("delete", () => {
    it("supprime le secret (désactivation 2FA)", async () => {
      await store.save(makeSecret({ userId: "erin" }));
      await store.delete("erin");
      assert.equal(await store.findByUser("erin"), null);
    });

    it("est idempotent sur un utilisateur inconnu", async () => {
      await store.delete("never"); // ne throw pas
      assert.equal(await store.findByUser("never"), null);
    });
  });

  describe("persistance / survie au redémarrage (fichier partagé)", () => {
    it("un secret écrit est relu par un nouveau store sur le même ORM", async () => {
      await store.save(makeSecret({ userId: "frank", secretEnc: "persisted" }));
      // Nouveau store sur le MÊME orm connecté (≈ nouvelle instance après reboot).
      const store2 = DrizzleTotpSecretStore.from(orm);
      assert.equal((await store2.findByUser("frank"))?.secretEnc, "persisted");
    });
  });
});
