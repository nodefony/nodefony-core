import type { ContextType } from "@nodefony/http";

/**
 * Zone sécurisée — un pattern d'URL + la liste des authenticators à exécuter.
 *
 * Le firewall teste chaque zone par ordre de spécificité ; la première dont le
 * pattern matche capture la requête (`context.security`). Les zones viennent de
 * `defineSecurityConfig({ areas })` — patterns compilés et triés au boot, conflits
 * détectés au boot (pas au premier match runtime).
 */
export interface ISecuredArea {
  /** Nom de la zone (`"main_api"`, `"admin"`…). */
  readonly name: string;

  /** Pattern d'URL compilé. */
  readonly pattern: RegExp;

  /** Zone protégée (Zero Trust) ; `false` = zone publique explicite. */
  readonly security: boolean;

  /** HTTP stateless (JWT cookie) ; le défaut 2026. */
  readonly stateless: boolean;

  /** Noms des authenticators à exécuter (chaîne — tous doivent passer). */
  readonly authenticators: readonly string[];

  /** Domaine/vhost de la zone (ex. `admin.exemple.com`). Omis = tous domaines. */
  readonly host?: string;

  /** La requête tombe-t-elle dans cette zone ? (pattern + host éventuel). */
  match(context: ContextType): boolean;
}
