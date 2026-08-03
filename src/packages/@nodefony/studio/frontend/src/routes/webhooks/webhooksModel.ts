/**
 * Modèle de la console **Webhooks sortants** (P6.13 Slice C) — **types miroir**
 * du contrat back `@nodefony/security` (frontière isomorphe : on recopie la shape
 * JSON, le secret chiffré est exclu par construction, jamais d'import runtime
 * serveur) + endpoints, statut de livraison dérivé, mapping d'erreur, formatage
 * et catalogue d'événements.
 *
 * Portée UNIQUE = **administration plateforme** (`ROLE_NODEFONY_ADMIN`) : un
 * webhook est une mécanique de sécurité système, pas une ressource par-user. Le
 * data plane est monté par `SecurityAdminApi` (broker admin) sous le namespace
 * `security` → PAS de sous-préfixe `admin` : `/nodefony/security/api/webhooks`.
 *
 * Source de vérité serveur : `security/nodefony/contracts/IWebhookEndpoint.ts`
 * + `security/nodefony/src/admin/WebhookAdminApi.ts`.
 */

/**
 * Vue publique d'un endpoint webhook — miroir de `WebhookEndpointSummary`
 * (= `IWebhookEndpoint` SANS `secretEnc`). Le secret de signature n'est JAMAIS
 * lu ici : il n'est exposé en clair qu'à la création/rotation/révélation.
 */
export interface WebhookEndpoint {
  /** Identifiant public stable (`wh_<random>`). */
  id: string;
  /** URL de destination (validée anti-SSRF à l'enregistrement). */
  url: string;
  /** Actions d'audit souscrites (`"*"` = toutes). La livraison ne part que si l'action matche. */
  events: string[];
  /** Endpoint actif ? (désactivé = aucune livraison ; auto-désactivé après trop d'échecs). */
  enabled: boolean;
  /** Libellé humain optionnel. */
  description: string | null;
  /** Slot multi-tenant (réservé P17) — `null` = global. */
  tenantId: string | null;
  /** Identité de l'admin créateur (soft ref, traçabilité). */
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  /** Dernière tentative de livraison (epoch ms) ou `null` (jamais livré). */
  lastDeliveryAt: number | null;
  /** Code HTTP de la dernière livraison, ou `null` (jamais livré / erreur réseau). */
  lastDeliveryStatus: number | null;
  /** Message d'erreur de la dernière livraison, ou `null`. */
  lastDeliveryError: string | null;
  /** Échecs consécutifs (auto-désactivation au-delà du seuil, façon GitHub). */
  failureCount: number;
  /** Métadonnées extensibles (jamais de secret). */
  metadata: Record<string, unknown>;
}

/** Révélation d'un secret (création / rotation) — clair exposé une seule fois. */
export interface WebhookSecretReveal {
  endpoint: WebhookEndpoint;
  /** Secret de signature EN CLAIR (`whsec_…`) — disponible une seule fois. */
  secret: string;
}

/**
 * Réponse de la liste — miroir du handler `GET webhooks` (`WebhookAdminApi`) :
 * l'état du sous-système (« où on écrit ») + les endpoints. Lecture DÉFENSIVE
 * côté serveur (jamais de 503) → la console affiche toujours un badge honnête
 * et une table, même webhooks désactivés (→ `endpoints` vide).
 */
export interface WebhookListResponse {
  /** Webhooks activés en config (`webhooks.enabled`) ET service prêt. */
  enabled: boolean;
  /** Driver déduit du store (`memory`/`orm`), `null` si indéterminable. */
  driver: WebhookDriver;
  /** Classe réelle du store (ex. `DrizzleWebhookStore`), `none` si absent. */
  store: string;
  /**
   * **LA page** d'endpoints (pagination serveur, native au store) — jamais le
   * registre entier. Compter cette liste ne donne donc PAS le nombre total
   * d'endpoints : c'est `total` qui fait foi.
   */
  endpoints: WebhookEndpoint[];
  /** Total exact côté serveur (absent si le backend ne sait pas compter). */
  total?: number;
  /** Taille de page appliquée par le serveur (défaut 50, cap 200). */
  limit: number;
  /** Décalage de cette page (mode offset). */
  offset?: number;
  /** Jeton de page suivante (mode curseur) ; `null` = fin. */
  nextCursor?: string | null;
}

/** Driver logique du backend webhook (miroir du badge « où on écrit » Studio). */
export type WebhookDriver = "memory" | "orm" | null;

/**
 * Trace d'une livraison (historique « récentes ») — miroir de `IWebhookDelivery` :
 * ce que Nodefony a ENVOYÉ à l'endpoint + la réponse observée. RAM par pod.
 */
export interface WebhookDelivery {
  ts: number;
  messageId: string;
  type: string;
  attempt: number;
  ok: boolean;
  status: number | null;
  error: string | null;
  durationMs: number;
  /** Corps JSON envoyé (enveloppe `{id,timestamp,type,data}`), tronqué. */
  requestBody: string;
  /** Début du corps de réponse du destinataire (tronqué), ou `null`. */
  responseBody: string | null;
}

