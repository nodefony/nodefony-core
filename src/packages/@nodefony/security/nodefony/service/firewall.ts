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
import type { ContextType, ISecurityTrace } from "@nodefony/http";
import { encoderFromConfig } from "@nodefony/user";

import { SecuredArea } from "../src/SecuredArea";
import { LoginThrottler } from "../src/throttle/LoginThrottler";
import { RoleHierarchyWalker } from "../src/RoleHierarchyWalker";
import { randomBytes } from "node:crypto";
import { mergeCspFragments, type CspFragment } from "../src/csp";
import { CsrfTokenManager } from "../src/csrfToken";
import { Csrf } from "./csrf";
import { Cors } from "./cors";
import { SecurityHeaders } from "./securityHeaders";
import { AuthenticationError } from "../errors/AuthenticationError";
import { ThrottledError } from "../errors/ThrottledError";
import { CsrfError } from "../errors/CsrfError";
import {
  defineSecurityConfig,
  type ISecurityConfig,
} from "../config/defineModuleConfig";
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
import { recordAudit } from "../src/audit/recordAudit";
import { readAuditContext } from "../src/audit/readAuditContext";
import {
  createAuditBridge,
  SECURITY_AUDIT_CHANNEL,
  type IAuditEventSource,
} from "../src/audit/auditBridge";
import type {
  IRealtimeService,
  IRealtimeAuthenticatorMatcher,
} from "../src/realtime/realtimeContracts";
import type { IFirewall } from "../contracts/IFirewall";
import type { IAuthenticator } from "../contracts/IAuthenticator";
import type { IToken } from "../contracts/IToken";
import type { ISecuredArea } from "../contracts/ISecuredArea";
import type {
  IFirewallDescription,
  IFirewallDefensesDescription,
  IFirewallZoneDescription,
  IFirewallAuthenticatorDescription,
  IRoleHierarchyDescription,
} from "../contracts/IFirewallDescription";

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
 * Extrait la valeur d'un cookie de l'en-tête `Cookie` brut (lecture directe, sans
 * dépendre du parse du Context — robuste quel que soit l'ordre du pipeline).
 * Retient la 1ʳᵉ occurrence du nom. Utilisé par la défense synchronizer CSRF.
 */
function cookieValue(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
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
  // Synchronizer token CSRF (`@CsrfProtect`, défense en profondeur opt-in) — null
  // si CSRF désactivé. Construit avec le secret config ou un secret éphémère (dev).
  #csrfTokens: CsrfTokenManager | null = null;
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
      // Synchronizer token (`@CsrfProtect`) : secret config en prod (PARTAGÉ entre
      // process), sinon secret éphémère + avertissement (dev — re-généré au restart,
      // invalide les tokens en cours ; non sûr en cluster). Construit dès que CSRF
      // est actif → les routes décorées fonctionnent sans config supplémentaire.
      let secret = this.#config.csrf.secret;
      if (!secret) {
        secret = randomBytes(32).toString("base64url");
        this.log(
          "csrf.secret absent → secret synchronizer ÉPHÉMÈRE généré (dev). En PROD/cluster, " +
            "fixer csrf.secret (≥16 car., partagé entre process) — générer la clé et le " +
            "câblage : `npx nodefony security:secrets`.",
          "WARNING",
        );
      }
      this.#csrfTokens = new CsrfTokenManager(secret);
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
    if (!realtime) return;
    let wired = false;
    for (const area of this.#areas ?? []) {
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
    // Verrou de frame GLOBAL (1 hub), posé INCONDITIONNELLEMENT dès que le hub
    // existe — PAS seulement quand une zone qualifiante est câblée. F82 : le
    // conditionner à `wired` était fail-OPEN — sans zone `security && realtime`
    // (ou avec `areas` vide), aucun verrou n'était posé, `runAuthorizer` renvoyait
    // `true` pour TOUTE frame, et les canaux d'introspection système (`syslog:`,
    // `security:audit`, `orm:`…) étaient servis à l'anonyme. Le plancher système
    // ({@link DEFAULT_SYSTEM_RULES}) ne dépend PAS des zones : il exige toujours au
    // moins ROLE_ADMIN sur les namespaces réservés. Sans zone, aucun authenticator
    // n'est câblé → tout abonné reste anonyme → ces canaux sont fermés à TOUS
    // (fail-closed), et une app qui veut y donner accès DOIT déclarer une zone
    // `security && realtime` (qui câble le SessionRealtimeAuthenticator ci-dessus).
    // Partage `matchPath` (source unique de zone HTTP ⇔ WS) + RBAC par canal.
    // Politiques système SURCHARGEABLES par la config (`realtimeChannels`, placée
    // AVANT → elle gagne). `channelResolver` = realtime (politiques métier
    // déclarées via `@RealtimeChannel`).
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
    // Journal d'audit (P6.14 lot 2b) : tout refus de frame WS est une transition
    // de sécurité (api.request sur zone gardée, canal interdit). La closure n'est
    // tirée QUE sur refus (cold) → 0 coût sur le hot-path WS. La frame ne porte ni
    // IP ni requestId (≠ HttpContext) : acteur + cible suffisent.
    const container = this.container as Container;
    realtime.setFrameAuthorizer(
      buildFrameAuthorizer(this, {
        channelResolver: realtime,
        systemRules,
        onDeny: (_surface, target, reason, token) =>
          recordAudit(container, {
            category: "ws",
            action: "frame.denied",
            outcome: "denied",
            actor: token.getUserIdentifier(),
            resource: target,
            reason,
          }),
      }),
    );
    // Canal live du journal d'audit (P6.14 lot 4) — enregistré comme canal
    // SYSTÈME sur le hub : servable par TOUT endpoint (pas seulement Studio),
    // gardé ROLE_NODEFONY_ADMIN par le plancher `security:` du verrou ci-dessus.
    // Lazy de bout en bout : le pont ne s'abonne à l'AuditService qu'au 1ᵉʳ
    // auditeur connecté (factory du hub) et s'en détache au dernier (0 listener
    // au repos). Gardé par le plancher → jamais de canal d'audit non protégé.
    const auditSource = this.container?.get<IAuditEventSource>("auditService");
    if (auditSource && realtime.registerSystemChannel) {
      realtime.registerSystemChannel(SECURITY_AUDIT_CHANNEL, (ch, publish) =>
        createAuditBridge(auditSource, publish, ch),
      );
    }
    this.log(
      wired
        ? "Realtime data plane locked — WS handshake authenticators (RBAC) + frame authorizer + audit channel wired"
        : "Realtime data plane locked — frame authorizer (system floor) wired without qualifying zone; system channels closed to anonymous",
      "DEBUG",
    );
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
   * Projection LECTURE SEULE de l'état RUNTIME (data plane Studio P6.15) — décrit
   * ce qui TOURNE (zones montées, authenticators instanciés, défenses résolues),
   * pas la config brute. **Secrets exclus par construction** (le synchronizer CSRF
   * et la clé JWT ne sont JAMAIS exposés — on remonte leur PRÉSENCE, pas leur
   * valeur, comme le journal d'audit). Cold-path admin (lecture rare) → 0
   * contrainte hot-path.
   */
  describe(): IFirewallDescription {
    const config = this.#config;
    const mounted = this.#authenticators;

    const zones: IFirewallZoneDescription[] = (this.#areas ?? []).map((a) => ({
      name: a.name,
      pattern: a.pattern.source,
      security: a.security,
      stateless: a.stateless,
      mode: a.mode,
      authenticators: [...a.authenticators],
      allowsAnonymous: a.authenticators.includes("anonymous"),
      host: a.host ?? null,
      realtime: a.realtime,
    }));

    // Union registre (disponibles en config) ∪ montés (référencés par ≥1 zone) :
    // la console montre à la fois ce qui est utilisable et ce qui est actif.
    const available = new Set(listAuthenticatorFactories());
    const names = new Set<string>(available);
    if (mounted) for (const n of mounted.keys()) names.add(n);
    const authenticators: IFirewallAuthenticatorDescription[] = [...names]
      .sort()
      .map((name) => ({
        name,
        mounted: mounted?.has(name) ?? false,
        available: available.has(name),
        challenge: typeof mounted?.get(name)?.challenge === "function",
      }));

    return {
      configValid: !this.#configError,
      // Message seul (jamais la stack) — l'endpoint est déjà ROLE_NODEFONY_ADMIN.
      configError: this.#configError ? this.#configError.message : null,
      zones,
      authenticators,
      defenses: config ? this.#describeDefenses(config) : null,
    };
  }

  // Défenses transverses résolues — projection SANS secret (csrf.secret /
  // jwt.keystore / oauth clientSecret jamais lus ici).
  #describeDefenses(config: ISecurityConfig): IFirewallDefensesDescription {
    return {
      csrf: {
        enabled: config.csrf.enabled,
        fetchMetadata: config.csrf.fetchMetadata,
        checkOrigin: config.csrf.checkOrigin,
        strictSameSite: config.csrf.strictSameSite,
        sameSite: config.csrf.sameSite,
        trustedOrigins: [...config.csrf.trustedOrigins],
        // PRÉSENCE du synchronizer (secret armé), jamais la valeur du secret.
        synchronizerToken: this.#csrfTokens !== null,
      },
      cors: {
        enabled: config.cors.enabled,
        origins: [...config.cors.origins],
        credentials: config.cors.credentials,
        methods: [...config.cors.methods],
        allowedHeaders: [...config.cors.allowedHeaders],
        exposedHeaders: [...config.cors.exposedHeaders],
        maxAgeS: config.cors.maxAgeS,
      },
      headers: {
        enabled: config.headers.enabled,
        hsts: config.headers.hsts,
        hstsMaxAgeS: config.headers.hstsMaxAgeS,
        csp: config.headers.csp,
        cspNonces: config.headers.cspNonces,
        frameguard: config.headers.frameguard,
        noSniff: config.headers.noSniff,
        referrerPolicy: config.headers.referrerPolicy,
        coop: config.headers.coop,
        coep: config.headers.coep,
        corp: config.headers.corp,
        originAgentCluster: config.headers.originAgentCluster,
        permissionsPolicy: config.headers.permissionsPolicy,
      },
      rateLimit: {
        enabled: config.rateLimit.enabled,
        freeAttempts: config.rateLimit.freeAttempts,
        baseDelayS: config.rateLimit.baseDelayS,
        capDelayS: config.rateLimit.capDelayS,
      },
    };
  }

  /**
   * Hiérarchie de rôles déclarée + résolution transitive (data plane Studio).
   * Brut = ce que l'app a écrit ; `inherits` = aplati précalculé par le walker.
   */
  describeRoleHierarchy(): IRoleHierarchyDescription {
    const raw = this.#config?.roleHierarchy ?? {};
    const hierarchy: Record<string, string[]> = {};
    for (const role of Object.keys(raw)) hierarchy[role] = [...raw[role]];
    const walker = this.roleHierarchy;
    const roles = Object.keys(hierarchy).map((role) => ({
      role,
      inherits: [...walker.reachableRoles([role])]
        .filter((r) => r !== role)
        .sort(),
    }));
    return { hierarchy, roles };
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
    // Radiographie (dev-only) : le chemin de succès est MUET côté audit (le
    // volume nominal n'est pas un signal de sécurité) → sans cette trace, une
    // requête qui PASSE ne dit ni par quelle zone, ni par quel authenticator.
    // `context.profiling` est faux en prod → aucune allocation ici.
    const trace = this.#startTrace(context);
    if (bypass) {
      if (trace) trace.outcome = "bypass";
      return context;
    }

    let token: IToken | null;
    try {
      token = await this.#authenticate(context, area, trace);
    } catch (error) {
      if (error instanceof ThrottledError) {
        // 429 (RFC 6585) : pas un défi d'authentification — `Retry-After`
        // (le client légitime sait quoi attendre), pas de WWW-Authenticate.
        context.response?.setHeader("Retry-After", String(error.retryAfterS));
        this.#recordAuth(
          context,
          area,
          "auth.throttled",
          "failure",
          "throttled",
          null,
        );
        throw error;
      }
      this.#setChallenge(context, area); // la réponse 401 porte WWW-Authenticate
      // Credential PRÉSENTÉ mais invalide (l'acteur a échoué une preuve).
      this.#recordAuth(
        context,
        area,
        "auth.failure",
        "failure",
        "invalid_credentials",
        null,
      );
      throw error;
    }

    // Zero Trust : aucune preuve présentée dans une zone protégée → 401. Refus
    // par POLITIQUE (zone fermée), pas un échec de preuve → outcome `denied`.
    if (token === null) {
      this.#setChallenge(context, area);
      this.#recordAuth(
        context,
        area,
        "auth.denied",
        "denied",
        "no_credentials",
        null,
      );
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
      this.#recordAuth(
        context,
        area,
        "auth.denied",
        "denied",
        "unauthenticated",
        token.getUserIdentifier(),
      );
      throw new AuthenticationError(
        `Authentication required for area "${area.name}"`,
      );
    }
    // Succès (authentifié OU anonyme explicite) : AUCUNE émission — le hot-path
    // nominal reste muet (le volume n'est pas un signal d'audit). La trace
    // dev-only, elle, retient QUI est passé et PAR QUOI (radiographie).
    if (trace) {
      trace.outcome = token.isAuthenticated() ? "granted" : "anonymous";
      trace.user = token.getUserIdentifier();
      trace.roles = token.getRoles();
    }
    return context;
  }

  /**
   * Ouvre la trace de décision de la zone — **dev-only**, gratuit en production.
   *
   * L'allocation est conditionnée au témoin `context.profiling` (posé par le
   * HttpKernel quand le Profiler est actif, donc jamais en prod) : sur le
   * hot-path nominal, ceci coûte une lecture de booléen.
   *
   * @returns la trace fraîche (posée sur le context), ou `null` hors profiling.
   */
  #startTrace(context: ContextType): ISecurityTrace | null {
    const ctx = context as unknown as {
      profiling?: boolean;
      securityTrace?: ISecurityTrace | null;
    };
    if (!ctx.profiling) return null;
    const trace: ISecurityTrace = {
      authenticator: null,
      // Défaut fail-closed : tant qu'aucune sortie n'a tranché, la requête est
      // réputée refusée (une trace tronquée ne doit jamais se lire « passée »).
      outcome: "denied",
      reason: null,
      user: null,
      roles: null,
    };
    ctx.securityTrace = trace;
    return trace;
  }

  // Journalise un refus d'authentification de zone (cold-path : 401/429 only) —
  // helper DRY des 4 sorties d'échec de `handleSecurity`. Jamais appelé sur le
  // chemin de succès → 0 allocation sur le hot-path nominal. `recordAudit` est
  // no-op si l'audit est absent/désactivé (coût quasi nul même sous attaque).
  #recordAuth(
    context: ContextType,
    area: ISecuredArea,
    action: string,
    outcome: "failure" | "denied",
    reason: string,
    actor: string | null,
  ): void {
    // Radiographie : le refus porte son MOTIF (dev-only ; `securityTrace` est
    // null en prod). `throttled` est un 429, pas un échec de preuve → il garde
    // sa propre issue plutôt que d'être aplati en `failure`.
    const trace = (
      context as unknown as { securityTrace?: ISecurityTrace | null }
    ).securityTrace;
    if (trace) {
      trace.outcome = reason === "throttled" ? "throttled" : outcome;
      trace.reason = reason;
      // L'acteur est connu quand une preuve a été présentée (credential rejeté,
      // token non authentifié) — sinon `null` (personne ne s'est annoncé).
      trace.user = actor;
    }
    recordAudit(this.container as Container, {
      category: "auth",
      action,
      outcome,
      actor,
      resource: area.name,
      reason,
      ...readAuditContext(context),
    });
  }

  /**
   * Défense CSRF (P6 J5/étape 2) — branchée dans le pipeline HTTP de `@nodefony/http`
   * pour TOUTE requête (zone ou non), APRÈS le resolve (les marqueurs `@CsrfProtect`/
   * `@CsrfExempt` de la route sont disponibles). Trois rôles :
   *
   *  - **Émission** : sur une requête SÛRE vers une route `@CsrfProtect`, minte le
   *    synchronizer token (`context.csrfToken`) — HttpContext pose ensuite le cookie
   *    lisible `csrf-token`. Sinon, hot-path GET = retour immédiat (aucun en-tête lu).
   *  - **Étape 1 (globale)** : sur une mutation, défense Fetch Metadata / Origin
   *    (rejet cross-site même sur route publique). Skippée si `@CsrfExempt` (webhook,
   *    auth par signature/clé) ou `bypassFirewall` (callbacks OAuth).
   *  - **Étape 2 (opt-in)** : sur une mutation `@CsrfProtect`, exige EN PLUS le
   *    synchronizer token (en-tête `x-csrf-token` ≡ cookie + HMAC valide).
   *
   * @throws CsrfError (403) — provenance tierce, ou synchronizer token absent/invalide.
   */
  enforceCsrf(context: ContextType): void {
    if (!this.#csrf) return; // désactivé, ou config invalide (handleSecurity gère le fail-closed)
    const bypass = (context as { resolver?: { bypassFirewall?: boolean } })
      .resolver?.bypassFirewall;
    if (bypass) return;
    const ctx = context as {
      csrfProtect?: boolean;
      csrfExempt?: boolean;
      csrfToken?: string | null;
    };
    // Méthode sûre (GET/HEAD…) : pas de vérif CSRF (RFC 9110). On en profite pour
    // ÉMETTRE le synchronizer token si la route est `@CsrfProtect` (1× — déjà posé → skip).
    if (!Csrf.isStateChanging(context.method)) {
      if (ctx.csrfProtect && this.#csrfTokens && ctx.csrfToken == null) {
        ctx.csrfToken = this.#csrfTokens.issue();
      }
      return;
    }
    // Mutation explicitement exemptée (@CsrfExempt) → hors défense CSRF (auth conservée).
    if (ctx.csrfExempt) return;
    const headers = (
      context.request as { headers?: RequestHeaders } | undefined
    )?.headers;
    // Étape 1 — défense globale (Fetch Metadata d'abord, repli Origin/Referer).
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
    // Étape 2 — synchronizer token EN PLUS sur les routes `@CsrfProtect`.
    if (ctx.csrfProtect && this.#csrfTokens) {
      const ok = this.#csrfTokens.verify(
        headerValue(headers, "x-csrf-token"),
        cookieValue(headerValue(headers, "cookie"), "csrf-token"),
      );
      if (!ok) throw new CsrfError("Missing or invalid CSRF token");
    }
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
    // CSP per-route (`@Csp`, P6) : directives additionnelles posées par le Resolver
    // sur le contexte au match (`null` = cas courant → 0 composition). Lu APRÈS le
    // resolve (cf déplacement dans handleHttp). Le merge n'est payé QUE sur ces routes.
    const extra = (context as { cspDirectives?: CspFragment | null })
      .cspDirectives;
    // CSP nonce/req (étape B) : LIRE `context.cspNonce` génère le nonce PARESSEUSEMENT
    // et le mémoïse → le `<script nonce="X">` rendu ensuite par le controller lit la
    // MÊME valeur. Posé seulement si le CSP porte `{{nonce}}` (sinon `hasNonce`=false
    // → 0 génération crypto). Antérieur au `writeHead`.
    if (sh.hasNonce) {
      const nonce = (context as { cspNonce: string }).cspNonce;
      response.setHeader(
        "Content-Security-Policy",
        extra ? sh.cspForExtra(nonce, extra) : sh.cspFor(nonce),
      );
    } else if (extra) {
      // CSP statique + extra de route → recompose (écrase l'en-tête statique posé
      // dans la boucle `headers`). Pas de nonce ici (param ignoré par cspForExtra).
      response.setHeader("Content-Security-Policy", sh.cspForExtra("", extra));
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
   * @param trace - radiographie dev-only ; reçoit le NOM du maillon qui a
   *   résolu l'identité (`null` en prod → aucune écriture).
   * @returns le token accepté, ou `null` si aucune preuve n'a été présentée.
   * @throws AuthenticationError (401) — credential invalide ou preuve manquante
   *   (mode `all`). Toute erreur interne est logguée ERROR puis wrappée 401
   *   fail-closed (rien ne fuite au client).
   */
  async #authenticate(
    context: ContextType,
    area: ISecuredArea,
    trace: ISecurityTrace | null = null,
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
      // Radiographie : le maillon qui a RÉELLEMENT résolu l'identité (en mode
      // `all`, le dernier — c'est lui qui la porte, cf ci-dessous).
      if (trace) trace.authenticator = name;
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
