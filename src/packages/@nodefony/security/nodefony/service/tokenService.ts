import { Service, Module, Container, Event, type Severity } from "nodefony";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type * as Jose from "jose";
import type { IUser, IUserProvider, IPasswordVerifier } from "@nodefony/user";
import {
  defineSecurityConfig,
  type ISecurityConfig,
  type ISecurityConfigInput,
} from "../config/defineSecurityConfig";
import { AuthenticationError } from "../errors/AuthenticationError";
import { ThrottledError } from "../errors/ThrottledError";
import type { LoginThrottler } from "../src/throttle/LoginThrottler";
import { getTokenStoreFactory } from "../src/token/tokenStoreRegistry";
import { JwtKeystore } from "../src/token/JwtKeystore";
import { resolveJwtRuntime, type IJwtRuntime } from "../src/token/jwtRuntime";
import type { ITokenStore, IAccessTokenRecord } from "../contracts/ITokenStore";
import type { IJwtKeystore } from "../contracts/IJwtKeystore";

const serviceName = "tokenService";

// Source d'identité (UserService implémente les deux faces).
type UserSource = IPasswordVerifier & IUserProvider;

/**
 * Réponse d'émission de jetons — nommage RFC 6749 §5.1 (snake_case, JSON).
 * Le JWT part en `Authorization: Bearer`, JAMAIS en cookie ni en URL.
 */
export interface ITokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  /** Durée de vie de l'access token (s). */
  expires_in: number;
  /** Scopes accordés (séparés par des espaces). */
  scope: string;
}

/**
 * Orchestrateur des jetons longue durée (P6 J4) — émission/refresh des JWT +
 * **maintenance du store** (le seam `ITokenStore.gc()` n'a pas d'autre appelant).
 *
 * Au boot (si `jwt.enabled`) : résout le store pluggable (`tokenStore.driver`),
 * crée le keystore Ed25519, les pose au container (`tokenStore`/`jwtKeystore`,
 * consommés par le `JwtAuthenticator` et les endpoints framework), puis arme un
 * **timer de gc** `unref` (n'empêche pas l'arrêt) avec **jitter** de phase
 * (étale les balayages entre process d'un cluster sur un store partagé). À
 * l'arrêt (`onTerminate`) : `clearInterval`/`clearTimeout`.
 *
 * Émission = « password grant » M2M/CLI : credential vérifié par le service
 * `users` → access (JWT signé, 15 min) + refresh (secret opaque haute entropie,
 * stocké **haché**). Refresh = rotation + détection de rejeu (RFC 9700 §4.14).
 */
class TokenService extends Service {
  #runtime: IJwtRuntime | null = null;
  #store: ITokenStore | null = null;
  #keystore: IJwtKeystore | null = null;
  #jose: typeof Jose | null = null;
  #users: UserSource | null = null;
  #throttler: LoginThrottler | null = null;
  #throttlerResolved = false;
  #gcStart: NodeJS.Timeout | null = null;
  #gcTimer: NodeJS.Timeout | null = null;
  #gcRunning = false;

