import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { runWebAuthnPaginationContract } from "../../../security/tests/support/webauthnPaginationContract";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleWebAuthnCredentialStore } from "../../nodefony/src/DrizzleWebAuthnCredentialStore";
import {
  registerWebAuthnCredentialEntity,
  WEBAUTHN_CREDENTIAL_ENTITY,
} from "../../nodefony/entity/webAuthnCredentialEntity";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";

/**
 * Enveloppe Drizzle du **banc de contrat UNIQUE** du listing des passkeys
 * (`@nodefony/security`) : gère le cycle de vie ORM (register entité → connect →
 * disconnect + unregister scopé) et branche le harness en mode **offset**. Aucune
 * assertion ici — partagées avec mémoire/Mongoose/Redis. `skip` gate pg/mysql.
 */
export function runDrizzleWebAuthnPagination(opts: {
  label: string;
  connector: string;
  config: ConstructorParameters<typeof DrizzleOrm>[1];
  dialect?: SqlDialect;
  skip?: boolean;
}): void {
  describe.skipIf(opts.skip ?? false)(opts.label, () => {
    let orm: DrizzleOrm;
    let store: DrizzleWebAuthnCredentialStore;

    beforeAll(async () => {
      registerWebAuthnCredentialEntity(opts.connector, opts.dialect); // AVANT connect
      orm = new DrizzleOrm(opts.connector, opts.config);
      await orm.connect();
      store = DrizzleWebAuthnCredentialStore.from(orm);
    });
    afterAll(async () => {
      await orm.disconnect();
      entityRegistry.unregister(WEBAUTHN_CREDENTIAL_ENTITY, opts.connector);
      ormRegistry.unregister(opts.connector);
    });

    runWebAuthnPaginationContract({
      store: () => store,
      clear: async () => {
        await orm.getRepository(WEBAUTHN_CREDENTIAL_ENTITY).delete({});
      },
      mode: "offset",
    });
  });
}
