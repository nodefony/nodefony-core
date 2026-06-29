import { randomUUID } from "node:crypto";
import type { Criteria, ITransaction } from "@nodefony/orm-core";
import { BaseUser } from "./BaseUser";
import type { IBaseUserOptions } from "./BaseUser";
import type {
  IPasswordAuthenticatedUser,
  ISocialProvider,
  IUserRepository,
} from "../contracts/index";

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
    // `socialProviders` est un champ d'entité hors du contrat credential — le
    // provisioning OAuth (Shadow User) le passe ; sans lui, le 2ᵉ login ne
    // retrouverait pas le compte (findBySocialProvider) → doublons.
    const d = data as Partial<IPasswordAuthenticatedUser> & {
      socialProviders?: ISocialProvider[];
    };
    const user = new BaseUser({
      id: randomUUID(),
      identifier: d.identifier as string,
      roles: d.roles ? [...d.roles] : [],
      password: d.password ?? null,
      socialProviders: d.socialProviders,
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
    if ("password" in data) user.password = data.password ?? null;
    if (data.roles) user.roles = [...data.roles];
    return Promise.resolve(user);
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
}

export default InMemoryUserRepository;
