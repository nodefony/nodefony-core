import { randomUUID } from "node:crypto";
import type { Criteria, ITransaction } from "@nodefony/orm-core";
import { assertPageQuery, compareByOrder } from "nodefony";
import type { IPage } from "nodefony";
import { BaseUser } from "./BaseUser";
import type { IBaseUserOptions } from "./BaseUser";
import type {
  IPasswordAuthenticatedUser,
  ISocialProvider,
  IUserListQuery,
  IUserRepository,
} from "../contracts/index";
import { USER_SORTABLE_FIELDS_IN_MEMORY, USER_DEFAULT_ORDER } from "./userSort";

/**
 * Annuaire d'utilisateurs **en mémoire** — implémentation de référence du contrat
 * {@link IUserRepository} sur une `Map` (aucun ORM).
 *
 * Trois usages :
 * - **tests de charge** : zéro I/O (pas de sync SQLite) → la mesure n'est pas
 *   polluée par la persistance ;
 * - **scripts / tests manuels** : démarrer sans base de données ;
 * - **fixture de banc** déterministe (l'état est reconstruit à chaque boot).
 *
 * La persistance réelle (`@nodefony/drizzle` / `@nodefony/mongoose`) prend ce rôle
 * en application — **même contrat, zéro changement en aval** (`UserService`,
 * authenticators). Branché sous `UserService` comme n'importe quel repository.
 */
export class InMemoryUserRepository implements IUserRepository {
  readonly #store = new Map<string, BaseUser>();

  /**
   * Capacité RÉELLE de cet annuaire : `BaseUser` ne porte ni `createdAt` ni
   * `updatedAt`, donc ils ne sont pas annoncés. Le data plane refuse alors ces
   * champs en 400 au lieu de rendre un ordre arbitraire.
   */
  readonly sortableFields = USER_SORTABLE_FIELDS_IN_MEMORY;

  /**
   * @param seed - comptes initiaux (identité + rôles + hash de mot de passe
   *   éventuel). Hacher en amont (hash pré-calculé) évite tout coût CPU au boot.
   */
  constructor(seed: IBaseUserOptions[] = []) {
    for (const options of seed) {
      const user = new BaseUser(options);
      this.#store.set(user.id, user);
    }
  }

