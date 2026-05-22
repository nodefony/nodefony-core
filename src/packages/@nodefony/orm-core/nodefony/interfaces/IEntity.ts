/**
 * Relation déclarative entre deux entités, indépendante du driver ORM.
 */
export interface IEntityRelation {
  /** Cardinalité de la relation. */
  readonly type: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";

  /** Nom logique de l'entité cible (clé de lookup dans le registre). */
  readonly target: string;

  /** Champ portant la relation côté entité courante. */
  readonly field: string;

  /**
   * Clé étrangère explicite. Si omise, l'adapter en dérive une déterministe
   * (camelCase `<entité>Id`) — évite la divergence avec le défaut du driver
   * (Sequelize génère du PascalCase `UserId`).
   */
  readonly foreignKey?: string;
}

/**
 * Description d'une entité enregistrée dans le registre cross-ORM.
 *
 * Une même entité logique (ex. `User`) peut exister pour plusieurs ORM : `orm`
 * désigne l'ORM cible et `schema`/`model` portent la définition propre au driver
 * (schéma Mongoose, table Sequelize, schéma Drizzle...). `model` n'est disponible
 * qu'après connexion de l'ORM (compilation du modèle).
 *
 * @typeParam S - type du schéma natif du driver.
 * @typeParam M - type du modèle compilé natif du driver.
 */
export interface IEntity<S = unknown, M = unknown> {
  /** Nom logique de l'entité (clé de lookup, ex. `"User"`). */
  readonly name: string;

  /** Nom de l'ORM cible enregistré dans le registre (ex. `"db_principale"`). */
  readonly orm: string;

  /**
   * Module Nodefony propriétaire de l'entité (ex. `"user"`, `"test"`).
   * **Optionnel** : sert au regroupement dans le graphe canonique / ERD Studio.
   * Non renseigné → entité non rattachée (groupe « — » côté UI).
   */
  readonly module?: string;

  /** Définition de schéma propre au driver (forme libre). */
  readonly schema: S;

  /** Modèle compilé natif, renseigné après connexion de l'ORM. */
  model?: M;

  /** Relations déclarées vers d'autres entités (par nom logique). */
  readonly relations?: ReadonlyArray<IEntityRelation>;
}
