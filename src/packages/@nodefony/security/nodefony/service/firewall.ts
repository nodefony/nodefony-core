import {
  Service,
  Module,
  Container,
  Event,
  RequestContext,
  Severity,
  Msgid,
  Message,
  Pdu,
  logColor,
} from "nodefony";
import type { ContextType } from "@nodefony/http";
import { encoderFromConfig } from "@nodefony/user";

import { SecuredArea } from "../src/SecuredArea";
import { LoginThrottler } from "../src/throttle/LoginThrottler";
import { RoleHierarchyWalker } from "../src/RoleHierarchyWalker";
import { mergeCspFragments, type CspFragment } from "../src/csp";
import { Csrf } from "./csrf";
import { Cors } from "./cors";
import { SecurityHeaders } from "./securityHeaders";
import { AuthenticationError } from "../errors/AuthenticationError";
import { ThrottledError } from "../errors/ThrottledError";
import {
  defineSecurityConfig,
  type ISecurityConfig,
} from "../config/defineSecurityConfig";
import {
  getAuthenticatorFactory,
  listAuthenticatorFactories,
} from "../src/authenticator/authenticatorRegistry";
import { SessionRealtimeAuthenticator } from "../src/authenticator/SessionRealtimeAuthenticator";
import {
  buildFrameAuthorizer,
  DEFAULT_SYSTEM_RULES,
  type ISystemChannelRule,
} from "../src/realtime/frameAuthorizer";
import type {
  IRealtimeService,
  IRealtimeAuthenticatorMatcher,
} from "../src/realtime/realtimeContracts";
import type { IFirewall } from "../contracts/IFirewall";
import type { IAuthenticator } from "../contracts/IAuthenticator";
import type { IToken } from "../contracts/IToken";
import type { ISecuredArea } from "../contracts/ISecuredArea";

const serviceName = "firewall";

// Surface minimale d'une réponse capable de porter un en-tête (HTTP/HTTP2 —
// une réponse WS ne l'a pas : capability check, jamais de cast aveugle).
interface IHeaderCapableResponse {
  setHeader?: (name: string, value: string | readonly string[]) => unknown;
}

