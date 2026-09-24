import { mongoTestUri } from "../helpers/mongoTestUri";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import { MongooseTokenStore } from "../../nodefony/src/MongooseTokenStore";
import {
  registerTokenEntities,
  TOKEN_ENTITY_NAMES,
} from "../../nodefony/entity/tokenEntity";
import { runTokenStoreContract } from "../../../security/tests/support/tokenStoreContract";

const ORM = "tokens_test";
// Serveur Mongo partagé (globalSetup) scopé sur la base `tokens_test` ; `null`
// → infra indisponible → suite skippée.
const URI = mongoTestUri(ORM);

/**
 * Enveloppe Mongoose du **banc de contrat UNIQUE** du store de jetons — le banc
 * vit chez `@nodefony/security`, propriétaire du contrat `ITokenStore`, et
 * `@nodefony/drizzle` branche EXACTEMENT le même sur ses trois dialectes. C'est
 * cette identité qui fait la parité : un écart de comportement entre les deux
 * backends devient un test rouge, par construction.
 */
describe.skipIf(!URI)(
  "Mongoose MongooseTokenStore — ITokenStore portable",
  () => {
    let orm: MongooseOrm;

    const purge = async (): Promise<void> => {
      await orm.getRepository(TOKEN_ENTITY_NAMES.records).delete({});
      await orm.getRepository(TOKEN_ENTITY_NAMES.denied).delete({});
      await orm.getRepository(TOKEN_ENTITY_NAMES.revocations).delete({});
    };

    beforeAll(async () => {
      registerTokenEntities(ORM); // AVANT connect (compilation des 3 modèles)
      orm = new MongooseOrm(ORM, URI!);
      await orm.connect();
      await purge(); // ardoise propre (Mongo externe partagé)
    });

    afterAll(async () => {
      await orm?.disconnect();
      entityRegistry.unregister(TOKEN_ENTITY_NAMES.records, ORM);
      entityRegistry.unregister(TOKEN_ENTITY_NAMES.denied, ORM);
      entityRegistry.unregister(TOKEN_ENTITY_NAMES.revocations, ORM);
      ormRegistry.unregister(ORM);
    });

    runTokenStoreContract({
      create: (now, retention) => MongooseTokenStore.from(orm, now, retention),
      clear: purge,
      // Un pool froid sérialise les premières requêtes et masque les courses.
      warm: async () => {
        const records = orm.getRepository(TOKEN_ENTITY_NAMES.records);
        await Promise.all(Array.from({ length: 10 }, () => records.count({})));
      },
    });
  },
);
