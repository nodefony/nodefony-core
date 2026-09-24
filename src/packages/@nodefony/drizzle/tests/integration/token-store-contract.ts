import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleTokenStore } from "../../nodefony/src/DrizzleTokenStore";
import {
  registerTokenEntities,
  TOKEN_ENTITY_NAMES,
} from "../../nodefony/entity/tokenEntity";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";
import { runTokenStoreContract as runSharedTokenStoreContract } from "../../../security/tests/support/tokenStoreContract";

/**
 * Enveloppe Drizzle du **banc de contrat UNIQUE** du store de jetons (le banc
 * vit chez `@nodefony/security`, propriétaire du contrat `ITokenStore`) : elle
 * gère le cycle de vie ORM (entités → connect → disconnect + désinscription
 * scopée) et branche le harness. **Aucune assertion ici** — elles sont
 * partagées avec la mémoire et avec l'adaptateur documentaire.
 *
 * LA même suite sur les TROIS dialectes (sqlite toujours ; postgres/mysql gatés
 * par l'infra) : `upsert` = `ON CONFLICT` (sqlite/pg) vs `ON DUPLICATE KEY
 * UPDATE` + relecture (mysql) ; `$max` = `MAX()` vs `GREATEST()` ; epoch ms =
 * `integer` vs `bigint` ; JSON = `text` vs `jsonb` vs `json`.
 */

/** Options d'un run du banc (un dialecte = un fichier consommateur). */
export interface ITokenStoreContractOptions {
  dialect: SqlDialect;
  /** Clé UNIQUE d'ORM (isole les 3 entités dans le registre process-wide). */
  connector: string;
  /** Options de connexion (filename sqlite / url pg-mysql). */
  connection: { filename?: string; url?: string };
}

export function runTokenStoreContract(opts: ITokenStoreContractOptions): void {
  const { dialect, connector } = opts;
  let orm: DrizzleOrm;

  const purge = async (): Promise<void> => {
    // Tables persistantes entre les runs sur pg/mysql (IF NOT EXISTS).
    await orm.getRepository(TOKEN_ENTITY_NAMES.records).delete({});
    await orm.getRepository(TOKEN_ENTITY_NAMES.denied).delete({});
    await orm.getRepository(TOKEN_ENTITY_NAMES.revocations).delete({});
  };

  beforeAll(async () => {
    registerTokenEntities(connector, dialect); // AVANT connect (DDL dérivé au boot)
    orm = new DrizzleOrm(connector, { dialect, ...opts.connection });
    await orm.connect();
    await purge();
  });

  afterAll(async () => {
    await purge();
    await orm.disconnect();
    entityRegistry.unregister(TOKEN_ENTITY_NAMES.records, connector);
    entityRegistry.unregister(TOKEN_ENTITY_NAMES.denied, connector);
    entityRegistry.unregister(TOKEN_ENTITY_NAMES.revocations, connector);
    ormRegistry.unregister(connector);
  });

  runSharedTokenStoreContract({
    create: (now, retention) => DrizzleTokenStore.from(orm, now, retention),
    clear: purge,
    warm: async () => {
      const records = orm.getRepository(TOKEN_ENTITY_NAMES.records);
      await Promise.all(Array.from({ length: 10 }, () => records.count({})));
    },
  });
}
