/**
 * Surface d'INTROSPECTION du firewall (data plane Studio P6.15) — projection
 * LECTURE SEULE de l'état RUNTIME réel du {@link IFirewall} (zones montées,
 * authenticators instanciés, défenses résolues), **secrets exclus par
 * construction** (présence, jamais valeur — règle audit). Distincte de la config
 * brute : on décrit ce qui TOURNE, pas ce que l'app a écrit (un nom
 * d'authenticator en typo n'apparaît pas comme « monté »).
 *
 * Le front Studio en tient des **types miroir locaux** (frontière isomorphe :
 * jamais d'import runtime `@nodefony/security` dans le bundle navigateur).
 */

/** Une zone sécurisée telle que montée au boot (pattern compilé → source). */
export interface IFirewallZoneDescription {
  /** Nom de la zone (`"nodefony-admin"`…). */
  name: string;
  /** Pattern d'URL (`RegExp.source`) capturé par la zone. */
  pattern: string;
  /** Zone protégée (Zero Trust) ; `false` = zone publique explicite. */
  security: boolean;
  /** `true` = chaque requête porte sa preuve (JWT/clé) ; `false` = session BFF possible. */
  stateless: boolean;
  /** Chaîne d'authenticators : `first` (le premier qui reconnaît) ou `all` (MFA). */
  mode: "first" | "all";
  /** Noms des authenticators exécutés par la zone (sémantique selon `mode`). */
  authenticators: readonly string[];
  /** Le pattern `anonymous` est-il listé (anonymat explicite autorisé) ? */
  allowsAnonymous: boolean;
  /** Domaine/vhost de la zone, ou `null` (tous domaines). */
  host: string | null;
  /** Zone valable aussi pour les frames WebSocket (api.request + subscribe). */
  realtime: boolean;
}

/** Un authenticator : disponible (registre de fabriques) et/ou monté (≥1 zone). */
export interface IFirewallAuthenticatorDescription {
  /** Nom logique (`anonymous`/`userpassword`/`session`/`jwt`/`apikey`…). */
  name: string;
  /** Référencé par ≥1 zone → instancié au boot (actif sur le pipeline). */
  mounted: boolean;
  /** Présent dans le registre de fabriques (utilisable en config). */
  available: boolean;
  /** Déclare un challenge `WWW-Authenticate` (RFC 7235). */
  challenge: boolean;
}

/** Défenses transverses résolues (CSRF/CORS/headers/throttle) — sans secret. */
export interface IFirewallDefensesDescription {
  csrf: {
    enabled: boolean;
    /** Défense primaire Fetch Metadata (`Sec-Fetch-Site`). */
    fetchMetadata: boolean;
    /** Repli Origin/Referer (vieux navigateurs). */
    checkOrigin: boolean;
    /** Politique stricte same-origin only (multi-tenant). */
    strictSameSite: boolean;
    /** Attribut cookie `SameSite`. */
    sameSite: "Strict" | "Lax" | "None";
    /** Alias d'origine légitimes (façades multi-domaine). */
    trustedOrigins: readonly string[];
    /** Synchronizer token `@CsrfProtect` armé (secret présent OU éphémère dev) — PRÉSENCE, jamais le secret. */
    synchronizerToken: boolean;
  };
  cors: {
    enabled: boolean;
    origins: readonly string[];
    credentials: boolean;
    methods: readonly string[];
    allowedHeaders: readonly string[];
    exposedHeaders: readonly string[];
    maxAgeS: number;
  };
  headers: {
    enabled: boolean;
    /** ⚙️ posé par @nodefony/http (transport) — reflété ici pour information. */
    hsts: boolean;
    hstsMaxAgeS: number;
    /** Policy CSP (template `{{nonce}}`) — politique publique, pas un secret. */
    csp: string;
    cspNonces: boolean;
    frameguard: "deny" | "sameorigin";
    noSniff: boolean;
    referrerPolicy: string;
    coop?: string;
    coep?: string;
    corp?: string;
    originAgentCluster?: boolean;
    permissionsPolicy?: string;
  };
  rateLimit: {
    enabled: boolean;
    freeAttempts: number;
    baseDelayS: number;
    capDelayS: number;
  };
}

/** Photo complète de l'état du firewall. */
export interface IFirewallDescription {
  /** Config sécurité valide au boot (sinon le firewall est fail-closed). */
  configValid: boolean;
  /** Message d'erreur de config si fail-closed, sinon `null` (jamais de stack — Zero Trust). */
  configError: string | null;
  /** Zones montées, triées par spécificité (pattern le plus long d'abord). */
  zones: IFirewallZoneDescription[];
  /** Authenticators disponibles/montés (union registre ∪ instanciés). */
  authenticators: IFirewallAuthenticatorDescription[];
  /** Défenses résolues, ou `null` si la config est invalide. */
  defenses: IFirewallDefensesDescription | null;
}

/** Un rôle déclaré + ses rôles hérités (résolution transitive du walker). */
export interface IRoleDescription {
  /** Rôle déclaré (clé de la hiérarchie). */
  role: string;
  /** Tous les rôles atteignables transitivement (hors le rôle lui-même), triés. */
  inherits: string[];
}

/** Hiérarchie de rôles : déclaration brute + résolution aplatie. */
export interface IRoleHierarchyDescription {
  /** Déclaration directe (`{ ROLE_ADMIN: ["ROLE_USER"] }`). */
  hierarchy: Record<string, string[]>;
  /** Résolution transitive précalculée par le {@link RoleHierarchyWalker}. */
  roles: IRoleDescription[];
}
