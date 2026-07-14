import type { IEntity } from "../interfaces/index";

/**
 * Registre cross-ORM des entités, indexé par nom logique puis par connecteur.
 *
 * Une même entité logique (ex. `User`) peut exister sur plusieurs connexions :
 * l'index interne est `entities[entityName][connectorName] = IEntity`. Le lookup
 * {@link EntityRegistry.get} accepte un nom seul (résolu si l'entité n'existe
 * que sur un connecteur) ou un couple nom + connecteur pour lever l'ambiguïté.
 *
 * Structure pure (`Object.create(null)`) et lazy : rien n'est alloué tant
 * qu'aucune entité n'est enregistrée. Aucun coupling à `nodefony`.
 */
export class EntityRegistry {
  /** `entities[name][connector] = entity` — allouée au premier enregistrement. */
  #entities: Record<string, Record<string, IEntity>> | null = null;

  /**
   * Enregistre une entité pour son connecteur cible.
   *
   * @param entity - entité implémentant {@link IEntity} (utilise `name` + `connector`).
   * @throws si cette entité est déjà enregistrée sur le même connecteur.
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
    if (bucket[entity.connector] !== undefined) {
      throw new Error(
        `EntityRegistry: entity "${entity.name}" already registered for connector "${entity.connector}".`,
      );
    }
    bucket[entity.connector] = entity;
  }

  /**
   * Résout une entité par nom (et connecteur si plusieurs candidats).
   *
   * @param name - nom logique de l'entité (ex. `"User"`).
   * @param connector - connecteur cible ; obligatoire si l'entité existe sur plusieurs.
   * @returns l'entité correspondante.
   * @throws si l'entité est inconnue, absente du connecteur demandé, ou ambiguë
   *   (plusieurs connecteurs) sans `connector` précisé.
   */
  get(name: string, connector?: string): IEntity {
    const bucket = this.#entities?.[name];
    if (bucket === undefined) {
      throw new Error(`EntityRegistry: no entity registered under "${name}".`);
    }
    if (connector !== undefined) {
      const entity = bucket[connector];
      if (entity === undefined) {
        throw new Error(
          `EntityRegistry: entity "${name}" is not registered for connector "${connector}".`,
        );
      }
      return entity;
    }
    const connectors = Object.keys(bucket);
    if (connectors.length > 1) {
      throw new Error(
        `EntityRegistry: entity "${name}" exists on multiple connectors (${connectors.join(", ")}); specify one.`,
      );
    }
    return bucket[connectors[0]];
  }

  /**
   * Indique si une entité (optionnellement sur un connecteur précis) est enregistrée.
   *
   * @param name - nom logique de l'entité.
   * @param connector - connecteur cible facultatif.
   */
  has(name: string, connector?: string): boolean {
    const bucket = this.#entities?.[name];
    if (bucket === undefined) {
      return false;
    }
    return connector === undefined ? true : bucket[connector] !== undefined;
  }

  /**
   * Liste toutes les entités enregistrées, tous connecteurs confondus.
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
      for (const connector in bucket) {
        out.push(bucket[connector]);
      }
    }
    return out;
  }

  /**
   * Retire une entité du registre (teardown tests / hot-reload).
   *
   * @param name - nom logique de l'entité.
   * @param connector - si fourni, retire seulement cette variante ; sinon toutes.
   * @returns `true` si quelque chose a été retiré, `false` sinon.
   */
  unregister(name: string, connector?: string): boolean {
    const store = this.#entities;
    if (store === null) {
      return false;
    }
    const bucket = store[name];
    if (bucket === undefined) {
      return false;
    }
    if (connector === undefined) {
      delete store[name];
      return true;
    }
    if (bucket[connector] === undefined) {
      return false;
    }
    delete bucket[connector];
    if (Object.keys(bucket).length === 0) {
      delete store[name];
    }
    return true;
  }
}

/**
 * Singleton process-wide partagé. Les entités s'y enregistrent (via le
 * décorateur `entities([...])` posé sur le Module, ou {@link Entity.register}).
 * La classe {@link EntityRegistry} reste instanciable pour des registres isolés
 * (tests).
 */
export const entityRegistry: EntityRegistry = new EntityRegistry();
