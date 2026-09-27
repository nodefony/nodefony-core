import type { ISecurityConfig } from "../../config/defineModuleConfig";

/**
 * Paramètres JWT **résolus** partagés par l'émetteur ({@link TokenService}) et le
 * vérificateur ({@link JwtAuthenticator}) — garantit que `iss`/`aud` posés à la
 * signature sont EXACTEMENT ceux exigés à la vérification (une divergence = tout
 * rejeté). Fonction pure (pas d'état, pas de kernel) → les deux côtés obtiennent
 * la même valeur sans la partager.
 */
export interface IJwtRuntime {
  /** Émetteur (`iss`). */
  readonly issuer: string;
  /** Audiences acceptées au verify ; la première sert d'`aud` à l'émission. */
  readonly audiences: string[];
  /** TTL access token (s). */
  readonly accessTtlS: number;
  /** TTL refresh token (s). */
  readonly refreshTtlS: number;
  /** Rotation du refresh à chaque usage (OWASP / RFC 9700). */
  readonly rotateRefresh: boolean;
  /** Algorithme — `"EdDSA"` (Ed25519). RS256 = slot non câblé en J4a. */
  readonly alg: "EdDSA";
}

/**
 * Dérive les paramètres effectifs depuis la config sécurité. `issuer` omis →
 * `"nodefony"` (DEVRAIT être surchargé en prod) ; `audiences` vide → l'app est sa
 * propre audience (`[issuer]`).
 */
export function resolveJwtRuntime(jwt: ISecurityConfig["jwt"]): IJwtRuntime {
  const issuer = jwt.issuer && jwt.issuer.length > 0 ? jwt.issuer : "nodefony";
  const audiences = jwt.audiences.length > 0 ? [...jwt.audiences] : [issuer];
  return {
    issuer,
    audiences,
    accessTtlS: jwt.accessTtlS,
    refreshTtlS: jwt.refreshTtlS,
    rotateRefresh: jwt.rotateRefresh,
    alg: "EdDSA",
  };
}

/**
 * Audience inscrite dans un jeton quand aucune ressource n'est demandée : la
 * première de la liste blanche. La liste n'est jamais vide après
 * {@link resolveJwtRuntime} ; un runtime construit à la main qui la laisserait
 * vide retombe sur la même règle — l'application est sa propre audience.
 *
 * @param runtime - paramètres JWT résolus
 * @returns l'audience par défaut
 */
export function defaultAudience(runtime: IJwtRuntime): string {
  return runtime.audiences[0] ?? runtime.issuer;
}
