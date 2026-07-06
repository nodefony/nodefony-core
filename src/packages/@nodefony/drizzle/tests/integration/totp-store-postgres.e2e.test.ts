import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { ITotpSecret } from "@nodefony/security";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleTotpSecretStore } from "../../nodefony/src/DrizzleTotpSecretStore";
import {
  registerTotpSecretEntity,
  TOTP_SECRET_ENTITY,
} from "../../nodefony/entity/totpSecretEntity";

/**
 * e2e **Postgres** du store de secrets TOTP (S2 multi-dialecte) — 2FA sur PG
 * réel : PK naturelle `userId` (1 secret/user, save = upsert), patch PARTIEL
 * (un champ omis n'est JAMAIS écrasé à NULL — l'anti-rejeu RFC 6238 en dépend),
 * `recoveryCodes` jsonb, `lastUsedStep` integer (tranche T, pas un horodatage).
 *
 * GATE : `NF_PG_URL` (sinon skip) — cf token-store-postgres.e2e.test.ts.
 */

const PG_URL = process.env.NF_PG_URL;
const ORM = "totp_pg_e2e";

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

describe.skipIf(!PG_URL)(
  "DrizzleTotpSecretStore — e2e Postgres (S2 multi-dialecte)",
  () => {
    let orm: DrizzleOrm;
    let store: DrizzleTotpSecretStore;

    beforeAll(async () => {
      registerTotpSecretEntity(ORM, "postgres"); // pgTable, AVANT connect
      orm = new DrizzleOrm(ORM, { dialect: "postgres", url: PG_URL });
      await orm.connect();
      store = DrizzleTotpSecretStore.from(orm);
      await orm.getRepository(TOTP_SECRET_ENTITY).delete({});
    });

    afterAll(async () => {
      await orm.disconnect();
      entityRegistry.unregister(TOTP_SECRET_ENTITY, ORM);
      ormRegistry.unregister(ORM);
    });

    it("save + findByUser : round-trip complet (jsonb + nullables PG)", async () => {
      const secret = makeSecret({ userId: "pg-alice", confirmedAt: 42 });
      await store.save(secret);
      const found = await store.findByUser("pg-alice");
      assert.deepEqual(found, secret);
      assert.deepEqual(found?.recoveryCodes, ["h1", "h2"]);
      assert.equal(found?.lastUsedStep, null, "NULL PG → null JS");
      assert.equal(await store.findByUser("pg-ghost"), null);
    });

    it("save rejoué = upsert par PK userId (ré-enrôlement, 1 seule ligne)", async () => {
      await store.save(
        makeSecret({
          userId: "pg-alice",
          secretEnc: "iv2.tag2.cipher2",
          algorithm: "SHA256",
          recoveryCodes: ["n1"],
        }),
      );
      const found = await store.findByUser("pg-alice");
      assert.equal(found?.secretEnc, "iv2.tag2.cipher2");
      assert.equal(found?.algorithm, "SHA256");
      assert.deepEqual(found?.recoveryCodes, ["n1"]);
    });

    it("update PARTIEL : lastUsedStep avancé (anti-rejeu §5.2) SANS toucher le reste", async () => {
      await store.update("pg-alice", {
        lastUsedStep: 57_000_123,
        lastUsedAt: 77,
      });
      const found = await store.findByUser("pg-alice");
      assert.equal(
        found?.lastUsedStep,
        57_000_123,
        "tranche T posée (integer PG)",
      );
      assert.equal(found?.lastUsedAt, 77);
      assert.equal(
        found?.secretEnc,
        "iv2.tag2.cipher2",
        "champ omis du patch JAMAIS écrasé",
      );
      assert.deepEqual(found?.recoveryCodes, ["n1"], "codes intacts");
    });

    it("update : consommation d'un code de récupération (recoveryCodes remplacés)", async () => {
      await store.update("pg-alice", { recoveryCodes: [] });
      const found = await store.findByUser("pg-alice");
      assert.deepEqual(found?.recoveryCodes, []);
      assert.equal(found?.lastUsedStep, 57_000_123, "anti-rejeu préservé");
    });

    it("update d'un user non enrôlé = no-op conforme ; delete : le secret disparaît", async () => {
      await store.update("pg-ghost", { lastUsedStep: 1 });
      assert.equal(await store.findByUser("pg-ghost"), null);
      await store.delete("pg-alice");
      assert.equal(await store.findByUser("pg-alice"), null);
    });
  },
);
