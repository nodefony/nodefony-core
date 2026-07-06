import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IWebAuthnCredential } from "@nodefony/security";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleWebAuthnCredentialStore } from "../../nodefony/src/DrizzleWebAuthnCredentialStore";
import {
  registerWebAuthnCredentialEntity,
  WEBAUTHN_CREDENTIAL_ENTITY,
} from "../../nodefony/entity/webAuthnCredentialEntity";

/**
 * e2e **Postgres** du store de credentials WebAuthn (S2 multi-dialecte) —
 * passkeys sur PG réel : booléens natifs (BE/BS/UV, ≠ integer SQLite),
 * `transports` jsonb, normalisation `nickname` NULL ↔ absent du contrat,
 * patch d'authentification (updateOne borné `#pickOne` PG).
 *
 * GATE : `NF_PG_URL` (sinon skip) — cf token-store-postgres.e2e.test.ts.
 */

const PG_URL = process.env.NF_PG_URL;
const ORM = "wac_pg_e2e";

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

describe.skipIf(!PG_URL)(
  "DrizzleWebAuthnCredentialStore — e2e Postgres (S2 multi-dialecte)",
  () => {
    let orm: DrizzleOrm;
    let store: DrizzleWebAuthnCredentialStore;

    beforeAll(async () => {
      registerWebAuthnCredentialEntity(ORM, "postgres"); // pgTable, AVANT connect
      orm = new DrizzleOrm(ORM, { dialect: "postgres", url: PG_URL });
      await orm.connect();
      store = DrizzleWebAuthnCredentialStore.from(orm);
      await orm.getRepository(WEBAUTHN_CREDENTIAL_ENTITY).delete({});
    });

    afterAll(async () => {
      await orm.disconnect();
      entityRegistry.unregister(WEBAUTHN_CREDENTIAL_ENTITY, ORM);
      ormRegistry.unregister(ORM);
    });

    it("save + findById : booléens PG natifs + transports jsonb + nickname omis", async () => {
      const cred = makeCredential({ id: "pg-c1", signCount: 7 });
      await store.save(cred);
      const found = await store.findById("pg-c1");
      assert.deepEqual(found, cred);
      assert.equal(found?.backupEligible, true, "boolean PG → true JS strict");
      assert.equal(found?.backupState, false);
      assert.equal(
        "nickname" in (found as object),
        false,
        "NULL → clé ABSENTE du contrat (nickname?)",
      );
    });

    it("save rejoué = UPDATE (1 credential), nickname + lastUsedAt posés", async () => {
      await store.save(
        makeCredential({ id: "pg-c1", nickname: "YubiKey", lastUsedAt: 42 }),
      );
      const found = await store.findById("pg-c1");
      assert.equal(found?.nickname, "YubiKey");
      assert.equal(found?.lastUsedAt, 42);
      assert.equal((await store.findByUser("u1")).length, 1, "pas de doublon");
    });

    it("findByUser : liste les credentials du porteur (index userId), isolation par user", async () => {
      await store.save(makeCredential({ id: "pg-c2", userId: "u1" }));
      await store.save(makeCredential({ id: "pg-other", userId: "u2" }));
      const mine = await store.findByUser("u1");
      assert.deepEqual(
        mine.map((c) => c.id).sort(),
        ["pg-c1", "pg-c2"],
        "les credentials d'u2 n'apparaissent pas",
      );
    });

    it("update (patch auth §6.1.1) : signCount/BS/UV/lastUsedAt — au plus UNE ligne touchée", async () => {
      await store.update("pg-c1", {
        signCount: 8,
        backupState: true,
        uvInitialized: true,
        lastUsedAt: 99,
      });
      const updated = await store.findById("pg-c1");
      assert.equal(updated?.signCount, 8, "compteur anti-clone avancé");
      assert.equal(updated?.backupState, true, "BS peut évoluer");
      assert.equal(updated?.lastUsedAt, 99);
      const other = await store.findById("pg-c2");
      assert.equal(other?.signCount, 0, "l'autre credential du user intact");
      await store.update("pg-ghost", {
        signCount: 1,
        backupState: false,
        uvInitialized: false,
        lastUsedAt: 1,
      }); // id inconnu → no-op conforme, pas d'erreur
    });

    it("delete : le credential disparaît, les autres restent", async () => {
      await store.delete("pg-c1");
      assert.equal(await store.findById("pg-c1"), null);
      assert.equal((await store.findByUser("u1")).length, 1);
    });
  },
);
