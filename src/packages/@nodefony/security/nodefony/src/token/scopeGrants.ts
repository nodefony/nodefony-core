import {
  ADMIN_SCOPE_READ,
  ADMIN_SCOPE_WRITE,
  refusedAdminScopes,
} from "nodefony";
import type { RoleHierarchyWalker } from "../RoleHierarchyWalker";

/**
 * Qui peut OBTENIR un scope d'application : clé = un scope exact ou une
 * famille `préfixe:*`, valeur = les rôles dont UN suffit.
 */
export type IScopeGrants = Readonly<Record<string, readonly string[]>>;

/**
 * Un scope demandé et refusé, avec la règle qui l'a refusé.
 *
 * `admin` = réservé au plan d'administration du framework
 * ({@link refusedAdminScopes}) ; `application` = déclaré dans
 * `grantableScopes` pour des rôles que le porteur n'a pas.
 */
export interface IScopeRefusal {
  scope: string;
  rule: "admin" | "application";
}

// Grammaire `scope-token` de RFC 6749 §3.3 : %x21 / %x23-5B / %x5D-7E.
const SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]+$/u;
const WILDCARD_SUFFIX = ":*";

/**
 * Clés que `grantableScopes` refuse : le plan d'administration est jugé par le
 * framework, et une déclaration ici serait soit sans effet, soit un
 * assouplissement — deux pièges que rien ne signalerait.
 */
export const RESERVED_SCOPE_GRANT_KEYS: readonly string[] = [
  ADMIN_SCOPE_READ,
  ADMIN_SCOPE_WRITE,
  "admin:*",
];

/**
 * Dit pourquoi une clé de `grantableScopes` est invalide, ou `null` si elle
 * est acceptable.
 *
 * Une clé est un `scope-token` (RFC 6749 §3.3) ; un `*` n'y est admis qu'en
 * dernière position, juste après `:` (une famille `préfixe:*`).
 *
 * @param key - la clé déclarée.
 * @returns le motif du refus, ou `null`.
 */
export function scopeGrantKeyProblem(key: string): string | null {
  if (!SCOPE_TOKEN.test(key)) {
    return "n'est pas un scope valide (RFC 6749 §3.3 : ni espace, ni guillemet, ni barre oblique inverse)";
  }
  const star = key.indexOf("*");
  if (
    star !== -1 &&
    (star !== key.length - 1 ||
      !key.endsWith(WILDCARD_SUFFIX) ||
      key.length === WILDCARD_SUFFIX.length)
  ) {
    return "porte un `*` ailleurs qu'en fin de famille (`préfixe:*`)";
  }
  if (RESERVED_SCOPE_GRANT_KEYS.includes(key)) {
    return "est réservé au plan d'administration du framework (les scopes `admin:read`/`admin:write` sont accordés au seul rôle ROLE_NODEFONY_ADMIN)";
  }
  return null;
}

/**
 * Politique d'attribution des scopes d'application, compilée une fois au boot.
 *
 * Résolution : une clé EXACTE l'emporte sur une famille, et la famille la plus
 * longue sur une plus courte (`shop:admin:*` > `shop:*`). Le résultat ne dépend
 * donc pas de l'ordre des clés. Un scope qu'aucune clé ne couvre reste accordé
 * à tout porteur (comportement historique).
 */
export class ScopeGrantPolicy {
  readonly #exact = new Map<string, readonly string[]>();
  // [préfixe SANS l'étoile, rôles], du plus long au plus court.
  readonly #families: [string, readonly string[]][] = [];

  /**
   * @param grants - la section `grantableScopes`, déjà validée par le schéma.
   */
  constructor(grants: IScopeGrants = {}) {
    for (const [key, roles] of Object.entries(grants)) {
      if (key.endsWith(WILDCARD_SUFFIX)) {
        this.#families.push([key.slice(0, -1), roles]);
      } else {
        this.#exact.set(key, roles);
      }
    }
    this.#families.sort((a, b) => b[0].length - a[0].length);
  }

  /** `true` si aucune clé n'est déclarée — tout scope d'application est accordé. */
  get isEmpty(): boolean {
    return this.#exact.size === 0 && this.#families.length === 0;
  }

  /**
   * Les rôles dont UN suffit pour obtenir ce scope.
   *
   * @param scope - un scope demandé.
   * @returns les rôles de la clé la plus spécifique, ou `null` si aucune clé ne
   *   le couvre (scope libre).
   */
  rolesFor(scope: string): readonly string[] | null {
    const exact = this.#exact.get(scope);
    if (exact !== undefined) return exact;
    for (const [prefix, roles] of this.#families) {
      if (scope.startsWith(prefix)) return roles;
    }
    return null;
  }
}

/**
 * Les scopes demandés que ce porteur ne peut pas obtenir, avec la règle qui
 * refuse chacun.
 *
 * Seul juge des DEUX familles, appelé par chaque émetteur de l'application
 * (jeton d'accès, clé API) : la règle d'administration du framework
 * ({@link refusedAdminScopes}, jugée sur les rôles PLATS du compte, comme le
 * plan d'administration) et la politique de l'application
 * ({@link ScopeGrantPolicy}, jugée hiérarchie de rôles comprise, comme un
 * `@IsGranted`).
 *
 * @param requested - scopes demandés (RFC 6749 §3.3).
 * @param roles - rôles du porteur, tels que son compte les porte.
 * @param policy - politique compilée de `grantableScopes`.
 * @param hierarchy - hiérarchie de rôles ; absente, seuls les rôles plats comptent.
 * @returns les refus, dans l'ordre de la demande — vide si tout est accordé.
 */
export function refusedScopes(
  requested: readonly string[],
  roles: readonly string[],
  policy: ScopeGrantPolicy,
  hierarchy: RoleHierarchyWalker | null,
): IScopeRefusal[] {
  const admin = refusedAdminScopes(requested, roles);
  if (admin.length === 0 && policy.isEmpty) return [];
  let reachable: ReadonlySet<string> | null = null;
  const out: IScopeRefusal[] = [];
  for (const scope of requested) {
    if (admin.includes(scope)) {
      out.push({ scope, rule: "admin" });
      continue;
    }
    const allowed = policy.rolesFor(scope);
    if (allowed === null) continue;
    reachable ??= hierarchy ? hierarchy.reachableRoles(roles) : new Set(roles);
    if (!allowed.some((role) => reachable?.has(role))) {
      out.push({ scope, rule: "application" });
    }
  }
  return out;
}
