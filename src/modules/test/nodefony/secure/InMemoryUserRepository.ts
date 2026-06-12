import { randomUUID } from "node:crypto";
import { BaseUser } from "@nodefony/user";
import type {
  IBaseUserOptions,
  IPasswordAuthenticatedUser,
  IUserRepository,
} from "@nodefony/user";
import type { Criteria, ITransaction } from "@nodefony/orm-core";

/**
 * Utilisateurs du banc sécurité (zone `test-secure`) — DEV UNIQUEMENT (le module
 * test est `policy: "dev"`, jamais chargé en production).
 *
 * Mot de passe des deux comptes : `secret` (hashs bcrypt coût 12 pré-calculés —
 * zéro hash au boot, et `needsRehash` reste faux : aucun re-hash parasite
 * pendant les suites d'intégration).
 */
export const SECURE_TEST_USERS: IBaseUserOptions[] = [
  {
    id: "00000000-0000-4000-8000-00000000ad01",
    identifier: "admin",
    roles: ["ROLE_ADMIN"],
    password: "$2y$12$LClrbAwB2rWklN.9mNaLSe8M3VT6g2HcuCSBkpdJAg/bgw8N66ktG",
  },
  {
    id: "00000000-0000-4000-8000-0000000005e1",
    identifier: "user",
    roles: ["ROLE_USER"],
    password: "$2y$12$SUihCkfVHcpC5EdUgTE/fOk0btOqY3RaUJutRyTkKepvUlxLVqO1u",
  },
];

/**
 * Annuaire d'utilisateurs **en mémoire** — fixture du banc sécurité.
 *
 * Implémente le contrat {@link IUserRepository} complet sur une `Map` (aucun
 * ORM) : branché sous `UserService` pour fournir la source d'identité du
 * firewall pendant les tests d'intégration. La persistance réelle (Drizzle/
 * Mongoose) prend ce rôle en application — même contrat, zéro changement aval.
 */
export class InMemoryUserRepository implements IUserRepository {
  readonly #store = new Map<string, BaseUser>();

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
    const user = new BaseUser({
      id: randomUUID(),
      identifier: data.identifier as string,
      roles: data.roles ? [...data.roles] : [],
      password: data.password ?? null,
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
