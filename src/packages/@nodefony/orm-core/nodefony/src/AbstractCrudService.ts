import { Service } from "nodefony";
import type {
  IRepository,
  Criteria,
  RepositoryReadOptions,
  IPage,
  PageQuery,
} from "../interfaces/index";
import { paginate } from "./paginate";
import type { ServiceWiring } from "./serviceWiring";

/**
 * Service CRUD **générique** — socle réutilisable au-dessus d'un {@link IRepository}.
 *
 * Toute entité (User, Article, Room...) expose son CRUD « toujours de la même
 * manière » en étendant cette classe : `class UserService extends
 * AbstractCrudService<IUser, IUserRepository>`. Le service est la **source de
 * vérité métier**, transport-agnostique : les adaptateurs (REST controller, WS
 * RPC, resolver GraphQL, commande CLI) l'appellent sans dupliquer la logique.
 *
 * Étend {@link Service} (DI, Syslog, bus d'événements) → instancié **une seule
 * fois** (singleton DI). C'est légitime car la classe est **stateless** : son
 * état d'instance ne porte que des invariants partagés (le `repository` injecté).
 * L'état par requête (utilisateur courant, tenant, transaction) vit dans le
 * `Context`/ALS, **jamais** dans un champ du service.
 *
 * **Perf** : les lectures (`find`/`findOne`/`findById`/`count`) délèguent
 * directement au repository — aucun hook ni event sur le chemin chaud. Les
 * mutations (`create`/`update`/`delete`) passent par les hooks template-method et
 * émettent un événement de cycle de vie (`onCreated`/`onUpdated`/`onDeleted`)
 * consommable pour l'audit, le cache, ou Studio.
 *
 * @typeParam T - type de l'entité gérée.
 * @typeParam R - type concret du repository (conserve les finders métier dans la
 *   sous-classe, ex. `IUserRepository`). Défaut : `IRepository<T>`.
 */
export abstract class AbstractCrudService<
  T,
  R extends IRepository<T> = IRepository<T>,