// ─── Endpoints du data plane ─────────────────────────────────────────────────

/** Base du data plane webhooks (broker `security`, RBAC `ROLE_NODEFONY_ADMIN`). */
export const WEBHOOKS_ENDPOINT = "/nodefony/security/api/webhooks";

/**
 * GET — **compteurs de tête**, posés par le serveur sur le registre ENTIER.
 *
 * Endpoint distinct de la liste : ces nombres ne dépendent ni de la fenêtre ni
 * de l'ordre, on ne les recharge donc qu'au montage, au changement de filtre et
 * après une mutation.
 */
export const WEBHOOKS_STATS_ENDPOINT = `${WEBHOOKS_ENDPOINT}/stats`;

/** PATCH/DELETE/GET sur un endpoint par id. */
export function webhookEndpoint(id: string): string {
  return `${WEBHOOKS_ENDPOINT}/${encodeURIComponent(id)}`;
}
/** POST — régénère le secret de signature (rotation), nouveau secret 1×. */
export function webhookRotateEndpoint(id: string): string {
  return `${webhookEndpoint(id)}/rotate`;
}
/** POST — révèle le secret de signature en clair (action sensible, auditée). */
export function webhookRevealEndpoint(id: string): string {
  return `${webhookEndpoint(id)}/reveal`;
}
/** GET — historique des dernières livraisons d'un endpoint (ce qui a été envoyé). */
export function webhookDeliveriesEndpoint(id: string): string {
  return `${webhookEndpoint(id)}/deliveries`;
}

/** Version de la doc de cette surface (badge des fiches `DocHint`). */
export const WEBHOOKS_DOC = "v1.0";

/** Rôle requis (admin plateforme) — source unique `auth/roles`. */
export { ROLE_NODEFONY_ADMIN as ADMIN_ROLE } from "../../auth/roles";

// ─── Catalogue d'événements souscriptibles ───────────────────────────────────

/** Joker = toutes les actions d'audit (sauf la catégorie `webhook`, anti-boucle). */
export const WILDCARD_EVENT = "*";

/** Un groupe d'événements souscriptibles (formulaire de création/édition). */
export interface WebhookEventGroup {
  /** Domaine fonctionnel (en-tête de groupe). */
  domain: string;
  events: { value: string; label: string }[];
}

/**
 * Catalogue **curé** des événements d'audit souscriptibles, groupés par domaine.
 * Un webhook s'abonne à une **action d'audit** (`<sujet>.<verbe>`) : tout
 * `auditService.record({ action })` du serveur est livrable. Cette liste suit
 * `audit/auditModel.AUDIT_ACTIONS` mais reste **non exhaustive par contrat** (le
 * champ libre complète) — et **exclut volontairement la catégorie `webhook.*`**
 * (garde anti-boucle du dispatcher : un event webhook ne déclenche pas de
 * webhook). Évolution future = catalogue **découvert du code** (calque des
 * scopes `@RequireScope` → `declaredScopes`), cf bus d'événements métier.
 */
export const WEBHOOK_EVENT_CATALOGUE: readonly WebhookEventGroup[] = [
  {
    domain: "Authentification",
    events: [
      { value: "login.success", label: "login.success — connexion réussie" },
      { value: "login.failure", label: "login.failure — connexion échouée" },
      {
        value: "login.throttled",
        label: "login.throttled — connexion freinée",
      },
      { value: "logout", label: "logout — déconnexion" },
      { value: "auth.failure", label: "auth.failure — credential invalide" },
      { value: "auth.throttled", label: "auth.throttled — backoff NIST" },
      { value: "auth.denied", label: "auth.denied — Zero Trust" },
    ],
  },
  {
    domain: "Autorisation",
    events: [
      { value: "access.denied", label: "access.denied — refus voters/RBAC" },
      { value: "frame.denied", label: "frame.denied — verrou de frame WS" },
    ],
  },
  {
    domain: "Jetons & clés",
    events: [
      { value: "token.issued", label: "token.issued — jeton émis" },
      {
        value: "token.reuse_detected",
        label: "token.reuse_detected — réutilisation détectée",
      },
      { value: "apikey.created", label: "apikey.created — clé API créée" },
      { value: "apikey.revoked", label: "apikey.revoked — clé API révoquée" },
    ],
  },
] as const;

/** Tous les events du catalogue (à plat) — pour discriminer catalogue ↔ libre. */
export const CATALOGUE_EVENTS: readonly string[] =
  WEBHOOK_EVENT_CATALOGUE.flatMap((g) => g.events.map((e) => e.value));

// ─── Statut de livraison dérivé (le DTO ne porte pas de champ « status ») ─────

export type DeliveryHealth = "never" | "ok" | "failing";