  constructor(public module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options,
    );
    this.kernel?.once("onBoot", () => this.#build());
    this.kernel?.once("onTerminate", () => this.#shutdown());
  }

  // ── Cycle de vie ─────────────────────────────────────────────────────────────

  #build(): void {
    let config: ISecurityConfig;
    try {
      config = defineSecurityConfig(this.options as ISecurityConfigInput);
    } catch {
      // Config invalide : le firewall logge CRITIC + fail-closed. On s'efface
      // (le JWT restera indisponible → 503 à l'émission, 401 à la vérification).
      return;
    }
    // Le store de jetons héberge les refresh tokens (JWT) ET les clés API (PAT,
    // P6.12). On le provisionne dès que l'une OU l'autre capacité est activée —
    // ce service en est le propriétaire (avec son gc) ; `ApiKeyService` et le
    // `JwtAuthenticator` le résolvent du container par nom.
    const jwtEnabled = config.jwt.enabled;
    const apiKeysEnabled = config.apiKeys.enabled;
    if (!jwtEnabled && !apiKeysEnabled) {
      this.log("token service idle — JWT et clés API désactivés", "DEBUG");
      return;
    }
    const factory = getTokenStoreFactory(config.tokenStore.driver);
    if (!factory) {
      this.log(
        `token store "${config.tokenStore.driver}" inconnu — JWT/clés API indisponibles`,
        "CRITIC",
      );
      return;
    }
    this.#store = factory({ container: this.container as Container, config });
    // Partage par NOM (`ApiKeyService`, `JwtAuthenticator`, endpoints framework —
    // convention-frère `passwordEncoder`/`loginThrottler`).
    this.container?.set("tokenStore", this.#store);

    // Capacité JWT (signature + refresh) : runtime + keystore Ed25519 — seulement
    // si activée. Sans elle, le store existe quand même (clés API seules).
    if (jwtEnabled) {
      this.#runtime = resolveJwtRuntime(config.jwt);
      this.#keystore = new JwtKeystore(config.jwt.keystore, (m, s) =>
        this.log(m, s as Severity),
      );
      this.container?.set("jwtKeystore", this.#keystore);
    }

    this.#scheduleGc(config.tokenStore.gcIntervalS, config.tokenStore.gcJitter);
    this.log(
      `token service ready — store "${config.tokenStore.driver}", jwt=${jwtEnabled}, apiKeys=${apiKeysEnabled}, gc ${config.tokenStore.gcIntervalS}s`,
      "DEBUG",
    );
  }

  #shutdown(): void {
    if (this.#gcStart) {
      clearTimeout(this.#gcStart);
      this.#gcStart = null;
    }
    if (this.#gcTimer) {
      clearInterval(this.#gcTimer);
      this.#gcTimer = null;
    }
  }

  /** `true` si l'émission JWT (signature + refresh) est opérationnelle. */
  isEnabled(): boolean {
    return this.#keystore !== null && this.#runtime !== null;
  }

  // ── gc (orchestration du seam ITokenStore.gc) ───────────────────────────────

  // Phase de départ jittérée (≤ 60 s) PUIS intervalle régulier : décale les
  // balayages entre process sans coordination (un store ORM partagé n'est pas
  // balayé par N workers au même instant). `unref` → n'empêche pas l'arrêt.
  #scheduleGc(intervalS: number, jitter: boolean): void {
    if (intervalS <= 0 || !this.#store) return;
    const base = intervalS * 1000;
    const phase = jitter
      ? Math.floor(Math.random() * Math.min(base, 60_000))
      : 0;
    this.#gcStart = setTimeout(() => {
      this.#gcStart = null;
      void this.runGc(); // purge l'accumulation du downtime
      const timer = setInterval(() => void this.runGc(), base);
      timer.unref();
      this.#gcTimer = timer;
    }, 30_000 + phase);
    this.#gcStart.unref();
  }

