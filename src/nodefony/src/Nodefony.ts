import type Kernel from "./kernel/Kernel";
import { version as pkgVersion } from "../package.json";
import { v4 as uuidv4, v5 as uuidv5 } from "uuid";

/**
 * Façade statique du framework — point d'entrée global remplaçant le singleton JS legacy.
 *
 * Expose le `Kernel` courant (registre des modules + services), la version du
 * package, et des générateurs d'identifiants UUID. Constructeur privé — aucune
 * instance ne doit être créée ; tout passe par les statics.
 *
 * @example
 * ```ts
 * import { Nodefony } from "nodefony";
 * const kernel = Nodefony.getKernel();
 * const id = Nodefony.generateId();
 * ```
 *
 * @remarks Le `Kernel` est `null` tant qu'il n'a pas été instancié par
 *   `bin/nodefony` ou par un test — toujours tester avec `?.`.
 */
export class Nodefony {
  /** Version du package `nodefony` (lue depuis `package.json` au build). */
  static readonly version: string = pkgVersion;
  static #kernel: Kernel | null = null;

  private constructor() {}

  /**
   * Retourne le `Kernel` courant ou `null` s'il n'a pas encore été instancié.
   *
   * @returns instance unique du Kernel ou `null` (avant boot ou après shutdown).
   */
  static getKernel(): Kernel | null {
    return Nodefony.#kernel;
  }

  /**
   * Enregistre le `Kernel` courant — appelé une seule fois au boot.
   *
   * @param k - instance du Kernel à mémoriser.
   * @remarks Appels multiples écrasent la référence précédente sans warning.
   */
  static setKernel(k: Kernel): void {
    Nodefony.#kernel = k;
  }

  /**
   * Génère un UUID v4 (aléatoire) — utilisé pour `requestId`, identifiants de session, etc.
   *
   * @returns string UUID format `8-4-4-4-12`.
   */
  static generateId(): string {
    return uuidv4();
  }

  /**
   * Génère un UUID v5 (déterministe — hash SHA-1 nom + namespace).
   *
   * Même `name` + `namespace` produit toujours le même UUID. Utile pour
   * générer des ids stables à partir d'une URL ou d'un identifiant métier.
   *
   * @param name - chaîne à hasher.
   * @param namespace - UUID parent (défaut : UUID v4 aléatoire — perd le déterminisme).
   * @returns string UUID v5.
   */
  static generateV5Id(name: string, namespace?: string): string {
    return uuidv5(name, namespace || uuidv4());
  }
}
