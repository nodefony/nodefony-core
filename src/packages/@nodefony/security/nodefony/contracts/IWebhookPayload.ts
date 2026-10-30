/**
 * Corps JSON d'une livraison webhook, tel que le destinataire le reçoit — le type à poser sur le `JSON.parse` du récepteur.
 *
 * Signé avec ses en-têtes (`webhook-id`, `webhook-timestamp`, `webhook-signature`,
 * convention Standard Webhooks) : vérifier la signature AVANT de lire le corps.
 *
 * @typeParam T - la forme de `data` ; `unknown` tant que le récepteur ne l'a pas vérifiée.
 */
export interface IWebhookPayload<T = unknown> {
  /**
   * Identifiant du MESSAGE, égal à l'en-tête `webhook-id` et stable d'un réessai à l'autre : la clé de déduplication du récepteur.
   */
  readonly id: string;
  /**
   * Heure de la TENTATIVE de livraison (ISO 8601), pas celle de l'événement : un réessai porte une heure plus tardive.
   *
   * L'heure de l'événement vit dans `data` (`ts` pour un événement d'audit).
   */
  readonly timestamp: string;
  /** Nom de l'événement — l'action d'audit, ex. `"login.success"` ; c'est lui que filtrent les motifs d'abonnement. */
  readonly type: string;
  /** L'événement lui-même ; pour l'audit, un `IAuditEvent`. */
  readonly data: T;
}
