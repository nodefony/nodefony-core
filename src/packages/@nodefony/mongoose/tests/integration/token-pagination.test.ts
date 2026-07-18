import { mongoTestUri } from "../helpers/mongoTestUri";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import {
  registerTokenEntities,
  TOKEN_ENTITY_NAMES,
} from "../../nodefony/entity/tokenEntity";
import { MongooseTokenStore } from "../../nodefony/src/MongooseTokenStore";
import { runTokenPaginationContract } from "../../../security/tests/support/tokenPaginationContract";

/**
 * Le banc de contrat unique de pagination des jetons (`@nodefony/security`),
 * déroulé sur le store Mongoose (mode **offset**) — mêmes assertions que la mémoire
 * et les 3 dialectes SQL. GATE : infra Mongo (sinon skip).
 */
const ORM = "mongo_token_pagination";
const URI = mongoTestUri(ORM);

describe.skipIf(!URI)(
  "MongooseTokenStore — pagination (contrat unique)",
  () => {
    let orm: MongooseOrm;
    let store: MongooseTokenStore;

    beforeAll(async () => {
      registerTokenEntities(ORM); // AVANT connect (compilation des modèles)
      orm = new MongooseOrm(ORM, URI!);
      await orm.connect();
      store = MongooseTokenStore.from(orm);
    });
    afterAll(async () => {
      await orm.disconnect();
      entityRegistry.unregister(TOKEN_ENTITY_NAMES.records, ORM);
      entityRegistry.unregister(TOKEN_ENTITY_NAMES.denied, ORM);
      entityRegistry.unregister(TOKEN_ENTITY_NAMES.revocations, ORM);
      ormRegistry.unregister(ORM);
    });

    runTokenPaginationContract({
      store: () => store,
      clear: async () => {
        await orm.getRepository(TOKEN_ENTITY_NAMES.records).delete({});
      },
      mode: "offset",
    });
  },
);
