import type { IPage, IPageQuery, ISortableSource } from "nodefony";
import type {
  IWebhookEndpoint,
  WebhookEndpointUpdate,
} from "./IWebhookEndpoint";

/**
 * Requête de **listing paginé** d'endpoints webhook (data plane admin) — le
 * contrat de page standard du core ({@link IPageQuery}) enrichi des filtres
 * propres aux endpoints.
 *
 * `q` (hérité) = sous-chaîne **insensible à la casse** cherchée dans `url` **ou**
 * `description` — la question posée par un humain devant la console (« où part
 * mon webhook stripe ? ») porte sur ces deux champs, jamais sur l'id.
 */
export interface IWebhookListQuery extends IPageQuery {
  /** `true` = actifs seulement, `false` = désactivés seulement, omis = les deux. */
  enabled?: boolean;
  /**
   * Ne garder que les endpoints **abonnés à cet événement** (appartenance au
   * tableau `events`). Répond à la question d'exploitation « qui écoute
   * `user.created` ? ». Non portable au `Criteria` générique (containment dans un
   * tableau JSON) → chaque backend l'implémente nativement.
   */
  event?: string;
}

/**
 * Persistance des **endpoints webhook** (configuration durable, pas un cache).
 * Backend interchangeable (Memory dev/test · Drizzle SQL · Mongoose) via le
 * registre {@link ../src/webhook/webhookStoreRegistry}. **Redis n'est PAS un
 * store d'endpoints** (config durable ≠ éphémère) — il servira la *queue de
 * livraison* cross-pod (slice cluster), pas ce contrat.
 *
 * Volume attendu : faible (dizaines d'endpoints), lecture fréquente par le
 * dispatcher (qui en garde un snapshot mémoire), écriture rare (CRUD admin).
 */
export interface IWebhookStore extends ISortableSource {
  // `sortableFields` vient d'`ISortableSource` (core) : la FORME de la capacité
  // s'écrit une fois pour toutes les ressources. Ici, seul le vocabulaire est
  // propre aux endpoints — `WEBHOOK_SORTABLE_FIELDS` (`../src/webhook/webhookSort`).

  /** Insère un nouvel endpoint. */
  save(endpoint: IWebhookEndpoint): Promise<void>;
  /** Charge un endpoint par id, ou `null`. */
  findById(id: string): Promise<IWebhookEndpoint | null>;
  /** Applique un patch partiel (champs mutables) ; no-op si id absent. */
  update(id: string, patch: WebhookEndpointUpdate): Promise<void>;
  /** Supprime un endpoint ; no-op si id absent. */
  delete(id: string): Promise<void>;
  /**
   * **Tous** les endpoints — réservé au **snapshot du dispatcher** (le service
   * garde en mémoire la table complète des abonnements pour router un événement
   * sans I/O, et la recharge au boot puis après chaque écriture CRUD).
   *
   * ⚠️ Énumération complète assumée **par conception** ici : le dispatcher doit
   * connaître TOUS les abonnements pour ne pas rater une livraison. C'est un
   * cold-path (boot + CRUD admin), jamais une requête d'affichage. Pour lister
   * dans une console, utiliser {@link IWebhookStore.listPage}.
   */
  listAll(): Promise<IWebhookEndpoint[]>;
  /**
   * Liste **paginée** d'endpoints pour le data plane admin — ne matérialise
   * jamais plus d'une page, filtres {@link IWebhookListQuery} appliqués **au
   * store** (jamais après un chargement complet).
   *
   * Ordre par défaut : `createdAt` DESC (le plus récent d'abord), départagé par
   * `id` ASC — sans ce tiebreaker deux endpoints créés dans la même milliseconde
   * pourraient changer de page entre deux appels et l'un d'eux ne jamais
   * apparaître. Un `order` explicite le remplace, dans la limite de
   * {@link IWebhookStore.sortableFields} ; il s'applique **avant** le découpage
   * en pages, jamais sur la tranche déjà extraite.
   */
  listPage(query: IWebhookListQuery): Promise<IPage<IWebhookEndpoint>>;
  /**
   * Nombre d'endpoints correspondant aux filtres (`COUNT` natif) — base du
   * `total` d'une page et des compteurs de la console.
   *
   * @returns le compte exact ; `-1` si le backend ne sait pas compter à coût
   *   raisonnable (« je ne sais pas » explicite, jamais un total inventé).
   */
  countEndpoints(query: IWebhookListQuery): Promise<number>;
}
