import assert from "node:assert/strict";
import { EntityRegistry } from "../../nodefony/src/EntityRegistry";
import type { IEntity } from "../../nodefony/interfaces/index";

/** Stub minimal d'IEntity : name + orm suffisent au registre. */
const entity = (name: string, orm: string): IEntity =>
  ({ name, orm, schema: {} }) as IEntity;

describe("EntityRegistry", () => {
  let reg: EntityRegistry;

  beforeEach(() => {
    reg = new EntityRegistry();
  });

  it("est vide à l'init (lazy)", () => {
    assert.deepEqual(reg.list(), []);
    assert.equal(reg.has("User"), false);
  });

  it("register + get (mono-ORM, nom seul)", () => {
    const e = entity("User", "db_principale");
    reg.register(e);
    assert.equal(reg.get("User"), e);
    assert.equal(reg.has("User"), true);
    assert.equal(reg.has("User", "db_principale"), true);
  });

  it("lookup cross-ORM : même entité, 2 ORM", () => {
    const seq = entity("User", "drizzle");
    const mongo = entity("User", "mongoose");
    reg.register(seq);
    reg.register(mongo);
    assert.equal(reg.get("User", "drizzle"), seq);
    assert.equal(reg.get("User", "mongoose"), mongo);
    assert.equal(reg.list().length, 2);
  });

  it("get sans ORM est ambigu si plusieurs candidats", () => {
    reg.register(entity("User", "drizzle"));
    reg.register(entity("User", "mongoose"));
    assert.throws(() => reg.get("User"), /multiple ORMs/);
  });

  it("throw sur doublon (même name + orm)", () => {
    reg.register(entity("User", "drizzle"));
    assert.throws(
      () => reg.register(entity("User", "drizzle")),
      /already registered/,
    );
  });

  it("throw sur entité inconnue / ORM absent", () => {
    assert.throws(() => reg.get("Ghost"), /no entity registered/);
    reg.register(entity("User", "drizzle"));
    assert.throws(() => reg.get("User", "mongoose"), /not registered for ORM/);
  });

  it("unregister par ORM, puis bucket vidé", () => {
    reg.register(entity("User", "drizzle"));
    reg.register(entity("User", "mongoose"));
    assert.equal(reg.unregister("User", "drizzle"), true);
    assert.equal(reg.has("User", "drizzle"), false);
    assert.equal(reg.has("User", "mongoose"), true);
    assert.equal(reg.unregister("User", "mongoose"), true);
    assert.equal(reg.has("User"), false);
  });

  it("unregister sans ORM retire toutes les variantes", () => {
    reg.register(entity("User", "drizzle"));
    reg.register(entity("User", "mongoose"));
    assert.equal(reg.unregister("User"), true);
    assert.deepEqual(reg.list(), []);
    assert.equal(reg.unregister("User"), false);
  });
});
