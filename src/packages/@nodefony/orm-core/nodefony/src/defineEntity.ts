import type { IEntity } from "../interfaces/IEntity";

/**
 * Descripteur d'entité **sans connecteur figé** — la forme sous laquelle une
 * application déclare ses entités.
 *
 * Pourquoi le connecteur manque : dans {@link IEntity}, `connector` est le **nom
 * d'une connexion** (`"default"`, `"analytics"`…). C'est une donnée de
 * **configuration**, pas de code : la même table peut être servie par une connexion
 * différente selon l'environnement. La figer à l'import interdirait de la réutiliser
 * — c'est exactement ce qui condamne le décorateur de classe
 * `@entity({connector, schema})` à n'être jamais employé en production. Ici, le
 * connecteur est résolu **au boot**, par le décorateur `entities`.
 */
export interface IEntityDefinition<S = unknown, M = unknown> extends Omit<
  IEntity<S, M>,
  "connector"
> {
  /**
   * Connecteur cible — à ne renseigner que pour **forcer** une entité sur une
   * connexion précise (base secondaire). Sinon, c'est `entities(…, { connector })`
   * qui tranche, et à défaut le connecteur `"default"`.
   */
  readonly connector?: string;
}

/**
 * Déclare une entité applicative. Fonction d'**identité typée** : elle ne fait
 * qu'attacher le type — aucun effet de bord, aucun enregistrement.
 *
 * L'enregistrement est le rôle du décorateur `entities([...])` posé sur le Module,
 * qui s'exécute à la phase `onRegister` (avant que l'ORM ne se connecte). Séparer
 * les deux permet d'importer une entité (dans un test, un script, un autre module)
 * sans déclencher son inscription dans un registre global.
 *
 * @example
 * ```ts
 * export const PostEntity = defineEntity({
 *   name: "Post",
 *   module: "blog",
 *   schema: postTable,     // table Drizzle native (ou SchemaDefinition Mongoose)
 * });
 * ```
 *
 * @param definition - descripteur (nom logique, schéma natif, module, relations…).
 * @returns le descripteur, tel quel.
 */
export function defineEntity<S, M = unknown>(
  definition: IEntityDefinition<S, M>,
): IEntityDefinition<S, M> {
  return definition;
}
