/**
 * La table `User` du framework doit être RÉFÉRENÇABLE par une entité voisine.
 *
 * 🔴 Ce que ces cas gardent est un fait de TYPAGE, et rien ne le gardait : une
 * application générée qui déclare `author:ref(User)` — la relation la plus
 * évidente qu'on puisse écrire — produit `.references(() => userTable.id)`, et
 * son `npm run typecheck` échouait sur `TS2339: Property 'id' does not exist on
 * type 'SQLiteTable<TableConfig>'`. La table est construite à partir d'une spec
 * dont les colonnes ne survivent pas à l'inférence, et son type rendu ne portait
 * donc plus aucune colonne.
 *
 * Le cas d'exécution ci-dessous ne suffirait PAS à le garder : la colonne a
 * toujours existé à l'exécution, c'est le TYPE qui l'avait perdue. C'est donc le
 * `typecheck` du paquet qui fait foi — ce fichier compile ou il ne compile pas.
 */
import { describe, it, expect } from "vitest";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { getTableColumns } from "drizzle-orm";
import { createUserTable, userTable } from "../../nodefony/entity/userTable";

describe("table User — référençable par une entité voisine", () => {
  it("expose sa clé primaire au TYPE, donc `.references()` compile", () => {
    // Exactement ce que `create entity Message "author:ref(User)"` écrit.
    const messages = sqliteTable("messages_probe", {
      id: text("id").primaryKey(),
      author: text("author")
        .references(() => userTable.id, { onDelete: "restrict" })
        .notNull(),
    });
    expect(Object.keys(getTableColumns(messages))).toContain("author");
  });

  it("l'expose aussi pour un dialecte demandé explicitement", () => {
    const table = createUserTable("sqlite");
    expect(table.id).toBeDefined();
    expect(Object.keys(getTableColumns(table))).toContain("id");
  });
});
