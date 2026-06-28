/**
 * Modèle d'un **événement de sécurité** auditable (P6.14) — login, refus d'accès,
 * émission/révocation de jeton, défense CSRF/CORS, verrou de frame WS. Vocabulaire
 * MÉTIER de sécurité, distinct du log technique du trafic (`AuditLogEntry`,
 * `@nodefony/http` P3.1, 1 PDU/requête) : ici on trace une **transition d'état**
 * de sécurité, pas chaque requête. Sérialisable JSON (stream WS + persistance).
 *
 * Règle d'or : un **secret n'entre JAMAIS** dans un événement (ni mot de passe, ni
 * jeton, ni cookie) — seule sa *présence* est tracée via {@link IAuditEvent.flags}.
 */

/**
 * Sous-système de sécurité concerné — axe de filtrage principal de la console
 * d'audit (Studio P6.15). Fermé : la liste des sous-systèmes est stable.
 */
export type AuditCategory =
  | "auth" // authentification (login/logout, chaîne du firewall)
  | "authz" // autorisation (accès accordé/refusé, voters, @IsGranted)
  | "token" // jetons longue durée (JWT refresh, PAT) émis/révoqués
  | "session" // cycle de vie de session (ouverture, régénération, destruction)
  | "oauth" // login social OAuth2 (authorize, callback, provisioning JIT)
  | "webauthn" // passkeys (enregistrement, assertion)
  | "csrf" // défense CSRF (Fetch-Metadata, token synchronizer)
  | "cors" // politique CORS (preflight rejeté)
  | "ws" // verrou de frame WebSocket (api.request / subscribe refusé)
  | "webhook" // webhook sortant (auto-désactivation après échecs répétés)
  | "config"; // mutation de config runtime depuis Studio (édition live admin)

/**
 * Issue d'une action de sécurité. La distinction `failure`/`denied` est utile à
 * l'auditeur : `failure` = l'acteur a échoué une preuve (brute-force, signature
 * invalide) ; `denied` = une **politique** a refusé un acteur même bien formé
 * (rôle manquant, origine interdite, plancher WS) — signal d'accès non autorisé.
 */
export type AuditOutcome =
  | "success" // l'action a abouti (login réussi, jeton émis)
  | "failure" // échec côté acteur (mauvais mot de passe, throttle, jeton invalide)
  | "denied"; // refus par une politique (Zero Trust, RBAC, CSRF, CORS)

/** Drapeaux de **présence** de matériel sensible (jamais la valeur). */
export interface IAuditEventFlags {
  /** Un en-tête `Authorization` était présent. */
  hasAuthorization?: boolean;
  /** Un cookie était présent. */
  hasCookie?: boolean;
}

/**
 * Un événement de sécurité journalisé. `id`/`ts` sont posés par l'`AuditService`
 * (l'émetteur ne fournit qu'un {@link IAuditEventDraft}) → un seul appel système
 * d'horodatage, centralisé hors des points d'émission.
 */
export interface IAuditEvent {
  /** Identifiant unique dans le process (corrélation + curseur de pagination). */
  id: string;
  /** Horodatage (epoch ms, `Date.now()`), posé par le service. */
  ts: number;
  /** Sous-système concerné — axe de filtrage principal. */
  category: AuditCategory;
  /**
   * Action conventionnée `<sujet>.<verbe>` (ex. `"login.success"`,
   * `"access.denied"`, `"token.revoked"`, `"session.opened"`). String **ouverte**
   * (la liste grandit lot par lot) — PAS un enum fermé, qui coupleraient
   * `IAuditEvent` à chaque point d'émission. Table de référence : README §Audit.
   */
  action: string;
  /** Issue de l'action. */
  outcome: AuditOutcome;
  /**
   * Acteur : identité (`token.getUserIdentifier()`) ou `null` si anonyme/non
   * identifié (tentative pré-authentification). Un **libellé d'identité**, jamais
   * un secret.
   */
  actor: string | null;
  /**
   * Ressource visée (zone firewall, route, canal WS, attribut d'autorisation) —
   * descripteur léger ; jamais le corps ni les en-têtes de la requête.
   */
  resource?: string | null;
  /**
   * Raison **machine** stable et filtrable (ex. `"invalid_credentials"`,
   * `"throttled"`, `"veto"`, `"origin_mismatch"`) — PAS un message libre traduit.
   */
  reason?: string | null;
  /** IP source si disponible (audit « from where »). */
  ip?: string | null;
  /** User-Agent source si disponible. */
  userAgent?: string | null;
  /** Id de requête (corrélation log ↔ audit via l'ALS, P1.4) ; `null` hors requête. */
  requestId?: string | null;
  /**
   * **Présence** (jamais la valeur) de matériel sensible au moment de l'événement
   * — calque `AuditLogEntry.hasAuthorization`. Trace « un cookie / un Authorization
   * était là » sans jamais journaliser le secret lui-même.
   */
  flags?: IAuditEventFlags;
  /** Extras applicatifs libres (anti-migration) ; absents par défaut. */
  metadata?: Record<string, unknown>;
}

/**
 * Champs fournis par l'**émetteur** d'un événement — l'`AuditService` y ajoute
 * `id` + `ts`. Garde les points d'émission concis et sans appel système d'horloge.
 */
export type IAuditEventDraft = Omit<IAuditEvent, "id" | "ts">;
