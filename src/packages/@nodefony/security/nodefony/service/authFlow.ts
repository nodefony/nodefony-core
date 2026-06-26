import { Service, Module, Container, Event, RequestContext } from "nodefony";
import type { ContextType, SessionsService, ISession } from "@nodefony/http";
import type { IUser, IUserProvider, IPasswordVerifier } from "@nodefony/user";
import { AuthenticationError } from "../errors/AuthenticationError";
import { ThrottledError } from "../errors/ThrottledError";
import type { LoginThrottler } from "../src/throttle/LoginThrottler";
import { resolveSessionIdentity } from "../src/sessionIdentity";
import { recordAudit } from "../src/audit/recordAudit";
import { readAuditContext } from "../src/audit/readAuditContext";

const serviceName = "authFlow";

// Message UNIFORME (anti-énumération) — identique à la porte Basic.
const INVALID_CREDENTIALS = "Invalid credentials";

// Clé de session portant le défi 2FA en attente (1ᵉʳ facteur validé, 2ᵉ requis).
// L'identité N'EST PAS posée tant que le code n'est pas validé → Zero Trust.
const PENDING_MFA_KEY = "mfa:pending";

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

/**
 * Issue d'un `login` : soit l'identité est établie (session ouverte), soit un
 * **second facteur** est requis (2FA) — le mot de passe seul n'a PAS authentifié.
 */
export type ILoginOutcome =
  | { status: "authenticated"; user: ISafeUser }
  | { status: "mfa_required"; methods: ["totp"] };

/**
 * Vue MINIMALE du service `totp` (`@nodefony/security`) — couplage par NOM dans
 * le container (comme `users`/`sessions`), jamais un import dur : 2FA désactivé
 * ⇒ service absent ou `isEnabled()` false ⇒ le login nominal ne paie aucun accès.
 */
interface ITotpLoginVerifier {
  isEnabled(): boolean;
  isEnabledFor(userId: string): Promise<boolean>;
  verifyLogin(
    userId: string,
    code: string,
  ): Promise<{ ok: boolean; method?: string }>;
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
  // Service 2FA résolu UNE fois (lazy + caché). null = 2FA absent/désactivé →
  // le chemin login nominal (sans 2FA) ne paie aucun accès store.
  #totp: ITotpLoginVerifier | null = null;
  #totpResolved = false;

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
   * @returns `authenticated` (identité établie) ou `mfa_required` (2ᵉ facteur requis).
   * @throws ThrottledError (429 + `Retry-After`) — backoff actif.
   * @throws AuthenticationError (401, message uniforme) — credential absent ou
   *   invalide.
   */
  async login(
    context: ContextType,
    identifier: unknown,
    password: unknown,
  ): Promise<ILoginOutcome> {
    const info = readAuditContext(context);
    const who = typeof identifier === "string" ? identifier : null;
    if (
      typeof identifier !== "string" ||
      identifier.length === 0 ||
      typeof password !== "string" ||
      password.length === 0
    ) {
      recordAudit(this.container as Container, {
        category: "auth",
        action: "login.failure",
        outcome: "failure",
        actor: who,
        reason: "invalid_credentials",
        ...info,
      });
      throw new AuthenticationError(INVALID_CREDENTIALS);
    }
    const throttler = this.#resolveThrottler();
    if (throttler !== null) {
      const retryAfterS = throttler.check(identifier);
      if (retryAfterS > 0) {
        recordAudit(this.container as Container, {
          category: "auth",
          action: "login.throttled",
          outcome: "failure",
          actor: identifier,
          reason: "throttled",
          ...info,
        });
        throw new ThrottledError(retryAfterS);
      }
    }
    const user = await this.#resolveUsers().authenticate(identifier, password);
    if (user === null) {
      throttler?.recordFailure(identifier);
      recordAudit(this.container as Container, {
        category: "auth",
        action: "login.failure",
        outcome: "failure",
        actor: identifier,
        reason: "invalid_credentials",
        ...info,
      });
      throw new AuthenticationError(INVALID_CREDENTIALS);
    }
    throttler?.recordSuccess(identifier);

    // Step-up 2FA : si l'utilisateur a un second facteur, le mot de passe NE
    // suffit PAS. On dépose un défi en session (PENDING) SANS poser l'identité —
    // `me()` renvoie null, Zero Trust 401 protège tout tant que le code n'est pas
    // validé par `completeMfaLogin`. Coût nul quand le 2FA est désactivé
    // (`#resolveTotp` court-circuite : 0 accès store sur le login nominal).
    const totp = this.#resolveTotp();
    if (totp && (await totp.isEnabledFor(user.identifier))) {
      const session = await this.ensureSession(context);
      session?.set(PENDING_MFA_KEY, user.identifier);
      await session?.save();
      recordAudit(this.container as Container, {
        category: "auth",
        action: "login.mfa_required",
        outcome: "success",
        actor: user.identifier,
        reason: "totp",
        ...info,
      });
      return { status: "mfa_required", methods: ["totp"] };
    }

    await this.#openSession(context, user.identifier);
    // Principal de la requête courante : string sur le contexte (lié au blob
    // par `saveSession`), objet riche dans l'ALS (logs/audit).
    context.user = user.identifier;
    RequestContext.set("user", user);
    recordAudit(this.container as Container, {
      category: "auth",
      action: "login.success",
      outcome: "success",
      actor: user.identifier,
      ...info,
    });
    return { status: "authenticated", user: toSafeUser(user) };
  }

