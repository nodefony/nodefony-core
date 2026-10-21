import type { RolesVerdict } from "../mcp/profileRoute";

/** Vue minimale du service `users` (`@nodefony/user`). */
interface IAccountSource {
  loadUserByIdentifier(identifier: string): Promise<unknown>;
}

/** Vue minimale du pare-feu (`firewall`, `@nodefony/security`) : sa hiérarchie de rôles. */
interface IRoleHierarchySource {
  roleHierarchy: { reachableRoles(roles: readonly string[]): Set<string> };
}

function isAccountSource(value: unknown): value is IAccountSource {
  return (
    typeof value === "object" &&
    value !== null &&
    "loadUserByIdentifier" in value &&
    typeof value.loadUserByIdentifier === "function"
  );
}

function isRoleHierarchySource(value: unknown): value is IRoleHierarchySource {
  return (
    typeof value === "object" &&
    value !== null &&
    "roleHierarchy" in value &&
    typeof value.roleHierarchy === "object" &&
    value.roleHierarchy !== null &&
    "reachableRoles" in value.roleHierarchy &&
    typeof value.roleHierarchy.reachableRoles === "function"
  );
}

/** Rôles chaîne d'un compte lu, sans lui faire confiance. */
function rolesOf(user: unknown): string[] {
  if (typeof user !== "object" || user === null || !("roles" in user))
    return [];
  return Array.isArray(user.roles)
    ? user.roles.filter((r: unknown): r is string => typeof r === "string")
    : [];
}

/**
 * Les rôles du compte `target`, hiérarchie comprise, sont-ils TOUS atteints par
 * ceux de `owner` ? Jouer un autre compte ne doit jamais monter en droits.
 *
 * Fail-closed : un service absent, un compte introuvable ou une lecture qui
 * lève rendent un refus, jamais un accord.
 *
 * @param users - le service `users` du conteneur.
 * @param firewall - le service `firewall` du conteneur (sa hiérarchie de rôles).
 * @param owner - propriétaire du jeton MCP.
 * @param target - compte à jouer.
 * @returns l'accord, ou la raison du refus (rôles en trop nommés).
 */
export async function compareAccountRoles(
  users: unknown,
  firewall: unknown,
  owner: string,
  target: string,
): Promise<RolesVerdict> {
  if (!isAccountSource(users) || !isRoleHierarchySource(firewall)) {
    return {
      ok: false,
      reason:
        "comptes ou hiérarchie de rôles indisponibles (@nodefony/user, @nodefony/security)",
    };
  }
  let ownerUser: unknown;
  let targetUser: unknown;
  try {
    ownerUser = await users.loadUserByIdentifier(owner);
    targetUser = await users.loadUserByIdentifier(target);
  } catch {
    return { ok: false, reason: "compte introuvable" };
  }
  const hierarchy = firewall.roleHierarchy;
  const granted = hierarchy.reachableRoles(rolesOf(ownerUser));
  const extra = [...hierarchy.reachableRoles(rolesOf(targetUser))].filter(
    (role) => !granted.has(role),
  );
  return extra.length === 0
    ? { ok: true }
    : {
        ok: false,
        reason: `\`${target}\` a des rôles que \`${owner}\` n'a pas : ${extra.sort().join(", ")}`,
      };
}
