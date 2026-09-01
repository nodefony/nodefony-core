import assert from "node:assert/strict";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { Entity, entityRegistry } from "@nodefony/orm-core";
import {
  registerDrizzleFrameworkStores,
  FRAMEWORK_CONNECTOR,
} from "../../nodefony/registerStores";
import { createUserEntity } from "../../nodefony/entity/userTable";

/**
 * Une entité `User` possédée par l'application doit porter les colonnes que le
 * framework LIT — et l'apprendre AU DÉMARRAGE.
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
 */
describe("contrat utilisateur — l'entité de l'application est contrôlée au démarrage", () => {
  /** Une entité `User` d'application à qui il manque `roles`. */
  class AmputeeUserEntity extends Entity<SQLiteTable> {
    readonly name = "User";
    readonly connector = FRAMEWORK_CONNECTOR;
    override getSchema(): SQLiteTable {
      return sqliteTable("User", {
        id: text("id").primaryKey(),
        identifier: text("identifier").notNull().unique(),
        password: text("password"),
        // `roles` RETIRÉE — c'est tout le propos.
        createdAt: text("createdAt").notNull(),
        updatedAt: text("updatedAt").notNull(),
      }) as SQLiteTable;
    }
  }

  const forget = (): void => {
    if (entityRegistry.has("User", FRAMEWORK_CONNECTOR)) {
      entityRegistry.unregister("User", FRAMEWORK_CONNECTOR);
    }
  };

  it("REFUSE, en nommant la colonne ET son lecteur", () => {
    entityRegistry.register(new AmputeeUserEntity());
    try {
      assert.throws(
        () => registerDrizzleFrameworkStores("sqlite"),
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
          return true;
        },
      );
    } finally {
      forget();
    }
  });

  it("LAISSE PASSER une entité d'application complète", () => {
    entityRegistry.register(createUserEntity(FRAMEWORK_CONNECTOR, "sqlite"));
    try {
      const report = registerDrizzleFrameworkStores("sqlite");
      assert.ok(report.appOwned.includes("User"));
    } finally {
      forget();
    }
  });

  it("LAISSE PASSER quand l'application ne possède PAS l'entité", () => {
    // Le repli du framework est DÉRIVÉ du contrat : le contrôler ici ne dirait
    // que ce que le banc de parité dit mieux, et sur les trois dialectes.
    try {
      const report = registerDrizzleFrameworkStores("sqlite");
      assert.ok(report.registered.includes("User"));
    } finally {
      forget();
    }
  });
});
