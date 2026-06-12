import { Service, Module, Container, Event, RequestContext } from "nodefony";
import type { ContextType, SessionsService, ISession } from "@nodefony/http";
import type { IUser, IUserProvider, IPasswordVerifier } from "@nodefony/user";
import { AuthenticationError } from "../errors/AuthenticationError";
import { ThrottledError } from "../errors/ThrottledError";
import type { LoginThrottler } from "../src/throttle/LoginThrottler";
import { resolveSessionIdentity } from "../src/sessionIdentity";

const serviceName = "authFlow";

// Message UNIFORME (anti-énumération) — identique à la porte Basic.
const INVALID_CREDENTIALS = "Invalid credentials";

/**
 * Projection PUBLIQUE de l'utilisateur — ce qui sort en JSON vers le client.
 * Jamais l'entité brute : le hash (`IPasswordAuthenticatedUser.password`) ne
 * doit traverser ni la sérialisation ni un log.
 */
export interface ISafeUser {
  id: string;
  username: string;
  roles: string[];
}

// Source d'identité résolue du container — UserService implémente les deux faces.
type UserSource = IPasswordVerifier & IUserProvider;

/**
 * Flux de session BFF — login/logout/me côté serveur (P6 J3).
 *
 * C'est le GUICHET : le credential est présenté UNE fois (`login`), vérifié par
 * le {@link IPasswordVerifier} (hash, leurre anti-timing, re-hash migration),
 * puis remplacé par un cookie de session opaque `HttpOnly` — le mot de passe ne
 * recircule jamais, le navigateur ne stocke aucun token lisible par JS.
 *
 * Anti session-fixation (OWASP) : l'ID de session est TOUJOURS régénéré au
 * login — un ID pré-posé par un attaquant (cookie forcé avant le guichet) ne
 * survit pas à l'authentification ; l'ancienne entrée storage est détruite.
 *
 * Throttling NIST SP 800-63B : le MÊME `LoginThrottler` que la porte Basic
 * (instance partagée via le container, posée par le firewall au boot) — un
 * attaquant ne contourne pas le backoff en changeant de porte.
 *
 * Les handlers HTTP (`SessionAuthController`, `@nodefony/framework`) sont des
 * adaptateurs minces au-dessus de ce service — la logique reste testable sans
 * transport.
 */
class AuthFlow extends Service {
  #users: UserSource | null = null;
  #sessions: SessionsService | null = null;
  // null = throttling désactivé en config ; résolu UNE fois (le firewall pose
  // l'instance au boot, avant toute requête).
  #throttler: LoginThrottler | null = null;
  #throttlerResolved = false;

