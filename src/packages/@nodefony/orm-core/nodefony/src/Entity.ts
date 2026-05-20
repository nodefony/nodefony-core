import type { IEntity, IEntityRelation } from "../interfaces/index";
import { entityRegistry } from "./EntityRegistry";

/**
 * Classe de base abstraite d'une entité, indépendante du driver ORM.
 *
 * Porte le contrat {@link IEntity} : nom logique, ORM cible, schéma natif
 * (calculé via {@link Entity.getSchema}), modèle compilé (post-connexion) et
 * relations déclaratives. {@link Entity.register} insère l'entité dans le
 * {@link entityRegistry} process-wide.
 *
 * **Pas d'auto-enregistrement dans le constructeur** : en TypeScript, le
 * constructeur de la classe de base s'exécute AVANT les initialiseurs de champs
 * de la sous-classe — `name`/`orm` seraient encore `undefined`. L'enregistrement
 * automatique est donc porté par le décorateur `@entity` (P5.3), qui lit les
 * métadonnées de classe ; en attendant, appeler explicitement
 * {@link Entity.register} après instanciation.
 *
 * @typeParam S - type du schéma natif du driver.
 * @typeParam M - type du modèle compilé natif du driver.
 */
export abstract class Entity<S = unknown, M = unknown>
  implements IEntity<S, M>
{
  /** Nom logique de l'entité (clé de lookup, ex. `"User"`). */
  abstract readonly name: string;

  /** Nom de l'ORM cible enregistré dans le {@link ormRegistry}. */
  abstract readonly orm: string;

  /** Modèle compilé natif, renseigné après connexion de l'ORM. */
  model?: M;

  /** Relations déclarées vers d'autres entités (par nom logique). */
  readonly relations?: ReadonlyArray<IEntityRelation>;

  /**
   * Construit la définition de schéma propre au driver.
   *
   * @returns le schéma natif (forme libre selon l'ORM).
   */
  abstract getSchema(): S;

  /** Définition de schéma propre au driver (délègue à {@link Entity.getSchema}). */
  get schema(): S {
    return this.getSchema();
  }

  /**
   * Enregistre cette entité dans le {@link entityRegistry} process-wide.
   *
   * @returns `this` (chaînable).
   * @throws si l'entité est déjà enregistrée pour le même ORM.
   */
  register(): this {
    entityRegistry.register(this);
    return this;
  }
}