/**
 * Santé de la dernière livraison, dérivée de `lastDelivery*`/`failureCount` :
 *  - `never`   : jamais livré (aucune tentative).
 *  - `ok`      : dernière réponse 2xx ET 0 échec consécutif.
 *  - `failing` : dernière réponse ≥ 400 / erreur réseau, ou échecs en cours.
 */
export function deliveryHealth(ep: WebhookEndpoint): DeliveryHealth {
  if (ep.lastDeliveryAt === null) return "never";
  if (ep.failureCount > 0) return "failing";
  const s = ep.lastDeliveryStatus;
  if (s !== null && s >= 200 && s < 300) return "ok";
  return "failing";
}

/**
 * Compteurs de tête — miroir de ce que rend `webhooks/stats`.
 *
 * `null` = le backend ne sait pas compter, ou les webhooks sont coupés ; se rend
 * « — » à l'écran. Un `0` se lirait « aucun endpoint configuré », ce qui est une
 * information, alors qu'on n'en a aucune.
 *
 * Les populations se **recoupent** : un endpoint peut être actif ET en échec.
 * Aucune n'est donc déduite d'une autre par soustraction.
 */
export interface WebhookCounts {
  total: number | null;
  /** Actifs (enabled). */
  active: number | null;
  /** En échec (au moins un échec consécutif courant), actifs ou non. */
  failing: number | null;
  /** Désactivés (enabled = false, dont auto-désactivés). */
  disabled: number | null;
}

/**
 * Compte sur les endpoints REÇUS.
 *
 * ⚠️ Ne subsiste que comme repli tant que la réponse n'est pas fenêtrée ; la
 * vue consomme `webhooks/stats`. Compter la page en la présentant comme le
 * registre est exactement le mensonge que cet endpoint corrige.
 */
export function countWebhooks(endpoints: WebhookEndpoint[]): WebhookCounts {
  // Accumulateurs locaux : la forme rendue admet `null` (« le backend ne sait
  // pas »), mais un comptage local sait toujours — il n'a rien à ignorer.
  let active = 0;
  let disabled = 0;
  let failing = 0;
  for (const ep of endpoints) {
    if (ep.enabled) active++;
    else disabled++;
    if (ep.failureCount > 0) failing++;
  }
  return { total: endpoints.length, active, disabled, failing };
}

// ─── Validation de formulaire (le back re-valide anti-SSRF — ceci = garde-fou UX) ─

/**
 * Valide une URL de destination côté client (garde-fou UX, pas la sécurité — le
 * serveur applique `assertPublicUrl` anti-SSRF). Renvoie un message FR ou `null`.
 */
export function validateWebhookUrl(raw: string): string | null {
  const url = raw.trim();
  if (url.length === 0) return "L'URL de destination est requise.";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "URL invalide (ex. https://example.com/hooks/nodefony).";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "Seules les URL http(s) sont acceptées.";
  }
  return null;
}

// ─── Formatage ───────────────────────────────────────────────────────────────

/** Date absolue lisible (ou « — » si nulle). */
export function fmtDate(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Âge relatif en clair (paliers — jamais de churn ms↔s) : « à l'instant » /
 * « il y a … » ; `null` → « Jamais ».
 */
export function fmtSince(ms: number | null, now: number = Date.now()): string {
  if (ms === null) return "Jamais";
  const sec = Math.floor((now - ms) / 1000);
  if (sec < 5) return "À l'instant";
  if (sec < 60) return `Il y a ${sec} s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `Il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `Il y a ${d} j`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `Il y a ${mo} mois`;
  return `Il y a ${Math.floor(mo / 12)} an(s)`;
}

/**
 * Traduit une erreur HTTP du data plane webhooks en message FR explicite
 * (vitrine honnête) — même classe que les autres consoles Sécurité.
 */
export function describeWebhooksError(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  if (status === 401) {
    return (
      "Non authentifié — votre session Studio a expiré ou n'est plus reconnue " +
      "par le firewall. Reconnectez-vous."
    );
  }
  if (status === 403) {
    return (
      "Accès refusé — la gestion des webhooks est réservée aux administrateurs " +
      "plateforme (ROLE_NODEFONY_ADMIN)."
    );
  }
  if (status === 422) {
    // SSRF : l'URL pointe vers une cible privée/interdite (anti-rebinding).
    const msg = (e as { message?: string } | null)?.message;
    return msg
      ? `URL refusée : ${msg}`
      : "URL refusée — cible privée/interne interdite (protection anti-SSRF).";
  }
  if (status === 400) {
    const msg = (e as { message?: string } | null)?.message;
    return msg ? `Requête invalide : ${msg}` : "Requête invalide.";
  }
  if (status === 503) {
    return (
      "Webhooks indisponibles — désactivés en config sécurité " +
      "(webhooks.enabled = false) ou store non provisionné."
    );
  }
  if (status === 404) {
    return "Endpoint introuvable — il a peut-être été supprimé entre-temps.";
  }
  const msg = (e as { message?: string } | null)?.message;
  return msg
    ? `Erreur de chargement des webhooks : ${msg}`
    : "Erreur de chargement des webhooks.";
}
