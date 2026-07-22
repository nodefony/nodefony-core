import { PLATFORM_CHANNELS } from "nodefony";
/**
 * Modèle de la console auditeur (P6.15) — **types miroir** du contrat back
 * `@nodefony/security` (P6.14) + constantes d'affichage. Frontière isomorphe : on
 * NE référence JAMAIS le code serveur, on recopie le contrat (shape JSON stable).
 *
 * Source de vérité serveur : `security/nodefony/contracts/IAuditEvent.ts` +
 * `IAuditStore.ts`. Data plane consommé : `GET /nodefony/security/api/audit/events`.
 */

/**
 * Sous-système de sécurité concerné — MIROIR du contrat `@nodefony/security`
 * `IAuditEvent.ts` (`AuditCategory`, fermé : 11). Doit couvrir TOUTE valeur que le
 * backend peut émettre, sinon un événement arrive sans métadonnée de rendu.
 */
export type AuditCategory =
  | "auth"
  | "authz"
  | "token"
  | "session"
  | "oauth"
  | "webauthn"
  | "csrf"
  | "cors"
  | "ws"
  | "webhook"
  | "config";

/** Issue d'une action de sécurité. */
export type AuditOutcome = "success" | "failure" | "denied";

/** Drapeaux de **présence** de matériel sensible (jamais la valeur). */
export interface AuditEventFlags {
  hasAuthorization?: boolean;
  hasCookie?: boolean;
}

/**
 * Un événement de sécurité journalisé — miroir de `IAuditEvent` serveur. Un
 * secret n'y entre JAMAIS : seule la *présence* est tracée via {@link flags}.
 */
export interface AuditEvent {
  /** Identifiant unique (corrélation + curseur de pagination). */
  id: string;
  /** Horodatage (epoch ms). */
  ts: number;
  category: AuditCategory;
  /** Action conventionnée `<sujet>.<verbe>` (`"login.success"`…). String ouverte. */
  action: string;
  outcome: AuditOutcome;
  /** Acteur (identité) ou `null` si anonyme/pré-authentification. */
  actor: string | null;
  /** Ressource visée (zone, route, canal WS) — descripteur léger. */
  resource?: string | null;
  /** Raison **machine** filtrable (`"invalid_credentials"`, `"throttled"`…). */
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** Id de requête — corrélation log ↔ trace (saut vers la trace complète). */
  requestId?: string | null;
  flags?: AuditEventFlags;
  metadata?: Record<string, unknown>;
}

/**
 * Page de résultats — miroir du contrat de pagination **unique** de Nodefony
 * (`IPage<IAuditEvent>` côté serveur), du + récent au + ancien. Le journal
 * pagine par **curseur** : `nextCursor` est un jeton **opaque** que le client
 * repasse tel quel, il n'a pas à savoir ce qu'il transporte.
 */
export interface AuditPage {
  items: AuditEvent[];
  /** Total correspondant au filtre — absent si le serveur a sauté le comptage. */
  total?: number;
  /** Taille de page servie (écho du `limit` demandé). */
  limit: number;
  /** `true` s'il reste des événements plus anciens au-delà de cette page. */
  hasNext: boolean;
  /** Jeton de la page suivante (à repasser en `cursor`) ; `null` = fin. */
  nextCursor?: string | null;
}

/**
 * Canal WS du flux live d'audit (P6.14 lot 4) — miroir de `SECURITY_AUDIT_CHANNEL`
 * serveur. Plancher `ROLE_NODEFONY_ADMIN` (verrou de frame). ⚠️ Pas encore
 * atteignable depuis la socket Studio (`StudioRealtimeController` ignore les
 * canaux inconnus) : le front est PRÊT, le tuyau backend + garde RBAC = prérequis
 * (sécurisation de Studio, P6.15). Tant que muet → la console reste en consultation.
 */
export const SECURITY_AUDIT_CHANNEL = PLATFORM_CHANNELS.audit;

/**
 * Charge poussée sur `nodefony:audit` — miroir de `IAuditBatch` serveur : batch
 * coalescé (1 frame ~250 ms) + nombre d'événements omis sous surcharge (ring
 * borné). `dropped > 0` = pic d'événements (attaque ?) → afficher un récap.
 */
export interface AuditBatch {
  events: AuditEvent[];
  dropped: number;
}

/** Filtre serveur courant (sous-ensemble utile de `IAuditListQuery`). */
export interface AuditFilter {
  category?: AuditCategory;
  outcome?: AuditOutcome;
  actor?: string;
  action?: string;
  /** Fenêtre temporelle (preset) — convertie en `since` au moment du fetch. */
  period: AuditPeriod;
}

/** Presets de période (convertis en borne `since` epoch ms au fetch). */
export type AuditPeriod = "1h" | "24h" | "7d" | "all";