  #match(
    user: BaseUser,
    criteria?: Criteria<IPasswordAuthenticatedUser>,
  ): boolean {
    if (!criteria) return true;
    return Object.entries(criteria).every(
      ([key, value]) =>
        (user as unknown as Record<string, unknown>)[key] === value,
    );
  }

  find(
    criteria?: Criteria<IPasswordAuthenticatedUser>,
  ): Promise<IPasswordAuthenticatedUser[]> {
    return Promise.resolve(
      [...this.#store.values()].filter((u) => this.#match(u, criteria)),
    );
  }

  findOne(
    criteria: Criteria<IPasswordAuthenticatedUser>,
  ): Promise<IPasswordAuthenticatedUser | null> {
    return Promise.resolve(
      [...this.#store.values()].find((u) => this.#match(u, criteria)) ?? null,
    );
  }

  create(
    data: Partial<IPasswordAuthenticatedUser>,
  ): Promise<IPasswordAuthenticatedUser> {
    // `socialProviders`/`enabled`/`locked` sont des champs d'ENTITÉ hors du
    // contrat credential — les backends réels (Drizzle/Mongoose) les persistent
    // à la création (via le repo de base) ; le store mémoire fait de même pour
    // rester à parité (sans `socialProviders`, le 2ᵉ login OAuth ne retrouverait
    // pas le compte → doublons ; sans `enabled`, impossible de seeder un inactif).
    const d = data as Partial<IPasswordAuthenticatedUser> & {
      socialProviders?: ISocialProvider[];
      enabled?: boolean;
      locked?: boolean;
    };
    const user = new BaseUser({
      id: randomUUID(),
      identifier: d.identifier as string,
      roles: d.roles ? [...d.roles] : [],
      password: d.password ?? null,
      socialProviders: d.socialProviders,
      enabled: d.enabled,
      locked: d.locked,
    });
    this.#store.set(user.id, user);
    return Promise.resolve(user);
  }

  updateOne(
    criteria: Criteria<IPasswordAuthenticatedUser>,
    data: Partial<IPasswordAuthenticatedUser>,
  ): Promise<IPasswordAuthenticatedUser | null> {
    const user = [...this.#store.values()].find((u) =>
      this.#match(u, criteria),
    );
    if (!user) return Promise.resolve(null);
    this.#apply(user, data);
    return Promise.resolve(user);
  }

  /**
   * Applique un patch sur une instance, **comme le ferait un backend réel**.
   *
   * Le contrat d'`IRepository.updateOne` promet d'écrire « les champs à
   * modifier » : n'en honorer qu'une partie ferait de ce dépôt un menteur
   * silencieux — un `{ enabled: false }` semblerait réussir (l'entité est
   * renvoyée) sans rien désactiver, alors que Drizzle et Mongoose, eux,
   * l'appliqueraient. Un banc de charge ou un test manuel en `NF_USER_STORE=memory`
   * n'exercerait alors pas le comportement de production.
   *
   * `enabled`/`locked` sont `protected` sur {@link BaseUser} (l'état de compte
   * s'exprime par des verbes) → on passe par ses méthodes plutôt que de forcer
   * l'accès. `id` et `identifier` sont `readonly` : sur ce backend l'entité EST
   * l'instance, sa clé n'est pas réécrivable — les ignorer est plus honnête que
   * de muter un champ déclaré immuable.
   */
  #apply(user: BaseUser, data: Partial<IPasswordAuthenticatedUser>): void {
    const d = data as Partial<IPasswordAuthenticatedUser> & {
      socialProviders?: ISocialProvider[];
      enabled?: boolean;
      locked?: boolean;
      currentRole?: string | null;
      metadata?: Record<string, unknown>;
    };
    if ("password" in d) user.password = d.password ?? null;
    // Copie défensive : le tableau de l'appelant ne doit pas rester partagé
    // avec l'entité stockée (une mutation externe changerait les rôles).
    if (d.roles) user.roles = [...d.roles];
    if (d.socialProviders) user.socialProviders = [...d.socialProviders];
    if (d.metadata) user.metadata = { ...d.metadata };
    if ("currentRole" in d) user.currentRole = d.currentRole ?? null;
    if (d.enabled !== undefined) {
      if (d.enabled) user.enable();
      else user.disable();
    }
    if (d.locked !== undefined) {
      if (d.locked) user.lock();
      else user.unlock();
    }
  }

  async upsert(
    criteria: Criteria<IPasswordAuthenticatedUser>,
    update: Partial<IPasswordAuthenticatedUser>,
    insertOnly?: Partial<IPasswordAuthenticatedUser>,
  ): Promise<IPasswordAuthenticatedUser> {
    const updated = await this.updateOne(criteria, update);
    if (updated) return updated;
    return this.create({
      ...(criteria as Partial<IPasswordAuthenticatedUser>),
      ...(insertOnly as Partial<IPasswordAuthenticatedUser> | undefined),
      ...update,
    });
  }

  async createMany(
    data: Partial<IPasswordAuthenticatedUser>[],
  ): Promise<IPasswordAuthenticatedUser[]> {
    const out: IPasswordAuthenticatedUser[] = [];
    for (const d of data) {
      out.push(await this.create(d));
    }
    return out;
  }

  exists(criteria: Criteria<IPasswordAuthenticatedUser>): Promise<boolean> {
    return Promise.resolve(
      [...this.#store.values()].some((u) => this.#match(u, criteria)),
    );
  }

  deleteOne(criteria: Criteria<IPasswordAuthenticatedUser>): Promise<boolean> {
    for (const [id, user] of this.#store) {
      if (this.#match(user, criteria)) {
        this.#store.delete(id);
        return Promise.resolve(true);
      }
    }
    return Promise.resolve(false);
  }

  findOneAndDelete(
    criteria: Criteria<IPasswordAuthenticatedUser>,
  ): Promise<IPasswordAuthenticatedUser | null> {
    for (const [id, user] of this.#store) {
      if (this.#match(user, criteria)) {
        this.#store.delete(id);
        return Promise.resolve(user);
      }
    }
    return Promise.resolve(null);
  }

  increment(
    criteria: Criteria<IPasswordAuthenticatedUser>,
    changes: Partial<Record<keyof IPasswordAuthenticatedUser, number>>,
  ): Promise<IPasswordAuthenticatedUser | null> {
    const user = [...this.#store.values()].find((u) =>
      this.#match(u, criteria),
    );
    if (!user) return Promise.resolve(null);
    const rec = user as unknown as Record<string, number>;
    for (const [field, delta] of Object.entries(changes)) {
      rec[field] = (rec[field] ?? 0) + (delta as number);
    }
    return Promise.resolve(user);
  }

  async updateMany(
    criteria: Criteria<IPasswordAuthenticatedUser>,
    data: Partial<IPasswordAuthenticatedUser>,
  ): Promise<number> {
    const users = await this.find(criteria);
    for (const user of users) {
      await this.updateOne(
        { id: user.id } as Criteria<IPasswordAuthenticatedUser>,
        data,
      );
    }
    return users.length;
  }

  delete(criteria: Criteria<IPasswordAuthenticatedUser>): Promise<number> {
    let deleted = 0;
    for (const [id, user] of this.#store) {
      if (this.#match(user, criteria)) {
        this.#store.delete(id);
        deleted += 1;
      }
    }
    return Promise.resolve(deleted);
  }

  async count(
    criteria?: Criteria<IPasswordAuthenticatedUser>,
  ): Promise<number> {
    return (await this.find(criteria)).length;
  }

  /**
   * Déduplication en mémoire — l'annuaire est déjà entièrement chargé, il n'y a
   * donc pas de parcours à éviter comme en SQL. `null`/`undefined` sont écartés
   * pour tenir la même sémantique que `COUNT(DISTINCT col)`.
   */
  async countDistinct(
    field: keyof IPasswordAuthenticatedUser & string,
    criteria?: Criteria<IPasswordAuthenticatedUser>,
  ): Promise<number> {
    const seen = new Set<unknown>();
    for (const user of await this.find(criteria)) {
      const value = user[field];
      if (value !== null && value !== undefined) seen.add(value);
    }
    return seen.size;
  }

  /** In-memory : pas de transaction — le repository est sa propre unité. */
  withTransaction(_tx: ITransaction): IUserRepository {
    return this;
  }

  findByIdentifier(
    identifier: string,
  ): Promise<IPasswordAuthenticatedUser | null> {
    return Promise.resolve(
      [...this.#store.values()].find((u) => u.identifier === identifier) ??
        null,
    );
  }

  findBySocialProvider(
    provider: string,
    providerId: string,
  ): Promise<IPasswordAuthenticatedUser | null> {
    return Promise.resolve(
      [...this.#store.values()].find((u) =>
        u.socialProviders.some(
          (s) => s.provider === provider && s.providerId === providerId,
        ),
      ) ?? null,
    );
  }

  /**
   * {@inheritDoc IUserRepository.listPage}
   *
   * In-memory : la collection est déjà en RAM (bornée par conception), donc le
   * filtrage/tri/slice se fait sur la structure — pas de matérialisation
   * supplémentaire. `total` gratuit (longueur du filtré) sauf `withTotal: false`.
   */
  listPage(query: IUserListQuery): Promise<IPage<IPasswordAuthenticatedUser>> {
    assertPageQuery(query, "offset");
    const limit = Math.max(1, Math.floor(query.limit));
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const q = query.q?.toLowerCase();

    let filtered = [...this.#store.values()];
    if (query.role !== undefined) {
      filtered = filtered.filter((u) => u.roles.includes(query.role as string));
    }
    if (query.enabled !== undefined) {
      filtered = filtered.filter((u) => u.isActive() === query.enabled);
    }
    if (query.locked !== undefined) {
      filtered = filtered.filter((u) => u.isLocked() === query.locked);
    }
    if (query.hasSocial !== undefined) {
      filtered = filtered.filter(
        (u) => u.socialProviders.length > 0 === query.hasSocial,
      );
    }
    if (q !== undefined && q.length > 0) {
      filtered = filtered.filter((u) => u.identifier.toLowerCase().includes(q));
    }

    // Comparateur PARTAGÉ du core — le même que les autres stores mémoire, pour
    // qu'un tri rendu en RAM ne diffère pas de celui rendu par SQL ou Mongo.
    const order = query.order?.length ? query.order : USER_DEFAULT_ORDER;
    filtered.sort(
      compareByOrder(
        order,
        (u, field) => (u as unknown as Record<string, unknown>)[field],
      ),
    );

    const items = filtered.slice(offset, offset + limit);
    const total = query.withTotal === false ? undefined : filtered.length;
    return Promise.resolve({
      items,
      total,
      limit,
      offset,
      hasNext: offset + items.length < filtered.length,
    });
  }

  /** {@inheritDoc IUserRepository.countActiveAdmins} */
  /**
   * {@inheritDoc IUserRepository.countUsers}
   *
   * Réutilise `listPage` avec une fenêtre nulle : le filtrage est écrit une
   * seule fois, donc compter et lister ne peuvent pas diverger.
   */
  async countUsers(query: IUserListQuery): Promise<number> {
    const page = await this.listPage({ ...query, limit: 1, offset: 0 });
    return page.total ?? 0;
  }

  countActiveAdmins(adminRole: string): Promise<number> {
    let count = 0;
    for (const u of this.#store.values()) {
      if (u.isActive() && u.roles.includes(adminRole)) count += 1;
    }
    return Promise.resolve(count);
  }
}

export default InMemoryUserRepository;
