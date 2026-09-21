import { entityRegistry, ormRegistry, type Criteria } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleAuditStore } from "../../nodefony/src/DrizzleAuditStore";
import {
  registerAuditEntities,
  AUDIT_ENTITY_NAMES,
  type AuditEventRow,
} from "../../nodefony/entity/auditEventEntity";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";
import { runAuditBurstContract } from "../../../security/tests/support/auditBurstContract";

/**
 * Enveloppe Drizzle du banc de RAFALE du journal d'audit — le banc vit chez
 * `@nodefony/security`, propriétaire du contrat `IAuditStore`, et
 * `@nodefony/mongoose` branche EXACTEMENT le même. Aucune assertion ici.
 *
 * Pourquoi ce banc existe des DEUX côtés : le risque est le même, et il ne
 * dépend pas du moteur. `DrizzleAuditStore` trie par `(ts DESC, id DESC)` avec
 * le même curseur composite, et reçoit du service les mêmes identifiants
 * séquentiels en base 36. Le banc de pagination du contrat ne sème que 12
 * événements dont 3 en collision — assez pour le principe, pas pour une rafale.
 *
 * Il est rejoué sur les trois dialectes : l'ordre composite se résout côté
 * serveur, et la comparaison de chaînes d'un identifiant dépend de la
 * **collation** — celle de MySQL n'est pas celle de PostgreSQL.
 */
const PG_URL = process.env.NF_PG_URL;
const MYSQL_URL = process.env.NF_MYSQL_URL;

function runOn(opts: {
  label: string;
  connector: string;
  dialect: SqlDialect;
  connection: { filename?: string; url?: string };
  skip?: boolean;
}): void {
  describe.skipIf(opts.skip ?? false)(opts.label, () => {
    let orm: DrizzleOrm;
    let store: DrizzleAuditStore;

    beforeAll(async () => {
      registerAuditEntities(opts.connector, opts.dialect); // AVANT connect
      orm = new DrizzleOrm(opts.connector, {
        dialect: opts.dialect,
        ...opts.connection,
      });
      await orm.connect();
      store = DrizzleAuditStore.from(orm);
    });

    afterAll(async () => {
      await orm?.disconnect();
      entityRegistry.unregister(AUDIT_ENTITY_NAMES.events, opts.connector);
      ormRegistry.unregister(opts.connector);
    });

    runAuditBurstContract({
      store: () => store,
      clear: async () => {
        await orm.getRepository(AUDIT_ENTITY_NAMES.events).delete({});
      },
      removeEvents: async (ids) => {
        await orm
          .getRepository<AuditEventRow>(AUDIT_ENTITY_NAMES.events)
          .delete({ id: { $in: ids } } as unknown as Criteria<AuditEventRow>);
      },
    });
  });
}

runOn({
  label: "Drizzle (sqlite) — journal d'audit sous rafale",
  connector: "audit_burst_sqlite",
  dialect: "sqlite",
  connection: { filename: ":memory:" },
});

runOn({
  label: "Drizzle (postgres) — journal d'audit sous rafale",
  connector: "audit_burst_pg",
  dialect: "postgres",
  connection: { url: PG_URL },
  skip: !PG_URL,
});

runOn({
  label: "Drizzle (mysql) — journal d'audit sous rafale",
  connector: "audit_burst_mysql",
  dialect: "mysql",
  connection: { url: MYSQL_URL },
  skip: !MYSQL_URL,
});
