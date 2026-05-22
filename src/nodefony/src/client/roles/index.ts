/**
 * `nodefony/roles` — utilitaires d'autorisation par rôles, **purs et isomorphes**
 * (front + serveur), sans dépendance ni état global.
 *
 * - Source de vérité = chaînes `ROLE_*` (ce que transportent JWT/OAuth/claims).
 * - Contrôle ponctuel sans allocation : {@link hasRole}, {@link hasAnyRole}, {@link hasAllRoles}.
 * - Contrôles répétés en O(1) : {@link RoleSet}.
 * - Masques binaires pour ensemble FIXE en hot path serveur : {@link RoleRegistry}.
 *
 * Le mécanisme est générique : les rôles applicatifs (ex. `ROLE_DEV`) sont définis par
 * le consommateur, **jamais** par le core.
 */
export type { Role } from "./roles";
export { hasRole, hasAnyRole, hasAllRoles, RoleSet } from "./roles";
export { RoleRegistry, ROLE_MASK_CAPACITY } from "./registry";