// En-têtes d'une requête indexés par nom lowercase (IncomingHttpHeaders) — un
// en-tête répété est exposé en tableau ; pour les en-têtes mono-valeur CSRF
// (Sec-Fetch-Site/Origin/Referer/Host) on retient la 1ʳᵉ occurrence.
type RequestHeaders = Record<string, string | string[] | undefined>;
function headerValue(
  headers: RequestHeaders | undefined,
  name: string,
): string | undefined {
  const v = headers?.[name];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Orchestrateur de sécurité Nodefony — refonte 2026 (P6).
 *
 * `isSecure()` (hot-path, court-circuit si aucune zone) ne fait QUE matcher la
 * zone et poser `context.security`. `handleSecurity()` (lazy, seulement sur une
 * zone protégée) exécute la chaîne d'authentication selon le `mode` de la zone
 * (`first` : le premier qui reconnaît la requête authentifie ; `all` : tous
 * doivent passer, le dernier porte l'identité) → propage l'utilisateur dans
 * l'ALS → applique le **Zero Trust** (zone protégée sans preuve acceptée → 401,
 * sauf anonymat explicite via l'authenticator `anonymous`).
 *
 * **Fail-closed** : config invalide au boot (Zod, nom d'authenticator inconnu)
 * → le firewall capture TOUT le trafic et répond 401 (jamais une app servie
 * sans sa sécurité). Erreur interne pendant l'authentification (source
 * d'identité down, câblage manquant) → log ERROR serveur + 401 générique
 * (aucun détail ne fuite au client).
 *
 * Conformité : tout 401 porte un challenge `WWW-Authenticate` (RFC 7235) fourni
 * par le premier authenticator de la zone qui en déclare un.
 *
 * CORS, CSRF et autorisation par décorateurs viennent se brancher en S4/S5.
 * Toutes les structures sont **lazy** (perf : une app sans zone = zéro alloc).
 */
class Firewall extends Service implements IFirewall {
  // Zones triées par spécificité — null tant qu'aucune zone n'est configurée.
  #areas: SecuredArea[] | null = null;
  // Authenticators par nom — null tant qu'aucun n'est enregistré/instancié.
  #authenticators: Map<string, IAuthenticator> | null = null;
  #roleHierarchy: RoleHierarchyWalker | null = null;
  // Défense CSRF par défaut — null tant que la config CSRF est désactivée.
  #csrf: Csrf | null = null;
  // Politique CORS — null tant que la config CORS est désactivée.
  #cors: Cors | null = null;
  // En-têtes de sécurité applicatifs (CSP, Referrer-Policy, COOP/COEP/CORP…) —
  // null si désactivés. Le socle transport (nosniff/frame/HSTS) reste dans http.
  #securityHeaders: SecurityHeaders | null = null;
  // Fragments CSP déclarés par module (origines Vite dev…) — null tant qu'aucun
  // module n'en enregistre. Mergés dans le CSP de base au (dé)enregistrement.
  #cspFragments: Map<string, CspFragment> | null = null;
  // Config validée + gelée (consommée par les fabriques d'authenticators).
  #config: ISecurityConfig | null = null;
  // Fail-closed : posée si la config sécurité est invalide au boot → le
  // firewall capture toutes les requêtes et les rejette tant que c'est cassé.
  #configError: Error | null = null;

  constructor(public module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options,
    );
    this.kernel?.once("onBoot", () => this.#build());
  }

  // Compile config (Zod fail-fast) + zones + hiérarchie de rôles +
  // authenticators référencés (via le registre de fabriques) — au boot.
  #build(): void {
    try {
      this.#config = defineSecurityConfig(
        this.options as Parameters<typeof defineSecurityConfig>[0],
      );
    } catch (e) {
      this.#configError = e as Error;
      this.log(
        `Security configuration INVALID — firewall fail-closed, ALL requests rejected: ${
          (e as Error).message
        }`,
        "CRITIC",
      );
      return;
    }
    this.#roleHierarchy = new RoleHierarchyWalker(this.#config.roleHierarchy);
    // Niveau A de l'autorisation partagé au container : le RoleVoter
    // (AuthorizationService) le lit pour résoudre `ROLE_*`. Source unique.
    this.container?.set("roleHierarchy", this.#roleHierarchy);
    this.#provisionSharedServices(this.#config);

    // Défense CSRF : globale (pas liée aux zones — toute mutation cross-site est
    // bloquée), instanciée une fois si activée. Origines de confiance = alias
    // multi-domaine (`csrf.trustedOrigins`) ∪ whitelist CORS (ce que CORS autorise
    // explicitement n'est pas du CSRF) — toutes deux traversent la défense.
    if (this.#config.csrf.enabled) {
      this.#csrf = new Csrf(this.#config.csrf, [
        ...this.#config.csrf.trustedOrigins,
        ...this.#config.cors.origins,
      ]);
    }
    // Politique CORS (globale, hors zones). La config `*`+credentials est déjà
    // rejetée au boot (refine Zod) → ici `#cors` est toujours sûr.
    if (this.#config.cors.enabled) {
      this.#cors = new Cors(this.#config.cors);
    }
    // En-têtes de sécurité APPLICATIFS (CSP/Referrer/COOP…). Le socle transport
    // (nosniff/frame/HSTS) est posé par @nodefony/http à l'entrée brute (couvre
    // statics + erreurs) → security n'émet QUE le complément (1 source par en-tête).
    if (this.#config.headers.enabled) {
      this.#securityHeaders = new SecurityHeaders(this.#config.headers);
    }

    const areas = this.#config.areas;
    const names = Object.keys(areas);
    if (names.length) {
      const list: SecuredArea[] = [];
      for (const name of names) {
        list.push(new SecuredArea(name, areas[name]));
      }
      // Spécificité : pattern le plus long d'abord (déterministe, simple).
      list.sort((a, b) => b.pattern.source.length - a.pattern.source.length);
      this.#areas = list;
      this.#instantiateAuthenticators(list);
    }

    if (!this.#configError) {
      this.#wireRealtime();
      this.log(
        `Firewall ready — ${this.#areas?.length ?? 0} area(s), ${
          this.#authenticators?.size ?? 0
        } authenticator(s)`,
        "DEBUG",
      );
    }
  }

  // Branche le verrou WS sur le hub realtime (par NOM de service, 0 import
  // realtime — security ⊥ realtime). Pour TOUTE zone protégée (Zero Trust : une
  // zone qui ferme le HTTP ferme aussi le WS — `realtime` défaut `true`, opt-out
  // explicite `false`) : un authenticator de session (transfère l'identité déjà
  // résolue au handshake) + le verrou de frame global (api.request ≤ GET, canaux
  // d'observabilité gatés). No-op si le module realtime n'est pas chargé.
  #wireRealtime(): void {
    const realtime = this.container?.get<IRealtimeService>("realtimeService");
    if (!realtime || !this.#areas) return;
    let wired = false;
    for (const area of this.#areas) {
      // Opt-out explicite SEULEMENT (`realtime: false`) : un flag opt-IN serait
      // fail-open — une zone qui oublie le flag laisserait le WS anonyme (trou
      // silencieux). Armer une zone sans handshake WS = matcher jamais déclenché
      // (0 coût) → sûr de l'armer partout.
      if (!area.security || !area.realtime) continue;
      // Une instance d'authenticator PAR zone : le hub dédoublonne `useAuthenticator`
      // par instance → une instance partagée n'enregistrerait que le 1ᵉʳ matcher.
      // Stateless (lit l'ALS) → 0 coût. En pratique une seule zone (nodefony-admin).
      const matcher: IRealtimeAuthenticatorMatcher = area.host
        ? { pattern: area.pattern, host: area.host }
        : { pattern: area.pattern };
      realtime.useAuthenticator(matcher, new SessionRealtimeAuthenticator());
      wired = true;
    }
    if (wired) {
      // Verrou de frame GLOBAL (1 hub) — partage `matchPath` (source unique de
      // zone HTTP ⇔ WS) + RBAC par canal. Politiques système = défauts plateforme
      // (namespaces réservés → ROLE_ADMIN) SURCHARGEABLES par la config (placée
      // AVANT → elle gagne). `channelResolver` = realtime (politiques métier
      // déclarées via `@RealtimeChannel`). Posé dès qu'une zone protégée existe.
      const configRules: ISystemChannelRule[] = (
        this.#config?.realtimeChannels ?? []
      ).map((r) => ({
        prefix: r.pattern,
        policy: {
          authenticated: r.authenticated,
          roles: r.roles,
          scopes: r.scopes,
        },
      }));
      const systemRules =
        configRules.length > 0
          ? [...configRules, ...DEFAULT_SYSTEM_RULES]
          : DEFAULT_SYSTEM_RULES;
      realtime.setFrameAuthorizer(
        buildFrameAuthorizer(this, { channelResolver: realtime, systemRules }),
      );
      this.log(
        "Realtime data plane locked — WS handshake + frame authorizer (RBAC) wired",
        "DEBUG",
      );
    }
  }

  // P6 J3 — briques TRANSVERSES construites depuis la config validée, posées
  // au container (partagées entre la porte Basic, le flux login BFF et le
  // UserService de l'application) :
  //  - `passwordEncoder` : pont config.encoders → chaîne d'encodeurs (1re
  //    entrée = principal, suivantes = legacy lecture seule, migration au
  //    login). L'app le consomme à la construction de son UserService.
  //  - `loginThrottler` : backoff NIST partagé — UNE instance pour TOUTES les
  //    portes (un attaquant ne contourne pas le compteur en changeant de porte).
  #provisionSharedServices(config: ISecurityConfig): void {
    const specs = Object.values(config.encoders);
    if (specs.length > 0) {
      this.container?.set("passwordEncoder", encoderFromConfig(specs));
    }
    const rl = config.rateLimit;
    if (rl.enabled) {
      this.container?.set(
        "loginThrottler",
        new LoginThrottler({
          freeAttempts: rl.freeAttempts,
          baseDelayS: rl.baseDelayS,
          capDelayS: rl.capDelayS,
          maxTracked: rl.maxTracked,
        }),
      );
    }
  }

  // Instancie via le registre les authenticators référencés par les zones
  // (lazy : seuls les noms utilisés coûtent). Nom inconnu = config morte →
  // fail-closed (un typo ne doit pas devenir un 401 mystère en prod).
  #instantiateAuthenticators(areas: SecuredArea[]): void {
    for (const area of areas) {
      for (const name of area.authenticators) {
        if (this.#authenticators?.has(name)) continue; // plugin déjà enregistré
        const factory = getAuthenticatorFactory(name);
        if (!factory) {
          this.#configError = new Error(
            `area "${area.name}": authenticator "${name}" unknown — registered: ` +
              `[${listAuthenticatorFactories().join(", ")}]`,
          );
          this.log(
            `Security configuration INVALID — ${this.#configError.message}`,
            "CRITIC",
          );
          return;
        }
        this.registerAuthenticator(
          factory({
            container: this.container as Container,
            config: this.#config as ISecurityConfig,
          }),
        );
      }
    }
  }

  /** Hiérarchie de rôles résolue (niveau A de l'autorisation, P6.8). */
  get roleHierarchy(): RoleHierarchyWalker {
    return (this.#roleHierarchy ??= new RoleHierarchyWalker());
  }

  /**
   * `true` si l'un des rôles de l'utilisateur couvre `required` (hiérarchie
   * comprise). Surface lue par le verrou de frame WS ({@link buildFrameAuthorizer})
   * pour le RBAC par canal — délègue au {@link RoleHierarchyWalker}.
   */
  hasRole(userRoles: readonly string[], required: string): boolean {
    return this.roleHierarchy.hasRole(userRoles, required);
  }

  registerAuthenticator(authenticator: IAuthenticator): void {
    (this.#authenticators ??= new Map()).set(authenticator.name, authenticator);
  }

  getArea(name: string): ISecuredArea | undefined {
    return this.#areas?.find((a) => a.name === name);
  }

  /**
   * Match de zone par pathname (+ host) SANS contexte — source UNIQUE consultée
   * par `isSecure` (HTTP) ET le verrou WebSocket (la frame `api.request` n'a
   * qu'un path). Hot-path : patterns pré-compilés + pathname fourni → 0 alloc.
   */
  matchPath(pathname: string, host?: string): SecuredArea | null {
    if (!this.#areas) return null;
    for (const area of this.#areas) {
      if (area.matchPath(pathname, host)) return area;
    }
    return null;
  }

  /** Match rapide de zone — pose `context.security`. `true` si zone capturée. */
  isSecure(context: ContextType): boolean {
    if (this.#configError) return true; // fail-closed : tout capturer
    if (!this.#areas) return false; // aucune zone → court-circuit hot-path
    // Pathname extrait UNE fois (vs N fois si chaque area.match le recalculait).
    const req = context.request;
    if (!req || !req.url) return false;
    const pathname =
      req.url instanceof URL ? req.url.pathname : String(req.url);
    const area = this.matchPath(
      pathname,
      (context as { domain?: string }).domain,
    );
    if (area) {
      context.security = area;
      return true;
    }
    return false;
  }

  /**
   * Pipeline complet de la zone : chaîne d'authenticators (selon `mode`) → ALS
   * → Zero Trust. Rejette (401, challenge RFC 7235 posé) ou résout.
   */
  async handleSecurity(context: ContextType): Promise<ContextType> {
    if (this.#configError) {
      // Fail-closed : le détail (CRITIC au boot) ne fuite jamais au client.
      throw new AuthenticationError("Security configuration invalid");
    }
    const area = context.security as ISecuredArea | null | undefined;
    if (!area || !area.security) return context; // hors zone ou zone publique
    const bypass = (context as { resolver?: { bypassFirewall?: boolean } })
      .resolver?.bypassFirewall;
    if (bypass) return context;

    let token: IToken | null;
    try {
      token = await this.#authenticate(context, area);
    } catch (error) {
      if (error instanceof ThrottledError) {
        // 429 (RFC 6585) : pas un défi d'authentification — `Retry-After`
        // (le client légitime sait quoi attendre), pas de WWW-Authenticate.
        context.response?.setHeader("Retry-After", String(error.retryAfterS));
        throw error;
      }
      this.#setChallenge(context, area); // la réponse 401 porte WWW-Authenticate
      throw error;
    }

    // Zero Trust : aucune preuve présentée dans une zone protégée → 401.
    if (token === null) {
      this.#setChallenge(context, area);
      throw new AuthenticationError(
        `Authentication required for area "${area.name}"`,
      );
    }

    RequestContext.set("user", token.getUser());
    // Token complet dans l'ALS : l'autorisation (décorateurs @IsGranted, J7) et
    // le verrou de frame WS y lisent rôles/scopes/attributs — `user` seul ne
    // suffit pas (axe scopes ≠ rôles). Propagé sur tout le pipeline de la zone.
    RequestContext.set("token", token);

    // Défense en profondeur : seul l'anonymat EXPLICITE (authenticator
    // `anonymous` listé dans la zone) autorise un token non authentifié.
    if (!token.isAuthenticated() && token.type !== "anonymous") {
      this.#setChallenge(context, area);
      throw new AuthenticationError(
        `Authentication required for area "${area.name}"`,
      );
    }
    return context;
  }

  /**
   * Défense CSRF (P6 J5) — branchée dans le pipeline HTTP de `@nodefony/http`
   * pour TOUTE requête (zone ou non) : une mutation cross-site est rejetée même
   * sur une route publique. Synchrone et fail-fast sur le hot-path (méthode sûre
   * → retour immédiat, aucun en-tête lu). No-op si CSRF désactivé ou route
   * exemptée du firewall (`bypassFirewall` — calque des callbacks OAuth).
   *
   * @throws CsrfError (403) — provenance tierce sur une méthode state-changing.
   */
  enforceCsrf(context: ContextType): void {
    if (!this.#csrf) return; // désactivé, ou config invalide (handleSecurity gère le fail-closed)
    // Hot-path : court-circuit AVANT de lire le moindre en-tête sur un GET.
    if (!Csrf.isStateChanging(context.method)) return;
    const bypass = (context as { resolver?: { bypassFirewall?: boolean } })
      .resolver?.bypassFirewall;
    if (bypass) return;
    const headers = (
      context.request as { headers?: RequestHeaders } | undefined
    )?.headers;
    this.#csrf.enforce({
      method: context.method,
      secFetchSite: headerValue(headers, "sec-fetch-site"),
      origin: headerValue(headers, "origin"),
      referer: headerValue(headers, "referer"),
      // Host BRUT avec port (`URL.host` du fallback inclut le port) — `:authority`
      // en HTTP/2, `context.domain` n'est qu'un fallback (hostname sans port).
      host:
        headerValue(headers, "host") ??
        headerValue(headers, ":authority") ??
        (context as { domain?: string }).domain,
    });
  }

  /**
   * Politique CORS (P6 J5) — branchée dans `handleFrontController` AVANT le
   * routing/firewall. Pose les en-têtes `Access-Control-*` et **court-circuite le
   * preflight** `OPTIONS` en `204` (le preflight ne porte jamais de credentials,
   * Fetch Standard → il ne doit ni router ni s'authentifier). No-op hors requête
   * cross-origin (pas d'`Origin`), CORS désactivé, ou réponse non-HTTP (WS).
   *
   * @returns `204` si la requête est un preflight (l'appelant court-circuite la
   *   réponse), sinon `undefined` (la requête réelle suit le pipeline normal).
   */
  handleCors(context: ContextType): number | undefined {
    if (!this.#cors) return undefined;
    const headers = (
      context.request as { headers?: RequestHeaders } | undefined
    )?.headers;
    const origin = headerValue(headers, "origin");
    if (!origin) return undefined; // requête same-origin / non-navigateur
    const response = (context as { response?: IHeaderCapableResponse | null })
      .response;
    if (typeof response?.setHeader !== "function") return undefined; // WS : pas d'en-têtes HTTP

    const isPreflight =
      context.method?.toUpperCase() === "OPTIONS" &&
      headerValue(headers, "access-control-request-method") !== undefined;

    const corsHeaders = isPreflight
      ? this.#cors.preflightHeaders(origin)
      : this.#cors.actualHeaders(origin);
    // Origine non autorisée → corsHeaders null : aucun en-tête posé (réponse non
    // partageable, le navigateur bloque — 0 fuite). Le preflight reste court-circuité.
    if (corsHeaders) {
      for (const name in corsHeaders) {
        response.setHeader(name, corsHeaders[name]);
      }
    }
    return isPreflight ? 204 : undefined;
  }

  /**
   * En-têtes de sécurité APPLICATIFS (P6 J5) — CSP, Referrer-Policy, isolation
   * cross-origin (COOP/COEP/CORP), Origin-Agent-Cluster, Permissions-Policy.
   * Posés sur toute réponse du pipeline (branché dans `handleHttp`). Complète le
   * socle transport de `@nodefony/http` (nosniff/frame/HSTS, posé à l'entrée brute)
   * SANS le ré-émettre. No-op si désactivé ou réponse non-HTTP (WS).
   *
   * En-têtes constants = table figée pré-calculée au boot (0 alloc/concat). Le CSP
   * nonce/req (étape B) ajoute 1 `join` + 1 `setHeader` UNIQUEMENT si activé.
   */
  applySecurityHeaders(context: ContextType): void {
    const sh = this.#securityHeaders;
    if (!sh) return;
    const response = (context as { response?: IHeaderCapableResponse | null })
      .response;
    if (typeof response?.setHeader !== "function") return;
    // En-têtes constants (Referrer/COOP/… + CSP statique si pas de nonce) — figés.
    const headers = sh.headers;
    for (const name in headers) {
      response.setHeader(name, headers[name]);
    }
    // CSP nonce/req (étape B) : LIRE `context.cspNonce` génère le nonce PARESSEUSEMENT
    // et le mémoïse → le `<script nonce="X">` rendu ensuite par le controller lit la
    // MÊME valeur. Posé seulement si le CSP porte `{{nonce}}` (sinon `hasNonce`=false
    // → 0 génération crypto). Antérieur au `writeHead` (cf handleHttp 881 < 935).
    if (sh.hasNonce) {
      response.setHeader(
        "Content-Security-Policy",
        sh.cspFor((context as { cspNonce: string }).cspNonce),
      );
    }
  }

  /**
   * Déclare des directives CSP additionnelles pour `moduleName` (cf `IFirewall`).
   * No-op si les en-têtes applicatifs sont désactivés (pas de CSP à étendre).
   * Recompose `#securityHeaders` (merge + re-split nonce) — hors hot-path.
   */
  registerCspOrigins(moduleName: string, fragment: CspFragment): void {
    if (!this.#securityHeaders || !this.#config) return;
    (this.#cspFragments ??= new Map()).set(moduleName, fragment);
    this.#rebuildSecurityHeaders();
  }

  /** Retire les directives CSP de `moduleName` et recompose si nécessaire. */
  unregisterCspOrigins(moduleName: string): void {
    if (!this.#cspFragments?.delete(moduleName)) return;
    this.#rebuildSecurityHeaders();
  }

  /**
   * Reconstruit `SecurityHeaders` depuis le CSP de base mergé avec les fragments
   * enregistrés. Appelé UNIQUEMENT au (dé)enregistrement d'un module (jamais par
   * requête) → parse/merge/serialize amortis hors hot-path. Repart toujours de
   * `headers.csp` (base) → idempotent (pas de merge sur du déjà-mergé).
   */
  #rebuildSecurityHeaders(): void {
    const headers = this.#config?.headers;
    if (!headers) return;
    const csp =
      this.#cspFragments && this.#cspFragments.size > 0
        ? mergeCspFragments(headers.csp, this.#cspFragments.values())
        : headers.csp;
    this.#securityHeaders = new SecurityHeaders({ ...headers, csp });
  }

  /**
   * Exécute la chaîne d'authenticators de la zone selon son `mode`.
   *
   * `first` : le premier dont `supports()` est vrai authentifie — un credential
   * PRÉSENTÉ mais invalide échoue immédiatement (jamais de fallback silencieux
   * vers le maillon suivant). Aucune preuve présentée → `null`.
   *
   * `all` : tous les maillons doivent supporter ET authentifier (MFA) ; le
   * DERNIER token porte l'identité. Une preuve manquante = 401.
   *
   * @returns le token accepté, ou `null` si aucune preuve n'a été présentée.
   * @throws AuthenticationError (401) — credential invalide ou preuve manquante
   *   (mode `all`). Toute erreur interne est logguée ERROR puis wrappée 401
   *   fail-closed (rien ne fuite au client).
   */
  async #authenticate(
    context: ContextType,
    area: ISecuredArea,
  ): Promise<IToken | null> {
    let token: IToken | null = null;
    for (const name of area.authenticators) {
      const authenticator = this.#authenticators?.get(name);
      if (!authenticator) {
        // Filet runtime (la validation boot rend ce cas quasi impossible) :
        // un maillon manquant ne doit JAMAIS laisser passer.
        this.log(`authenticator "${name}" not registered`, "ERROR");
        throw new AuthenticationError(
          `Authentication required for area "${area.name}"`,
        );
      }
      if (!authenticator.supports(context)) {
        if (area.mode === "first") continue; // pas de credential pour ce maillon
        // mode "all" : chaque preuve est obligatoire.
        throw new AuthenticationError(
          `Authentication required for area "${area.name}"`,
        );
      }
      const created = await authenticator.createToken(context);
      let authenticated: IToken;
      try {
        authenticated = await authenticator.authenticate(created);
      } catch (error) {
        await authenticator.onFailure(context, error as Error);
        if (error instanceof AuthenticationError) {
          this.log(
            `authentication failed (area "${area.name}", authenticator "${name}")`,
            "WARNING",
          );
          throw error;
        }
        if (error instanceof ThrottledError) {
          // Backoff NIST actif : remonte tel quel (429 + Retry-After posé par
          // handleSecurity) — surtout pas wrappé en 401 générique.
          this.log(
            `login throttled (area "${area.name}", authenticator "${name}", retry in ${error.retryAfterS}s)`,
            "WARNING",
          );
          throw error;
        }
        // Erreur INTERNE (source d'identité down, câblage) : signal ops complet
        // côté serveur, 401 générique côté client (fail-closed, zéro fuite).
        this.log(error, "ERROR");
        throw new AuthenticationError("Authentication failed");
      }
      await authenticator.onSuccess(context, authenticated);
      if (area.mode === "first") return authenticated;
      token = authenticated; // mode "all" : le dernier porte l'identité
    }
    return token;
  }

  // Pose le challenge WWW-Authenticate (RFC 7235 : tout 401 DOIT en porter un)
  // du premier authenticator de la zone qui en déclare. Cold path (401 only).
  // Capability check : une réponse WS n'a pas d'en-têtes (le close code suffit).
  #setChallenge(context: ContextType, area: ISecuredArea): void {
    const response = (context as { response?: IHeaderCapableResponse | null })
      .response;
    if (typeof response?.setHeader !== "function") return;
    for (const name of area.authenticators) {
      const challenge = this.#authenticators?.get(name)?.challenge?.();
      if (challenge) {
        response.setHeader("WWW-Authenticate", challenge);
        return;
      }
    }
  }

  override log(
    pci: unknown,
    severity?: Severity,
    msgid?: Msgid,
    msg?: Message,
  ): Pdu {
    if (!msgid) {
      // Couleur gatée au boot (logColor) → msgid brut "FIREWALL" hors TTY (JSONL
      // queryable + pipe prod propres) ; cyan sur terminal interactif.
      msgid = logColor.cyan("FIREWALL");
    }
    return super.log(pci, severity, msgid, msg);
  }
}

export default Firewall;
export { Firewall };
