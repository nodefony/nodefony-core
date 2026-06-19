import type { Container } from "nodefony";
import type { IPasswordVerifier, IUserProvider } from "@nodefony/user";
import type { IAuthenticator } from "../../contracts/IAuthenticator";
import type { ISecurityConfig } from "../../config/defineSecurityConfig";
import { AnonymousAuthenticator } from "./AnonymousAuthenticator";
import { SessionAuthenticator } from "./SessionAuthenticator";
import { UserPasswordAuthenticator } from "./UserPasswordAuthenticator";
import { JwtAuthenticator } from "./JwtAuthenticator";
import { ApiKeyAuthenticator } from "./ApiKeyAuthenticator";
import { resolveJwtRuntime } from "../token/jwtRuntime";
import type { LoginThrottler } from "../throttle/LoginThrottler";

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

registerAuthenticatorFactory("userpassword", ({ container }) => {
  // Throttler NIST PARTAGÉ (posé au container par le firewall au boot depuis
  // config.rateLimit) : même compteur que le login JSON BFF (`AuthFlow`) — un
  // attaquant ne contourne pas le backoff en changeant de porte. Absent =
  // throttling désactivé en config.
  const throttler = container.get<LoginThrottler>("loginThrottler") ?? null;
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

registerAuthenticatorFactory("session", ({ container }) => {
  // Session BFF (P6 J3) : la preuve des requêtes POST-login. Résolution lazy
  // de la source d'identité — même frontière que `userpassword`.
  return new SessionAuthenticator(() => {
    const provider = container.get<IUserProvider>("users");
    if (!provider) {
      throw new Error(
        `SessionAuthenticator: aucun service "users" (IUserProvider) dans le ` +
          `container — enregistrer un UserService au boot de l'application.`,
      );
    }
    return provider;
  });
});

registerAuthenticatorFactory("jwt", ({ container, config }) => {
  // JWT Bearer (P6 J4) : API service↔service / agents. Le keystore + le store
  // de jetons sont posés au container par le TokenService au boot ; résolution
  // lazy dans l'instance (cold path). Les paramètres iss/aud/ttl sont dérivés de
  // la config (mêmes valeurs que l'émetteur via `resolveJwtRuntime`).
  return new JwtAuthenticator(container, resolveJwtRuntime(config.jwt));
});

registerAuthenticatorFactory("apikey", ({ container, config }) => {
  // Clé API personnelle (PAT, P6.12) : bearer opaque révocable. Le store de
  // jetons est posé au container par le TokenService ; résolution lazy dans
  // l'instance. Préfixe (discrimine du JWT) + throttle "last used" = config.apiKeys.
  return new ApiKeyAuthenticator(container, {
    prefix: config.apiKeys.prefix,
    lastUsedThrottleS: config.apiKeys.lastUsedThrottleS,
  });
});
