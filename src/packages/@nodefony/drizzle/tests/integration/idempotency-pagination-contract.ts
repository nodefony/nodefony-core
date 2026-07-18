import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IdempotentResponse } from "nodefony";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleIdempotencyStore } from "../../nodefony/src/DrizzleIdempotencyStore";
import {
  registerIdempotencyEntities,
  IDEMPOTENCY_ENTITY_NAME,
} from "../../nodefony/entity/idempotencyEntity";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";
import { runIdempotencyPaginationContract } from "../../../../../nodefony/src/tests/support/idempotencyPaginationContract";

/**
 * Enveloppe Drizzle du **banc de contrat UNIQUE** du listing d'idempotence (le
 * banc vit au CORE, propriétaire du contrat `IIdempotencyStore`) : gère le cycle
 * de vie ORM (register entité → connect → disconnect + unregister scopé) et
 * branche le harness en mode **offset**. Aucune assertion ici — partagées avec
 * la mémoire et Redis. `skip` gate pg/mysql.
 */

/** Bail in-flight / rétention de la réponse mémorisée (tests déterministes). */
const LEASE_MS = 60_000;
const TTL_MS = 600_000;

/** Réponse mémorisée de référence (le banc vérifie qu'elle NE SORT PAS). */
const RESPONSE: IdempotentResponse = { status: 201, body: { id: "a" } };

export function runDrizzleIdempotencyPagination(opts: {
  label: string;
  connector: string;
  config: ConstructorParameters<typeof DrizzleOrm>[1];
  dialect?: SqlDialect;
  skip?: boolean;
}): void {
  describe.skipIf(opts.skip ?? false)(opts.label, () => {
    let orm: DrizzleOrm;
    let store: DrizzleIdempotencyStore;
    // Horloge contrôlée : le store filtre les entrées échues à la LECTURE, donc
    // la fenêtre courante fait partie du contrat testé.
    let clock = 1_000_000;

    beforeAll(async () => {
      registerIdempotencyEntities(opts.connector, opts.dialect); // AVANT connect
      orm = new DrizzleOrm(opts.connector, opts.config);
      await orm.connect();
      store = DrizzleIdempotencyStore.from(orm, () => clock, LEASE_MS, TTL_MS);
    });
    afterAll(async () => {
      await orm.disconnect();
      entityRegistry.unregister(IDEMPOTENCY_ENTITY_NAME, opts.connector);
      ormRegistry.unregister(opts.connector);
    });

    runIdempotencyPaginationContract({
      store: () => store,
      mode: "offset",
      // Sur une base RÉELLE la table survit au run précédent : on purge
      // physiquement (≠ sqlite `:memory:`, jeté à chaque process) puis on repart
      // d'une fenêtre temporelle propre.
      clear: async () => {
        await orm.getRepository(IDEMPOTENCY_ENTITY_NAME).delete({});
        clock = 30_000_000;
      },
      seed: async (prefix, n) => {
        for (let i = 0; i < n; i += 1) {
          const key = `${prefix}-${String(i).padStart(2, "0")}`;
          await store.begin(key, "fp");
          if (i % 2 === 0) await store.complete(key, RESPONSE);
        }
      },
      // Le temps passe au-delà de la plus longue échéance semée : les clés sont
      // encore EN BASE (le GC applicatif n'est pas passé) mais ne sont plus
      // opposables — le listing doit déjà les ignorer.
      expireSeeded: async () => {
        clock += TTL_MS + LEASE_MS + 1;
      },
    });
  });
}
