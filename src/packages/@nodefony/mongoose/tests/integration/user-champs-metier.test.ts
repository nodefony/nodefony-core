import assert from "node:assert/strict";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import { userSchema } from "../../nodefony/entity/userEntity";
import { MongooseUserRepository } from "../../nodefony/src/MongooseUserRepository";

/**
 * Un champ métier ajouté à l'utilisateur par l'APPLICATION doit se relire —
 * pendant documentaire du banc SQL, et par le MÊME mécanisme.
 *
 * Le schéma ci-dessous est celui d'une application : le contrat, plus ses
 * champs. Mongoose n'est pas schemaless de ce point de vue — un champ non
 * déclaré n'est pas persisté —, donc l'application les déclare, exactement comme
 * elle ajoute une colonne en SQL.
 *
 * Ce banc garde aussi ce que le SQL ne peut pas voir : que `_id` et `__v`, que
 * le moteur ajoute à chaque document, ne débordent PAS sur l'utilisateur rendu.
 */
const ORM = "mongo_user_business_fields";
const URI = mongoTestUri(ORM);

describe.skipIf(!URI)(
  "champs métier de l'application sur `User` (Mongoose)",
  () => {
    let orm: MongooseOrm;
    let users: MongooseUserRepository;
    /** LA porte d'écriture : le dépôt générique, seul à accepter ces champs. */
    let generic: IRepository<Record<string, unknown>>;

    beforeAll(async () => {
      entityRegistry.register({
        connector: ORM,
        name: "User",
        module: "user",
        schema: { ...userSchema, firstName: String, department: String },
        timestamps: true,
      });
      orm = new MongooseOrm(ORM, URI!);
      await orm.connect();
      users = MongooseUserRepository.from(orm);
      generic = orm.getRepository<Record<string, unknown>>("User");
      const connection = orm.getNativeConnection<{
        db?: {
          collections(): Promise<{ deleteMany(f: object): Promise<unknown> }[]>;
        };
      }>();
      const collections = (await connection.db?.collections()) ?? [];
      await Promise.all(collections.map((c) => c.deleteMany({})));
    });

    afterAll(async () => {
      await orm.disconnect();
      entityRegistry.unregister("User", ORM);
      ormRegistry.unregister(ORM);
    });

    it("un champ métier écrit par le dépôt générique se relit", async () => {
      await generic.create({
        identifier: "carol@example.com",
        firstName: "Carol",
        department: "R&D",
      });

      const user = await users.findByIdentifier("carol@example.com");
      assert.ok(user, "utilisateur introuvable");
      assert.equal(
        (user as unknown as { firstName: string }).firstName,
        "Carol",
      );
      assert.equal(
        (user as unknown as { department: string }).department,
        "R&D",
      );
    });

    it("le comportement du contrat est intact, horodatages compris", async () => {
      const user = await users.findByIdentifier("carol@example.com");
      assert.ok(user);
      assert.equal(typeof user.hasRole, "function");
      assert.equal(user.isActive(), true);
      // `timestamps: true` les pose ; le report les rend visibles aux DTO admin —
      // ce que ce dépôt ne faisait PAS, à la différence du dépôt SQL.
      assert.ok(
        (user as unknown as { createdAt: Date }).createdAt instanceof Date,
      );
    });

    it("la plomberie du moteur ne déborde pas sur l'utilisateur", async () => {
      const user = await users.findByIdentifier("carol@example.com");
      assert.ok(user);
      assert.ok(!("_id" in user), "_id ne doit pas être reporté");
      assert.ok(!("__v" in user), "__v ne doit pas être reporté");
      // L'identité reste celle du contrat : une chaîne, pas un ObjectId.
      assert.equal(typeof user.id, "string");
    });

    it("le listing paginé rend lui aussi les champs métier", async () => {
      const page = await users.listPage({ q: "carol", limit: 10 });
      assert.equal(page.items.length, 1);
      assert.equal(
        (page.items[0] as unknown as { firstName: string }).firstName,
        "Carol",
      );
    });
  },
);
