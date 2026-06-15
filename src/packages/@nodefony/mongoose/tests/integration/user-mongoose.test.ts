import assert from "node:assert/strict";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import {
  registerUserEntity,
  type UserRow,
} from "../../nodefony/entity/userEntity";
import { MongooseUserRepository } from "../../nodefony/src/MongooseUserRepository";

const ORM = "mongo_user_test";
// Serveur Mongo PARTAGÉ (globalSetup) scopé sur la base `mongo_user_test`.
// `null` → infra absente → suite skippée.
const URI = mongoTestUri(ORM);

describe.skipIf(!URI)("@nodefony/user ↔ Mongoose adapter (P5.8)", () => {
  let orm: MongooseOrm;
  let users: MongooseUserRepository;

  beforeAll(async () => {
    registerUserEntity(ORM); // AVANT connect (le modèle est compilé au connect)
    orm = new MongooseOrm(ORM, URI!);
    await orm.connect();
    users = MongooseUserRepository.from(orm);
  });

  afterAll(async () => {
    await orm.disconnect();
    // Scoper à NOTRE orm : le bucket "User" du registry est process-wide.
    entityRegistry.unregister("User", ORM);
    ormRegistry.unregister(ORM);
  });

  it("create() → BaseUser avec id (ObjectId hex) + défauts du schéma", async () => {
    const u = await users.create({
      identifier: "alice@nodefony.dev",
      roles: ["ROLE_USER"],
      password: "hash$alice",
    });
    assert.match(u.id, /^[0-9a-f]{24}$/); // virtuel `id` = hex de l'ObjectId
    assert.equal(u.identifier, "alice@nodefony.dev");
    assert.equal(u.password, "hash$alice");
    assert.deepEqual(u.roles, ["ROLE_USER"]);
    // Comportement BaseUser (pas un document nu) + défauts du schéma.
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

  it("compte 100% OAuth : password null + roles défaut []", async () => {
    const u = await users.create({ identifier: "oauth-only@x.c" });
    assert.equal(u.password, null);
    assert.deepEqual(u.roles, []);
  });

  it("updateOne() modifie les rôles (mapping conservé)", async () => {
    const updated = await users.updateOne(
      { identifier: "alice@nodefony.dev" },
      { roles: ["ROLE_USER", "ROLE_ADMIN"] },
    );
    assert.ok(updated);
    assert.equal(updated.hasRole("ROLE_ADMIN"), true);
    const reread = await users.findByIdentifier("alice@nodefony.dev");
    assert.deepEqual(reread?.roles, ["ROLE_USER", "ROLE_ADMIN"]);
  });

  it("findBySocialProvider() scanne socialProviders via $elemMatch (Shadow User)", async () => {
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
