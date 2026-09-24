import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleWebAuthnCredentialStore } from "../../nodefony/src/DrizzleWebAuthnCredentialStore";
import {
  registerWebAuthnCredentialEntity,
  WEBAUTHN_CREDENTIAL_ENTITY,
} from "../../nodefony/entity/webAuthnCredentialEntity";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";
import { runWebAuthnStoreContract as runSharedWebAuthnStoreContract } from "../../../security/tests/support/webAuthnStoreContract";

/**
 * Enveloppe Drizzle du **banc de contrat UNIQUE** du store de passkeys (le banc
 * vit chez `@nodefony/security`, propriétaire du contrat
 * `IWebAuthnCredentialStore`) : elle gère le cycle de vie ORM (entité → connect
 * → disconnect + désinscription scopée) et branche le harness. **Aucune
 * assertion ici** — elles sont partagées avec la mémoire et avec l'adaptateur
 * documentaire.
 *
 * LA même suite sur les TROIS dialectes (sqlite toujours ; postgres/mysql gatés
 * par l'infra) : les booléens traversent trois encodages (`integer
 * mode:boolean` sqlite / `boolean` pg / `tinyint` mysql).
 */

export interface IWebAuthnStoreContractOptions {
  dialect: SqlDialect;
  connector: string;
  connection: { filename?: string; url?: string };
}

export function runWebAuthnStoreContract(
  opts: IWebAuthnStoreContractOptions,
): void {
  const { dialect, connector } = opts;
  let orm: DrizzleOrm;
  let store: DrizzleWebAuthnCredentialStore;

  const purge = async (): Promise<void> => {
    await orm.getRepository(WEBAUTHN_CREDENTIAL_ENTITY).delete({});
  };

  beforeAll(async () => {
    registerWebAuthnCredentialEntity(connector, dialect); // AVANT connect
    orm = new DrizzleOrm(connector, { dialect, ...opts.connection });
    await orm.connect();
    store = DrizzleWebAuthnCredentialStore.from(orm);
    await purge();
  });

  afterAll(async () => {
    await purge();
    await orm.disconnect();
    entityRegistry.unregister(WEBAUTHN_CREDENTIAL_ENTITY, connector);
    ormRegistry.unregister(connector);
  });

  runSharedWebAuthnStoreContract({
    store: () => store,
    clear: purge,
    // Un pool froid sérialise les premières requêtes et masque les courses que
    // le cas d'écriture concurrente existe pour débusquer.
    warm: async () => {
      const repo = orm.getRepository(WEBAUTHN_CREDENTIAL_ENTITY);
      await Promise.all(Array.from({ length: 10 }, () => repo.count({})));
    },
  });
}
