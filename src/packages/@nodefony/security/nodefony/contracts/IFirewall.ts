import type { ContextType } from "@nodefony/http";
import type { IAuthenticator } from "./IAuthenticator";
import type { ISecuredArea } from "./ISecuredArea";
import type { CspFragment } from "../src/csp";
import type {
  IFirewallDescription,
  IRoleHierarchyDescription,
} from "./IFirewallDescription";

/**
 * Orchestrateur de sécurité — branché dans le pipeline HTTP/WS de `@nodefony/http`.
 *
 * `isSecure()` (rapide, hot-path) ne fait QUE matcher la zone et poser
 * `context.security`. `handleSecurity()` (lazy, seulement si la requête est dans
 * une zone) exécute CORS → headers → authenticators → Zero Trust → CSRF.
 */
export interface IFirewall {
  /** Match rapide de zone (pose `context.security`). `true` si zone capturée. */
  isSecure(context: ContextType): boolean;

  /** Pipeline complet d'authentification de la zone. Rejette (401/403) ou résout. */
  handleSecurity(context: ContextType): Promise<ContextType>;

  /**
   * Défense CSRF (Fetch Metadata + repli Origin) sur les méthodes state-changing.
   * No-op sur les méthodes sûres et hors navigateur. Lève `CsrfError` (403) sinon.
   */
  enforceCsrf(context: ContextType): void;

  /**
   * Politique CORS : pose les en-têtes `Access-Control-*`. Retourne `204` pour un
   * preflight `OPTIONS` (à court-circuiter), sinon `undefined`. No-op hors CORS.
   */
  handleCors(context: ContextType): number | undefined;

  /**
   * Pose les en-têtes de sécurité applicatifs (CSP, Referrer-Policy, COOP/COEP/
   * CORP, Permissions-Policy) sur la réponse. No-op si désactivés / hors HTTP.
   */
  applySecurityHeaders(context: ContextType): void;

  /**
   * Déclare des directives CSP additionnelles pour un module (ex. `@nodefony/frontend`
   * en dev : origines Vite + `'unsafe-eval'`). Fusionnées dans le CSP de base et
   * recomposées (re-split nonce) au (dé)enregistrement — jamais par requête.
   */
  registerCspOrigins(moduleName: string, fragment: CspFragment): void;

  /** Retire les directives CSP d'un module (ex. `stopDev` du frontend). */
  unregisterCspOrigins(moduleName: string): void;

  /** Enregistre un authenticator (appelé par chaque `*Authenticator` au boot). */
  registerAuthenticator(authenticator: IAuthenticator): void;

  /** Zone par nom, ou `undefined`. */
  getArea(name: string): ISecuredArea | undefined;

  /**
   * Projection LECTURE SEULE de l'état RUNTIME (zones/authenticators/défenses)
   * pour le data plane Studio — **secrets exclus** (présence, jamais valeur).
   * Décrit ce qui TOURNE (pas la config brute). Source de vérité d'introspection.
   */
  describe(): IFirewallDescription;

  /** Hiérarchie de rôles déclarée + résolution transitive (data plane Studio). */
  describeRoleHierarchy(): IRoleHierarchyDescription;
}
