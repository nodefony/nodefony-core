import { mongoTestUri } from "../helpers/mongoTestUri";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import { MongooseWebAuthnCredentialStore } from "../../nodefony/src/MongooseWebAuthnCredentialStore";
import {
  registerWebAuthnCredentialEntity,
  WEBAUTHN_CREDENTIAL_ENTITY,
} from "../../nodefony/entity/webAuthnCredentialEntity";
import { runWebAuthnStoreContract } from "../../../security/tests/support/webAuthnStoreContract";

const ORM = "wac_test";
// Serveur Mongo partagé (globalSetup) scopé sur la base `wac_test` ; `null`
// → infra indisponible → suite skippée.
const URI = mongoTestUri(ORM);

/**
 * Enveloppe Mongoose du **banc de contrat UNIQUE** du store de passkeys — le
 * banc vit chez `@nodefony/security`, propriétaire du contrat
 * `IWebAuthnCredentialStore`, et `@nodefony/drizzle` branche EXACTEMENT le même
 * sur ses trois dialectes. C'est cette identité qui fait la parité : un écart
 * de comportement entre les deux backends devient un test rouge, par
 * construction.
 */
describe.skipIf(!URI)(
  "Mongoose MongooseWebAuthnCredentialStore — IWebAuthnCredentialStore portable",
  () => {
    let orm: MongooseOrm;
    let store: MongooseWebAuthnCredentialStore;

    const purge = async (): Promise<void> => {
      await orm.getRepository(WEBAUTHN_CREDENTIAL_ENTITY).delete({});
    };

    beforeAll(async () => {
      registerWebAuthnCredentialEntity(ORM); // AVANT connect (compilation du modèle)
      orm = new MongooseOrm(ORM, URI!);
      await orm.connect();
      await purge(); // ardoise propre
      store = MongooseWebAuthnCredentialStore.from(orm);
    });

    afterAll(async () => {
      await orm?.disconnect();
      entityRegistry.unregister(WEBAUTHN_CREDENTIAL_ENTITY, ORM);
      ormRegistry.unregister(ORM);
    });

    runWebAuthnStoreContract({
      store: () => store,
      clear: purge,
      // Un pool froid sérialise les premières requêtes et masque les courses.
      warm: async () => {
        const repo = orm.getRepository(WEBAUTHN_CREDENTIAL_ENTITY);
        await Promise.all(Array.from({ length: 10 }, () => repo.count({})));
      },
    });
  },
);
