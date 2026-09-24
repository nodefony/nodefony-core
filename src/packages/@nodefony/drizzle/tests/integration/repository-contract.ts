import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import {
  createFrameworkTableFactory,
  type FrameworkTableFactory,
} from "../../nodefony/entity/colKit";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";
import {
  PROBE_ENTITY,
  runRepositoryContract as runSharedRepositoryContract,
} from "../../../orm-core/tests/support/repositoryContract";

/**
 * Enveloppe Drizzle du **banc de contrat UNIQUE** `IRepository` + `IOrm` (le
 * banc vit chez `@nodefony/orm-core`, propriétaire du contrat) : elle déclare
 * l'entité sonde dans le dialecte, gère le cycle de vie ORM et branche le
 * harnais. **Aucune assertion de contrat ici** — seule la sonde propre au
 * moteur (stockage sqlite / pool serveur) reste de ce côté.
 *
 * LA même suite sur les TROIS dialectes (sqlite toujours ; postgres/mysql gatés
 * par l'infra) — et sur MongoDB par l'adaptateur documentaire.
 */

/** Table sonde couvrant tous les kinds + defaults JS + index. */
const probeFactory: FrameworkTableFactory = createFrameworkTableFactory({
  name: PROBE_ENTITY,
  columns: {
    id: { kind: "text", primaryKey: true, defaultFn: () => randomUUID() },
    name: { kind: "text", notNull: true },
    age: { kind: "int", notNull: true },
    score: { kind: "int", notNull: true },
    tags: { kind: "json" },
    active: { kind: "bool", notNull: true, defaultFn: () => true },
    createdAt: { kind: "epochMs", notNull: true, defaultFn: () => Date.now() },
    note: { kind: "text" },
  },
  indexes: [{ name: "repo_contract_probe_age_idx", on: ["age"] }],
});

/** Options d'un run du banc (un dialecte = un fichier consommateur). */
export interface IContractRunOptions {
  dialect: SqlDialect;
  /** Clé UNIQUE d'ORM (isole l'entité sonde dans le registre process-wide). */
  connector: string;
  /** Options de connexion (filename sqlite / url pg-mysql). */
  connection: { filename?: string; url?: string };
}

/**
 * Déroule la suite de contrat sur un dialecte. À appeler DANS un `describe`
 * (éventuellement `describe.skipIf(!url)`) du fichier consommateur.
 */
export function runRepositoryContract(opts: IContractRunOptions): void {
  const { dialect, connector } = opts;
  let orm: DrizzleOrm;

  beforeAll(async () => {
    entityRegistry.register({
      connector,
      name: PROBE_ENTITY,
      schema: probeFactory(dialect),
    });
    orm = new DrizzleOrm(connector, { dialect, ...opts.connection });
    await orm.connect(); // le banc purge la table (persistante entre les runs)
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister(PROBE_ENTITY, connector);
    ormRegistry.unregister(connector);
  });

  runSharedRepositoryContract({
    orm: () => orm,
    offline: () => ({
      orm: new DrizzleOrm(`${connector}_offline`, {
        dialect,
        ...opts.connection,
      }),
      dispose: () => ormRegistry.unregister(`${connector}_offline`),
    }),
    driver: dialect,
    savepoints: true,
    assertProbe: async (o) => {
      const p = await o.probe!();
      if (dialect === "sqlite") {
        // Mono-connexion : la sonde utile est le stockage (PRAGMA).
        assert.equal(typeof p.storage?.sizeBytes, "number");
        return;
      }
      // Base serveur : le pool EST la métrique qui compte (saturation à
      // `pool.max` = la falaise de RPS mesurée au banc de charge).
      assert.equal(typeof p.pool?.size, "number", "taille max du pool");
      assert.equal(typeof p.pool?.available, "number", "connexions idle");
      assert.equal(typeof p.pool?.borrowed, "number", "connexions en usage");
      assert.ok((p.pool?.size ?? 0) > 0, "un plafond de 0 ne veut rien dire");
      // La sonde doit REFLÉTER l'état, pas seulement avoir la bonne forme : une
      // transaction tient une connexion dédiée, donc elle est EMPRUNTÉE. Sans
      // cette assertion, des compteurs figés à 0 passeraient le test.
      await o.transaction(async () => {
        const during = await o.probe!();
        assert.ok(
          (during.pool?.borrowed ?? 0) >= 1,
          `transaction en cours → ≥1 connexion empruntée, sonde: ${JSON.stringify(during.pool)}`,
        );
      });
    },
  });
}
