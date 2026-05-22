/**
 * Représentation **canonique et sérialisable** du modèle de données multi-ORM.
 *
 * C'est la pièce maîtresse « IA-first » du data plane ORM : un graphe normalisé
 * (ORM-agnostique) qui sert à la fois :
 *  - la **visualisation** (ERD React Flow côté Studio) ;
 *  - l'**IA** (contexte d'un agent : text-to-SQL, RAG schéma-aware) ;
 *  - l'**interop** (export DBML / JSON Schema / SQL DDL).
 *
 * Une source, plusieurs consommateurs. Le diagramme n'est qu'une projection.
 */

/** Colonne/champ normalisé d'une entité (extrait via {@link IOrm.describeEntity}). */
export interface IColumnInfo {
  /** Nom de la colonne. */
  name: string;
  /** Type natif tel que rapporté par le driver (ex. `text`, `integer`, `String`). */
  type: string;
  /** `true` si clé primaire. */
  primaryKey: boolean;
  /** `true` si la colonne accepte `NULL`. */
  nullable: boolean;
  /** `true` si contrainte d'unicité. */
  unique: boolean;
}

/** Relation projetée pour le graphe (sous-ensemble sérialisable de `IEntityRelation`). */
export interface IRelationInfo {
  /** Cardinalité. */
  type: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";
  /** Entité cible (nom logique). */
  target: string;
  /** Champ portant la relation côté entité courante. */
  field: string;
  /** Clé étrangère (explicite ou dérivée déterministe). */
  foreignKey?: string;
}

/** Nœud du graphe : une entité avec ses colonnes et ses relations. */
export interface IEntityGraphNode {
  /** Nom logique de l'entité. */
  name: string;
  /** ORM/connecteur cible. */
  orm: string;
  /**
   * Module Nodefony propriétaire (regroupement ERD), `""` si non rattaché.
   */
  module: string;
  /** Colonnes normalisées (vide si l'adapter n'implémente pas `describeEntity`). */
  columns: IColumnInfo[];
  /** Relations déclarées. */
  relations: IRelationInfo[];
}

/** Résumé d'un ORM/connecteur enregistré. */
export interface IOrmSummary {
  /** Clé du connecteur dans le `OrmRegistry`. */
  name: string;
  /**
   * Vendor de l'adapter en minuscules (`drizzle`, `sequelize`, `mongoose`…),
   * dérivé du nom de classe. `""` si indéterminé. Dette : promouvoir en
   * `IOrm.vendor` déclaré par chaque adapter (P7.1 industrialisation ORM).
   */
  vendor: string;
  /** `true` si c'est le connecteur par défaut (`"default"`). */
  default: boolean;
  /** État de la connexion. */
  connected: boolean;
  /** Nombre d'entités rattachées à cet ORM. */
  entityCount: number;
}

/** Graphe complet du modèle de données — réponse de `/nodefony/orm/api/graph`. */
export interface IOrmGraph {
  /** ORMs/connecteurs enregistrés. */
  orms: IOrmSummary[];
  /** Entités (colonnes + relations), éventuellement filtrées par ORM. */
  entities: IEntityGraphNode[];
}
