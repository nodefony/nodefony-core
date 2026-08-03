import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Criteria, ITransaction } from "@nodefony/orm-core";
import {
  Argon2idEncoder,
  BaseUser,
  BcryptEncoder,
  MigratingEncoder,
  UserService,
  WeakPasswordError,
  type IPasswordAuthenticatedUser,
  type IUserRepository,
  type IUserListQuery,
} from "../../index";

// Coût bcrypt bas — accélère hash/verify sans changer la logique testée.
const FAST = 4;

/**
 * Repository utilisateur en mémoire — implémente le contrat sans ORM réel.
 * Stocke des {@link BaseUser} (qui portent isActive/isLocked/password).
 */
class MemoryUserRepo implements IUserRepository {
  readonly store = new Map<string, BaseUser>();

  private match(u: BaseUser, criteria?: Criteria<IPasswordAuthenticatedUser>) {
    if (!criteria) return true;
    return Object.entries(criteria).every(
      ([k, v]) => (u as unknown as Record<string, unknown>)[k] === v,
    );
  }

  find(criteria?: Criteria<IPasswordAuthenticatedUser>) {
    return Promise.resolve(
      [...this.store.values()].filter((u) => this.match(u, criteria)),
    );
  }

  findOne(criteria: Criteria<IPasswordAuthenticatedUser>) {
    return Promise.resolve(
      [...this.store.values()].find((u) => this.match(u, criteria)) ?? null,
    );
  }

  create(data: Partial<IPasswordAuthenticatedUser>) {
    const id = randomUUID();
    const user = new BaseUser({
      id,
      identifier: data.identifier as string,
      roles: data.roles ? [...data.roles] : [],
      password: data.password ?? null,
    });
    this.store.set(id, user);
    return Promise.resolve<IPasswordAuthenticatedUser>(user);
  }

  updateOne(
    criteria: Criteria<IPasswordAuthenticatedUser>,
    data: Partial<IPasswordAuthenticatedUser>,
  ) {
    const user = [...this.store.values()].find((u) => this.match(u, criteria));
    if (!user) return Promise.resolve(null);
    if ("password" in data) user.password = data.password ?? null;
    if (data.roles) user.roles = [...data.roles];
    return Promise.resolve<IPasswordAuthenticatedUser>(user);
  }

  updateMany(
    criteria: Criteria<IPasswordAuthenticatedUser>,
    data: Partial<IPasswordAuthenticatedUser>,
  ) {
    let n = 0;
    for (const user of this.store.values()) {
      if (!this.match(user, criteria)) continue;
      if ("password" in data) user.password = data.password ?? null;
      if (data.roles) user.roles = [...data.roles];
      n += 1;
    }
    return Promise.resolve(n);
  }

  delete(criteria: Criteria<IPasswordAuthenticatedUser>) {
    let n = 0;
    for (const [id, u] of this.store) {
      if (this.match(u, criteria)) {
        this.store.delete(id);
        n += 1;
      }
    }
    return Promise.resolve(n);
  }

  count(criteria?: Criteria<IPasswordAuthenticatedUser>) {
    return this.find(criteria).then((r) => r.length);
  }

  countDistinct(
    field: keyof IPasswordAuthenticatedUser & string,
    criteria?: Criteria<IPasswordAuthenticatedUser>,
  ) {
    return this.find(criteria).then(
      (r) =>
        new Set(
          r.map((u) => u[field]).filter((v) => v !== null && v !== undefined),
        ).size,
    );
  }

  createMany(data: Partial<IPasswordAuthenticatedUser>[]) {
    return Promise.all(data.map((d) => this.create(d)));
  }

  upsert(
    criteria: Criteria<IPasswordAuthenticatedUser>,
    update: Partial<IPasswordAuthenticatedUser>,
    insertOnly?: Partial<IPasswordAuthenticatedUser>,
  ) {
    return this.updateOne(criteria, update).then((updated) => {
      if (updated) return updated;
      return this.create({
        ...(criteria as Partial<IPasswordAuthenticatedUser>),
        ...insertOnly,
        ...update,
      });
    });
  }

