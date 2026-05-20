import type { IOrm } from "../interfaces/index";

/**
 * Registre process-wide des instances ORM enregistrées sous un nom unique.
 *
 * Support multi-ORM natif : chaque driver (`@nodefony/sequelize`,
 * `@nodefony/mongoose`, `@nodefony/drizzle`...) s'enregistre à son boot via
 * {@link OrmRegistry.register} sous une clé logique (`"db_principale"`,
 * `"db_logs"`...). Les consommateurs (repositories, session storage, security)
 * résolvent l'ORM voulu par cette clé, jamais par référence directe au driver.
 *
 * Pas de coupling à `nodefony` : structure pure et lazy (la `Map` interne n'est
 * allouée qu'au premier `register`), donc trivialement testable en isolation.
 */
export class OrmRegistry {
  /** Allouée paresseusement au premier enregistrement (zéro coût au boot). */
  #orms: Map<string, IOrm> | null = null;

  /**
   * Enregistre une instance ORM sous un nom unique.
   *
   * @param name - clé logique de l'ORM (ex. `"db_principale"`).
   * @param orm - instance implémentant {@link IOrm}.
   * @throws si un ORM du même nom est déjà enregistré (erreur de configuration).
   */
  register(name: string, orm: IOrm): void {
    if (this.#orms === null) {
      this.#orms = new Map();
    }
    if (this.#orms.has(name)) {
      throw new Error(
        `OrmRegistry: an ORM named "${name}" is already registered.`,
      );
    }
    this.#orms.set(name, orm);
  }

  /**
   * Résout l'ORM enregistré sous un nom.
   *
   * @param name - clé logique de l'ORM.
   * @returns l'instance {@link IOrm} correspondante.
   * @throws si aucun ORM n'est enregistré sous ce nom.
   */
  get(name: string): IOrm {
    const orm = this.#orms?.get(name);
    if (orm === undefined) {
      throw new Error(`OrmRegistry: no ORM registered under "${name}".`);
    }
    return orm;
  }

  /**
   * Indique si un ORM est enregistré sous ce nom.
   *
   * @param name - clé logique de l'ORM.
   */
  has(name: string): boolean {
    return this.#orms?.has(name) ?? false;
  }

  /**
   * Liste les noms des ORM enregistrés.
   *
   * @returns tableau des clés (vide si aucun ORM enregistré).
   */
  list(): string[] {
    return this.#orms === null ? [] : [...this.#orms.keys()];
  }

  /**
   * Retire un ORM du registre (utile au teardown des tests / hot-reload).
   *
   * @param name - clé logique de l'ORM.
   * @returns `true` si un ORM a été retiré, `false` sinon.
   */
  unregister(name: string): boolean {
    return this.#orms?.delete(name) ?? false;
  }
}

/**
 * Singleton process-wide partagé par tous les drivers et consommateurs ORM.
 *
 * Les modules ORM s'enregistrent ici ; la classe {@link OrmRegistry} reste
 * instanciable séparément pour des registres isolés (tests).
 */
export const ormRegistry: OrmRegistry = new OrmRegistry();
