import type { IAdminEndpoint } from "../../types/IAdminApi";

/**
 * Décision d'autorisation du data plane admin (Studio) — fonction **PURE**,
 * cœur de la garantie RBAC, testée isolément (zéro dépendance runtime/DI).
 *
 * **Fail-closed.** Un endpoint qui exige un rôle (`requiredRole` non vide) n'est
 * accordé QUE si l'appelant le porte. Un appelant **sans rôle** (`roles=[]` — ex.
 * compte authentifié non doté, créé via `POST users` sans `roles`) est donc
 * **rejeté** (403). C'était le **fail-open historique** : le 403 était court-circuité
 * par une garde `roles.length > 0 &&` — vestige du « mode mock » d'avant P6, quand
 * aucun rôle n'était injecté. Zero Trust : l'absence de rôle ne vaut pas
 * laissez-passer. Le firewall (zone `nodefony-admin`) garantit l'AUTHENTIFICATION
 * en amont ; cette fonction tranche le RÔLE.
 *
 * `requiredRole` vide (`""`) ou absent = endpoint **public déclaré**
 * (`IAdminEndpoint.public`, ex. liveness `livez`) → toujours accordé : le RBAC du
 * broker est volontairement court-circuité, la protection vit alors dans le firewall.
 *
 * @param roles - rôles **bruts** de l'appelant (projection ALS `IAdminRequest.roles`).
 * @param requiredRole - rôle exigé par la route (`""`/`undefined` = public).
 * @returns `true` si l'accès est accordé.
 */
export function isAdminGranted(
  roles: readonly string[],
  requiredRole: string | undefined,
): boolean {
  if (!requiredRole) return true; // endpoint public (role === "") — pas de RBAC ici
  return roles.includes(requiredRole); // fail-closed : roles=[] → refusé
}

/**
 * Rôle exigé par défaut d'un endpoint d'administration qui n'en déclare aucun.
 *
 * Le défaut est **restrictif** : un producteur qui oublie de qualifier son
 * endpoint le publie au rôle d'administrateur, jamais à l'anonyme. Ouvrir plus
 * large se DÉCLARE (`IAdminEndpoint.public`) et se relit en revue.
 */
export const ADMIN_DEFAULT_ROLE = "ROLE_NODEFONY_ADMIN";

/**
 * Rôle **effectif** d'un endpoint — la règle, à un seul endroit.
 *
 * Toutes les portes du plan d'administration (route HTTP montée par le broker,
 * pont WS-RPC, commande `inspect`, serveur MCP) doivent trancher le même rôle
 * pour le même endpoint. Deux résolutions séparées finiraient par diverger, et
 * c'est la porte secondaire — celle qu'on relit le moins — qui deviendrait la
 * plus permissive.
 *
 * @param endpoint - la définition telle que le producteur la déclare.
 * @returns le rôle exigé, ou `""` pour un endpoint **public déclaré**.
 */
export function resolveAdminRole(
  endpoint: Pick<IAdminEndpoint, "public" | "role">,
): string {
  return endpoint.public ? "" : (endpoint.role ?? ADMIN_DEFAULT_ROLE);
}
