import assert from "node:assert/strict";
import mongoose from "mongoose";
import { BootConfigurationError } from "nodefony";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import { registerUserEntity } from "../../nodefony/entity/userEntity";

/**
 * Un champ privé ne sort JAMAIS par un `populate` — même règle que l'eager-load
 * SQL (`@nodefony/user#entityPrivateFields`), même test côté Drizzle.
 */
const ORM = "mongo_private_fields";
const URI = mongoTestUri(ORM);

interface IOwner {
  id: string;
  identifier: string;
  password?: string;
}
interface IReview {
  id: string;
  comment: string;
  owner?: Record<string, unknown> | string | null;
}
interface IShelf {
  id: string;
  label: string;
  items?: Record<string, unknown>[];
}

describe.skipIf(!URI)(
  "Mongoose — un champ privé ne sort pas par une relation",
  () => {
    let orm: MongooseOrm;
    let users: IRepository<IOwner>;
    let reviews: IRepository<IReview>;
    let shelves: IRepository<IShelf>;
    let items: IRepository<Record<string, unknown>>;

    beforeAll(async () => {
      registerUserEntity(ORM);
      entityRegistry.register({
        connector: ORM,
        name: "Review",
        schema: {
          comment: { type: String, required: true },
          owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        },
      });
      entityRegistry.register({
        connector: ORM,
        name: "Shelf",
        schema: { label: { type: String, required: true } },
        relations: [
          {
            type: "one-to-many",
            target: "Item",
            field: "items",
            foreignKey: "shelf",
          },
        ],
      });
      entityRegistry.register({
        connector: ORM,
        name: "Item",
        schema: {
          title: { type: String, required: true },
          cost: { type: String, required: true },
        },
        privateFields: ["cost"],
      });
      orm = new MongooseOrm(ORM, URI!);
      await orm.connect();
      users = orm.getRepository<IOwner>("User");
      reviews = orm.getRepository<IReview>("Review");
      shelves = orm.getRepository<IShelf>("Shelf");
      items = orm.getRepository("Item");
      for (const repository of [users, reviews, shelves, items]) {
        await repository.delete({});
      }
    });

    afterAll(async () => {
      await orm.disconnect();
      for (const name of ["User", "Review", "Shelf", "Item"]) {
        entityRegistry.unregister(name, ORM);
      }
      ormRegistry.unregister(ORM);
    });

    it("référence vers User : l'identifiant sort, l'empreinte et l'état d'autorisation non", async () => {
      const owner = await users.create({
        identifier: "owner@nodefony.dev",
        password: "$argon2id$secret",
      });
      const review = await reviews.create({ comment: "bien", owner: owner.id });
      const loaded = await reviews.findOne(
        { id: review.id },
        { relations: ["owner"] },
      );
      const populated = loaded?.owner;
      assert.ok(populated !== null && typeof populated === "object");
      assert.equal(populated["identifier"], "owner@nodefony.dev");
      for (const hidden of ["password", "roles", "credentialsVersion"]) {
        assert.ok(!(hidden in populated), hidden);
      }
      const direct = await users.findOne({ id: owner.id });
      assert.equal(direct?.password, "$argon2id$secret");
    });

    it("virtuel one-to-many : un champ déclaré privé par l'enfant ne sort pas", async () => {
      const shelf = await shelves.create({ label: "A" });
      await items.create({ title: "lampe", cost: "12.50", shelf: shelf.id });
      const [loaded] = await shelves.find(
        { id: shelf.id },
        { relations: ["items"] },
      );
      assert.equal(loaded?.items?.length, 1);
      assert.equal(loaded?.items?.[0]?.["title"], "lampe");
      assert.ok(!("cost" in (loaded?.items?.[0] ?? {})));
    });

    it("un champ privé mal orthographié refuse la connexion en le nommant", async () => {
      const name = "mongo_private_fields_typo";
      entityRegistry.register({
        connector: name,
        name: "Item",
        schema: { cost: { type: String } },
        privateFields: ["cots"],
      });
      const typo = new MongooseOrm(name, mongoTestUri(name)!);
      try {
        await assert.rejects(
          typo.connect(),
          (error: unknown) =>
            error instanceof BootConfigurationError &&
            error.message.includes("« cots »"),
        );
      } finally {
        await typo.disconnect().catch(() => undefined);
        entityRegistry.unregister("Item", name);
        ormRegistry.unregister(name);
      }
    });
  },
);
