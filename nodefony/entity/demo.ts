import { randomUUID } from "node:crypto";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
import { userTable } from "@nodefony/drizzle";

/**
 * Entités de **démonstration** de l'app dev, branchées sur l'ORM Drizzle par
 * défaut (connecteur `"default"`).
 *
 * But : rendre l'ERD Studio (`/nodefony/databases`) et le profiler SQL vivants
 * avec une **vraie relation** (1-N `User` → `Post`). Aucune logique métier — juste
 * deux entités reliées que le `DrizzleService` matérialise en tables au boot.
 *
 * L'enregistrement se fait au **top-level** (à l'import depuis `index.ts`) → il
 * a lieu avant le `onBoot` du `DrizzleService`, qui crée les tables à partir du
 * `entityRegistry` (même fenêtre que le décorateur `@entity` de la session).
 */
const ORM = "default";

/**
 * Table `Post` de démo (app) — reliée à `User` par la FK `userId`. Défauts en
 * `$defaultFn` (JS-level) car le DDL dérivé de Drizzle n'émet pas les `DEFAULT`
 * SQL (mêmes contraintes que `userTable`).
 */
export const postTable = sqliteTable("Post", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  title: text("title").notNull(),
  body: text("body"),
  userId: text("userId").notNull(),
  createdAt: integer("createdAt")
    .notNull()
    .$defaultFn(() => Date.now()),
});

// User (table fournie par @nodefony/drizzle) → 1-N vers Post.
const userEntity: IEntity = {
  orm: ORM,
  name: "User",
  schema: userTable,
  relations: [{ type: "one-to-many", target: "Post", field: "posts" }],
};

// Post → N-1 vers User. FK déterministe `userId`, cohérente avec le 1-N côté User.
const postEntity: IEntity = {
  orm: ORM,
  name: "Post",
  schema: postTable,
  relations: [
    { type: "many-to-one", target: "User", field: "author", foreignKey: "userId" },
  ],
};

entityRegistry.register(userEntity);
entityRegistry.register(postEntity);