/** Nombre d'événements chargés par page (curseur). */
export const AUDIT_PAGE_SIZE = 100;

/** Métadonnée d'affichage d'une catégorie (label FR + teinte Mantine). */
export interface CategoryMeta {
  value: AuditCategory;
  label: string;
  color: string;
}

/**
 * Catégories affichées/filtrables — UNIQUEMENT celles qui ont un émetteur RÉEL
 * aujourd'hui (grep `record({ category: … })` côté `@nodefony/security`). Un filtre
 * qui ne rend JAMAIS rien induit en erreur (motif « affordance morte »), et une
 * catégorie qui émet mais manque ici s'affiche sans label ni couleur.
 *
 * `oauth` / `csrf` / `cors` / `config` sont au contrat (`IAuditEvent.ts`) mais
 * n'émettent encore aucun événement → volontairement absents ici. Les ré-ajouter au
 * moment où l'on câble leur émetteur (l'ordre suit le contrat).
 */
export const AUDIT_CATEGORIES: readonly CategoryMeta[] = [
  { value: "auth", label: "Authentification", color: "blue" },
  { value: "authz", label: "Autorisation", color: "indigo" },
  { value: "token", label: "Jetons", color: "grape" },
  { value: "session", label: "Session", color: "cyan" },
  { value: "webauthn", label: "Passkeys", color: "violet" },
  { value: "ws", label: "WebSocket", color: "pink" },
  { value: "webhook", label: "Webhooks", color: "orange" },
] as const;

/** Métadonnée d'affichage d'une issue (label FR + teinte). */
export interface OutcomeMeta {
  value: AuditOutcome;
  label: string;
  color: string;
}

/** Les 3 issues. `denied` (refus par politique) = le signal d'alerte auditeur. */
export const AUDIT_OUTCOMES: readonly OutcomeMeta[] = [
  { value: "success", label: "Succès", color: "teal" },
  { value: "failure", label: "Échec", color: "orange" },
  { value: "denied", label: "Refus", color: "red" },
] as const;

/**
 * Actions conventionnées émises aujourd'hui (table README §Audit). String
 * ouverte côté serveur (la liste grandit lot par lot) → cette liste alimente le
 * Select de filtre mais n'est PAS exhaustive par contrat.
 */
export const AUDIT_ACTIONS: readonly { value: string; label: string }[] = [
  { value: "login.success", label: "login.success — connexion réussie" },
  { value: "login.failure", label: "login.failure — connexion échouée" },
  { value: "login.throttled", label: "login.throttled — connexion freinée" },
  { value: "logout", label: "logout — déconnexion" },
  { value: "auth.failure", label: "auth.failure — credential invalide" },
  { value: "auth.throttled", label: "auth.throttled — backoff NIST" },
  { value: "auth.denied", label: "auth.denied — Zero Trust" },
  { value: "access.denied", label: "access.denied — refus voters/RBAC" },
  { value: "frame.denied", label: "frame.denied — verrou de frame WS" },
  { value: "token.issued", label: "token.issued — jeton émis" },
  {
    value: "token.reuse_detected",
    label: "token.reuse_detected — réutilisation",
  },
  { value: "apikey.created", label: "apikey.created — clé API créée" },
  { value: "apikey.revoked", label: "apikey.revoked — clé API révoquée" },
] as const;

/** Libellé FR des presets de période (UI). */
export const AUDIT_PERIODS: readonly { value: AuditPeriod; label: string }[] = [
  { value: "1h", label: "1 h" },
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 j" },
  { value: "all", label: "Tout" },
] as const;

/**
 * Convertit un preset de période en borne basse `since` (epoch ms), ou
 * `undefined` pour « tout » (pas de borne). Évalué au fetch (`now` courant).
 */
export function periodSince(
  period: AuditPeriod,
  now: number,
): number | undefined {
  switch (period) {
    case "1h":
      return now - 3_600_000;
    case "24h":
      return now - 86_400_000;
    case "7d":
      return now - 7 * 86_400_000;
    case "all":
      return undefined;
  }
}

/**
 * Sérialise un filtre + curseur en query string du data plane audit. Les clés
 * absentes ne sont pas filtrantes (AND côté serveur).
 */
export function buildAuditQuery(
  filter: AuditFilter,
  now: number,
  cursor?: string,
): string {
  const params = new URLSearchParams();
  if (filter.category) params.set("category", filter.category);
  if (filter.outcome) params.set("outcome", filter.outcome);
  if (filter.actor) params.set("actor", filter.actor);
  if (filter.action) params.set("action", filter.action);
  const since = periodSince(filter.period, now);
  if (since !== undefined) params.set("since", String(since));
  params.set("limit", String(AUDIT_PAGE_SIZE));
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}
