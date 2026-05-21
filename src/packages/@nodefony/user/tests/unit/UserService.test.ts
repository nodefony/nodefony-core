import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Criteria, ITransaction } from "@nodefony/orm-core";
import {
  BaseUser,
  BcryptEncoder,
  UserService,
  type IPasswordAuthenticatedUser,
  type IUserRepository,
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

  update(
    criteria: Criteria<IPasswordAuthenticatedUser>,
    data: Partial<IPasswordAuthenticatedUser>,
  ) {
    const user = [...this.store.values()].find((u) => this.match(u, criteria));
    if (!user) return Promise.resolve(null);
    if ("password" in data) user.password = data.password ?? null;
    if (data.roles) user.roles = [...data.roles];
    return Promise.resolve<IPasswordAuthenticatedUser>(user);
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

  withTransaction(_tx: ITransaction) {
    return this;
  }

  findByIdentifier(identifier: string) {
    return this.findOne({ identifier });
  }

  findBySocialProvider() {
    return Promise.resolve<IPasswordAuthenticatedUser | null>(null);
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
      const updated = await service.update(
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
      await service.createUser({ identifier: "a@x.io", plainPassword: "s3cret" });
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
  });
});