  increment(
    criteria: Criteria<IPasswordAuthenticatedUser>,
    changes: Partial<Record<keyof IPasswordAuthenticatedUser, number>>,
  ) {
    const user = [...this.store.values()].find((u) => this.match(u, criteria));
    if (!user) return Promise.resolve(null);
    const record = user as unknown as Record<string, number>;
    for (const [field, delta] of Object.entries(changes)) {
      record[field] = (record[field] ?? 0) + (delta as number);
    }
    return Promise.resolve<IPasswordAuthenticatedUser>(user);
  }

  deleteOne(criteria: Criteria<IPasswordAuthenticatedUser>) {
    return this.findOneAndDelete(criteria).then((u) => u !== null);
  }

  findOneAndDelete(criteria: Criteria<IPasswordAuthenticatedUser>) {
    for (const [id, user] of this.store) {
      if (this.match(user, criteria)) {
        this.store.delete(id);
        return Promise.resolve<IPasswordAuthenticatedUser>(user);
      }
    }
    return Promise.resolve(null);
  }

  exists(criteria: Criteria<IPasswordAuthenticatedUser>) {
    return Promise.resolve(
      [...this.store.values()].some((u) => this.match(u, criteria)),
    );
  }

  withTransaction(_tx: ITransaction) {
    return this;
  }

  findByIdentifier(identifier: string) {
    return this.findOne({ identifier });
  }

  findBySocialProvider() {
    return Promise.resolve<IPasswordAuthenticatedUser | null>(null);
  }

  listPage(query: IUserListQuery) {
    const limit = Math.max(1, Math.floor(query.limit));
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const q = query.q?.toLowerCase();
    const role = query.role;
    let filtered = [...this.store.values()];
    if (role !== undefined)
      filtered = filtered.filter((u) => u.roles.includes(role));
    if (query.enabled !== undefined)
      filtered = filtered.filter((u) => u.isActive() === query.enabled);
    if (q)
      filtered = filtered.filter((u) => u.identifier.toLowerCase().includes(q));
    filtered.sort((a, b) => a.identifier.localeCompare(b.identifier));
    const items = filtered.slice(offset, offset + limit);
    return Promise.resolve({
      items: items as IPasswordAuthenticatedUser[],
      total: query.withTotal === false ? undefined : filtered.length,
      limit,
      offset,
      hasNext: offset + items.length < filtered.length,
    });
  }

  countActiveAdmins(adminRole: string) {
    return Promise.resolve(
      [...this.store.values()].filter(
        (u) => u.isActive() && u.roles.includes(adminRole),
      ).length,
    );
  }

  /** Double du COUNT filtré : applique les mêmes filtres que le vrai annuaire. */
  countUsers(query: IUserListQuery) {
    return Promise.resolve(
      [...this.store.values()].filter((u) => {
        if (query.role !== undefined && !u.roles.includes(query.role)) {
          return false;
        }
        if (query.enabled !== undefined && u.isActive() !== query.enabled) {
          return false;
        }
        if (query.locked !== undefined && u.isLocked() !== query.locked) {
          return false;
        }
        if (
          query.hasSocial !== undefined &&
          u.socialProviders.length > 0 !== query.hasSocial
        ) {
          return false;
        }
        return true;
      }).length,
    );
  }
}

function makeService(rounds = FAST) {
  const repo = new MemoryUserRepo();
  const service = new UserService(repo, new BcryptEncoder(rounds));
  return { repo, service };
}

