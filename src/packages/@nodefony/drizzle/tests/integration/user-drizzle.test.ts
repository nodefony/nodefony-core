import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import {
  DrizzleUserRepository,
  registerUserEntity,
  type UserRow,
} from "../../nodefony/src/user/index";

const ORM = "db_user_test";

describe("@nodefony/user ↔ Drizzle adapter (P5.9)", () => {
  let orm: DrizzleOrm;
  let users: DrizzleUserRepository;

  beforeAll(async () => {
    registerUserEntity(ORM); // AVANT connect (l'adapter crée la table au connect)
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
    users = DrizzleUserRepository.from(orm);
  });

  afterAll(async () => {
    await orm.disconnect();
    // Scoper à NOTRE orm : `unregister("User")` sans orm efface le bucket entier
    // (toutes ORMs) → contaminerait le banc P7.4 (User@db_test).
    entityRegistry.unregister("User", ORM);
    ormRegistry.unregister(ORM);
  });

  it("create() → BaseUser avec id généré + défauts ($defaultFn)", async () => {
    const u = await users.create({
      identifier: "alice@nodefony.dev",
      roles: ["ROLE_USER"],
      password: "hash$alice",
    });
    assert.match(u.id, /[0-9a-f-]{36}/); // UUID auto
    assert.equal(u.identifier, "alice@nodefony.dev");
    assert.equal(u.password, "hash$alice");
    assert.deepEqual(u.roles, ["ROLE_USER"]);
    // Comportement BaseUser (pas une ligne nue) + défauts NOT NULL via $defaultFn.
    assert.equal(typeof u.hasRole, "function");
    assert.equal(u.hasRole("ROLE_USER"), true);
    assert.equal(u.isActive(), true); // enabled défaut true
    assert.equal(u.isLocked(), false); // locked défaut false
  });

  it("findByIdentifier() retrouve l'utilisateur (credential inclus)", async () => {
    const u = await users.findByIdentifier("alice@nodefony.dev");
    assert.ok(u);
    assert.equal(u.password, "hash$alice");
    assert.equal(u.hasRole("ROLE_USER"), true);
  });

  it("findByIdentifier() inconnu → null", async () => {
    assert.equal(await users.findByIdentifier("ghost@nodefony.dev"), null);
  });

  it("compte 100% OAuth : password null persiste", async () => {
    const u = await users.create({ identifier: "oauth-only@x.c" });
    assert.equal(u.password, null);
    assert.deepEqual(u.roles, []); // défaut $defaultFn []
  });

  it("update() modifie les rôles (mapping conservé)", async () => {
    const updated = await users.update(
      { identifier: "alice@nodefony.dev" },
      { roles: ["ROLE_USER", "ROLE_ADMIN"] },
    );
    assert.ok(updated);
    assert.equal(updated.hasRole("ROLE_ADMIN"), true);
    const reread = await users.findByIdentifier("alice@nodefony.dev");
    assert.deepEqual(reread?.roles, ["ROLE_USER", "ROLE_ADMIN"]);
  });

  it("findBySocialProvider() scanne le JSON socialProviders (Shadow User)", async () => {
    // socialProviders n'est pas dans le contrat IUser → écrit via le repo de base.
    const base = orm.getRepository<UserRow>("User");
    await base.create({
      identifier: "shadow@x.c",
      socialProviders: [
        { provider: "github", providerId: "4242", createdAt: new Date() },
      ],
    });
    const found = await users.findBySocialProvider("github", "4242");
    assert.ok(found);
    assert.equal(found.identifier, "shadow@x.c");
    // mauvaise paire → null
    assert.equal(await users.findBySocialProvider("github", "0000"), null);
    assert.equal(await users.findBySocialProvider("google", "4242"), null);
  });

  it("delete() + count() portables", async () => {
    const before = await users.count();
    assert.equal(await users.delete({ identifier: "oauth-only@x.c" }), 1);
    assert.equal(await users.count(), before - 1);
  });

  it("withTransaction() : rollback annule la création", async () => {
    const before = await users.count();
    await assert.rejects(
      orm.transaction(async (tx) => {
        await users.withTransaction(tx).create({ identifier: "doomed@x.c" });
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(await users.count(), before);
    assert.equal(await users.findByIdentifier("doomed@x.c"), null);
  });
});
