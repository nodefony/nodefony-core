import assert from "node:assert/strict";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { pgTable, text as pgText } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";
import { mysqlTable, varchar } from "drizzle-orm/mysql-core";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import { Entity, entityRegistry } from "@nodefony/orm-core";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";
import {
  registerDrizzleFrameworkStores,
  FRAMEWORK_CONNECTOR,
} from "../../nodefony/registerStores";
import {
  createUserEntity,
  userTableColumns,
} from "../../nodefony/entity/userTable";

/**
 * Une entité `User` possédée par l'application doit porter les colonnes que le
 * framework LIT — et l'apprendre AU DÉMARRAGE, sur les TROIS dialectes.
 *
 * Sans ce contrôle, le manque est silencieux de bout en bout : la migration
 * s'applique, le démarrage rend un code de sortie nul, et la commande qui liste
 * les comptes les AFFICHE. Le défaut n'éclate qu'au premier accès à la colonne
 * absente, peut-être des semaines plus tard, dans un chemin peu fréquenté —
 * exactement le moment où le lien avec la colonne retirée est perdu.
 *
 * Ce que le banc exige du message, et pas seulement du refus : la colonne ET
 * son lecteur. Qui a retiré `roles` sait qu'il l'a retirée ; ce qu'il ignore,
 * c'est que le filtre `?role=` et le compte des administrateurs actifs la
 * lisent.
 *
 * **Pourquoi les trois dialectes, et pas seulement sqlite.** Le refus repose sur
 * {@link userTableColumns}, dont la grammaire de lecture CHANGE avec le dialecte
 * — `getTableConfig` n'est pas la même fonction pour pg, mysql et sqlite, et la
 * mauvaise appliquée à une table rend un objet VIDE sans lever. Or le contrôle
 * de démarrage sort en silence sur une table qui ne se laisse pas lire
 * (délibérément : une table illisible ne prouve pas qu'une colonne manque). Un
 * banc qui n'éprouve que sqlite laisserait donc passer une branche pg ou mysql
 * qui ne lit RIEN — le refus ne se déclencherait jamais, sans un mot, et
 * précisément sur les moteurs de production.
 */
