import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleWebhookStore } from "../../nodefony/src/DrizzleWebhookStore";
import {
  registerWebhookEndpointEntity,
  WEBHOOK_ENDPOINT_ENTITY,
} from "../../nodefony/entity/webhookEndpointEntity";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";
import { runWebhookStoreContract as runSharedWebhookStoreContract } from "../../../security/tests/support/webhookStoreContract";

/**
 * Enveloppe Drizzle du **banc de contrat UNIQUE** du store d'endpoints webhook
 * (le banc vit chez `@nodefony/security`, propriétaire du contrat
 * `IWebhookStore`) : elle gère le cycle de vie ORM (entité → connect →
 * disconnect + désinscription scopée) et branche le harness. **Aucune assertion
 * ici** — elles sont partagées avec la mémoire et avec l'adaptateur documentaire.
 *
 * LA même suite sur les TROIS dialectes (sqlite toujours ; postgres/mysql gatés
 * par l'infra) : le booléen `enabled` et les colonnes JSON sont précisément ce
 * qui diverge entre moteurs.
 */

export interface IWebhookStoreContractOptions {
  dialect: SqlDialect;
  connector: string;
  connection: { filename?: string; url?: string };
}

export function runWebhookStoreContract(
  opts: IWebhookStoreContractOptions,
): void {
  const { dialect, connector } = opts;
  let orm: DrizzleOrm;
  let store: DrizzleWebhookStore;

  const purge = async (): Promise<void> => {
    await orm.getRepository(WEBHOOK_ENDPOINT_ENTITY).delete({});
  };

  beforeAll(async () => {
    registerWebhookEndpointEntity(connector, dialect); // AVANT connect
    orm = new DrizzleOrm(connector, { dialect, ...opts.connection });
    await orm.connect();
    store = DrizzleWebhookStore.from(orm);
    await purge();
  });

  afterAll(async () => {
    await purge();
    await orm.disconnect();
    entityRegistry.unregister(WEBHOOK_ENDPOINT_ENTITY, connector);
    ormRegistry.unregister(connector);
  });

  runSharedWebhookStoreContract({
    store: () => store,
    clear: purge,
    // Un pool froid sérialise les premières requêtes et masque les courses que
    // le cas d'écriture concurrente existe pour débusquer.
    warm: async () => {
      const repo = orm.getRepository(WEBHOOK_ENDPOINT_ENTITY);
      await Promise.all(Array.from({ length: 10 }, () => repo.count({})));
    },
  });
}
