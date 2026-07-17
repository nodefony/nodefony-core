import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import {
  runUserPaginationContract,
  type UserSeedRow,
} from "../../../user/tests/support/userPaginationContract";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import {
  registerUserEntity,
  type UserRow,
} from "../../nodefony/entity/userTable";
import { DrizzleUserRepository } from "../../nodefony/src/DrizzleUserRepository";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";

/**
 * Enveloppe Drizzle du **banc de contrat UNIQUE** (`@nodefony/user`) : gère le
 * cycle de vie ORM (register entité → connect → disconnect + unregister scopé) et
 * branche le harness sur le base repository. Aucune assertion ici — elles vivent
 * dans le banc, partagé avec le store mémoire et Mongoose. `skip` gate les e2e
 * pg/mysql sur la présence de leur URL.
 */
export function runDrizzleUserPagination(opts: {
  label: string;
  ormName: string;
  config: ConstructorParameters<typeof DrizzleOrm>[1];
  dialect?: SqlDialect;
  skip?: boolean;
}): void {
  describe.skipIf(opts.skip ?? false)(opts.label, () => {
    let orm: DrizzleOrm;
    let users: DrizzleUserRepository;

    beforeAll(async () => {
      registerUserEntity(opts.ormName, opts.dialect);
      orm = new DrizzleOrm(opts.ormName, opts.config);
      await orm.connect();
      users = DrizzleUserRepository.from(orm);
    });
    afterAll(async () => {
      await orm.disconnect();
      entityRegistry.unregister("User", opts.ormName);
      ormRegistry.unregister(opts.ormName);
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
  });
}
