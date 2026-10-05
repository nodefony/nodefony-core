/**
 * Traduction des rôles d'un fournisseur d'identité (Keycloak, tout serveur
 * OpenID Connect) en rôles de l'application.
 *
 * Logique PURE, sans réseau ni base : la même fonction sert la connexion par
 * navigateur (claims du jeton reçu du point de jeton) et l'API (claims d'un
 * jeton dont la signature vient d'être vérifiée). Deux implémentations
 * divergeraient — un rôle retiré dans l'annuaire disparaîtrait d'un côté et
 * survivrait de l'autre.
 */

/** Où lire les rôles dans les claims du fournisseur. */
export type ProviderRoleSource = "client" | "realm" | "groups";

/** Source par défaut : les rôles du CLIENT — ceux que l'annuaire attribue à CETTE application. */
export const DEFAULT_ROLE_SOURCES: readonly ProviderRoleSource[] = ["client"];

/**
 * Préfixe des rôles de PLATEFORME (console d'administration, plan
 * d'administration) — jamais accordés par un annuaire externe.
 */
export const PLATFORM_ROLE_PREFIX = "ROLE_NODEFONY_";

/** `true` si le rôle relève de la plateforme (`ROLE_NODEFONY_*`). */
export function isPlatformRole(role: string): boolean {
  return role.startsWith(PLATFORM_ROLE_PREFIX);
}

/** Table de correspondance compilée d'UN fournisseur. */
export interface IProviderRoleMapping {
  /** Client dont on lit les rôles (`resource_access.<clientId>.roles`). */
  readonly clientId: string;
  /** Sources lues, dans l'ordre. */
  readonly sources: readonly ProviderRoleSource[];
  /** Rôle du fournisseur → rôle de l'application (objet sans prototype). */
  readonly table: Readonly<Record<string, string>>;
}

/** Ce que la configuration d'un fournisseur apporte à la correspondance. */
export interface IProviderRoleConfig {
  readonly clientId: string;
  readonly roleMapping?: Readonly<Record<string, string>> | undefined;
  readonly rolesSource?: readonly ProviderRoleSource[] | undefined;
}

/**
 * Compile la table d'un fournisseur — `null` quand il n'en déclare aucune, ce
 * qui laisse les rôles du compte entièrement locaux (comportement historique).
 *
 * @param config - configuration du fournisseur.
 * @returns la table compilée, ou `null`.
 */
export function compileProviderRoleMapping(
  config: IProviderRoleConfig,
): IProviderRoleMapping | null {
  const mapping = config.roleMapping;
  if (mapping === undefined) return null;
  // Objet sans prototype : un rôle Keycloak nommé `constructor` ou
  // `__proto__` ne doit rien résoudre d'autre que ce que la table déclare.
  const table = Object.create(null) as Record<string, string>;
  for (const [from, to] of Object.entries(mapping)) {
    table[from] = to;
  }
  return {
    clientId: config.clientId,
    sources:
      config.rolesSource !== undefined && config.rolesSource.length > 0
        ? config.rolesSource
        : DEFAULT_ROLE_SOURCES,
    table,
  };
}

/**
 * Rôles de l'application accordés par le fournisseur, d'après ses claims.
 *
 * Un rôle du fournisseur absent de la table est IGNORÉ — jamais recopié tel
 * quel : l'annuaire ne fabrique pas de rôle que l'application n'a pas déclaré.
 * Plusieurs jeux de claims (jeton d'accès, jeton d'identité) se cumulent : ils
 * viennent du même émetteur, chacun peut porter une partie des rôles selon
 * les « mappers » configurés chez lui.
 *
 * @param mapping - table compilée du fournisseur.
 * @param claimSets - claims à lire ; `null`/`undefined` ignorés.
 * @returns rôles de l'application, triés et sans doublon.
 */
export function mapProviderRoles(
  mapping: IProviderRoleMapping,
  ...claimSets: (Readonly<Record<string, unknown>> | null | undefined)[]
): string[] {
  const granted = new Set<string>();
  for (const claims of claimSets) {
    if (claims === null || claims === undefined) continue;
    for (const source of mapping.sources) {
      for (const role of readSource(claims, source, mapping.clientId)) {
        const mapped = mapping.table[role];
        if (mapped !== undefined) granted.add(mapped);
      }
    }
  }
  return [...granted].sort();
}

/** Lit les rôles bruts d'une source — tableau vide si la forme n'est pas celle attendue. */
function readSource(
  claims: Readonly<Record<string, unknown>>,
  source: ProviderRoleSource,
  clientId: string,
): readonly string[] {
  switch (source) {
    case "client": {
      const access = asRecord(claims.resource_access);
      return access === null ? [] : rolesOf(access[clientId]);
    }
    case "realm":
      return rolesOf(claims.realm_access);
    case "groups":
      return strings(claims.groups);
  }
}

/** `{ roles: [...] }` → les chaînes de `roles`. */
function rolesOf(value: unknown): readonly string[] {
  const record = asRecord(value);
  return record === null ? [] : strings(record.roles);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}
