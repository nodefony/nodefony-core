import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IWebAuthnCredential } from "@nodefony/security";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleWebAuthnCredentialStore } from "../../nodefony/src/DrizzleWebAuthnCredentialStore";
import {
  registerWebAuthnCredentialEntity,
  WEBAUTHN_CREDENTIAL_ENTITY,
} from "../../nodefony/entity/webAuthnCredentialEntity";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";

/**
 * BANC DE PARITÉ DU CONTRAT `IWebAuthnCredentialStore` — LA même suite sur les
 * TROIS dialectes (sqlite toujours ; postgres/mysql gatés par l'infra).
 *
 * Enjeu : une passkey remplace le mot de passe. Deux propriétés doivent tenir
 * sur tout backend — le **`signCount`** (compteur anti-clonage FIDO : il doit
 * survivre exactement, y compris à 0 et sur de grandes valeurs) et les
 * **booléens** `backupEligible`/`backupState`/`uvInitialized`, qui traversent
 * trois encodages (`integer mode:boolean` sqlite / `boolean` pg / `tinyint`
 * mysql) — un `false` qui revient en `0` truthy changerait une décision de
 * sécurité.
 */

export interface IWebAuthnStoreContractOptions {
  dialect: SqlDialect;
  connector: string;
  connection: { filename?: string; url?: string };
}

