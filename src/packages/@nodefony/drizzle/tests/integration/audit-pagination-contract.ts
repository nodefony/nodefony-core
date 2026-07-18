import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { runAuditPaginationContract } from "../../../security/tests/support/auditPaginationContract";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleAuditStore } from "../../nodefony/src/DrizzleAuditStore";
import {
  AUDIT_ENTITY_NAMES,
  registerAuditEntities,
} from "../../nodefony/entity/auditEventEntity";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";

/**
 * Enveloppe Drizzle du **banc de contrat UNIQUE** du journal d'audit paginé
 * (`@nodefony/security`) : gère le cycle de vie ORM (register entité → connect →
 * disconnect + unregister scopé) et branche le harness. Aucune assertion ici —
 * elles sont partagées avec le store mémoire. `skip` gate pg/mysql.
 */
export function runDrizzleAuditPagination(opts: {
  label: string;
  connector: string;
  config: ConstructorParameters<typeof DrizzleOrm>[1];
  dialect?: SqlDialect;
  skip?: boolean;
}): void {
  describe.skipIf(opts.skip ?? false)(opts.label, () => {
    let orm: DrizzleOrm;
    let store: DrizzleAuditStore;

    beforeAll(async () => {
      registerAuditEntities(opts.connector, opts.dialect); // AVANT connect
      orm = new DrizzleOrm(opts.connector, opts.config);
      await orm.connect();
      store = DrizzleAuditStore.from(orm);
    });
    afterAll(async () => {
      await orm.disconnect();
      entityRegistry.unregister(AUDIT_ENTITY_NAMES.events, opts.connector);
      ormRegistry.unregister(opts.connector);
    });

    runAuditPaginationContract({
      store: () => store,
      clear: async () => {
        await orm.getRepository(AUDIT_ENTITY_NAMES.events).delete({});
      },
    });
  });
}
