import type {
  AuditCategory,
  AuditOutcome,
  IAuditEvent,
  IAuditEventDraft,
} from "./IAuditEvent";

/**
 * Filtre de lecture du journal d'audit (console Studio P6.15, data plane P6.14
 * Lot 3). Tous les critères sont **AND** ; absents = non filtrant. Pagination par
 * **curseur** (`before` = id), du plus récent au plus ancien.
 */
export interface IAuditQuery {
  /** Restreint à un sous-système. */
  category?: AuditCategory;
  /** Restreint à une issue (`success`/`failure`/`denied`). */
  outcome?: AuditOutcome;
  /** Restreint à un acteur (égalité exacte de l'identifiant). */
  actor?: string;
  /** Restreint à une action conventionnée (`"login.success"`…). */
  action?: string;
  /** Restreint aux événements d'une **requête** (corrélation trace ↔ audit, P6.15). */
  requestId?: string;
  /** Borne basse d'horodatage (epoch ms, inclus). */
  since?: number;
  /** Borne haute d'horodatage (epoch ms, inclus). */
  until?: number;
  /** Taille de page (bornée par l'implémentation). */
  limit?: number;
  /** Curseur : ne renvoyer que les événements **plus anciens** que cet id. */
  before?: string;
}

/** Page de résultats d'audit, du plus récent au plus ancien. */
export interface IAuditQueryResult {
  /** Événements de la page (ordre décroissant : le plus récent d'abord). */
  events: IAuditEvent[];
  /** Curseur de la page suivante (passer en `before`) ; `null` = fin. */
  nextBefore: string | null;
  /** Total d'événements correspondant au filtre (hors pagination). */
  total: number;
}

/**
 * Journal d'audit **append-only** (tamper-evident) — état serveur des événements
 * de sécurité. **Pluggable** par backend (mémoire/fichier/ORM/Loki) comme
 * `ITokenStore`. La référence mémoire borne le volume (anti-fuite) ; un backend
 * partagé (ORM/Redis) sert le multi-pod et la rétention longue.
 *
 * `append` est la SEULE écriture : pas d'`update` ni de `delete` ciblé — seul le
 * `gc` (rétention) retire des entrées. L'immuabilité est la garantie d'audit.
 */
export interface IAuditStore {
  /** Ajoute un événement (immuable, jamais modifié ensuite). */
  append(event: IAuditEvent): Promise<void>;
  /** Lit une page d'événements filtrés (du plus récent au plus ancien). */
  query(filter?: IAuditQuery): Promise<IAuditQueryResult>;
  /**
   * Purge les événements au-delà de la fenêtre de rétention. À planifier
   * périodiquement par le propriétaire du store (timer `unref`). Sans appel, un
   * backend sans TTL natif s'accumule jusqu'à sa borne de volume.
   *
   * @returns nombre d'événements purgés.
   */
  gc(now?: number): Promise<number>;
}

/**
 * Face **émission** du journal, vue par les points sensibles (firewall,
 * authenticators, controllers OAuth/WebAuthn). `record` est **synchrone et
 * fire-and-forget** : l'audit ne doit JAMAIS bloquer ni faire échouer le flux
 * métier (un store en panne se solde par un log d'erreur, pas par un login KO).
 * No-op à coût nul si l'audit est désactivé.
 */
export interface IAuditSink {
  /**
   * Journalise un événement : pose `id`+`ts`, persiste (best-effort) et notifie
   * les abonnés live. Aucun effet (aucune allocation côté service) si désactivé.
   */
  record(event: IAuditEventDraft): void;
  /**
   * S'abonne au flux live des événements (bridge WS, P6.14 Lot 4). Renvoie une
   * fonction de désabonnement (cleanup obligatoire — pas de listener orphelin).
   */
  subscribe(listener: (event: IAuditEvent) => void): () => void;
}
