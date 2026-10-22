import type { IRolesWithin, RolesWithinVerdict } from "nodefony";
import type { IUser } from "@nodefony/user";
import type { RoleHierarchyWalker } from "./RoleHierarchyWalker";

/**
 * Vue de l'annuaire PLUS permissive que `IUserProvider` (qui promet un
 * `IUser`) : un fournisseur d'application peut rendre `null` ou `undefined`
 * au lieu de lever — sans garde, zéro rôle vaudrait accord. Tout
 * `IUserProvider` la satisfait.
 */
export interface IAccountDirectory {
  loadUserByIdentifier(identifier: string): Promise<IUser | null | undefined>;
}

/**
 * Lit un compte de l'annuaire, sans faire confiance au fournisseur : une
 * lecture qui lève et une lecture qui rend `null` disent toutes deux
 * « introuvable ».
 */
async function loadAccount(
  users: IAccountDirectory,
  identifier: string,
): Promise<IUser | null> {
  try {
    return (await users.loadUserByIdentifier(identifier)) ?? null;
  } catch {
    return null;
  }
}

/** Rôles chaîne d'un compte lu, sans lui faire confiance. */
function rolesOf(user: IUser): string[] {
  return Array.isArray(user.roles)
    ? user.roles.filter((r: unknown): r is string => typeof r === "string")
    : [];
}

/**
 * La règle « jouer un autre compte » : les rôles de `target`, hiérarchie
 * comprise, sont-ils TOUS atteints par ceux de `owner` ? Jouer un compte ne
 * monte jamais en droits.
 *
 * Fermée en cas de doute : un annuaire absent, un compte introuvable — y
 * compris un sujet externe éphémère, qui n'a pas de compte local — rendent un
 * refus, jamais un accord. L'annuaire est résolu à l'appel : le service `users`
 * peut être posé après le pare-feu.
 *
 * @param resolveUsers - rend l'annuaire des comptes (`users`), ou `null`
 * @param hierarchy - la hiérarchie de rôles du pare-feu
 * @returns la règle, à poser au conteneur sous `ROLES_WITHIN`
 */
export function rolesWithin(
  resolveUsers: () => IAccountDirectory | null,
  hierarchy: RoleHierarchyWalker,
): IRolesWithin {
  return async (owner: string, target: string): Promise<RolesWithinVerdict> => {
    const users = resolveUsers();
    if (users === null) {
      return {
        ok: false,
        reason: "annuaire des comptes indisponible (@nodefony/user)",
      };
    }
    const ownerUser = await loadAccount(users, owner);
    if (ownerUser === null) {
      return {
        ok: false,
        reason:
          `\`${owner}\` n'a pas de compte dans l'annuaire de l'application ` +
          "(un sujet externe éphémère ne peut jouer aucun compte)",
      };
    }
    const targetUser = await loadAccount(users, target);
    if (targetUser === null) {
      return { ok: false, reason: `compte \`${target}\` introuvable` };
    }
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
  };
}
