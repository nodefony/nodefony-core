import { defineEntity } from "@nodefony/orm-core";
import { FRAMEWORK_CONNECTOR, portableUserTable } from "@nodefony/drizzle";

/**
 * L'entité `User` d'une application générée (`nodefony/entity/User.ts`), réduite
 * à ce que le salon privé de `docs/cas-d-usage.md` référence.
 */
export const userTable = portableUserTable;

export const UserEntity = defineEntity({
  name: "User",
  module: "app",
  connector: FRAMEWORK_CONNECTOR,
  schema: userTable,
});
