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
  /** Connexion nommée cible, telle que déclarée en config (ex. `"db_principale"`). */
  connector: string;

  /** Nom logique ; par défaut le nom de la classe décorée. */
  name?: string;

  /**
   * Module Nodefony propriétaire (ex. `"user"`, `"test"`) — regroupe l'entité
   * dans le graphe canonique / ERD Studio. Optionnel.
   */
  module?: string;

  /**
   * Classification (domaine fonctionnel) — axe de regroupement ERD distinct du
   * `module`. Optionnel. Voir {@link IEntity.domain}.
   */
  domain?: string;

  /** Schéma natif du driver (schéma Mongoose, schéma Drizzle...). */
  schema?: S;

  /** Relations déclaratives vers d'autres entités. */
  relations?: ReadonlyArray<IEntityRelation>;
}

/**
 * Décore une classe comme entité multi-ORM et l'enregistre au chargement.
 *
 * Résout le piège d'ordre d'initialisation TS (le constructeur de base
 * s'exécute avant les initialiseurs de champs de la sous-classe) : le décorateur
 * s'exécute sur la **classe** au chargement du module, donc `name`/`connector`
 * sont connus sans instance. Il construit un **descripteur {@link IEntity} depuis
 * les options** (aucune instanciation au boot), l'enregistre dans le
 * `entityRegistry` process-wide, et stocke la métadonnée via un `WeakMap`
 * (cf. `metadataStore`, sans `reflect-metadata`).
 *
 * @param options - connecteur cible + nom/schéma/relations optionnels.
 * @returns le décorateur de classe (renvoie la classe inchangée).
 * @throws si une entité de même `name` est déjà enregistrée sur le même `connector`.
 *
 * @example
 * ```ts
 * \@entity({ connector: "db_principale", schema: { id: { type: "uuid" } } })
 * class User extends Entity { ... }
 * ```
 */
export function entity<S = unknown>(options: EntityOptions<S>) {
  return <T extends DecoratedClass>(target: T): T => {
    const name = options.name ?? target.name;
    const meta: EntityMetadata<S> = {
      name,
      connector: options.connector,
      module: options.module,
      domain: options.domain,
      schema: options.schema,
      relations: options.relations,
      target,
    };
    setEntityMeta(target, meta);

    const descriptor: IEntity<S> = {
      name,
      connector: options.connector,
      module: options.module,
      domain: options.domain,
      schema: options.schema as S,
      relations: options.relations,
    };
    entityRegistry.register(descriptor);

    return target;
  };
}
