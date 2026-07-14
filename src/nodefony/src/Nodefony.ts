import type Kernel from "./kernel/Kernel";
import { version as pkgVersion } from "../package.json";
import { randomUUID, randomUUIDv7 } from "node:crypto";

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
   * Génère un UUID v4 (aléatoire) — utilisé pour `requestId`, ids divers, etc.
   * Natif `node:crypto` (CSPRNG) — plus de dépendance `uuid`.
   *
   * @returns string UUID format `8-4-4-4-12`.
   */
  static generateId(): string {
    return randomUUID();
  }

  /**
   * Génère un UUID **v7** (RFC 9562) — identifiant **ordonné dans le temps**, à
   * préférer pour une clé primaire de base de données.
   *
   * Pourquoi lui plutôt que {@link generateId} (v4) sur une clé primaire : les 48
   * premiers bits portent l'horodatage, donc les lignes insérées à la suite
   * atterrissent **côte à côte dans l'index** ; un UUID v4, purement aléatoire,
   * fragmente le B-tree à chaque insertion. Et contrairement à un auto-incrément,
   * il ne donne pas l'énumération de toutes les ressources.
   *
   * ⚠️ **Deux limites à connaître.**
   * 1. **Pas d'ordre garanti dans une même milliseconde** : Node n'implémente pas le
   *    compteur monotone optionnel de la RFC (§6.2) — mesuré : ~50 % d'inversions
   *    entre identifiants tirés dans la même milliseconde. Trier des créations se
   *    fait sur `createdAt`, **jamais** sur l'identifiant.
   * 2. **Pas un secret** : la RFC l'interdit explicitement comme capacité de sécurité
   *    (« MUST NOT be used as security capabilities ») — l'instant de création fuit et
   *    une partie est devinable. Pour un jeton imprévisible → {@link generateId} (v4).
   *
   * @returns UUID v7, format `8-4-4-4-12`.
   */
  static generateSortableId(): string {
    return randomUUIDv7();
  }
}
