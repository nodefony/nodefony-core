import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import { MongooseAuditStore } from "../../nodefony/src/MongooseAuditStore";
import {
  registerAuditEntities,
  AUDIT_ENTITY_NAMES,
} from "../../nodefony/entity/auditEventEntity";
import { runAuditBurstContract } from "../../../security/tests/support/auditBurstContract";

const ORM = "audit_flow_test";
const URI = mongoTestUri(ORM);

/**
 * Enveloppe Mongoose du banc de RAFALE du journal d'audit — le banc vit chez
 * `@nodefony/security`, propriétaire du contrat `IAuditStore`, et
 * `@nodefony/drizzle` branche EXACTEMENT le même sur ses trois dialectes.
 * Aucune assertion ici : elle gère le cycle de vie ORM et rien d'autre.
 */
describe.skipIf(!URI)("Mongoose — MongooseAuditStore sous rafale", () => {
  let orm: MongooseOrm;
  let store: MongooseAuditStore;

  beforeAll(async () => {
    registerAuditEntities(ORM);
    orm = new MongooseOrm(ORM, URI!);
    await orm.connect();
    store = MongooseAuditStore.from(orm);
  });

  afterAll(async () => {
    await orm?.disconnect();
    entityRegistry.unregister(AUDIT_ENTITY_NAMES.events, ORM);
    ormRegistry.unregister(ORM);
  });

  runAuditBurstContract({
    store: () => store,
    clear: async () => {
      await orm.getRepository(AUDIT_ENTITY_NAMES.events).delete({});
    },
    removeEvents: async (ids) => {
      await orm
        .getRepository(AUDIT_ENTITY_NAMES.events)
        .delete({ id: { $in: ids } });
    },
  });
});