  /**
   * Exécute une passe de gc du store — **point d'entrée public d'un
   * ordonnanceur**. Le timer in-process l'appelle ; le futur worker cron (P5.0b)
   * ou une commande batch (`security:token-gc` / k8s CronJob) peut l'appeler à sa
   * place — poser alors `tokenStore.gcIntervalS: 0` désarme le timer in-process.
   *
   * ⚠️ Un store **local** (`memory`/`file`) est par-process serveur (mémoires
   * disjointes) : seul SON process peut le purger → le timer in-process reste
   * indispensable. Un store **partagé** (ORM) peut être délégué au worker cron
   * (un seul balayage, élection native) au lieu du jitter in-process.
   *
   * Anti-empilement (un seul gc concurrent) ; ne lève jamais (store I/O down →
   * ERROR loggé, retour `0`) pour ne pas tuer le déclencheur.
   *
   * @returns nombre d'entrées purgées.
   */
  async runGc(): Promise<number> {
    if (this.#gcRunning || !this.#store) return 0; // pas d'empilement
    this.#gcRunning = true;
    try {
      const t0 = performance.now();
      const purged = await this.#store.gc();
      if (purged > 0) {
        this.log(
          `token gc: ${purged} jeton(s) purgé(s) en ${(
            performance.now() - t0
          ).toFixed(1)}ms`,
          "DEBUG",
        );
      }
      return purged;
    } catch (e) {
      // Store I/O down : signal ops, pas de crash — retry au prochain tick.
      this.log(e as Error, "ERROR");
      return 0;
    } finally {
      this.#gcRunning = false;
    }
  }

  // ── Émission ─────────────────────────────────────────────────────────────────

  /**
   * Émet un couple access/refresh après vérification d'un credential
   * identifiant/mot de passe (grant M2M/CLI). Throttling NIST partagé si activé.
   *
   * @throws ThrottledError (429) — backoff actif.
   * @throws AuthenticationError (401, message uniforme) — credential invalide.
   */
  async issueForCredentials(
    identifier: unknown,
    password: unknown,
    requestedScopes?: string[],
  ): Promise<ITokenResponse> {
    if (
      typeof identifier !== "string" ||
      identifier.length === 0 ||
      typeof password !== "string" ||
      password.length === 0
    ) {
      throw new AuthenticationError("Invalid credentials");
    }
    const throttler = this.#resolveThrottler();
    if (throttler !== null) {
      const retryAfterS = throttler.check(identifier);
      if (retryAfterS > 0) throw new ThrottledError(retryAfterS);
    }
    const user = await this.#resolveUsers().authenticate(identifier, password);
    if (user === null) {
      throttler?.recordFailure(identifier);
      throw new AuthenticationError("Invalid credentials");
    }
    throttler?.recordSuccess(identifier);
    return this.issueTokens(user, requestedScopes);
  }

  /** Émet un couple access/refresh pour un utilisateur déjà authentifié. */
  async issueTokens(
    user: IUser,
    requestedScopes?: string[],
  ): Promise<ITokenResponse> {
    this.#ensureReady();
    const scopes =
      requestedScopes && requestedScopes.length > 0 ? [...requestedScopes] : [];
    const access = await this.#signAccess(user.identifier, scopes);
    const { record, raw } = this.#buildRefresh(
      user.identifier,
      scopes,
      this.#randomId(),
    );
    await this.#store!.put(record);
    return {
      access_token: access,
      refresh_token: raw,
      token_type: "Bearer",
      expires_in: this.#runtime!.accessTtlS,
      scope: scopes.join(" "),
    };
  }

  /**
   * Rotation d'un refresh token (RFC 9700 §4.14) : valide le refresh présenté,
   * émet un nouveau couple, révoque l'ancien. Un refresh **déjà révoqué**
   * re-présenté = rejeu → toute la famille est coupée.
   *
   * @throws AuthenticationError (401) — refresh inconnu/expiré/révoqué, sujet banni.
   */
  async refresh(rawRefresh: unknown): Promise<ITokenResponse> {
    this.#ensureReady();
    if (typeof rawRefresh !== "string" || rawRefresh.length === 0) {
      throw new AuthenticationError("Invalid token");
    }
    const store = this.#store!;
    const record = await store.findByHash(this.#hash(rawRefresh));
    if (!record || record.kind !== "refresh") {
      throw new AuthenticationError("Invalid token");
    }
    // Détection de rejeu : un refresh révoqué qui resurgit → un voleur l'utilise.
    // On coupe TOUTE la famille (voleur + victime) — la victime devra se reconnecter.
    if (record.revokedAt !== null) {
      if (record.family) {
        await store.revokeFamily(record.family, "reuse_detected");
      }
      throw new AuthenticationError("Invalid token");
    }
    const now = Date.now();
    if (record.expiresAt !== null && record.expiresAt <= now) {
      throw new AuthenticationError("Invalid token");
    }
    // Sujet revérifié — révocation sans attendre l'exp (ban, compte supprimé).
    const user = await this.#resolveUserForRefresh(record.subjectId);
    // Downscoping : les scopes ne montent JAMAIS sur la chaîne de refresh.
    const scopes = [...record.scopes];
    const access = await this.#signAccess(user.identifier, scopes);

    if (!this.#runtime!.rotateRefresh) {
      // Rotation désactivée : on réémet l'access, le refresh courant reste valide.
      return {
        access_token: access,
        refresh_token: rawRefresh,
        token_type: "Bearer",
        expires_in: this.#runtime!.accessTtlS,
        scope: scopes.join(" "),
      };
    }
    // Rotation : nouveau refresh (même famille), ancien chaîné + révoqué.
    const family = record.family ?? this.#randomId();
    const next = this.#buildRefresh(user.identifier, scopes, family);
    await store.put(next.record);
    record.replacedBy = next.record.id;
    record.revokedAt = now;
    record.revokedReason = "rotated";
    await store.put(record);
    return {
      access_token: access,
      refresh_token: next.raw,
      token_type: "Bearer",
      expires_in: this.#runtime!.accessTtlS,
      scope: scopes.join(" "),
    };
  }

  // ── Internes ─────────────────────────────────────────────────────────────────

  async #signAccess(subject: string, scopes: string[]): Promise<string> {
    const jose = await this.#ensureJose();
    const { key, kid } = await this.#keystore!.getSigningKey();
    const rt = this.#runtime!;
    return new jose.SignJWT({ scope: scopes.join(" ") })
      .setProtectedHeader({ alg: "EdDSA", kid, typ: "at+jwt" })
      .setIssuedAt()
      .setIssuer(rt.issuer)
      .setSubject(subject)
      .setAudience(rt.audiences[0]!)
      .setExpirationTime(`${rt.accessTtlS}s`)
      .setJti(randomUUID())
      .sign(key);
  }

