import assert from "node:assert/strict";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import { MongooseTotpSecretStore } from "../../nodefony/src/MongooseTotpSecretStore";
import {
  registerTotpSecretEntity,
  TOTP_SECRET_ENTITY,
  type TotpSecretRow,
} from "../../nodefony/entity/totpSecretEntity";
import {
  runTotpStoreContract,
  makeContractSecret,
} from "../../../security/tests/support/totpStoreContract";

const ORM = "totp_test";
// Serveur Mongo partagé (globalSetup) scopé sur la base `totp_test` ; `null`
// → infra indisponible → suite skippée.
const URI = mongoTestUri(ORM);

/**
 * Enveloppe Mongoose du **banc de contrat UNIQUE** du store 2FA — le banc vit
 * chez `@nodefony/security`, propriétaire du contrat `ITotpSecretStore`, et
 * `@nodefony/drizzle` branche EXACTEMENT le même sur ses trois dialectes. C'est
 * cette identité qui fait la parité : un écart de comportement entre les deux
 * backends devient un test rouge, par construction.
 *
 * Seuls les cas PROPRES à Mongo restent ici — ceux qu'un backend SQL ne peut pas
 * exercer parce qu'ils portent sur la forme du document au repos.
 */
describe.skipIf(!URI)(
  "Mongoose MongooseTotpSecretStore — ITotpSecretStore portable",
  () => {
    let orm: MongooseOrm;
    let store: MongooseTotpSecretStore;

    beforeAll(async () => {
      registerTotpSecretEntity(ORM); // AVANT connect (compilation du modèle)
      orm = new MongooseOrm(ORM, URI!);
      await orm.connect();
      await orm.getRepository(TOTP_SECRET_ENTITY).delete({});
      store = MongooseTotpSecretStore.from(orm);
    });

    afterAll(async () => {
      await orm?.disconnect();
      entityRegistry.unregister(TOTP_SECRET_ENTITY, ORM);
      ormRegistry.unregister(ORM);
    });

    runTotpStoreContract({
      store: () => store,
      clear: async () => {
        await orm.getRepository(TOTP_SECRET_ENTITY).delete({});
      },
      newStore: () => MongooseTotpSecretStore.from(orm),
      // `id` → `_id` par le contrat du repository : la clé naturelle EST la PK,
      // donc ce compte prouve l'unicité portée par la clé primaire elle-même.
      countFor: (userId) =>
        orm.getRepository(TOTP_SECRET_ENTITY).count({ id: userId } as never),
      // Un pool froid sérialise les premières requêtes et masque les courses.
      warm: async () => {
        const repo = orm.getRepository(TOTP_SECRET_ENTITY);
        await Promise.all(Array.from({ length: 10 }, () => repo.count({})));
      },
    });

    // ── Ce qu'un backend SQL ne peut pas exercer : la forme du document ───────
    describe("forme du document au repos (propre à Mongo)", () => {
      it("`_id` porte l'userId, et `userId` le double pour le tri public", async () => {
        // Les deux doivent rester ALIGNÉS : `_id` porte l'unicité (donc la
        // garantie), `userId` porte le tri et la recherche (le vocabulaire
        // public). Les laisser diverger rendrait un secret introuvable par
        // `listPage` tout en restant lisible par `findByUser` — et l'écart ne
        // se verrait sur aucune assertion de contrat.
        await orm.getRepository(TOTP_SECRET_ENTITY).delete({});
        await store.save(makeContractSecret({ userId: "u-forme" }));
        const rows = await orm
          .getRepository<TotpSecretRow>(TOTP_SECRET_ENTITY)
          .find({});
        assert.equal(rows.length, 1);
        const row = rows[0] as TotpSecretRow & { _id?: string };
        assert.equal(row._id, "u-forme", "`_id` = la clé naturelle");
        assert.equal(row.userId, "u-forme", "`userId` doublé dans le document");
      });

      it("un ré-enrôlement ne laisse pas de document orphelin", async () => {
        // L'upsert porte sur `_id` : un `save` qui filtrerait sur `userId`
        // (champ ordinaire, non unique) insérerait un SECOND document au lieu
        // de remplacer le premier.
        await store.save(
          makeContractSecret({ userId: "u-forme", secretEnc: "deux" }),
        );
        assert.equal(
          await orm.getRepository(TOTP_SECRET_ENTITY).count({}),
          1,
          "un seul document après ré-enrôlement",
        );
      });
    });
  },
);
