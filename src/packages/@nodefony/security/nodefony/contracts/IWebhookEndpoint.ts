/**
 * Endpoint webhook sortant — une **destination** que Nodefony notifie quand un
 * événement souscrit survient (modèle façon GitHub/Stripe).
 *
 * Le `secret` de signature est **chiffré au repos** (réversible, AES-256-GCM) :
 * contrairement à une clé API (hachée, vérifiée seulement), le serveur doit le
 * **relire** pour signer chaque livraison (HMAC). Le clair n'est jamais stocké,
 * seulement {@link secretEnc} (blob opaque).
 */
export interface IWebhookEndpoint {
  /** Identifiant public stable (`wh_<random>`). */
  readonly id: string;
  /** URL de destination (validée anti-SSRF à l'enregistrement). */
  readonly url: string;
  /** Secret de signature **chiffré** au repos (blob `gcm1.…`). Jamais en clair. */
  readonly secretEnc: string;
  /**
   * Actions d'audit souscrites (ex. `"login.success"`, `"user.created"`).
   * `"*"` = toutes. La livraison ne part que si l'action de l'événement matche.
   */
  readonly events: readonly string[];
  /** Endpoint actif ? (désactivé = aucune livraison). */
  readonly enabled: boolean;
  /** Libellé humain optionnel (console admin). */
  readonly description: string | null;
  /** Slot multi-tenant (réservé P17) — `null` = global. */
  readonly tenantId: string | null;
  /** Identité de l'admin créateur (soft ref, traçabilité). */
  readonly createdBy: string | null;
  /** Création (epoch ms). */
  readonly createdAt: number;
  /** Dernière modification (epoch ms). */
  readonly updatedAt: number;
  /** Dernière tentative de livraison (epoch ms) ou `null`. */
  readonly lastDeliveryAt: number | null;
  /** Code HTTP de la dernière livraison, ou `null` (jamais livré / erreur réseau). */
  readonly lastDeliveryStatus: number | null;
  /** Message d'erreur de la dernière livraison, ou `null`. */
  readonly lastDeliveryError: string | null;
  /** Échecs consécutifs (auto-désactivation au-delà d'un seuil, façon GitHub). */
  readonly failureCount: number;
  /** Métadonnées extensibles (jamais de secret). */
  readonly metadata: Record<string, unknown>;
}

/**
 * Champs mutables d'un endpoint (PATCH). `id`/`createdAt`/`createdBy`/`tenantId`
 * sont immuables après création.
 */
export type WebhookEndpointUpdate = Partial<
  Pick<
    IWebhookEndpoint,
    | "url"
    | "secretEnc"
    | "events"
    | "enabled"
    | "description"
    | "updatedAt"
    | "lastDeliveryAt"
    | "lastDeliveryStatus"
    | "lastDeliveryError"
    | "failureCount"
    | "metadata"
  >
>;

/**
 * Vue **publique** d'un endpoint (DTO console admin) — **sans** le secret
 * chiffré. Le secret en clair n'est renvoyé qu'une fois, à la création/rotation.
 */
export type WebhookEndpointSummary = Omit<IWebhookEndpoint, "secretEnc">;
