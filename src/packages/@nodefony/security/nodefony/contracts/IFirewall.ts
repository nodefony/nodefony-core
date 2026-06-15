import type { ContextType } from "@nodefony/http";
import type { IAuthenticator } from "./IAuthenticator";
import type { ISecuredArea } from "./ISecuredArea";

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

  /** Enregistre un authenticator (appelé par chaque `*Authenticator` au boot). */
  registerAuthenticator(authenticator: IAuthenticator): void;

  /** Zone par nom, ou `undefined`. */
  getArea(name: string): ISecuredArea | undefined;
}
