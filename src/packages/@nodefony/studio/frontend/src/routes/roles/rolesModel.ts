/**
 * Modèle de la page **Rôles** (P6.15) — exploration de la hiérarchie RBAC
 * (niveau A de l'autorisation : `RoleHierarchyWalker`).
 *
 * Les **types miroir** du contrat `roleHierarchy` sont nés dans `firewallModel`
 * (le contrat serveur `IRoleHierarchyDescription` vit dans
 * `security/.../IFirewallDescription.ts`, car roleHierarchy fait partie de
 * l'introspection du firewall) → on les **réutilise** ici (source unique, 0
 * duplication) et on ajoute les helpers purs propres à l'exploration des rôles.
 *
 * Data plane : `GET /nodefony/security/api/roleHierarchy` (RBAC
 * `ROLE_NODEFONY_ADMIN`). Frontière isomorphe : aucun import runtime serveur.
 */
export type { RoleDescription, RoleHierarchy } from "../firewall/firewallModel";
export { ROLES_ENDPOINT } from "../firewall/firewallModel";
// L'endpoint roleHierarchy est servi PAR le firewall (mêmes codes 401/403/503/404)
// → on réutilise tel quel le mapping d'erreur FR de la console Firewall.
export { describeFirewallError as describeRolesError } from "../firewall/firewallModel";

/** Version de la doc de cette surface (badge des fiches `DocHint`). */
export const ROLES_DOC = "v1.0";

/**
 * Tous les rôles que la hiérarchie du serveur fait CONNAÎTRE — clés ∪ valeurs.
 *
 * ⚠️ Ne PAS se contenter de `roles[]` du contrat : le serveur le construit par
 * `Object.keys(hierarchy)` (`firewall.ts:651`), si bien qu'un rôle qui n'hérite
 * de rien n'y figure jamais. Sur la configuration du dépôt, `ROLE_USER` est
 * exactement dans ce cas — il n'apparaît qu'en VALEUR, sous les quatre rôles de
 * tenant. Un sélecteur alimenté par `roles[]` perdrait donc le rôle de base, le
 * plus courant de tous.
 *
 * Trié pour que l'ordre d'affichage ne dépende pas de l'ordre de déclaration.
 */
export function knownRoles(hierarchy: Record<string, string[]>): string[] {
  const set = new Set<string>();
  for (const [role, inherited] of Object.entries(hierarchy)) {
    set.add(role);
    for (const r of inherited) set.add(r);
  }
  return [...set].sort();
}
