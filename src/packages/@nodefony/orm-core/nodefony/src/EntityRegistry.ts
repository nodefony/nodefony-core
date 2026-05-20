import type { IEntity } from "../interfaces/index";

/**
 * Registre cross-ORM des entités, indexé par nom logique puis par ORM.
 *
 * Une même entité logique (ex. `User`) peut exister pour plusieurs ORM :
 * l'index interne est `entities[entityName][ormName] = IEntity`. Le lookup
 * {@link EntityRegistry.get} accepte un nom seul (résolu si l'entité n'existe
 * que pour un ORM) ou un couple nom + ORM pour lever l'ambiguïté.
 *
 * Structure pure (`Object.create(null)`) et lazy : rien n'est alloué tant
 * qu'aucune entité n'est enregistrée. Aucun coupling à `nodefony`.
 */
export class EntityRegistry {
  /** `entities[name][orm] = entity` — allouée au premier enregistrement. */
  #entities: Record<string, Record<string, IEntity>> | null = null;

  /**
   * Enregistre une entité pour son ORM cible.
   *
   * @param entity - entité implémentant {@link IEntity} (utilise `name` + `orm`).
   * @throws si cette entité est déjà enregistrée pour le même ORM.
   */
  register(entity: IEntity): void {
    if (this.#entities === null) {
      this.#entities = Object.create(null) as Record<
        string,
        Record<string, IEntity>
      >;
    }
    const store = this.#entities;
    let bucket = store[entity.name];
    if (bucket === undefined) {
      bucket = Object.create(null) as Record<string, IEntity>;
      store[entity.name] = bucket;
    }
    if (bucket[entity.orm] !== undefined) {
      throw new Error(
        `EntityRegistry: entity "${entity.name}" already registered for ORM "${entity.orm}".`,
      );
    }
    bucket[entity.orm] = entity;
  }

  /**
   * Résout une entité par nom (et ORM si plusieurs candidats).
   *
   * @param name - nom logique de l'entité (ex. `"User"`).
   * @param orm - ORM cible ; obligatoire si l'entité existe pour plusieurs ORM.
   * @returns l'entité correspondante.
   * @throws si l'entité est inconnue, absente pour l'ORM demandé, ou ambiguë
   *   (plusieurs ORM) sans `orm` précisé.
   */
  get(name: string, orm?: string): IEntity {
    const bucket = this.#entities?.[name];
    if (bucket === undefined) {
      throw new Error(`EntityRegistry: no entity registered under "${name}".`);
    }
    if (orm !== undefined) {
      const entity = bucket[orm];
      if (entity === undefined) {
        throw new Error(
          `EntityRegistry: entity "${name}" is not registered for ORM "${orm}".`,
        );
      }
      return entity;
    }
    const orms = Object.keys(bucket);
    if (orms.length > 1) {
      throw new Error(
        `EntityRegistry: entity "${name}" exists for multiple ORMs (${orms.join(", ")}); specify one.`,
      );
    }
    return bucket[orms[0]];
  }

  /**
   * Indique si une entité (optionnellement pour un ORM précis) est enregistrée.
   *
   * @param name - nom logique de l'entité.
   * @param orm - ORM cible facultatif.
   */
  has(name: string, orm?: string): boolean {
    const bucket = this.#entities?.[name];
    if (bucket === undefined) {
      return false;
    }
    return orm === undefined ? true : bucket[orm] !== undefined;
  }

  /**
   * Liste toutes les entités enregistrées, tous ORM confondus.
   *
   * @returns tableau d'entités (vide si registre vide).
   */
  list(): IEntity[] {
    if (this.#entities === null) {
      return [];
    }
    const out: IEntity[] = [];
    for (const name in this.#entities) {
      const bucket = this.#entities[name];
      for (const orm in bucket) {
        out.push(bucket[orm]);
      }
    }
    return out;
  }

  /**
   * Retire une entité du registre (teardown tests / hot-reload).
   *
   * @param name - nom logique de l'entité.
   * @param orm - si fourni, retire seulement cette variante ORM ; sinon toutes.
   * @returns `true` si quelque chose a été retiré, `false` sinon.
   */
  unregister(name: string, orm?: string): boolean {
    const store = this.#entities;
    if (store === null) {
      return false;
    }
    const bucket = store[name];
    if (bucket === undefined) {
      return false;
    }
    if (orm === undefined) {
      delete store[name];
      return true;
    }
    if (bucket[orm] === undefined) {
      return false;
    }
    delete bucket[orm];
    if (Object.keys(bucket).length === 0) {
      delete store[name];
    }
    return true;
  }
}

/**
 * Singleton process-wide partagé. Les entités s'y enregistrent (via le
 * décorateur `@entity` en P5.3 ou {@link Entity.register}). La classe
 * {@link EntityRegistry} reste instanciable pour des registres isolés (tests).
 */
export const entityRegistry: EntityRegistry = new EntityRegistry();
