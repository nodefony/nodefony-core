import type { IRealtimeHandshake } from "./IRealtimeHandshake";

/**
 * Sélecteur d'une zone WS protégée — équivalent realtime de `ISecuredArea`
 * côté HTTP de `@nodefony/security` (pattern URL + vhost optionnel).
 *
 * Le hub stocke les matchers dans l'ordre d'enregistrement ; le **1ʳᵉ** dont
 * `match()` renvoie `true` capture le handshake. Convention : enregistrer les
 * patterns les plus spécifiques EN PREMIER.
 *
 * @example
 * ```ts
 * // Zone admin (préfixe + vhost) — JWT obligatoire
 * realtimeService.useAuthenticator(
 *   { pattern: /^\/admin\//, host: "admin.example.com" },
 *   jwtAuthenticator,
 * );
 * // Zone publique chat — anonyme accepté
 * realtimeService.useAuthenticator(
 *   { pattern: /^\/chat\// },
 *   anonymousAuthenticator,
 * );
 * ```
 */
export interface IRealtimeAuthenticatorMatcher {
  /**
   * Pattern d'URL (path) — string compilé en RegExp (escape complet) OU RegExp
   * fournie telle quelle. La RegExp est testée contre `handshake.url` (le path
   * sans query string).
   */
  readonly pattern: string | RegExp;

  /**
   * Vhost (Host header) optionnel — match exact (insensible à la casse). Omis
   * = tous domaines. Parité avec `ISecuredArea.host` HTTP.
   */
  readonly host?: string;
}

/**
 * Forme compilée d'un matcher — utilisé en interne par le hub (cache de la
 * RegExp compilée + host lowercase). Pas destiné à l'API publique.
 */
export interface ICompiledRealtimeMatcher {
  readonly pattern: RegExp;
  readonly host?: string;
  /** Le matcher capture-t-il ce handshake ? */
  match(handshake: IRealtimeHandshake): boolean;
}
