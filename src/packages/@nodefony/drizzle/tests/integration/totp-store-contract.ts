import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleTotpSecretStore } from "../../nodefony/src/DrizzleTotpSecretStore";
import {
  registerTotpSecretEntity,
  TOTP_SECRET_ENTITY,
} from "../../nodefony/entity/totpSecretEntity";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";
import { runTotpStoreContract as runSharedTotpStoreContract } from "../../../security/tests/support/totpStoreContract";

/**
 * Enveloppe Drizzle du **banc de contrat UNIQUE** du store 2FA (le banc vit chez
 * `@nodefony/security`, propriétaire du contrat `ITotpSecretStore`) : elle gère
 * le cycle de vie ORM (entité → connect → disconnect + désinscription scopée) et
 * branche le harness. **Aucune assertion ici** — elles sont partagées avec la
 * mémoire et avec l'adaptateur documentaire.
 *
 * LA même suite sur les TROIS dialectes (sqlite toujours ; postgres/mysql gatés
 * par l'infra) : c'est ce rejeu qui fait la parité, le `LIKE` et son échappement
 * étant précisément ce qui diverge entre moteurs.
 */

export interface ITotpStoreContractOptions {
  dialect: SqlDialect;
  connector: string;
  connection: { filename?: string; url?: string };
}

export function runTotpStoreContract(opts: ITotpStoreContractOptions): void {
  const { dialect, connector } = opts;
  let orm: DrizzleOrm;
  let store: DrizzleTotpSecretStore;

  beforeAll(async () => {
    registerTotpSecretEntity(connector, dialect); // AVANT connect
    orm = new DrizzleOrm(connector, { dialect, ...opts.connection });
    await orm.connect();
    store = DrizzleTotpSecretStore.from(orm);
    await orm.getRepository(TOTP_SECRET_ENTITY).delete({});
  });

  afterAll(async () => {
    await orm.getRepository(TOTP_SECRET_ENTITY).delete({});
    await orm.disconnect();
    entityRegistry.unregister(TOTP_SECRET_ENTITY, connector);
    ormRegistry.unregister(connector);
  });

  runSharedTotpStoreContract({
    store: () => store,
    clear: async () => {
      await orm.getRepository(TOTP_SECRET_ENTITY).delete({});
    },
    newStore: () => DrizzleTotpSecretStore.from(orm),
    countFor: (userId) =>
      orm.getRepository(TOTP_SECRET_ENTITY).count({ userId }),
    // Un pool froid sérialise les premières requêtes et masque les courses que
    // le cas d'écriture concurrente existe pour débusquer.
    warm: async () => {
      const repo = orm.getRepository(TOTP_SECRET_ENTITY);
      await Promise.all(Array.from({ length: 10 }, () => repo.count({})));
    },
  });
}
