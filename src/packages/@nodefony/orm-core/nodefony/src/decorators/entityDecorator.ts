import type { IEntity, IEntityRelation } from "../../interfaces/index";
import { entityRegistry } from "../EntityRegistry";
import {
  type DecoratedClass,
  type EntityMetadata,
  setEntityMeta,
} from "./metadataStore";

/**
 * Options du décorateur {@link entity}.
 *
 * @typeParam S - type du schéma natif du driver.
 */
export interface EntityOptions<S = unknown> {
  /** ORM cible enregistré dans le `ormRegistry` (ex. `"db_principale"`). */
  orm: string;

  /** Nom logique ; par défaut le nom de la classe décorée. */
  name?: string;

  /** Schéma natif du driver (attributs Sequelize, schéma Mongoose...). */
  schema?: S;

  /** Relations déclaratives vers d'autres entités. */
  relations?: ReadonlyArray<IEntityRelation>;
}

/**
 * Décore une classe comme entité multi-ORM et l'enregistre au chargement.
 *
 * Résout le piège d'ordre d'initialisation TS (le constructeur de base
 * s'exécute avant les initialiseurs de champs de la sous-classe) : le décorateur
 * s'exécute sur la **classe** au chargement du module, donc `name`/`orm` sont
 * connus sans instance. Il construit un **descripteur {@link IEntity} depuis les
 * options** (aucune instanciation au boot), l'enregistre dans le
 * `entityRegistry` process-wide, et stocke la métadonnée via un `WeakMap`
 * (cf. `metadataStore`, sans `reflect-metadata`).
 *
 * @param options - ORM cible + nom/schéma/relations optionnels.
 * @returns le décorateur de classe (renvoie la classe inchangée).
 * @throws si une entité de même `name` est déjà enregistrée pour le même `orm`.
 *
 * @example
 * ```ts
 * \@entity({ orm: "db_principale", schema: { id: { type: "uuid" } } })
 * class User extends Entity { ... }
 * ```
 */
export function entity<S = unknown>(options: EntityOptions<S>) {
  return <T extends DecoratedClass>(target: T): T => {
    const name = options.name ?? target.name;
    const meta: EntityMetadata<S> = {
      name,
      orm: options.orm,
      schema: options.schema,
      relations: options.relations,
      target,
    };
    setEntityMeta(target, meta);

    const descriptor: IEntity<S> = {
      name,
      orm: options.orm,
      schema: options.schema as S,
      relations: options.relations,
    };
    entityRegistry.register(descriptor);

    return target;
  };
}
