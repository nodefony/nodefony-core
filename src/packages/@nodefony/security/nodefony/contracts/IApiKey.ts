/**
 * Vue **publique** d'une clé API (PAT) — projection de `IAccessTokenRecord`
 * **sans le secret ni son hash** (jamais exposés après création). C'est la forme
 * renvoyée par la console (« mes clés ») et le data plane Studio.
 */
export interface IApiKeyView {
  /** Identifiant public de la clé (révocation, affichage). */
  id: string;
  /** Préfixe public affichable (`<prefix>_<pubid>`, ex. `nf_a1b2c3d4`). */
  prefix: string | null;
  /** Libellé humain (« CI deploy », « app mobile »). */
  name: string;
  /** Capacités accordées (axe distinct des rôles RBAC). */
  scopes: string[];
  /** Porteur (id utilisateur ou service account). */
  subjectId: string;
  /** Discriminant du porteur. */
  subjectType: "user" | "service";
  /** Organisation/tenant (`null` = global). */
  tenantId: string | null;
  /** Création (epoch ms). */
  createdAt: number;
  /** Expiration (epoch ms) ou `null` (sans expiration). */
  expiresAt: number | null;
  /** Dernier usage (epoch ms) ou `null` (jamais utilisée). */
  lastUsedAt: number | null;
  /** Révocation (epoch ms) ou `null` (active). */
  revokedAt: number | null;
}

/**
 * Résultat d'une **création** de clé — la vue publique **+ le token en clair**.
 * Le `token` n'est disponible qu'ICI, une seule fois : il n'est jamais stocké
 * (seul son `sha256` l'est) ni re-dérivable. La console l'affiche puis l'oublie.
 */
export interface IApiKeyCreated extends IApiKeyView {
  /** Secret EN CLAIR — affiché UNE seule fois (RFC : « shown once »). */
  token: string;
}

/**
 * Capacités/contraintes d'émission des clés API — exposées à la console (« Mes
 * clés ») pour un formulaire de création **honnête** : plafond par porteur,
 * catalogue de scopes, préfixe public, durée par défaut. **Aucune valeur
 * sensible** (config publique : le préfixe figure déjà dans chaque clé).
 */
export interface IApiKeyCapabilities {
  /** Émission de clés activée en config (`apiKeys.enabled`). */
  enabled: boolean;
  /** Marqueur public des clés (`<prefix>_…`, ex. `nf`). */
  prefix: string;
  /** Expiration par défaut en jours (`null` = sans expiration). */
  defaultExpiryDays: number | null;
  /** Plafond de clés ACTIVES par porteur (création au-delà → 409). */
  maxPerSubject: number;
  /** Catalogue de scopes autorisés (`null` = libre : tout scope non vide accepté). */
  allowedScopes: string[] | null;
}

/** Options de création d'une clé API. */
export interface ICreateApiKeyOptions {
  /** Libellé humain (obligatoire, non vide). */
  name: string;
  /** Capacités demandées (⊆ `apiKeys.allowedScopes` si un catalogue est défini). */
  scopes?: string[];
  /** Durée de vie en jours ; `null` = sans expiration ; omis = défaut config. */
  expiresInDays?: number | null;
  /** Tenant/organisation (multi-tenant) ; `null` = global. */
  tenantId?: string | null;
}
