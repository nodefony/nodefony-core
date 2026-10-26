import assert from "node:assert/strict";
import { defineEntity, entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { defineTable } from "../../nodefony/entity/colKit";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";

/**
 * `describeEntity` répond SANS connexion.
 *
 * Une commande en ligne (`nodefony inspect graph`) démarre le noyau sans
 * connecter l'ORM. Les colonnes n'étaient lues que sur les tables résolues à la
 * connexion : sur un schéma de 431 entités, la commande rendait 0 colonne et
 * 0 relation, quand la console, sur l'application démarrée, en montrait 5 659
 * et 241. La description d'une entité suffit pourtant à connaître ses colonnes
 * et ses clés étrangères, pour chaque dialecte.
 *
 * Le nom d'ENTITÉ diffère ici du nom de TABLE : la cible d'une clé étrangère
 * doit ressortir sous le premier, celui que le graphe relie.
 */
const CUSTOMER = defineTable({
  name: "llx_societe",
  columns: {
    rowid: { kind: "serial", primaryKey: true },
    nom: { kind: "string", length: 128, notNull: true },
  },
});
const INVOICE = defineTable({
  name: "llx_facture",
  columns: {
    rowid: { kind: "serial", primaryKey: true },
    ref: { kind: "string", length: 30, notNull: true },
    fk_soc: { kind: "ref", target: () => CUSTOMER },
  },
});

const DIALECTS: SqlDialect[] = ["sqlite", "postgres", "mysql"];

describe("describeEntity — sans connexion, d'après la description", () => {
  for (const dialect of DIALECTS) {
    it(`${dialect} : colonnes et clé étrangère d'une entité jamais connectée`, () => {
      const connector = `describe_offline_${dialect}`;
      entityRegistry.register({
        ...defineEntity({ name: "Customer", module: "test", schema: CUSTOMER }),
        connector,
      });
      entityRegistry.register({
        ...defineEntity({ name: "Invoice", module: "test", schema: INVOICE }),
        connector,
      });
      const orm = new DrizzleOrm(connector, {
        dialect,
        ...(dialect === "sqlite"
          ? { filename: ":memory:" }
          : { url: `${dialect}://nobody@127.0.0.1:1/none` }),
      });
      try {
        assert.equal(orm.isConnected(), false);
        const columns = orm.describeEntity("Invoice");
        assert.deepEqual(
          columns.map((c) => c.name),
          ["rowid", "ref", "fk_soc"],
        );
        assert.deepEqual(columns.find((c) => c.name === "fk_soc")?.references, {
          entity: "Customer",
          column: "rowid",
        });
        assert.deepEqual(orm.describeEntity("Unknown"), []);
      } finally {
        entityRegistry.unregister("Invoice", connector);
        entityRegistry.unregister("Customer", connector);
        ormRegistry.unregister(connector);
      }
    });
  }
});
