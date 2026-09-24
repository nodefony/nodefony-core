import { mongoTestUri } from "../helpers/mongoTestUri";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import { MongooseWebhookStore } from "../../nodefony/src/MongooseWebhookStore";
import {
  registerWebhookEndpointEntity,
  WEBHOOK_ENDPOINT_ENTITY,
} from "../../nodefony/entity/webhookEndpointEntity";
import { runWebhookStoreContract } from "../../../security/tests/support/webhookStoreContract";

const ORM = "wh_test";
// Serveur Mongo partagé (globalSetup) scopé sur la base `wh_test` ; `null`
// → infra indisponible → suite skippée.
const URI = mongoTestUri(ORM);

/**
 * Enveloppe Mongoose du **banc de contrat UNIQUE** du store d'endpoints webhook —
 * le banc vit chez `@nodefony/security`, propriétaire du contrat `IWebhookStore`,
 * et `@nodefony/drizzle` branche EXACTEMENT le même sur ses trois dialectes.
 * C'est cette identité qui fait la parité : un écart de comportement entre les
 * deux backends devient un test rouge, par construction.
 */
describe.skipIf(!URI)(
  "Mongoose MongooseWebhookStore — IWebhookStore portable",
  () => {
    let orm: MongooseOrm;
    let store: MongooseWebhookStore;

    const purge = async (): Promise<void> => {
      await orm.getRepository(WEBHOOK_ENDPOINT_ENTITY).delete({});
    };

    beforeAll(async () => {
      registerWebhookEndpointEntity(ORM); // AVANT connect (compilation du modèle)
      orm = new MongooseOrm(ORM, URI!);
      await orm.connect();
      await purge(); // ardoise propre
      store = MongooseWebhookStore.from(orm);
    });

    afterAll(async () => {
      await orm?.disconnect();
      entityRegistry.unregister(WEBHOOK_ENDPOINT_ENTITY, ORM);
      ormRegistry.unregister(ORM);
    });

    runWebhookStoreContract({
      store: () => store,
      clear: purge,
      // Un pool froid sérialise les premières requêtes et masque les courses.
      warm: async () => {
        const repo = orm.getRepository(WEBHOOK_ENDPOINT_ENTITY);
        await Promise.all(Array.from({ length: 10 }, () => repo.count({})));
      },
    });
  },
);
