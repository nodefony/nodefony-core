import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { runTokenPaginationContract } from "../../../security/tests/support/tokenPaginationContract";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleTokenStore } from "../../nodefony/src/DrizzleTokenStore";
import {
  registerTokenEntities,
  TOKEN_ENTITY_NAMES,
} from "../../nodefony/entity/tokenEntity";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";

/**
 * Enveloppe Drizzle du **banc de contrat UNIQUE** de pagination des jetons
 * (`@nodefony/security`) : gère le cycle de vie ORM (register entités → connect →
 * disconnect + unregister scopé) et branche le harness en mode **offset**. Aucune
 * assertion ici — partagées avec mémoire/Mongoose/Redis. `skip` gate pg/mysql.
 */
export function runDrizzleTokenPagination(opts: {
  label: string;
  connector: string;
  config: ConstructorParameters<typeof DrizzleOrm>[1];
  dialect?: SqlDialect;
  skip?: boolean;
}): void {
  describe.skipIf(opts.skip ?? false)(opts.label, () => {
    let orm: DrizzleOrm;
    let store: DrizzleTokenStore;

    beforeAll(async () => {
      registerTokenEntities(opts.connector, opts.dialect); // AVANT connect
      orm = new DrizzleOrm(opts.connector, opts.config);
      await orm.connect();
      store = DrizzleTokenStore.from(orm);
    });
    afterAll(async () => {
      await orm.disconnect();
      entityRegistry.unregister(TOKEN_ENTITY_NAMES.records, opts.connector);
      entityRegistry.unregister(TOKEN_ENTITY_NAMES.denied, opts.connector);
      entityRegistry.unregister(TOKEN_ENTITY_NAMES.revocations, opts.connector);
      ormRegistry.unregister(opts.connector);
    });

    runTokenPaginationContract({
      store: () => store,
      clear: async () => {
        await orm.getRepository(TOKEN_ENTITY_NAMES.records).delete({});
      },
      mode: "offset",
    });
  });
}