  /**
   * Ouvre la session BFF pour un utilisateur **déjà authentifié par un autre
   * facteur** (passkey/WebAuthn, OAuth, magic link…) — aucun mot de passe à
   * vérifier ici, la preuve a été apportée en amont par l'appelant.
   *
   * Même anti-fixation que {@link login} (ID régénéré, ancienne entrée
   * détruite). L'identité est re-résolue + revalidée (compte actif/non
   * verrouillé) via la source unique `resolveSessionIdentity` — un compte banni
   * entre la preuve et l'ouverture de session est rejeté.
   *
   * @param identifier - identifiant de l'utilisateur prouvé (ex. `sub` du credential).
   * @throws AuthenticationError (401, message uniforme) — identifiant absent, ou
   *   compte disparu/inactif/verrouillé.
   */
  async establishSessionFor(
    context: ContextType,
    identifier: unknown,
    reason = "federated",
  ): Promise<ISafeUser> {
    if (typeof identifier !== "string" || identifier.length === 0) {
      throw new AuthenticationError(INVALID_CREDENTIALS);
    }
    const user = await resolveSessionIdentity(this.#resolveUsers(), identifier);
    await this.#openSession(context, user.identifier);
    context.user = user.identifier;
    RequestContext.set("user", user);
    // Ouverture de session sur preuve EXTERNE (passkey/OAuth/2FA/magic link) —
    // l'appelant précise le facteur (`webauthn`/`oauth`/`totp`/`recovery`…).
    recordAudit(this.container as Container, {
      category: "auth",
      action: "login.success",
      outcome: "success",
      actor: user.identifier,
      reason,
      ...readAuditContext(context),
    });
    return toSafeUser(user);
  }

  /**
   * Valide le **second facteur** (code TOTP ou code de récupération) après un
   * `login` ayant renvoyé `mfa_required`, puis OUVRE la session BFF. Le défi
   * PENDING déposé en session par `login` est lu, vérifié, puis invalidé (usage
   * unique) ; l'identité n'est établie qu'ICI. **Throttlé** sur l'identité en
   * attente (anti brute-force du code à 6 chiffres).
   *
   * @param context - contexte HTTP (porte la session PENDING).
   * @param code - code présenté (TOTP ou code de récupération).
   * @returns la projection publique de l'utilisateur authentifié.
   * @throws ThrottledError (429) — trop de tentatives.
   * @throws AuthenticationError (401, uniforme) — aucun défi en cours, code absent
   *   ou invalide (la session N'est PAS ouverte ; le défi reste pour un retry).
   */
  async completeMfaLogin(
    context: ContextType,
    code: unknown,
  ): Promise<ISafeUser> {
    const info = readAuditContext(context);
    const pending = context.session?.get(PENDING_MFA_KEY);
    if (typeof pending !== "string" || pending.length === 0) {
      // Aucun 1ᵉʳ facteur validé en amont → on ne révèle rien (message uniforme).
      throw new AuthenticationError(INVALID_CREDENTIALS);
    }
    const throttler = this.#resolveThrottler();
    if (throttler !== null) {
      const retryAfterS = throttler.check(pending);
      if (retryAfterS > 0) {
        recordAudit(this.container as Container, {
          category: "auth",
          action: "login.throttled",
          outcome: "failure",
          actor: pending,
          reason: "throttled",
          ...info,
        });
        throw new ThrottledError(retryAfterS);
      }
    }
    const totp = this.#resolveTotp();
    const result =
      typeof code === "string" && code.length > 0 && totp
        ? await totp.verifyLogin(pending, code)
        : { ok: false, method: undefined };
    if (!result.ok) {
      throttler?.recordFailure(pending);
      recordAudit(this.container as Container, {
        category: "auth",
        action: "login.failure",
        outcome: "failure",
        actor: pending,
        reason: "mfa_invalid",
        ...info,
      });
      throw new AuthenticationError(INVALID_CREDENTIALS);
    }
    throttler?.recordSuccess(pending);
    // Défi consommé (usage unique) AVANT d'établir la session.
    context.session?.set(PENDING_MFA_KEY, null);
    return this.establishSessionFor(context, pending, result.method ?? "totp");
  }

  /**
   * Garantit une session pour la requête courante — la démarre (+ cookie) si
   * elle n'existe pas encore. Sert aux cérémonies **pré-authentification**
   * (login WebAuthn) : elles doivent porter un challenge côté serveur AVANT que
   * l'utilisateur soit connecté. La session anonyme ainsi créée devient la
   * session authentifiée au login — {@link establishSessionFor} régénère l'ID
   * (anti-fixation préservée), donc un challenge déposé ici n'ouvre aucune brèche.
   *
   * @returns la session (existante ou neuve), ou `null` si le service de session
   *   est indisponible.
   */
  async ensureSession(context: ContextType): Promise<ISession | null> {
    if (context.session) {
      return context.session;
    }
    // L'appelant persiste (cookie + challenge) via `session.save()` APRÈS y
    // avoir écrit son challenge — un seul aller-retour storage.
    return this.#resolveSessions().start(context);
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
    // Acteur capturé AVANT destroy (la session porte encore l'identifiant).
    const actor = typeof session.user === "string" ? session.user : null;
    await session.destroy(true);
    // L'état du contexte reflète la réalité : plus de session → le
    // `saveSession` de fin de requête est un no-op (pas de résurrection).
    context.session = null;
    context.user = null;
    recordAudit(this.container as Container, {
      category: "session",
      action: "logout",
      outcome: "success",
      actor,
      ...readAuditContext(context),
    });
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
      await session.storage.destroy(oldId);
    } catch {
      /* best-effort : session neuve jamais persistée */
    }
    // Provenance de l'OUVERTURE (login) — surfacée dans la console Sessions
    // (Studio lit `metaBag.ip`/`metaBag.ua`). On capture via les ACCESSEURS
    // proxy-aware des contextes concrets (`getRemoteAddress()` dépouille
    // X-Forwarded-For selon trustProxy ; `getUserAgent()` lit l'en-tête) — absents
    // du type de base `ContextType`, lus en duck-typing optionnel (même approche
    // que `readAuditContext`). Figé au moment de l'AUTHENTIFICATION → « ouverte
    // depuis » stable, distinct des métadonnées techniques posées par start().
    const provenance = context as {
      getRemoteAddress?: () => string | null | undefined;
      getUserAgent?: () => string | undefined;
    };
    try {
      const ip = provenance.getRemoteAddress?.();
      if (ip) session.setMetaBag("ip", ip);
      const ua = provenance.getUserAgent?.();
      if (ua) session.setMetaBag("ua", ua);
    } catch {
      /* best-effort : provenance non bloquante pour l'établissement de session */
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

  // Résout le service 2FA UNE fois (lazy + caché). null si le module 2FA est
  // absent OU désactivé (`isEnabled()` false) → le login nominal sans 2FA ne
  // paie aucun accès store ni microtask supplémentaire.
  #resolveTotp(): ITotpLoginVerifier | null {
    if (!this.#totpResolved) {
      const svc = this.get<ITotpLoginVerifier>("totp") ?? null;
      this.#totp = svc && svc.isEnabled() ? svc : null;
      this.#totpResolved = true;
    }
    return this.#totp;
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
