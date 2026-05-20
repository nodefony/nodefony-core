import assert from "node:assert/strict";
import { OrmRegistry } from "../../nodefony/src/OrmRegistry";
import type { IOrm } from "../../nodefony/interfaces/index";

/** Stub minimal d'IOrm — seul `name` compte pour les tests de registre. */
const stub = (name: string): IOrm =>
  ({ name }) as unknown as IOrm;

describe("OrmRegistry", () => {
  let reg: OrmRegistry;

  beforeEach(() => {
    reg = new OrmRegistry();
  });

  it("est vide à l'init (lazy, aucune alloc)", () => {
    assert.deepEqual(reg.list(), []);
    assert.equal(reg.has("db"), false);
  });

  it("register + get + has + list", () => {
    const orm = stub("db_principale");
    reg.register("db_principale", orm);
    assert.equal(reg.get("db_principale"), orm);
    assert.equal(reg.has("db_principale"), true);
    assert.deepEqual(reg.list(), ["db_principale"]);
  });

  it("supporte plusieurs ORM simultanés", () => {
    reg.register("db_principale", stub("db_principale"));
    reg.register("db_logs", stub("db_logs"));
    assert.deepEqual(reg.list().sort(), ["db_logs", "db_principale"]);
  });

  it("throw sur doublon de nom", () => {
    reg.register("db", stub("db"));
    assert.throws(() => reg.register("db", stub("db")), /already registered/);
  });

  it("throw sur get d'un nom absent", () => {
    assert.throws(() => reg.get("nope"), /no ORM registered/);
  });

  it("unregister retire l'entrée et nettoie", () => {
    reg.register("db", stub("db"));
    assert.equal(reg.unregister("db"), true);
    assert.equal(reg.has("db"), false);
    assert.deepEqual(reg.list(), []);
    assert.equal(reg.unregister("db"), false);
  });

  it("ré-enregistre après unregister (pas de doublon)", () => {
    reg.register("db", stub("db"));
    reg.unregister("db");
    assert.doesNotThrow(() => reg.register("db", stub("db")));
  });
});
