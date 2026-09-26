import type { ContextType } from "../service/http-kernel";

/**
 * Ce que le pipeline HTTP/WS — et le résolveur de framework — lit de la zone de sécurité posée sur
 * `context.security` — et rien de plus.
 *
 * Le pare-feu vit dans `@nodefony/security`, qui dépend de `@nodefony/http` :
 * `http` ne peut donc pas nommer ses classes sans recréer un cycle. C'est le
 * LECTEUR qui définit le contrat ; `ISecuredArea` (security) l'étend, et le
 * typecheck de `security` garantit l'alignement.
 */
export interface ISecurityZone {
  /** Nom de la zone (journalisation, profiler). */
  readonly name: string;
  /** `true` si la zone exige une authentification. */
  readonly security: boolean;
  /** Zone sans session : aucune session n'est ouverte ni lue. */
  readonly stateless: boolean;
  /** Stratégie des authenticators : le premier qui répond, ou tous. */
  readonly mode: "first" | "all";
  /** Noms des authenticators candidats, dans l'ordre. */
  readonly authenticators: readonly string[];
  /**
   * Rôles exigés par la zone, en OU (un seul suffit) ; `null` = aucune exigence
   * de rôle. Lu par le résolveur de `@nodefony/framework` pour l'autorisation.
   */
  readonly roles: readonly string[] | null;
}

/**
 * Ce que le noyau HTTP appelle du pare-feu, service `firewall` du conteneur.
 *
 * Implémenté par `Firewall` (`@nodefony/security`), dont `IFirewall` étend ce
 * contrat de ses propres membres (CSP, authenticators, description).
 */
export interface IFirewallGate {
  /** Match rapide de zone : pose `context.security`, `true` si une zone capture. */
  isSecure(context: ContextType): boolean;
  /** Authentifie la requête d'une zone protégée ; rejette si elle est refusée. */
  handleSecurity(context: ContextType): Promise<ContextType>;
  /** Refuse une requête qui ne présente pas le jeton CSRF attendu. */
  enforceCsrf(context: ContextType): void;
  /** Répond au preflight CORS ; `204` quand la réponse est déjà envoyée. */
  handleCors(context: ContextType): number | undefined;
  /** Pose les en-têtes de sécurité (CSP, HSTS…) de la réponse. */
  applySecurityHeaders(context: ContextType): void;
}
