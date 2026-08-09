import {
  Service,
  Module,
  Container,
  Event,
  GcScheduler,
  AUTO_STORE,
  EMPTY_INFRA,
  canonicalIssuer,
  resolveAutoStore,
  readStoreLocation,
  type Severity,
} from "nodefony";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type * as Jose from "jose";
import type { IUser, IUserProvider, IPasswordVerifier } from "@nodefony/user";
import {
  defineSecurityConfig,
  type ISecurityConfig,
  type ISecurityConfigInput,
} from "../config/defineModuleConfig";
import { AuthenticationError } from "../errors/AuthenticationError";
import { ThrottledError } from "../errors/ThrottledError";
import { InvalidTargetError } from "../errors/InvalidTargetError";
import type { LoginThrottler } from "../src/throttle/LoginThrottler";
import {
  getTokenStoreFactory,
  listTokenStores,
} from "../src/token/tokenStoreRegistry";
import { recordAudit } from "../src/audit/recordAudit";
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
 * Au boot (si `jwt.enabled`) : résout le store pluggable (`tokenStore.store`),
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
  /** Émetteur publiable, résolu une fois au boot (cf `#resolvePublication`). */
  #published: string | null = null;
  #store: ITokenStore | null = null;
  #keystore: IJwtKeystore | null = null;
  #jose: typeof Jose | null = null;
  #users: UserSource | null = null;
  #throttler: LoginThrottler | null = null;
  #throttlerResolved = false;
  // Maintenance des jetons expirés (refresh/PAT/denylist) — timer/jitter/
  // anti-empilement/désarmement mutualisés dans le GcScheduler du core.
  #gc: GcScheduler | null = null;

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
    // `auto` (défaut) = suivre l'infra database déclarée, borné aux backends
    // réellement enregistrés ; repli memory ANNONCÉ. Valeur explicite respectée.
    let storeName = config.tokenStore.store;
    let reason = `store explicitement configuré ("${storeName}")`;
    if (storeName === AUTO_STORE) {
      const auto = resolveAutoStore(
        "durable",
        this.kernel?.infra ?? EMPTY_INFRA,
        listTokenStores(),
      );
      storeName = auto.store;
      reason = auto.reason;
      this.log(`tokenStore "auto" → "${storeName}" (${auto.reason})`, "INFO");
    }
    const factory = getTokenStoreFactory(storeName);
    if (!factory) {
      // Doctrine d'échec : store EXPLICITEMENT configuré introuvable = config
      // erronée. Prod → boot avorté (fail-loud) ; dev → brique désactivée,
      // ANNONCÉE (jamais de fallback memory silencieux pour du durable).
      const msg =
        `token store "${storeName}" inconnu ` +
        `(enregistrés : ${listTokenStores().join(", ") || "aucun"})`;
      if (this.kernel?.environment === "production") {
        throw new Error(`${msg} — JWT/clés API indisponibles : boot avorté.`);
      }
      this.log(`${msg} — JWT/clés API indisponibles`, "CRITIC");
      return;
    }
    // Prod-guard : store durable en mémoire = denylist JWT, refresh tokens et
    // clés API PER-POD et VOLATILS — l'impact est nommé, le boot continue.
    if (storeName === "memory" && this.kernel?.environment === "production") {
      this.log(
        `tokenStore "memory" en PRODUCTION — denylist JWT, refresh tokens et clés API ` +
          `per-pod et volatils : révocation non partagée entre pods, tout est perdu au ` +
          `redémarrage. Déclarer une infra durable (NF_DATABASE_URL) ou un store persistant.`,
        "WARNING",
      );
    }
    this.#store = factory({ container: this.container as Container, config });
    this.kernel?.registerStoreResolution({
      brick: "tokens",
      nature: "durable",
      configured: config.tokenStore.store,
      resolved: storeName,
      available: listTokenStores(),
      reason,
      configPath: "security.tokenStore.store",
      location: readStoreLocation(this.#store),
    });
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
      this.#resolvePublication(config.jwt.jwks, this.#runtime.issuer);
    }

    this.#gc = new GcScheduler({
      intervalS: config.tokenStore.gcIntervalS,
      jitter: config.tokenStore.gcJitter,
      run: () => this.runGc(),
      onError: (e) => this.log(e as Error, "ERROR"),
    });
    this.#gc.start();
    this.log(
      `token service ready — store "${config.tokenStore.store}", jwt=${jwtEnabled}, apiKeys=${apiKeysEnabled}, gc ${config.tokenStore.gcIntervalS}s`,
      "DEBUG",
    );
  }

  #shutdown(): void {
    this.#gc?.stop();
    this.#gc = null;
  }

  /** `true` si l'émission JWT (signature + refresh) est opérationnelle. */
  isEnabled(): boolean {
    return this.#keystore !== null && this.#runtime !== null;
  }

  // ── rôle ÉMETTEUR : publier ses clés, et dire où elles sont (RFC 8414) ──────

  /**
   * Décide UNE fois, au boot, si cette application peut se déclarer émetteur.
   *
   * Trois conditions, et la troisième est celle qui surprend : l'émetteur doit
   * être une **URL https** (RFC 8414 §2). Le défaut `"nodefony"` de
   * {@link resolveJwtRuntime} n'en est pas une — parfaitement inoffensif tant
   * que Nodefony émet ET vérifie ses propres jetons (`iss` n'est alors qu'une
   * chaîne comparée à elle-même), mais inutilisable comme identifiant public.
   *
   * 🔴 **On ne DEVINE pas cette URL.** Derrière un relais (HAProxy, ingress,
   * CDN), le processus n'a aucun moyen fiable de connaître son adresse
   * publique : `Host` et `X-Forwarded-*` viennent de la requête, donc du client
   * en dernière analyse. La dériver ferait servir, par le VRAI serveur, un
   * document `issuer: https://attaquant.example` — crédible, et empoisonnant
   * tout cache mutualisé. Un argument non sécuritaire suffirait d'ailleurs :
   * l'émetteur est gravé dans le `iss` de chaque jeton DÉJÀ émis ; variable
   * selon l'hôte d'entrée, il ferait rejeter un jeton valide.
   *
   * Le refus est donc ANNONCÉ (avertissement au boot) plutôt que masqué
   * derrière un document qui ne mènerait nulle part.
   */
  #resolvePublication(wanted: boolean, issuer: string): void {
    if (!wanted) return;
    try {
      this.#published = canonicalIssuer(issuer);
    } catch {
      this.#published = null;
      this.log(
        `JWKS non publié : \`security.jwt.issuer\` vaut « ${issuer} », qui ` +
          `n'est pas une URL https. Renseigner l'URL publique de cette ` +
          `application (RFC 8414 §2) — derrière un relais, elle ne peut pas ` +
          `être devinée. Les jetons restent émis et vérifiés normalement.`,
        "WARNING",
      );
    }
  }

  /**
   * Émetteur sous lequel cette application accepte d'être DÉCOUVERTE, ou `null`.
   *
   * C'est la question que pose `@nodefony/framework` au moment de monter (ou
   * non) `/.well-known/oauth-authorization-server` et `/.well-known/jwks.json` :
   * il ne lit pas la configuration de sécurité, il obtient une réponse. `null`
   * = aucune route, donc `404` — pas de document creux, pas de demi-mesure.
   *
   * @returns l'émetteur canonique publiable, ou `null` si rien ne doit l'être
   */
  publishedIssuer(): string | null {
    return this.#published;
  }

  /**
   * Jeu de clés **publiques** de signature, tel qu'il doit être servi.
   *
   * Ne contient que des paramètres publics (RFC 8037/7517) — le keystore ne
   * sérialise jamais `d`. Rien n'est calculé ici : la route est une porte, la
   * matière vient du keystore.
   *
   * @returns le JWKS public
   * @throws Error si la capacité JWT n'est pas active (garde de programmation :
   *         les routes ne sont montées que si {@link publishedIssuer} répond)
   */
  async getPublicJWKS(): Promise<Jose.JSONWebKeySet> {
    if (!this.#keystore) {
      throw new Error(
        "JWKS demandé alors que la capacité JWT est inactive " +
          "(`security.jwt.enabled: false`).",
      );
    }
    return this.#keystore.getPublicJWKS();
  }

  // ── gc (orchestration du seam ITokenStore.gc) ───────────────────────────────

  /**
   * Une passe de purge du store (`ITokenStore.gc()`) — point d'entrée public d'un
   * ordonnanceur : le {@link GcScheduler} l'appelle, mais le futur worker cron
   * (`security:token-gc` / k8s CronJob) peut l'appeler à sa place (poser alors
   * `tokenStore.gcIntervalS: 0`). L'anti-empilement et la capture d'erreur vivent
   * dans le GcScheduler (via `onError`) — ici, la passe métier nue.
   *
   * ⚠️ Un store **local** (`memory`/`file`) est par-process (mémoires disjointes) :
   * seul SON process peut le purger → le timer in-process reste indispensable. Un
   * store **partagé** (ORM) peut être délégué au worker cron (un seul balayage).
   *
   * @returns nombre d'entrées purgées.
   */
  async runGc(): Promise<number> {
    if (!this.#store) return 0;
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
    resource?: unknown,
  ): Promise<ITokenResponse> {
    if (
      typeof identifier !== "string" ||
      identifier.length === 0 ||
      typeof password !== "string" ||
      password.length === 0
    ) {
      // Échec d'authentification du grant API (≠ login BFF) — audité comme une
      // tentative (OWASP A09). Pas de `context` ici → ni IP ni requestId. Un
      // identifiant vide/non-string → acteur `null` (rien d'identifiable).
      this.#auditGrant(
        "login.failure",
        typeof identifier === "string" && identifier.length > 0
          ? identifier
          : null,
        "invalid_credentials",
      );
      throw new AuthenticationError("Invalid credentials");
    }
    const throttler = this.#resolveThrottler();
    if (throttler !== null) {
      const retryAfterS = throttler.check(identifier);
      if (retryAfterS > 0) {
        this.#auditGrant("login.throttled", identifier, "throttled");
        throw new ThrottledError(retryAfterS);
      }
    }
    const user = await this.#resolveUsers().authenticate(identifier, password);
    if (user === null) {
      throttler?.recordFailure(identifier);
      this.#auditGrant("login.failure", identifier, "invalid_credentials");
      throw new AuthenticationError("Invalid credentials");
    }
    throttler?.recordSuccess(identifier);
    return this.issueTokens(user, requestedScopes, resource);
  }

  // Journalise une tentative de grant par mot de passe (cold-path : endpoint
  // dédié). `category:"auth"` (échec d'authentification), distinct de
  // `token.issued` (succès, `category:"token"`). no-op si audit absent/désactivé.
  #auditGrant(
    action: "login.failure" | "login.throttled",
    actor: string | null,
    reason: string,
  ): void {
    recordAudit(this.container as Container, {
      category: "auth",
      action,
      outcome: "failure",
      actor,
      reason,
    });
  }

  /**
   * Résout l'audience (`aud`) d'un jeton à émettre — RFC 8707 §2.
   *
   * Le client dit POUR QUI il demande le jeton ; le serveur décide s'il accepte.
   * La liste `security.jwt.audiences` est donc une **liste blanche de ressources
   * demandables**, et non une simple valeur par défaut : sans elle, n'importe
   * quel porteur d'un identifiant valide se ferait délivrer un jeton portant
   * l'audience de son choix — y compris celle d'une ressource à laquelle il n'a
   * rien à faire, dont la porte accepterait alors ce jeton sans sourciller.
   *
   * **Une seule ressource.** La RFC autorise plusieurs `resource` mais recommande
   * l'inverse (§3) : « If a bearer token has multiple intended recipients […] the
   * token is valid at more than one protected resource and can be used by any one
   * of those resources to access any of the others », d'où « a high degree of
   * trust between the involved parties is needed » — et elle prévoit qu'un
   * serveur soit « unwilling or unable » de le faire. Nous le sommes : la portée
   * minimale est le seul réglage qui ne se retourne pas contre l'application.
   *
   * @param requested - valeur `resource` telle que reçue, ou rien
   * @returns l'audience à inscrire dans le jeton
   * @throws InvalidTargetError (400) si la ressource est multiple, malformée ou
   *         non déclarée
   */
  #resolveAudience(requested?: unknown): string {
    const fallback = this.#runtime!.audiences[0]!;
    if (requested === undefined || requested === null) return fallback;
    if (Array.isArray(requested)) {
      // Refus AVANT de regarder les valeurs : le motif du refus est le nombre.
      throw new InvalidTargetError(
        "A single `resource` is accepted — a token valid at several resources " +
          "lets each of them act at the others (RFC 8707 §3).",
      );
    }
    if (typeof requested !== "string" || requested.length === 0) {
      throw new InvalidTargetError("`resource` must be an absolute URI.");
    }
    let url: URL;
    try {
      url = new URL(requested);
    } catch {
      throw new InvalidTargetError(
        "`resource` must be an absolute URI (RFC 8707 §2).",
        requested,
      );
    }
    if (url.hash) {
      // §2 : « The URI MUST NOT include a fragment component. » Un fragment ne
      // voyage pas jusqu'au serveur : deux demandes qui n'en diffèrent que par
      // lui désigneraient la même ressource tout en semblant distinctes.
      throw new InvalidTargetError(
        "`resource` must not include a fragment (RFC 8707 §2).",
        requested,
      );
    }
    // Comparaison sur la valeur EXACTE déclarée : c'est elle qui sera inscrite
    // dans `aud`, et c'est elle que la ressource comparera à son propre URI
    // canonique. Normaliser ici ferait diverger les deux extrémités.
    if (!this.#runtime!.audiences.includes(requested)) {
      // Le message ne nomme aucune audience acceptée : les énumérer donnerait la
      // carte des ressources protégées à qui possède un simple identifiant.
      throw new InvalidTargetError(
        "The requested resource is not available to this application.",
        requested,
      );
    }
    return requested;
  }

  /**
   * Émet un couple access/refresh pour un utilisateur déjà authentifié.
   *
   * @param user - porteur, déjà authentifié
   * @param requestedScopes - scopes demandés (RFC 6749 §3.3)
   * @param resource - ressource visée (RFC 8707) ; omise = audience par défaut
   * @throws InvalidTargetError (400) si `resource` ne peut pas être servie
   */
  async issueTokens(
    user: IUser,
    requestedScopes?: string[],
    resource?: unknown,
  ): Promise<ITokenResponse> {
    this.#ensureReady();
    const scopes =
      requestedScopes && requestedScopes.length > 0 ? [...requestedScopes] : [];
    const audience = this.#resolveAudience(resource);
    const access = await this.#signAccess(user.identifier, scopes, audience);
    const { record, raw } = this.#buildRefresh(
      user.identifier,
      scopes,
      this.#randomId(),
      audience,
    );
    await this.#store!.put(record);
    // Audit (P6.14 lot 2b) : un jeton longue durée vient d'être émis (surface
    // d'attaque créée). `tokenId` corrèle une future révocation/rejeu.
    recordAudit(this.container as Container, {
      category: "token",
      action: "token.issued",
      outcome: "success",
      actor: user.identifier,
      metadata: { tokenId: record.id, scopes },
    });
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
   * @param rawRefresh - le refresh token présenté, en clair
   * @param resource - ressource visée (RFC 8707 §2.2). Sur un `refresh_token`,
   *          la politique « may limit the acceptable resources to those that
   *          were originally granted […] or a subset thereof » : un jeton ne
   *          portant qu'une seule audience, le seul sous-ensemble possible est
   *          elle-même. Demander autre chose est donc refusé, jamais ignoré —
   *          sinon la rotation devient le chemin par lequel on obtient une
   *          audience qu'on n'a pas su demander à l'émission.
   * @throws AuthenticationError (401) — refresh inconnu/expiré/révoqué, sujet banni.
   * @throws InvalidTargetError (400) — `resource` demandée ≠ celle accordée
   */
  async refresh(
    rawRefresh: unknown,
    resource?: unknown,
  ): Promise<ITokenResponse> {
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
      // Audit (P6.14 lot 2b) : signal d'attaque FORT (jeton volé re-présenté) —
      // refus par politique anti-rejeu (RFC 9700 §4.14), famille coupée.
      recordAudit(this.container as Container, {
        category: "token",
        action: "token.reuse_detected",
        outcome: "denied",
        actor: record.subjectId,
        reason: "reuse_detected",
        metadata: { tokenId: record.id, family: record.family },
      });
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
    // L'AUDIENCE non plus. Elle est reprise du record, jamais recalculée : un
    // renouvellement qui retomberait sur l'audience par défaut élargirait la
    // portée du jeton sans que personne ne l'ait demandé — une restriction qui
    // s'annule au bout de quelques minutes n'est pas une restriction. Un record
    // antérieur à ce champ (ou d'une autre origine) retombe sur le défaut.
    const audience = record.audience?.[0] ?? this.#runtime!.audiences[0]!;
    if (resource !== undefined && resource !== null && resource !== audience) {
      // Le contrôle porte sur ce qui a été ACCORDÉ, pas sur la liste blanche : une
      // audience parfaitement déclarée reste refusée ici si ce n'est pas celle de
      // ce jeton-là. Sans cela, la rotation deviendrait une porte dérobée vers
      // une audience qu'on n'a pas obtenue à l'émission.
      throw new InvalidTargetError(
        "The requested resource does not match the one granted to this token " +
          "(RFC 8707 §2.2).",
        typeof resource === "string" ? resource : undefined,
      );
    }
    const access = await this.#signAccess(user.identifier, scopes, audience);

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
    const next = this.#buildRefresh(user.identifier, scopes, family, audience);
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

  async #signAccess(
    subject: string,
    scopes: string[],
    audience: string,
  ): Promise<string> {
    const jose = await this.#ensureJose();
    const { key, kid } = await this.#keystore!.getSigningKey();
    const rt = this.#runtime!;
    return (
      new jose.SignJWT({ scope: scopes.join(" ") })
        .setProtectedHeader({ alg: "EdDSA", kid, typ: "at+jwt" })
        .setIssuedAt()
        .setIssuer(rt.issuer)
        .setSubject(subject)
        // L'audience est celle qui a été ACCORDÉE — la ressource demandée, ou le
        // défaut. Reprendre `audiences[0]` ici annulerait la demande sans un mot.
        .setAudience(audience)
        .setExpirationTime(`${rt.accessTtlS}s`)
        .setJti(randomUUID())
        .sign(key)
    );
  }

  /**
   * Construit (sans persister) un record refresh + son secret opaque en clair.
   *
   * @param audience - ressource ACCORDÉE, mémorisée pour que la rotation rende
   *          un jeton de même portée. Sans elle, le renouvellement élargirait
   *          silencieusement l'accès à l'audience par défaut — un downscoping
   *          qui s'annule au bout de quelques minutes n'en est pas un.
   */
  #buildRefresh(
    subject: string,
    scopes: string[],
    family: string,
    audience: string,
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
      audience: [audience],
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
