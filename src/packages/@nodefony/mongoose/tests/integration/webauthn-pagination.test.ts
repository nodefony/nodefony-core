import { mongoTestUri } from "../helpers/mongoTestUri";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import {
  registerWebAuthnCredentialEntity,
  WEBAUTHN_CREDENTIAL_ENTITY,
} from "../../nodefony/entity/webAuthnCredentialEntity";
import { MongooseWebAuthnCredentialStore } from "../../nodefony/src/MongooseWebAuthnCredentialStore";
import { runWebAuthnPaginationContract } from "../../../security/tests/support/webauthnPaginationContract";

/**
 * Le banc de contrat unique du listing des passkeys (`@nodefony/security`),
 * déroulé sur le store Mongoose (mode **offset**) — mêmes assertions que la
 * mémoire et les 3 dialectes SQL. GATE : infra Mongo (sinon skip).
 */
const ORM = "mongo_webauthn_pagination";
const URI = mongoTestUri(ORM);

describe.skipIf(!URI)(
  "MongooseWebAuthnCredentialStore — pagination (contrat unique)",
  () => {
    let orm: MongooseOrm;
    let store: MongooseWebAuthnCredentialStore;

    beforeAll(async () => {
      registerWebAuthnCredentialEntity(ORM); // AVANT connect (compilation du modèle)
      orm = new MongooseOrm(ORM, URI!);
      await orm.connect();
      store = MongooseWebAuthnCredentialStore.from(orm);
    });
    afterAll(async () => {
      await orm.disconnect();
      entityRegistry.unregister(WEBAUTHN_CREDENTIAL_ENTITY, ORM);
      ormRegistry.unregister(ORM);
    });

    runWebAuthnPaginationContract({
      store: () => store,
      clear: async () => {
        await orm.getRepository(WEBAUTHN_CREDENTIAL_ENTITY).delete({});
      },
      mode: "offset",
    });
  },
);
