import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
import { userTable } from "@nodefony/drizzle";

/**
 * Entité **User** de l'app dev, branchée sur l'ORM Drizzle par défaut
 * (connecteur `"default"`).
 *
 * Ce n'est pas une démo jetable : `userTable` est le schéma de persistance **réel**
 * du système d'authentification, fourni par `@nodefony/drizzle` (P5.9). On le
 * déclare ici pour que la table soit matérialisée au boot et visible dans l'ERD
 * Studio (`/nodefony/databases`) + le profiler SQL.
 *
 * L'enregistrement se fait au **top-level** (à l'import depuis `index.ts`) → il
 * a lieu avant le `onBoot` du `DrizzleService`, qui crée les tables à partir du
 * `entityRegistry` (même fenêtre que le décorateur `@entity` de la session).
 */
const ORM = "default";

// User (table fournie par @nodefony/drizzle).
const userEntity: IEntity = {
  orm: ORM,
  name: "User",
  schema: userTable,
};

entityRegistry.register(userEntity);
