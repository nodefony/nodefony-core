import type { Role } from "./roles";

/**
 * Nombre maximum de rôles qu'un {@link RoleRegistry} peut indexer en masque `number`.
 *
 * Les opérateurs bit-à-bit de JavaScript travaillent sur des entiers **32 bits signés** :
 * `1 << 31` devient négatif et `1 << 32` repart à `1`. On réserve donc les bits 0..30
 * (31 rôles) pour rester sur des masques positifs sûrs. Au-delà → utiliser les chaînes
 * ({@link RoleSet}) ou un futur registre `BigInt`.
 */
export const ROLE_MASK_CAPACITY = 31;

/**
 * Registre OPTIONNEL qui assigne un bit à chaque rôle d'un ENSEMBLE FIXE, pour des
 * contrôles d'autorisation en masque (`&`/`|`) — O(1), sans allocation, adapté au hot path
 * serveur (voters, pipeline sécurité) quand les rôles sont connus à l'avance.
 *
 * ⚠️ Inadapté aux rôles DYNAMIQUES (créés en base à l'exécution) : ils n'ont pas de bit
 * fixe → rester sur les chaînes ({@link hasRole}, {@link RoleSet}).
 * ⚠️ Capacité = {@link ROLE_MASK_CAPACITY} rôles (limite 32 bits de JS).
 *
 * @example
 * const reg = new RoleRegistry().define("ROLE_DEV", "ROLE_SUPERVISOR");
 * const userMask = reg.mask(["ROLE_DEV"]);
 * RoleRegistry.hasAny(userMask, reg.mask(["ROLE_DEV", "ROLE_SUPERVISOR"])); // true
 */
export class RoleRegistry {
  readonly #bits = new Map<Role, number>();
  #next = 0;

  /**
   * Déclare un ou plusieurs rôles et leur assigne un bit (idempotent : un rôle déjà
   * connu conserve son bit).
   *
   * @param roles - rôles à enregistrer
   * @returns le registre (chaînable)
   * @throws {RangeError} si la capacité {@link ROLE_MASK_CAPACITY} est dépassée
   */
  define(...roles: Role[]): this {
    for (const role of roles) {
      if (this.#bits.has(role)) continue;
      if (this.#next >= ROLE_MASK_CAPACITY) {
        throw new RangeError(
          `RoleRegistry: capacité dépassée (${ROLE_MASK_CAPACITY} rôles max en masque 32 bits)`,
        );
      }
      this.#bits.set(role, 1 << this.#next);
      this.#next += 1;
    }
    return this;
  }

  /**
   * @param role - rôle recherché
   * @returns le bit du rôle (puissance de 2), ou `0` si inconnu
   */
  bit(role: Role): number {
    return this.#bits.get(role) ?? 0;
  }

  /**
   * Compile une liste de rôles en masque (OR des bits). Les rôles inconnus sont ignorés
   * (bit 0) — les déclarer d'abord via {@link RoleRegistry.define}.
   *
   * @param roles - rôles à encoder
   * @returns le masque binaire
   */
  mask(roles: readonly Role[]): number {
    let m = 0;
    for (const r of roles) m |= this.#bits.get(r) ?? 0;
    return m;
  }

  /**
   * Décode un masque en liste de rôles (ordre de déclaration).
   *
   * @param mask - masque binaire
   * @returns les rôles dont le bit est positionné
   */
  roles(mask: number): Role[] {
    const out: Role[] = [];
    for (const [role, bit] of this.#bits) if ((mask & bit) !== 0) out.push(role);
    return out;
  }

  /**
   * Test OR sur masques.
   *
   * @param userMask - masque des rôles de l'utilisateur
   * @param requiredMask - masque des rôles acceptés
   * @returns `true` si l'utilisateur a au moins un des rôles requis
   */
  static hasAny(userMask: number, requiredMask: number): boolean {
    return (userMask & requiredMask) !== 0;
  }

  /**
   * Test AND sur masques.
   *
   * @param userMask - masque des rôles de l'utilisateur
   * @param requiredMask - masque des rôles requis
   * @returns `true` si l'utilisateur a tous les rôles requis
   */
  static hasAll(userMask: number, requiredMask: number): boolean {
    return (userMask & requiredMask) === requiredMask;
  }
}
