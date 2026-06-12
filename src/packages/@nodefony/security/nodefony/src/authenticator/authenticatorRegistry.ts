import type { Container } from "nodefony";
import type { IPasswordVerifier } from "@nodefony/user";
import type { IAuthenticator } from "../../contracts/IAuthenticator";
import type { ISecurityConfig } from "../../config/defineSecurityConfig";
import { AnonymousAuthenticator } from "./AnonymousAuthenticator";
import { UserPasswordAuthenticator } from "./UserPasswordAuthenticator";
import { LoginThrottler } from "../throttle/LoginThrottler";

/**
 * Registre de **fabriques d'authenticators** — résout les noms listés dans
 * `areas.<zone>.authenticators` vers des instances, SANS que le firewall
 * connaisse le moindre nom en dur.
 *
 * Pourquoi : `IAuthenticator` est pluggable par contrat ; un
 * `if (name === "jwt") …` dans le firewall trahirait cette promesse (couplage
 * aux noms, fermé à l'extension). Les builtins s'enregistrent au chargement du
 * module (donc toujours AVANT le boot) ; un plugin externe enregistre le sien
 * (`registerAuthenticatorFactory("ldap", …)`) puis le référence en config —
 * aucun changement dans le cœur. Convention-frère : `backplaneRegistry`
 * (realtime), `ormRegistry` (orm-core).
 */

/**
 * Contexte passé à une fabrique : tout ce dont un authenticator peut avoir
 * besoin pour se construire. La fabrique ne fait QUE construire — résolutions
 * de services coûteuses en lazy à l'intérieur de l'instance (cold path).
 */
export interface IAuthenticatorFactoryContext {
  /** Container DI — résolution de services (`users`, `sessions`...). */
  readonly container: Container;
  /** Config sécurité validée + gelée (sections `jwt`, `passkeys`...). */
  readonly config: ISecurityConfig;
}

/** Fabrique d'un authenticator pour un nom donné. */
export type AuthenticatorFactory = (
  ctx: IAuthenticatorFactoryContext,
) => IAuthenticator;

const factories = new Map<string, AuthenticatorFactory>();

/**
 * Enregistre (ou remplace) la fabrique d'un authenticator. Appelé par les
 * builtins au chargement du module, et par les plugins pour les leurs
 * (LDAP, SSO maison...).
 */
export function registerAuthenticatorFactory(
  name: string,
  factory: AuthenticatorFactory,
): void {
  factories.set(name, factory);
}

/** Fabrique d'un authenticator par nom, ou `undefined` si inconnu. */
export function getAuthenticatorFactory(
  name: string,
): AuthenticatorFactory | undefined {
  return factories.get(name);
}

/** Noms enregistrés (validation boot, introspection Studio, tests). */
export function listAuthenticatorFactories(): string[] {
  return [...factories.keys()];
}

// ─── Builtins — enregistrés à l'import du module (dispo avant tout boot) ──────

registerAuthenticatorFactory("anonymous", () => new AnonymousAuthenticator());

registerAuthenticatorFactory("userpassword", ({ container, config }) => {
  // Throttler NIST construit depuis la config validée — 1 instance par
  // authenticator (lui-même unique par nom, partagé entre zones).
  const rl = config.rateLimit;
  const throttler = rl.enabled
    ? new LoginThrottler({
        freeAttempts: rl.freeAttempts,
        baseDelayS: rl.baseDelayS,
        capDelayS: rl.capDelayS,
        maxTracked: rl.maxTracked,
      })
    : null;
  return new UserPasswordAuthenticator(() => {
    const verifier = container.get<IPasswordVerifier>("users");
    if (!verifier) {
      // Erreur de CÂBLAGE (pas d'authentification) : le firewall la loggue en
      // ERROR puis répond 401 fail-closed — jamais de fuite du détail au client.
      throw new Error(
        `UserPasswordAuthenticator: aucun service "users" (IPasswordVerifier) ` +
          `dans le container — enregistrer un UserService au boot de l'application.`,
      );
    }
    return verifier;
  }, throttler);
});
