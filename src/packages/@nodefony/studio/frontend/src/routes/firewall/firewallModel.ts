/**
 * Modèle de la console **Firewall** (P6.15) — **types miroir** du contrat back
 * `@nodefony/security` (introspection runtime du firewall) + constantes
 * d'affichage. Frontière isomorphe : on NE référence JAMAIS le code serveur, on
 * recopie le contrat (shape JSON stable, secrets exclus par construction).
 *
 * Source de vérité serveur : `security/nodefony/contracts/IFirewallDescription.ts`.
 * Data plane consommé : `GET /nodefony/security/api/firewall`
 * + `GET /nodefony/security/api/roleHierarchy` (RBAC `ROLE_NODEFONY_ADMIN`).
 */

/** Une zone sécurisée montée — miroir de `IFirewallZoneDescription`. */
export interface FirewallZone {
  name: string;
  /** Pattern d'URL (`RegExp.source`). */
  pattern: string;
  /** Zone protégée (Zero Trust) ; `false` = publique explicite. */
  security: boolean;
  /** `true` = preuve par requête (JWT/clé) ; `false` = session BFF possible. */
  stateless: boolean;
  /** `first` (le premier qui reconnaît) ou `all` (tous = MFA). */
  mode: "first" | "all";
  authenticators: string[];
  /** L'authenticator `anonymous` est-il listé (anonymat explicite) ? */
  allowsAnonymous: boolean;
  host: string | null;
  /** Zone valable aussi pour les frames WebSocket. */
  realtime: boolean;
}

/** Un authenticator — miroir de `IFirewallAuthenticatorDescription`. */
export interface FirewallAuthenticator {
  name: string;
  /** Référencé par ≥1 zone → instancié (actif sur le pipeline). */
  mounted: boolean;
  /** Présent dans le registre de fabriques (utilisable en config). */
  available: boolean;
  /** Déclare un challenge `WWW-Authenticate` (RFC 7235). */
  challenge: boolean;
}

/** Défenses transverses résolues — miroir de `IFirewallDefensesDescription`. */
export interface FirewallDefenses {
  csrf: {
    enabled: boolean;
    fetchMetadata: boolean;
    checkOrigin: boolean;
    strictSameSite: boolean;
    sameSite: "Strict" | "Lax" | "None";
    trustedOrigins: string[];
    synchronizerToken: boolean;
  };
  cors: {
    enabled: boolean;
    origins: string[];
    credentials: boolean;
    methods: string[];
    allowedHeaders: string[];
    exposedHeaders: string[];
    maxAgeS: number;
  };
  headers: {
    enabled: boolean;
    hsts: boolean;
    hstsMaxAgeS: number;
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

/** Photo complète du firewall — miroir de `IFirewallDescription`. */
export interface FirewallDescription {
  configValid: boolean;
  configError: string | null;
  zones: FirewallZone[];
  authenticators: FirewallAuthenticator[];
  defenses: FirewallDefenses | null;
}

/** Un rôle + ses rôles hérités — miroir de `IRoleDescription`. */
export interface RoleDescription {
  role: string;
  inherits: string[];
}

/** Hiérarchie de rôles — miroir de `IRoleHierarchyDescription`. */
export interface RoleHierarchy {
  hierarchy: Record<string, string[]>;
  roles: RoleDescription[];
}

/** Endpoints du data plane sécurité consommés par la console Firewall. */
export const FIREWALL_ENDPOINT = "/nodefony/security/api/firewall";
export const ROLES_ENDPOINT = "/nodefony/security/api/roleHierarchy";
export const AUDIT_ENDPOINT = "/nodefony/security/api/audit/events";

/** Version de la doc de cette surface (badge des fiches `DocHint`). */
export const FIREWALL_DOC = "v1.0";

/**
 * Métadonnée d'affichage d'un authenticator builtin — label FR + rôle court +
 * teinte. String ouverte côté serveur (un plugin enregistre le sien) → fallback
 * sur le nom brut si inconnu.
 */
export interface AuthenticatorMeta {
  label: string;
  blurb: string;
  color: string;
}

export const AUTHENTICATOR_META: Record<string, AuthenticatorMeta> = {
  anonymous: {
    label: "Anonyme",
    blurb: "Accès non authentifié explicite (Zero Trust assoupli sur la zone).",
    color: "gray",
  },
  userpassword: {
    label: "Mot de passe",
    blurb: "Login identifiant + mot de passe (Argon2id, backoff NIST).",
    color: "blue",
  },
  session: {
    label: "Session BFF",
    blurb: "Cookie opaque révocable posé au login (web/Studio).",
    color: "cyan",
  },
  jwt: {
    label: "JWT Bearer",
    blurb: "Jeton signé (jose) — API service↔service / agents.",
    color: "grape",
  },
  apikey: {
    label: "Clé API (PAT)",
    blurb: "Bearer opaque révocable (style GitHub/Claude), hashé au repos.",
    color: "teal",
  },
  webauthn: {
    label: "Passkey",
    blurb: "WebAuthn/FIDO2 — MFA résistant au phishing (NIST AAL2).",
    color: "violet",
  },
};

/** Label FR d'un authenticator (ou son nom brut si inconnu). */
export function authenticatorLabel(name: string): string {
  return AUTHENTICATOR_META[name]?.label ?? name;
}

/** Nombre de défenses transverses actives (sur 4 : CSRF/CORS/headers/throttle). */
export function activeDefenseCount(d: FirewallDefenses | null): number {
  if (!d) return 0;
  let n = 0;
  if (d.csrf.enabled) n++;
  if (d.cors.enabled) n++;
  if (d.headers.enabled) n++;
  if (d.rateLimit.enabled) n++;
  return n;
}

/**
 * Traduit une erreur HTTP du data plane sécurité en message FR explicite
 * (vitrine honnête) — même classe d'erreurs que la console d'audit.
 */
export function describeFirewallError(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  if (status === 401) {
    return (
      "Non authentifié — votre session Studio a expiré ou n'est plus reconnue " +
      "par le firewall. Reconnectez-vous."
    );
  }
  if (status === 403) {
    return (
      "Accès refusé — l'introspection du firewall est réservée aux " +
      "administrateurs (ROLE_NODEFONY_ADMIN). Sécurisation réelle = P6."
    );
  }
  if (status === 503) {
    return "Firewall indisponible — service non monté dans le container.";
  }
  if (status === 404) {
    return "Endpoint introuvable — le module @nodefony/security n'est peut-être pas chargé.";
  }
  const msg = (e as { message?: string } | null)?.message;
  return msg
    ? `Erreur de chargement du firewall : ${msg}`
    : "Erreur de chargement de l'introspection du firewall.";
}