export function runWebAuthnStoreContract(
  opts: IWebAuthnStoreContractOptions,
): void {
  const { dialect, connector } = opts;
  let orm: DrizzleOrm;
  let store: DrizzleWebAuthnCredentialStore;

  const makeCredential = (
    over: Partial<IWebAuthnCredential> & Pick<IWebAuthnCredential, "id">,
  ): IWebAuthnCredential => ({
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
  });

  const rejections = (rs: PromiseSettledResult<unknown>[]): string[] =>
    rs
      .filter((r) => r.status === "rejected")
      .map((r) => (r as PromiseRejectedResult).reason?.message);

  /** Cf `token-store-contract` : un pool froid masque les races. */
  const warmPool = async (n = 10): Promise<void> => {
    const repo = orm.getRepository(WEBAUTHN_CREDENTIAL_ENTITY);
    await Promise.all(Array.from({ length: n }, () => repo.count({})));
  };

  const purge = async (): Promise<void> => {
    await orm.getRepository(WEBAUTHN_CREDENTIAL_ENTITY).delete({});
  };

  beforeAll(async () => {
    registerWebAuthnCredentialEntity(connector, dialect); // AVANT connect
    orm = new DrizzleOrm(connector, { dialect, ...opts.connection });
    await orm.connect();
    store = DrizzleWebAuthnCredentialStore.from(orm);
    await purge();
  });

  afterAll(async () => {
    await purge();
    await orm.disconnect();
    entityRegistry.unregister(WEBAUTHN_CREDENTIAL_ENTITY, connector);
    ormRegistry.unregister(connector);
  });

  describe("save / findById", () => {
    it("save + findById : round-trip complet (transports JSON, booléens, epoch)", async () => {
      await purge();
      await store.save(makeCredential({ id: "c1", signCount: 7 }));
      const c = await store.findById("c1");
      assert.ok(c);
      assert.deepEqual(c.transports, ["internal", "hybrid"]);
      assert.equal(c.signCount, 7);
      assert.equal(c.publicKey, "pk-c1");
      assert.equal(c.createdAt, 1_000_000);
      // Les booléens doivent revenir en VRAIS booléens (pas 0/1) : un `false`
      // truthy changerait une décision de sécurité.
      assert.equal(c.backupEligible, true);
      assert.equal(c.backupState, false);
      assert.equal(c.uvInitialized, true);
      assert.equal(typeof c.backupState, "boolean", "booléen, pas 0/1");
    });

    it("omet nickname quand la colonne est NULL (≠ null dans le contrat)", async () => {
      const c = await store.findById("c1");
      assert.equal("nickname" in (c as object), false, "clé ABSENTE, pas null");
    });

    it("conserve un nickname et un lastUsedAt non nuls", async () => {
      await store.save(
        makeCredential({
          id: "c2",
          nickname: "clé YubiKey 5 — é👩‍💻",
          lastUsedAt: 9_999,
        }),
      );
      const c = await store.findById("c2");
      assert.equal(c?.nickname, "clé YubiKey 5 — é👩‍💻");
      assert.equal(c?.lastUsedAt, 9_999);
    });

    it("findById d'un credential inconnu renvoie null", async () => {
      assert.equal(await store.findById("nope"), null);
    });

    it("save écrase un credential existant (upsert), 1 seule ligne", async () => {
      await store.save(makeCredential({ id: "c4", signCount: 1 }));
      await store.save(makeCredential({ id: "c4", signCount: 99 }));
      assert.equal((await store.findById("c4"))?.signCount, 99);
      assert.equal(
        (await store.findByUser("u1")).filter((c) => c.id === "c4").length,
        1,
      );
    });

    it("save CONCURRENT × 10 du même id : 0 rejet, une seule ligne", async () => {
      await warmPool();
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          store.save(makeCredential({ id: "c-conc", signCount: i })),
        ),
      );
      assert.deepEqual(rejections(results), [], "aucun rejet");
      assert.equal(
        (await store.findByUser("u1")).filter((c) => c.id === "c-conc").length,
        1,
      );
    });

    it("transports VIDE : tableau vide préservé (≠ null)", async () => {
      // Une passkey sans transport déclaré est légale ; `[]` ne doit pas
      // ressortir en `null` (le client itérerait sur null).
      await store.save(makeCredential({ id: "c-empty", transports: [] }));
      assert.deepEqual((await store.findById("c-empty"))?.transports, []);
    });

    it("signCount : 0 ≠ absent, et grande valeur non tronquée (borne int32)", async () => {
      // Compteur anti-clonage FIDO. Deux pièges : un `0` confondu avec « absent »
      // (les authenticators d'Apple renvoient TOUJOURS 0) et une valeur tronquée
      // silencieusement, qui ferait diverger la détection de clonage.
      //
      // ⚠️ ÉCART DE CONFORMITÉ connu (dette au dashboard) : le W3C définit
      // `signCount` comme un **uint32** (≤ 4 294 967 295), or la colonne est
      // `kind: "int"` = int32 SIGNÉ en pg/mysql. Au-delà d'`INT32_MAX`, pg lève
      // `22003` et mysql `ER_WARN_DATA_OUT_OF_RANGE` — sqlite passe (INTEGER
      // 64-bit) : c'est une DIVERGENCE, donc hors banc de parité. Inatteignable
      // en pratique (le compteur s'incrémente de 1 par authentification), mais le
      // banc borne ici ce qui est réellement garanti PARTOUT.
      const INT32_MAX = 2_147_483_647;
      await store.save(makeCredential({ id: "c-zero", signCount: 0 }));
      assert.equal((await store.findById("c-zero"))?.signCount, 0, "0 ≠ null");
      await store.save(makeCredential({ id: "c-big", signCount: INT32_MAX }));
      assert.equal((await store.findById("c-big"))?.signCount, INT32_MAX);
    });
  });

  describe("findByUser", () => {
    it("renvoie tous les credentials d'un utilisateur, et rien des autres", async () => {
      await purge();
      await store.save(makeCredential({ id: "m1", userId: "alice" }));
      await store.save(makeCredential({ id: "m2", userId: "alice" }));
      await store.save(makeCredential({ id: "m3", userId: "bob" }));
      const alice = await store.findByUser("alice");
      assert.deepEqual(alice.map((c) => c.id).sort(), ["m1", "m2"]);
    });

    it("renvoie [] pour un utilisateur sans credential", async () => {
      assert.deepEqual(await store.findByUser("ghost"), []);
    });
  });

  describe("countByUser", () => {
    it("compte les credentials du porteur, et d'aucun autre", async () => {
      await purge();
      await store.save(makeCredential({ id: "c1", userId: "alice" }));
      await store.save(makeCredential({ id: "c2", userId: "alice" }));
      await store.save(makeCredential({ id: "c3", userId: "bob" }));
      assert.equal(await store.countByUser("alice"), 2);
      assert.equal(await store.countByUser("bob"), 1);
    });

    it("renvoie 0 pour un utilisateur sans credential", async () => {
      assert.equal(await store.countByUser("ghost"), 0);
    });

    it("suit save et delete (c'est ce qui LIBÈRE une place sous le plafond)", async () => {
      await purge();
      await store.save(makeCredential({ id: "n1", userId: "alice" }));
      assert.equal(await store.countByUser("alice"), 1);
      await store.save(makeCredential({ id: "n2", userId: "alice" }));
      assert.equal(await store.countByUser("alice"), 2);
      await store.delete("n1");
      assert.equal(await store.countByUser("alice"), 1);
    });

    it("un re-save du MÊME id ne double pas le compte (upsert)", async () => {
      await purge();
      await store.save(makeCredential({ id: "dup", userId: "alice" }));
      await store.save(makeCredential({ id: "dup", userId: "alice" }));
      assert.equal(await store.countByUser("alice"), 1);
    });
  });

  describe("update", () => {
    it("met à jour signCount / backupState / uvInitialized / lastUsedAt", async () => {
      await purge();
      await store.save(makeCredential({ id: "u-1" }));
      await store.update("u-1", {
        signCount: 42,
        backupState: true,
        uvInitialized: false,
        lastUsedAt: 123_456,
      });
      const c = await store.findById("u-1");
      assert.equal(c?.signCount, 42);
      assert.equal(c?.backupState, true);
      assert.equal(
        c?.uvInitialized,
        false,
        "false ÉCRIT (pas ignoré comme falsy)",
      );
      assert.equal(c?.lastUsedAt, 123_456);
      assert.equal(c?.publicKey, "pk-u-1", "la clé publique n'est PAS touchée");
    });

    it("no-op si le credentialId est inconnu (ne lève pas, ne crée rien)", async () => {
      await store.update("jamais-vu", {
        signCount: 1,
        backupState: false,
        uvInitialized: true,
        lastUsedAt: 1,
      });
      assert.equal(await store.findById("jamais-vu"), null);
    });
  });

  describe("delete", () => {
    it("supprime le credential", async () => {
      await purge();
      await store.save(makeCredential({ id: "d1" }));
      await store.delete("d1");
      assert.equal(await store.findById("d1"), null);
    });

    it("est idempotent sur un credential inconnu", async () => {
      await store.delete("jamais-vu");
      await store.delete("d1");
    });

    it("ne supprime QUE la passkey visée (les autres du même user survivent)", async () => {
      await purge();
      await store.save(makeCredential({ id: "k1", userId: "multi" }));
      await store.save(makeCredential({ id: "k2", userId: "multi" }));
      await store.delete("k1");
      assert.deepEqual(
        (await store.findByUser("multi")).map((c) => c.id),
        ["k2"],
        "révoquer une passkey ne déconnecte pas les autres appareils",
      );
    });
  });
}