describe("UserService (P5.6 — extends AbstractCrudService)", () => {
  describe("createUser", () => {
    it("hache le mot de passe et émet onCreated (CRUD hérité)", async () => {
      const { service } = makeService();
      let fired: IPasswordAuthenticatedUser | null = null;
      service.on("onCreated", (u) => {
        fired = u as IPasswordAuthenticatedUser;
      });

      const user = await service.createUser({
        identifier: "jane@x.io",
        plainPassword: "s3cret",
        roles: ["ROLE_USER"],
      });

      assert.equal(user.identifier, "jane@x.io");
      assert.ok(user.id.length > 0);
      assert.notEqual(user.password, "s3cret"); // jamais en clair
      assert.match(user.password as string, /^\$2[aby]\$/);
      assert.equal(user.hasRole("ROLE_USER"), true);
      assert.equal(fired, user);
    });

    it("password null pour un compte sans credential local", async () => {
      const { service } = makeService();
      const user = await service.createUser({ identifier: "oauth@x.io" });
      assert.equal(user.password, null);
    });
  });

  describe("lectures héritées + finder métier", () => {
    it("findById (hérité) et findByIdentifier (spécifique)", async () => {
      const { service } = makeService();
      const created = await service.createUser({ identifier: "a@x.io" });
      assert.equal((await service.findById(created.id))?.id, created.id);
      assert.equal((await service.findByIdentifier("a@x.io"))?.id, created.id);
      assert.equal(await service.findByIdentifier("nope@x.io"), null);
      assert.equal(await service.count(), 1);
    });
  });

  describe("update / delete (CRUD hérité)", () => {
    it("update modifie les rôles et émet onUpdated", async () => {
      const { service } = makeService();
      const created = await service.createUser({ identifier: "a@x.io" });
      let fired = false;
      service.on("onUpdated", () => {
        fired = true;
      });
      const updated = await service.updateOne(
        { id: created.id },
        { roles: ["ROLE_ADMIN"] },
      );
      assert.equal(updated?.hasRole("ROLE_ADMIN"), true);
      assert.equal(fired, true);
    });

    it("delete supprime et émet onDeleted", async () => {
      const { service, repo } = makeService();
      const created = await service.createUser({ identifier: "a@x.io" });
      let count = -1;
      service.on("onDeleted", (_criteria, n) => {
        count = n as number;
      });
      assert.equal(await service.delete({ id: created.id }), 1);
      assert.equal(count, 1);
      assert.equal(repo.store.size, 0);
      assert.equal(await service.delete({ id: created.id }), 0); // déjà supprimé
    });
  });

  describe("changePassword (credential spécifique)", () => {
    it("re-hache et émet onPasswordChanged (pas onUpdated)", async () => {
      const { service } = makeService();
      const created = await service.createUser({
        identifier: "a@x.io",
        plainPassword: "old",
      });
      const oldHash = created.password;
      let pwdFired = false;
      let updFired = false;
      service.on("onPasswordChanged", () => (pwdFired = true));
      service.on("onUpdated", () => (updFired = true));
      const updated = await service.changePassword(created.id, "new");
      assert.notEqual(updated?.password, oldHash);
      assert.equal(pwdFired, true);
      assert.equal(updFired, false);
    });
  });

  describe("authenticate", () => {
    it("succès : émet onAuthenticated et retourne l'utilisateur", async () => {
      const { service } = makeService();
      const created = await service.createUser({
        identifier: "a@x.io",
        plainPassword: "s3cret",
      });
      let ok = false;
      service.on("onAuthenticated", () => {
        ok = true;
      });
      const user = await service.authenticate("a@x.io", "s3cret");
      assert.equal(user?.id, created.id);
      assert.equal(ok, true);
    });

    it("mauvais mot de passe : null + raison bad_credentials", async () => {
      const { service } = makeService();
      await service.createUser({
        identifier: "a@x.io",
        plainPassword: "s3cret",
      });
      let reason = "";
      service.on("onAuthenticationFailure", (_id, r) => {
        reason = r as string;
      });
      assert.equal(await service.authenticate("a@x.io", "wrong"), null);
      assert.equal(reason, "bad_credentials");
    });

    it("identifiant inconnu : null + raison unknown_identifier", async () => {
      const { service } = makeService();
      let reason = "";
      service.on("onAuthenticationFailure", (_id, r) => {
        reason = r as string;
      });
      assert.equal(await service.authenticate("ghost@x.io", "x"), null);
      assert.equal(reason, "unknown_identifier");
    });

    it("compte sans password local : null + raison no_password", async () => {
      const { service } = makeService();
      await service.createUser({ identifier: "oauth@x.io" }); // password null
      let reason = "";
      service.on("onAuthenticationFailure", (_id, r) => {
        reason = r as string;
      });
      assert.equal(await service.authenticate("oauth@x.io", "x"), null);
      assert.equal(reason, "no_password");
    });

    it("compte verrouillé : null + raison locked (priorité sur disabled)", async () => {
      const { service, repo } = makeService();
      const u = await service.createUser({
        identifier: "a@x.io",
        plainPassword: "s3cret",
      });
      repo.store.get(u.id)?.lock();
      let reason = "";
      service.on("onAuthenticationFailure", (_id, r) => {
        reason = r as string;
      });
      assert.equal(await service.authenticate("a@x.io", "s3cret"), null);
      assert.equal(reason, "locked");
    });

    it("compte désactivé : null + raison disabled", async () => {
      const { service, repo } = makeService();
      const u = await service.createUser({
        identifier: "a@x.io",
        plainPassword: "s3cret",
      });
      repo.store.get(u.id)?.disable();
      let reason = "";
      service.on("onAuthenticationFailure", (_id, r) => {
        reason = r as string;
      });
      assert.equal(await service.authenticate("a@x.io", "s3cret"), null);
      assert.equal(reason, "disabled");
    });

    it("re-hache le credential si le coût est obsolète (upgrade transparent)", async () => {
      const repo = new MemoryUserRepo();
      const weak = new UserService(repo, new BcryptEncoder(4));
      const created = await weak.createUser({
        identifier: "a@x.io",
        plainPassword: "s3cret",
      });
      const oldHash = created.password;

      const strong = new UserService(repo, new BcryptEncoder(6));
      let rehashed = false;
      strong.on("onPasswordChanged", () => {
        rehashed = true;
      });
      const user = await strong.authenticate("a@x.io", "s3cret");
      assert.equal(user?.id, created.id);
      assert.equal(rehashed, true);
      assert.notEqual(repo.store.get(created.id)?.password, oldHash);
      assert.match(
        repo.store.get(created.id)?.password as string,
        /^\$2[aby]\$06\$/,
      );
    });

    it("migre bcrypt → argon2id au login via MigratingEncoder (P6 J2)", async () => {
      const repo = new MemoryUserRepo();
      // Parc existant : compte créé à l'ère bcrypt.
      const legacy = new UserService(repo, new BcryptEncoder(4));
      const created = await legacy.createUser({
        identifier: "a@x.io",
        plainPassword: "s3cret",
      });
      assert.match(created.password as string, /^\$2[aby]\$/);

      // L'app passe à argon2id : bcrypt reste accepté en lecture seule.
      const migrating = new UserService(
        repo,
        new MigratingEncoder(
          new Argon2idEncoder({ memoryKiB: 64, timeCost: 1, parallelism: 1 }),
          [new BcryptEncoder(4)],
        ),
      );
      const user = await migrating.authenticate("a@x.io", "s3cret");
      assert.equal(user?.id, created.id);
      // Le hash stocké a été modernisé au seul moment où le clair existait.
      assert.match(
        repo.store.get(created.id)?.password as string,
        /^\$argon2id\$/,
      );
      // Le login suivant passe par le format cible, sans re-hash inutile.
      let rehashedAgain = false;
      migrating.on("onPasswordChanged", () => {
        rehashedAgain = true;
      });
      assert.equal(
        (await migrating.authenticate("a@x.io", "s3cret"))?.id,
        created.id,
      );
      assert.equal(rehashedAgain, false);
    });
  });

  describe("passwordBlocklist — hook NIST mots de passe compromis (P6 J2)", () => {
    const blocklist = {
      isBlocked: (plain: string) => Promise.resolve(plain === "password123"),
    };

    it("createUser refuse un mot de passe bloqué (WeakPasswordError)", async () => {
      const service = new UserService(
        new MemoryUserRepo(),
        new BcryptEncoder(4),
      );
      service.passwordBlocklist = blocklist;
      await assert.rejects(
        service.createUser({
          identifier: "a@x.io",
          plainPassword: "password123",
        }),
        WeakPasswordError,
      );
      const ok = await service.createUser({
        identifier: "a@x.io",
        plainPassword: "s3cret-unique",
      });
      assert.equal(ok.identifier, "a@x.io");
    });

    it("changePassword refuse un mot de passe bloqué, accepte un sain", async () => {
      const service = new UserService(
        new MemoryUserRepo(),
        new BcryptEncoder(4),
      );
      service.passwordBlocklist = blocklist;
      const user = await service.createUser({
        identifier: "a@x.io",
        plainPassword: "s3cret-unique",
      });
      await assert.rejects(
        service.changePassword(user.id, "password123"),
        WeakPasswordError,
      );
      assert.notEqual(
        await service.changePassword(user.id, "autre-s3cret"),
        null,
      );
    });

    it("sans blocklist branchée : aucun contrôle (hook opt-in)", async () => {
      const service = new UserService(
        new MemoryUserRepo(),
        new BcryptEncoder(4),
      );
      const ok = await service.createUser({
        identifier: "a@x.io",
        plainPassword: "password123",
      });
      assert.equal(ok.identifier, "a@x.io");
    });
  });
});