  constructor(public module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options,
    );
  }

  /**
   * Authentifie le couple identifiant/mot de passe et OUVRE la session BFF.
   *
   * Ordre NIST : throttle AVANT le verifier (un identifiant bloqué ne coûte
   * aucun hash argon2 — le backoff protège aussi le serveur du DoS), échec
   * compté, succès remis à zéro.
   *
   * @param context - contexte HTTP courant (porte la session/le cookie).
   * @param identifier - identifiant saisi (body JSON, non typé à la frontière).
   * @param password - mot de passe saisi.
   * @returns la projection publique de l'utilisateur authentifié.
   * @throws ThrottledError (429 + `Retry-After`) — backoff actif.
   * @throws AuthenticationError (401, message uniforme) — credential absent ou
   *   invalide.
   */
  async login(
    context: ContextType,
    identifier: unknown,
    password: unknown,
  ): Promise<ISafeUser> {
    if (
      typeof identifier !== "string" ||
      identifier.length === 0 ||
      typeof password !== "string" ||
      password.length === 0
    ) {
      throw new AuthenticationError(INVALID_CREDENTIALS);
    }
    const throttler = this.#resolveThrottler();
    if (throttler !== null) {
      const retryAfterS = throttler.check(identifier);
      if (retryAfterS > 0) throw new ThrottledError(retryAfterS);
    }
    const user = await this.#resolveUsers().authenticate(identifier, password);
    if (user === null) {
      throttler?.recordFailure(identifier);
      throw new AuthenticationError(INVALID_CREDENTIALS);
    }
    throttler?.recordSuccess(identifier);

    await this.#openSession(context, user.identifier);
    // Principal de la requête courante : string sur le contexte (lié au blob
    // par `saveSession`), objet riche dans l'ALS (logs/audit).
    context.user = user.identifier;
    RequestContext.set("user", user);
    return toSafeUser(user);
  }

  /**
   * Détruit la session courante (storage + cookie). Idempotent : sans session
   * active, ne fait rien.
   *
   * @returns `true` si une session a réellement été détruite.
   */
  async logout(context: ContextType): Promise<boolean> {
    const session = context.session;
    if (!session || session.status !== "active") {
      return false;
    }
    await session.destroy(true);
    // L'état du contexte reflète la réalité : plus de session → le
    // `saveSession` de fin de requête est un no-op (pas de résurrection).
    context.session = null;
    context.user = null;
    return true;
  }

  /**
   * Identité portée par la session courante, re-résolue auprès du provider
   * (mêmes contrôles que le `SessionAuthenticator` — source unique).
   *
   * @returns la projection publique, ou `null` (pas de session, session
   *   orpheline, compte verrouillé/désactivé) — le handler répond 401.
   */
  async me(context: ContextType): Promise<ISafeUser | null> {
    const identifier = context.session?.user;
    if (typeof identifier !== "string" || identifier.length === 0) {
      return null;
    }
    try {
      const user = await resolveSessionIdentity(
        this.#resolveUsers(),
        identifier,
      );
      return toSafeUser(user);
    } catch (error) {
      if (error instanceof AuthenticationError) return null;
      throw error;
    }
  }

  // Ouvre (ou reprend) la session puis applique l'anti-fixation : ID régénéré
  // INCONDITIONNELLEMENT (un cookie pré-posé ne survit pas au login), ancienne
  // entrée storage détruite (best-effort : elle peut ne pas exister), blob
  // persisté immédiatement avec l'identifiant (le cookie part avec la réponse).
  async #openSession(context: ContextType, identifier: string): Promise<void> {
    const session: ISession | null =
      context.session ?? (await this.#resolveSessions().start(context));
    if (session === null) {
      // Erreur de câblage (storage down...) : signal ops côté serveur, 401
      // générique côté client (fail-closed, rien ne fuite).
      this.log("login: session service returned no session", "ERROR");
      throw new AuthenticationError(INVALID_CREDENTIALS);
    }
    const oldId = session.id;
    session.regenerateId();
    try {
      await session.storage.destroy(oldId, session.contextSession);
    } catch {
      /* best-effort : session neuve jamais persistée */
    }
    await session.save(identifier);
  }

  #resolveSessions(): SessionsService {
    if (this.#sessions === null) {
      const sessions = this.get<SessionsService>("sessions");
      if (!sessions) {
        throw new Error(
          `AuthFlow: aucun service "sessions" dans le container — ` +
            `le module @nodefony/http doit être chargé avant @nodefony/security.`,
        );
      }
      this.#sessions = sessions;
    }
    return this.#sessions;
  }

  #resolveUsers(): UserSource {
    if (this.#users === null) {
      const users = this.get<UserSource>("users");
      if (!users) {
        throw new Error(
          `AuthFlow: aucun service "users" (IPasswordVerifier & IUserProvider) ` +
            `dans le container — enregistrer un UserService au boot de l'application.`,
        );
      }
      this.#users = users;
    }
    return this.#users;
  }

  #resolveThrottler(): LoginThrottler | null {
    if (!this.#throttlerResolved) {
      this.#throttler = this.get<LoginThrottler>("loginThrottler") ?? null;
      this.#throttlerResolved = true;
    }
    return this.#throttler;
  }
}

// Projette l'entité vers sa forme publique (jamais le hash).
function toSafeUser(user: IUser): ISafeUser {
  return {
    id: user.id,
    username: user.identifier,
    roles: [...user.roles],
  };
}

export default AuthFlow;
export { AuthFlow };
