import assert from "node:assert/strict";
import { entity } from "../../nodefony/src/decorators/entityDecorator";
import { repository } from "../../nodefony/src/decorators/repositoryDecorator";
import {
  getEntityMeta,
  hasEntityMeta,
  getRepositoryMeta,
  hasRepositoryMeta,
} from "../../nodefony/src/decorators/metadataStore";
import { entityRegistry } from "../../nodefony/src/EntityRegistry";

describe("@entity", () => {
  afterEach(() => {
    // Le décorateur enregistre dans le singleton process-wide → nettoyage.
    entityRegistry.unregister("Foo");
    entityRegistry.unregister("User");
  });

  it("stocke la métadonnée + auto-register le descripteur (name défaut = classe)", () => {
    @entity({ orm: "drizzle", schema: { id: "uuid" } })
    class Foo {}

    const meta = getEntityMeta(Foo);
    assert.ok(meta);
    assert.equal(meta.name, "Foo");
    assert.equal(meta.orm, "drizzle");
    assert.deepEqual(meta.schema, { id: "uuid" });
    assert.equal(meta.target, Foo);
    // descripteur poussé dans le registre singleton
    assert.equal(entityRegistry.has("Foo", "drizzle"), true);
    assert.equal(entityRegistry.get("Foo").schema, meta.schema);
  });

  it("name explicite remplace le nom de classe", () => {
    @entity({ orm: "mongoose", name: "User" })
    class UserModel {}

    assert.equal(getEntityMeta(UserModel)?.name, "User");
    assert.equal(entityRegistry.has("User", "mongoose"), true);
  });

  it("relations transmises au descripteur", () => {
    @entity({
      orm: "drizzle",
      name: "User",
      relations: [{ type: "one-to-many", target: "Room", field: "rooms" }],
    })
    class UserRel {}

    assert.equal(getEntityMeta(UserRel)?.relations?.length, 1);
    assert.equal(entityRegistry.get("User").relations?.[0].target, "Room");
  });

  it("hasEntityMeta = false sur classe non décorée", () => {
    class Plain {}
    assert.equal(hasEntityMeta(Plain), false);
    assert.equal(getEntityMeta(Plain), undefined);
  });
});

describe("@repository", () => {
  it("lie repo → entity via métadonnée (tag pur, pas de registre)", () => {
    @repository("repository.user", { entity: "User", orm: "drizzle" })
    class UserRepo {}

    const meta = getRepositoryMeta(UserRepo);
    assert.ok(meta);
    assert.equal(meta.name, "repository.user");
    assert.equal(meta.entity, "User");
    assert.equal(meta.orm, "drizzle");
    assert.equal(meta.target, UserRepo);
    assert.equal(hasRepositoryMeta(UserRepo), true);
  });

  it("orm optionnel", () => {
    @repository("repository.room", { entity: "Room" })
    class RoomRepo {}

    assert.equal(getRepositoryMeta(RoomRepo)?.orm, undefined);
  });

  it("hasRepositoryMeta = false sur classe non décorée", () => {
    class Plain {}
    assert.equal(hasRepositoryMeta(Plain), false);
  });
});
