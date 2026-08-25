import { mongoTestUri } from "../helpers/mongoTestUri";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import {
  registerUserEntity,
  type UserRow,
} from "../../nodefony/entity/userEntity";
import { MongooseUserRepository } from "../../nodefony/src/MongooseUserRepository";
import {
  runUserPaginationContract,
  type UserSeedRow,
} from "../../../user/tests/support/userPaginationContract";

/**
 * Le **banc de contrat unique** de pagination utilisateur (`@nodefony/user`),
 * déroulé sur le store Mongoose — les MÊMES assertions que le store mémoire et les
 * trois dialectes SQL, seul le harness (insert/clear via le base repo) change.
 * GATE : infra Mongo (`NF_MONGO_TEST_URI` ou memory-server), sinon skip.
 */
const ORM = "mongo_user_pagination";
const URI = mongoTestUri(ORM);

describe.skipIf(!URI)(
  "MongooseUserRepository — pagination (contrat unique)",
  () => {
    let orm: MongooseOrm;
    let users: MongooseUserRepository;

    beforeAll(async () => {
      registerUserEntity(ORM); // AVANT connect (le modèle est compilé au connect)
      orm = new MongooseOrm(ORM, URI!);
      await orm.connect();
      users = MongooseUserRepository.from(orm);
    });
    afterAll(async () => {
      await orm.disconnect();
      entityRegistry.unregister("User", ORM);
      ormRegistry.unregister(ORM);
    });

    runUserPaginationContract({
      users: () => users,
      insert: async (rows: UserSeedRow[]) => {
        const base = orm.getRepository<UserRow>("User");
        for (const row of rows) await base.create(row);
      },
      clear: async () => {
        await orm.getRepository<UserRow>("User").delete({});
      },
    });
  },
);
