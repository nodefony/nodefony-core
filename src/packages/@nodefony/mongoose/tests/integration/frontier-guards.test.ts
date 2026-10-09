import assert from "node:assert/strict";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { entity, entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { Criteria, IRepository } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import { documentId } from "../../nodefony/src/documentId";

// Les gardes posées à la place des conversions de type (#575) : une valeur
// d'une autre forme est REFUSÉE en nommant la cause, au lieu de traverser le
// code sous un type qui ment.

const URI = mongoTestUri("mongo_guards");

@entity({
  connector: "mongo_guards",
  name: "GuardItem",
  schema: { name: { type: String, required: true } },
})
class GuardItemEntity {}
void GuardItemEntity;

interface GuardItem {
  id: string;
  name: string;
}

/** Critère tel qu'il arrive d'un filtre HTTP : sa forme n'est pas garantie. */
function untrusted(json: string): Criteria<GuardItem> {
  const parsed: Criteria<GuardItem> = JSON.parse(json);
  return parsed;
}

describe("documentId — identité réelle d'un document", () => {
  it("`_id` chaîne fait foi", () => {
    const row = { id: "virtuel", _id: "jti-42" };
    assert.equal(documentId(row), "jti-42");
  });

  it("`_id` d'une autre forme (ObjectId hérité) retombe sur le virtuel `id`", () => {
    const row = { id: "virtuel", _id: { $oid: "65f0" } };
    assert.equal(documentId(row), "virtuel");
  });

  it("sans `_id` (projection), le virtuel `id`", () => {
    assert.equal(documentId({ id: "virtuel" }), "virtuel");
  });
});

describe.skipIf(!URI)(
  "MongooseRepository — critères venus de l'extérieur",
  () => {
    let orm: MongooseOrm;
    let items: IRepository<GuardItem>;

    beforeAll(async () => {
      orm = new MongooseOrm("mongo_guards", URI!);
      await orm.connect();
      items = orm.getRepository<GuardItem>("GuardItem");
      await items.delete({});
      await items.create({ name: "alpha" });
    });
    afterAll(async () => {
      await items?.delete({});
      await orm.disconnect();
      entityRegistry.unregister("GuardItem");
      ormRegistry.unregister("mongo_guards");
    });

    it("$like valide : filtre par motif", async () => {
      const found = await items.find(untrusted('{"name":{"$like":"alp%"}}'));
      assert.equal(found.length, 1);
    });

    it("$like non chaîne : refusé en nommant l'opérateur", async () => {
      await assert.rejects(
        items.find(untrusted('{"name":{"$like":42}}')),
        (e: unknown) => e instanceof TypeError && e.message.includes("$like"),
      );
    });

    it("branche de $or qui n'est pas un critère : refusée", async () => {
      await assert.rejects(
        items.find(untrusted('{"$or":[42]}')),
        (e: unknown) => e instanceof TypeError && e.message.includes("$or"),
      );
    });
  },
);

describe.skipIf(!URI)("MongooseOrm — schéma d'entité d'un autre ORM", () => {
  class ForeignTable {
    readonly columns = { name: "text" };
  }

  @entity({
    connector: "mongo_guards_foreign",
    name: "ForeignItem",
    schema: new ForeignTable(),
  })
  class ForeignItemEntity {}
  void ForeignItemEntity;

  afterAll(() => {
    entityRegistry.unregister("ForeignItem");
    ormRegistry.unregister("mongo_guards_foreign");
  });

  it("une instance de classe (table Drizzle) est refusée en nommant l'entité", async () => {
    const orm = new MongooseOrm("mongo_guards_foreign", URI!);
    try {
      await assert.rejects(
        orm.connect(),
        (e: unknown) =>
          e instanceof TypeError && e.message.includes("ForeignItem"),
      );
    } finally {
      await orm.disconnect();
    }
  });
});
