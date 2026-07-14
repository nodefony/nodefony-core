import assert from "node:assert/strict";
import { Entity } from "../../nodefony/src/Entity";
import { entityRegistry } from "../../nodefony/src/EntityRegistry";
import type { IEntityRelation } from "../../nodefony/interfaces/index";

/** Schéma factice (forme libre selon l'ORM). */
type FakeSchema = { fields: string[] };

/** Sous-classe concrète minimale pour exercer la base abstraite. */
class FakeEntity extends Entity<FakeSchema> {
  readonly name: string;
  readonly connector: string;
  override readonly relations?: ReadonlyArray<IEntityRelation>;
  #schemaCalls = 0;

  constructor(
    name: string,
    connector: string,
    relations?: ReadonlyArray<IEntityRelation>,
  ) {
    super();
    this.name = name;
    this.connector = connector;
    this.relations = relations;
  }

  get schemaCalls(): number {
    return this.#schemaCalls;
  }

  getSchema(): FakeSchema {
    this.#schemaCalls += 1;
    return { fields: ["id", "name"] };
  }
}

describe("Entity — classe de base abstraite cross-ORM", () => {
  const NAME = "EntityTest";
  const ORM = "entity-test-orm";

  afterEach(() => {
    entityRegistry.unregister(NAME);
  });

  it("le getter `schema` délègue à getSchema() (calculé, pas stocké)", () => {
    const e = new FakeEntity(NAME, ORM);
    assert.equal(e.schemaCalls, 0);
    assert.deepEqual(e.schema, { fields: ["id", "name"] });
    assert.equal(e.schemaCalls, 1);
    // Chaque accès recalcule (pas de mémoïsation au niveau de la base).
    void e.schema;
    assert.equal(e.schemaCalls, 2);
  });

  it("register() insère l'entité dans le registre et est chaînable", () => {
    const e = new FakeEntity(NAME, ORM);
    assert.equal(entityRegistry.has(NAME, ORM), false);
    const ret = e.register();
    assert.equal(ret, e);
    assert.equal(entityRegistry.has(NAME, ORM), true);
    assert.equal(entityRegistry.get(NAME, ORM), e);
  });

  it("register() en double (même name+connector) lève", () => {
    new FakeEntity(NAME, ORM).register();
    assert.throws(
      () => new FakeEntity(NAME, ORM).register(),
      /already registered for connector/,
    );
  });

  it("model est undefined avant compilation, relations optionnelles", () => {
    const rels: IEntityRelation[] = [
      { type: "one-to-many", target: "Child", field: "children" },
    ];
    const e = new FakeEntity(NAME, ORM, rels);
    assert.equal(e.model, undefined);
    assert.deepEqual(e.relations, rels);
  });
});
