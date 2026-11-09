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
  /**
   * Liste blanche des audiences ÉMETTABLES (RFC 8707) ; la première est
   * l'audience par défaut. Ce n'est pas ce qu'une zone accepte : une zone `jwt`
   * n'accepte que SA ressource, ou l'audience par défaut si elle n'en a pas.
   */
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
 *
 * La ressource d'une ZONE (`areas.<zone>.resource`) entre aussi dans la liste,
 * APRÈS les audiences déclarées : c'est une ressource que ce serveur protège, et
 * la redéclarer dans `jwt.audiences` était une seconde écriture de la même
 * valeur — celle qu'on oublie, et dont le seul symptôme est un `invalid_target`
 * à l'émission. Ajoutée en fin de liste, elle ne change jamais l'audience par
 * défaut ({@link defaultAudience}).
 *
 * Elle n'ouvre rien de plus à la VÉRIFICATION : chaque zone, `jwt` comme
 * `external-jwt`, exige SA ressource (l'audience par défaut pour une zone `jwt`
 * qui n'en déclare pas) — un jeton émis pour une zone n'en ouvre pas une autre.
 *
 * @param jwt - section `jwt` de la config validée
 * @param areas - zones du pare-feu ; omises, seules les audiences déclarées comptent
 * @returns les paramètres partagés par l'émetteur et les vérificateurs
 */
export function resolveJwtRuntime(
  jwt: ISecurityConfig["jwt"],
  areas?: ISecurityConfig["areas"],
): IJwtRuntime {
  const issuer = jwt.issuer && jwt.issuer.length > 0 ? jwt.issuer : "nodefony";
  const audiences = jwt.audiences.length > 0 ? [...jwt.audiences] : [issuer];
  if (areas !== undefined) {
    for (const name in areas) {
      const resource = areas[name]?.resource;
      if (resource !== undefined && !audiences.includes(resource)) {
        audiences.push(resource);
      }
    }
  }
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