> extends Service {
  protected readonly repository: R;

  /**
   * @param name - identifiant logique du service (msgid des logs, clé d'abonnement events).
   * @param repository - source de persistance injectée (DI).
   * @param wiring - câblage Service ({@link ServiceWiring} : `container?`,
   *   `notificationsCenter?`, `options?`) — quasi toujours omis (fourni par le container DI).
   */
  constructor(name: string, repository: R, ...wiring: ServiceWiring) {
    super(name, ...wiring);
    this.repository = repository;
  }

  // ─── Lectures — délégation pure (hot path : aucun hook, aucun event) ────────

  /**
   * Liste les entités correspondant au critère (toutes si omis).
   *
   * @param criteria - filtre typé optionnel.
   * @param options - eager-load / pagination / tri portables.
   */
  find(criteria?: Criteria<T>, options?: RepositoryReadOptions): Promise<T[]> {
    return this.repository.find(criteria, options);
  }

  /**
   * Première entité correspondant au critère, ou `null`.
   *
   * @param criteria - filtre de sélection.
   * @param options - eager-load portable.
   */
  findOne(
    criteria: Criteria<T>,
    options?: RepositoryReadOptions,
  ): Promise<T | null> {
    return this.repository.findOne(criteria, options);
  }

  /**
   * Entité par clé primaire `id`, ou `null`.
   *
   * @remarks Suppose une PK nommée `id` (convention Nodefony : UUID `string`).
   * Override dans la sous-classe si la PK diffère.
   * @param id - identifiant primaire.
   * @param options - eager-load portable.
   */
  findById(id: string, options?: RepositoryReadOptions): Promise<T | null> {
    return this.repository.findOne({ id } as Criteria<T>, options);
  }

  /**
   * Compte les entités correspondant au critère (toutes si omis).
   *
   * @param criteria - filtre optionnel.
   */
  count(criteria?: Criteria<T>): Promise<number> {
    return this.repository.count(criteria);
  }

  /**
   * Liste **une page** d'entités — pagination **native** (jamais matérialiser
   * toute la collection). C'est la primitive à utiliser pour toute liste admin /
   * data plane : elle ne charge qu'une page en mémoire, quelle que soit la taille
   * de la table.
   *
   * @param page - requête de page ({@link PageQuery} : `limit` obligatoire,
   *   `offset`/`order`/`criteria`/`withTotal` optionnels).
   * @returns une {@link Page} : au plus `limit` items, `hasNext`, et `total` si demandé.
   */
  findPage(page: PageQuery<T>): Promise<IPage<T>> {
    return paginate(this.repository, page);
  }

  // ─── Mutations — hooks template-method + events de cycle de vie ─────────────

  /**
   * Crée une entité : `beforeCreate` → persistance → `afterCreate` → `onCreated`.
   *
   * @param data - champs de l'entité à créer.
   * @returns l'entité persistée. Émet `onCreated`.
   */
  async create(data: Partial<T>): Promise<T> {
    const prepared = await this.beforeCreate(data);
    const entity = await this.repository.create(prepared);
    await this.afterCreate(entity);
    this.fire("onCreated", entity);
    return entity;
  }

  /**
   * Met à jour **au plus une** entité : `beforeUpdate` → persistance atomique
   * → `afterUpdate` → `onUpdated`.
   *
   * S'appuie sur {@link IRepository.updateOne} (atomique, `RETURNING` /
   * `findOneAndUpdate`) : l'entité retournée reflète l'écriture, donc l'event
   * `onUpdated` part de façon fiable même quand le critère porte sur un champ
   * modifié (corrige le faux `null` de l'ancien `update` + relecture).
   *
   * `updateMany` (mise à jour en masse) n'est volontairement **pas** exposée
   * ici : c'est une primitive de niveau repository (`IRepository.updateMany`) —
   * on la remontera dans un service le jour où un usage métier la réclame.
   *
   * @param criteria - filtre de sélection (champ inconnu → `UnknownCriteriaField`).
   * @param data - champs à modifier.
   * @returns l'entité mise à jour, ou `null` si aucune ne correspond (pas d'event).
   */
  async updateOne(criteria: Criteria<T>, data: Partial<T>): Promise<T | null> {
    const prepared = await this.beforeUpdate(criteria, data);
    const updated = await this.repository.updateOne(criteria, prepared);
    if (updated !== null) {
      await this.afterUpdate(updated);
      this.fire("onUpdated", updated);
    }
    return updated;
  }

  /**
   * Supprime : `beforeDelete` → persistance → `afterDelete` → `onDeleted`.
   *
   * @param criteria - filtre de sélection.
   * @returns le nombre d'entités supprimées. Émet `onDeleted` (criteria, count)
   *   uniquement si au moins une ligne a été supprimée.
   */
  async delete(criteria: Criteria<T>): Promise<number> {
    await this.beforeDelete(criteria);
    const removed = await this.repository.delete(criteria);
    if (removed > 0) {
      await this.afterDelete(criteria, removed);
      this.fire("onDeleted", criteria, removed);
    }
    return removed;
  }

  // ─── Hooks (template method) — no-op par défaut, override pour le métier ────
  // Le `await` sur ces hooks dans les mutations est volontaire (un hook peut être
  // asynchrone) ; le surcoût d'une microtask sur un no-op synchrone est négligeable
  // devant le round-trip DB d'une écriture. Pas de hook sur les lectures (hot path).

  /**
   * Transforme/valide les données avant création (ex. hacher un mot de passe).
   *
   * @param data - données entrantes.
   * @returns les données préparées à persister.
   */
  protected beforeCreate(data: Partial<T>): Partial<T> | Promise<Partial<T>> {
    return data;
  }

  /** Effet de bord après création (ex. provisionner une ressource liée). */
  protected afterCreate(_entity: T): void | Promise<void> {}

  /**
   * Transforme/valide les données avant mise à jour.
   *
   * @param criteria - cible de la mise à jour.
   * @param data - données entrantes.
   * @returns les données préparées à persister.
   */
  protected beforeUpdate(
    _criteria: Criteria<T>,
    data: Partial<T>,
  ): Partial<T> | Promise<Partial<T>> {
    return data;
  }

  /** Effet de bord après mise à jour. */
  protected afterUpdate(_entity: T): void | Promise<void> {}

  /** Garde/validation avant suppression (ex. interdire la suppression du dernier admin). */
  protected beforeDelete(_criteria: Criteria<T>): void | Promise<void> {}

  /** Effet de bord après suppression (ex. nettoyer un cache). */
  protected afterDelete(
    _criteria: Criteria<T>,
    _removed: number,
  ): void | Promise<void> {}
}