  /** Construit (sans persister) un record refresh + son secret opaque en clair. */
  #buildRefresh(
    subject: string,
    scopes: string[],
    family: string,
  ): { record: IAccessTokenRecord; raw: string } {
    const raw = `nfr_${randomBytes(32).toString("base64url")}`;
    const now = Date.now();
    const record: IAccessTokenRecord = {
      id: randomUUID(),
      kind: "refresh",
      name: "refresh token",
      prefix: null,
      subjectId: subject,
      subjectType: "user",
      tenantId: null,
      scopes: [...scopes],
      audience: [...this.#runtime!.audiences],
      resources: null,
      secretHash: this.#hash(raw),
      hashAlg: "sha256",
      clientId: null,
      cnf: null,
      family,
      replacedBy: null,
      createdAt: now,
      expiresAt: now + this.#runtime!.refreshTtlS * 1000,
      lastUsedAt: null,
      lastUsedIp: null,
      lastUsedUserAgent: null,
      revokedAt: null,
      revokedReason: null,
      metadata: {},
    };
    return { record, raw };
  }

  #ensureReady(): void {
    if (!this.#store || !this.#keystore || !this.#runtime) {
      throw new Error(
        "TokenService: non initialisé (JWT désactivé ou store indisponible)",
      );
    }
  }

  async #ensureJose(): Promise<typeof Jose> {
    return (this.#jose ??= (await import("jose")) as typeof Jose);
  }

  #hash(secret: string): string {
    return createHash("sha256").update(secret).digest("hex");
  }

  #randomId(): string {
    return randomBytes(16).toString("base64url");
  }

  #resolveUsers(): UserSource {
    if (this.#users === null) {
      const users = this.get<UserSource>("users");
      if (!users) {
        throw new Error(
          "TokenService: aucun service 'users' (IPasswordVerifier & " +
            "IUserProvider) dans le container — enregistrer un UserService au boot.",
        );
      }
      this.#users = users;
    }
    return this.#users;
  }

  async #resolveUserForRefresh(subjectId: string): Promise<IUser> {
    let user: IUser;
    try {
      user = await this.#resolveUsers().loadUserByIdentifier(subjectId);
    } catch {
      throw new AuthenticationError("Invalid token"); // sujet disparu
    }
    if (!user.isActive() || user.isLocked()) {
      throw new AuthenticationError("Invalid token"); // banni / désactivé
    }
    return user;
  }

  #resolveThrottler(): LoginThrottler | null {
    if (!this.#throttlerResolved) {
      this.#throttler = this.get<LoginThrottler>("loginThrottler") ?? null;
      this.#throttlerResolved = true;
    }
    return this.#throttler;
  }
}

export default TokenService;
export { TokenService };