describe("contrat utilisateur — l'entité de l'application est contrôlée au démarrage", () => {
  /** Les colonnes que porte une entité d'application à qui il manque `roles`. */
  const AMPUTEE: Record<SqlDialect, () => unknown> = {
    sqlite: () =>
      sqliteTable("User", {
        id: text("id").primaryKey(),
        identifier: text("identifier").notNull().unique(),
        password: text("password"),
        // `roles` RETIRÉE — c'est tout le propos.
        createdAt: text("createdAt").notNull(),
        updatedAt: text("updatedAt").notNull(),
      }),
    postgres: () =>
      pgTable("User", {
        id: pgText("id").primaryKey(),
        identifier: pgText("identifier").notNull().unique(),
        password: pgText("password"),
        createdAt: pgText("createdAt").notNull(),
        updatedAt: pgText("updatedAt").notNull(),
      }),
    mysql: () =>
      mysqlTable("User", {
        id: varchar("id", { length: 255 }).primaryKey(),
        identifier: varchar("identifier", { length: 255 }).notNull().unique(),
        password: varchar("password", { length: 255 }),
        createdAt: varchar("createdAt", { length: 255 }).notNull(),
        updatedAt: varchar("updatedAt", { length: 255 }).notNull(),
      }),
  };

  /** Une entité `User` d'application amputée, dans la grammaire d'un dialecte. */
  const amputeeEntity = (dialect: SqlDialect): Entity<unknown> => {
    class AmputeeUserEntity extends Entity<unknown> {
      readonly name = "User";
      readonly connector = FRAMEWORK_CONNECTOR;
      override getSchema(): unknown {
        return AMPUTEE[dialect]();
      }
    }
    return new AmputeeUserEntity();
  };

  const forget = (): void => {
    if (entityRegistry.has("User", FRAMEWORK_CONNECTOR)) {
      entityRegistry.unregister("User", FRAMEWORK_CONNECTOR);
    }
  };

  // Le registre est global au process : sans ce nettoyage, l'entité laissée par
  // le dialecte précédent serait relue dans la grammaire du suivant — donc lue
  // VIDE, et le banc conclurait « rien à refuser » pour la mauvaise raison.
  beforeEach(forget);
  afterEach(forget);

  const DIALECTS: SqlDialect[] = ["sqlite", "postgres", "mysql"];

  for (const dialect of DIALECTS) {
    describe(dialect, () => {
      it("REFUSE une entité amputée, en nommant la colonne ET son lecteur", () => {
        entityRegistry.register(amputeeEntity(dialect) as Entity<SQLiteTable>);
        assert.throws(
          () => registerDrizzleFrameworkStores(dialect),
          (error: Error) => {
            assert.match(
              error.message,
              /\broles\b/u,
              "la colonne doit être nommée",
            );
            assert.match(
              error.message,
              /countActiveAdmins|role=/u,
              "un lecteur de la colonne doit être nommé",
            );
            // Un refus qui ne dit pas quoi faire fait chercher au hasard.
            assert.match(error.message, /orm:generate/u);
            // 🔴 Le TYPE de l'erreur décide si le refus REFUSE quoi que ce soit.
            // Une `Error` ordinaire levée pendant le boot est absorbée par la
            // politique de résilience du kernel : WARNING, module écarté,
            // application démarrée en « BOOT dégradé », code de sortie nul.
            // Mesuré sur une application générée — le refus était parfaitement
            // rédigé et sans le moindre effet.
            assert.equal(
              error.name,
              "BootConfigurationError",
              "une Error ordinaire est dégradée en avertissement au boot",
            );
            return true;
          },
        );
      });

      it("LIT la table dans SA grammaire — la lecture n'est jamais vide", () => {
        // Le garde-fou du silence : `assertAppUserEntityHonoursContract` sort
        // sans rien dire sur une table qui rend zéro colonne. Si cette lecture
        // régressait, le refus ci-dessus disparaîtrait — et le banc resterait
        // vert si on ne mesurait que le refus.
        const columns = userTableColumns(AMPUTEE[dialect](), dialect);
        assert.ok(
          columns.size >= 5,
          `${dialect} : la table amputée doit rendre ses colonnes, pas un objet vide`,
        );
        assert.ok(columns.has("identifier"));
        assert.equal(columns.has("roles"), false);
      });

      it("LAISSE PASSER une entité d'application complète", () => {
        entityRegistry.register(createUserEntity(FRAMEWORK_CONNECTOR, dialect));
        const report = registerDrizzleFrameworkStores(dialect);
        assert.ok(report.appOwned.includes("User"));
      });

      it("LAISSE PASSER quand l'application ne possède PAS l'entité", () => {
        // Le repli du framework est DÉRIVÉ du contrat : le contrôler ici ne
        // dirait que ce que le banc de parité dit mieux.
        const report = registerDrizzleFrameworkStores(dialect);
        assert.ok(report.registered.includes("User"));
      });
    });
  }

  it("une table lue dans la MAUVAISE grammaire LÈVE — d'où le contrôle par dialecte", () => {
    // Ce fait est la raison d'être de `userTableColumns` : ce n'est pas un
    // défaut à corriger, c'est le comportement de drizzle. Le graver ici dit
    // POURQUOI le dialecte doit suivre l'entité jusqu'au point de lecture — et
    // POURQUOI le contrôle de démarrage entoure la lecture d'un `catch` : c'est
    // une exception qu'il absorbe, pas une table vide.
    for (const [table, reader] of [
      ["postgres", "sqlite"],
      ["sqlite", "mysql"],
      ["mysql", "postgres"],
    ] as [SqlDialect, SqlDialect][]) {
      assert.throws(
        () => userTableColumns(AMPUTEE[table](), reader),
        TypeError,
        `table ${table} lue en ${reader} : drizzle doit lever, pas rendre une table vide`,
      );
    }
  });
});
