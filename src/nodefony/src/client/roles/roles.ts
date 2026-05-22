/**
 * Type d'un rôle Nodefony. Convention `ROLE_*` (alignée Symfony) — mais le mécanisme
 * reste agnostique : n'importe quelle chaîne fait office de rôle.
 */
export type Role = string;

/**
 * Indique si l'utilisateur possède `role`.
 *
 * Implémentation sans allocation (parcours linéaire) : optimale pour un contrôle
 * ponctuel sur un petit tableau (cas courant : 1 à 5 rôles dans un JWT). Pour des
 * contrôles répétés contre le même utilisateur, préférer {@link RoleSet} (O(1) après
 * une unique allocation).
 *
 * @param userRoles - rôles portés par l'utilisateur (ex. claim `roles` du JWT)
 * @param role - rôle recherché
 * @returns `true` si `userRoles` contient `role`
 */
export function hasRole(
  userRoles: readonly Role[] | null | undefined,
  role: Role,
): boolean {
  return userRoles != null && userRoles.includes(role);
}

/**
 * Indique si l'utilisateur possède AU MOINS UN des `roles` (OR logique).
 *
 * @param userRoles - rôles de l'utilisateur
 * @param roles - rôles acceptés (l'un suffit)
 * @returns `true` si l'intersection est non vide ; `false` si `roles` est vide
 *          (aucune exigence ne peut être satisfaite)
 */
export function hasAnyRole(
  userRoles: readonly Role[] | null | undefined,
  roles: readonly Role[],
): boolean {
  if (userRoles == null || roles.length === 0) return false;
  for (const r of roles) if (userRoles.includes(r)) return true;
  return false;
}

/**
 * Indique si l'utilisateur possède TOUS les `roles` (AND logique).
 *
 * @param userRoles - rôles de l'utilisateur
 * @param roles - rôles tous requis
 * @returns `true` si chaque rôle requis est présent ; `true` si `roles` est vide
 *          (aucune exigence — convention de `Array.every`)
 */
export function hasAllRoles(
  userRoles: readonly Role[] | null | undefined,
  roles: readonly Role[],
): boolean {
  if (roles.length === 0) return true;
  if (userRoles == null) return false;
  for (const r of roles) if (!userRoles.includes(r)) return false;
  return true;
}

/**
 * Ensemble de rôles indexé pour des contrôles répétés en O(1).
 *
 * À utiliser quand on teste plusieurs fois les rôles d'un même utilisateur (filtrage
 * d'une navigation, rendu conditionnel de N panneaux) : une seule allocation de `Set`,
 * puis chaque `has`/`hasAny`/`hasAll` est O(1)/O(k). Pour un contrôle unique, préférer
 * les fonctions {@link hasRole} & co (zéro allocation).
 */
export class RoleSet {
  readonly #roles: Set<Role>;

  /** @param roles - rôles de l'utilisateur (dédoublonnés à la construction) */
  constructor(roles?: Iterable<Role> | null) {
    this.#roles = new Set(roles ?? undefined);
  }

  /** Nombre de rôles distincts. */
  get size(): number {
    return this.#roles.size;
  }

  /**
   * @param role - rôle recherché
   * @returns `true` si le rôle est présent (O(1))
   */
  has(role: Role): boolean {
    return this.#roles.has(role);
  }

  /**
   * @param roles - rôles acceptés
   * @returns `true` si AU MOINS UN des `roles` est présent (OR)
   */
  hasAny(roles: readonly Role[]): boolean {
    for (const r of roles) if (this.#roles.has(r)) return true;
    return false;
  }

  /**
   * @param roles - rôles requis
   * @returns `true` si TOUS les `roles` sont présents (AND ; `true` si liste vide)
   */
  hasAll(roles: readonly Role[]): boolean {
    for (const r of roles) if (!this.#roles.has(r)) return false;
    return true;
  }

  /** Copie triée des rôles (affichage / sérialisation déterministe). */
  toArray(): Role[] {
    return [...this.#roles].sort();
  }
}
