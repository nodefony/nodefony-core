import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import {
  runUserPaginationContract,
  type UserSeedRow,
} from "../../../user/tests/support/userPaginationContract";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import {
  registerUserEntity,
  type UserRow,
} from "../../nodefony/entity/userTable";
import { DrizzleUserRepository } from "../../nodefony/src/DrizzleUserRepository";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";

/**
 * Enveloppe Drizzle du **banc de contrat UNIQUE** (`@nodefony/user`) : gère le
 * cycle de vie ORM (register entité → connect → disconnect + unregister scopé) et
 * branche le harness sur le base repository. Aucune assertion ici — elles vivent
 * dans le banc, partagé avec le store mémoire et Mongoose. `skip` gate les e2e
 * pg/mysql sur la présence de leur URL.
 */
export function runDrizzleUserPagination(opts: {
  label: string;
  ormName: string;
  config: ConstructorParameters<typeof DrizzleOrm>[1];
  dialect?: SqlDialect;
  skip?: boolean;
}): void {
  describe.skipIf(opts.skip ?? false)(opts.label, () => {
    let orm: DrizzleOrm;
    let users: DrizzleUserRepository;

    beforeAll(async () => {
      registerUserEntity(opts.ormName, opts.dialect);
      orm = new DrizzleOrm(opts.ormName, opts.config);
      await orm.connect();
      users = DrizzleUserRepository.from(orm);
    });
    afterAll(async () => {
      await orm.disconnect();
      entityRegistry.unregister("User", opts.ormName);
      ormRegistry.unregister(opts.ormName);
    });

    runUserPaginationContract({
      users: () => users,
      insert: async (rows: UserSeedRow[]) => {
        const base = orm.getRepository<UserRow>("User");
        for (const row of rows) await base.create(row);
      },
      clear: async () => {
        await orm.getRepository<UserRow>("User").delete({});
      },
    });

    // Les verbes CRUD du repository, sur CE dialecte.
    //
    // `DrizzleUserRepository` n'a presque pas de logique propre : il délègue au
    // repository de base et remappe chaque ligne en `BaseUser`. C'est justement
    // ce remappage qui est l'enjeu — un verbe qui l'oublierait rendrait une LIGNE
    // SQL brute, sans `hasRole()`/`isActive()`, et les consommateurs (firewall,
    // authenticators, voters) perdraient le comportement sans qu'aucun type ne
    // proteste (la ligne a les mêmes champs). Le mapping dépend en outre du
    // dialecte (`roles` JSON = jsonb / text / json, dates = timestamptz /
    // integer / datetime), donc il se vérifie sur les trois, pas sur sqlite seul.
    describe("verbes CRUD — chaque retour est un utilisateur, jamais une ligne", () => {
      beforeEach(async () => {
        await orm.getRepository<UserRow>("User").delete({});
      });

      /** Ce qu'un consommateur attend : du COMPORTEMENT, pas des champs. */
      const assertBehaves = (u: unknown, label: string): void => {
        const user = u as {
          hasRole?: unknown;
          isActive?: unknown;
          roles?: unknown;
        };
        assert.equal(
          typeof user.hasRole,
          "function",
          `${label} doit rendre un BaseUser (hasRole absent → ligne brute)`,
        );
        assert.equal(typeof user.isActive, "function", `${label} : isActive`);
        assert.ok(Array.isArray(user.roles), `${label} : roles désérialisé`);
      };

      it("create rend un utilisateur au comportement complet", async () => {
        const u = await users.create({
          identifier: "crud-a",
          password: "h",
          roles: ["ROLE_USER"],
        });
        assertBehaves(u, "create");
        assert.equal(u.hasRole("ROLE_USER"), true);
        assert.equal(u.isActive(), true);
      });

      it("findOne et find remappent aussi", async () => {
        await users.create({ identifier: "crud-a", roles: ["ROLE_USER"] });
        assertBehaves(await users.findOne({ identifier: "crud-a" }), "findOne");
        assertBehaves((await users.find())[0], "find");
      });

      it("updateOne applique le patch ET remappe", async () => {
        await users.create({ identifier: "crud-a", roles: ["ROLE_USER"] });
        const up = await users.updateOne(
          { identifier: "crud-a" },
          { roles: ["ROLE_NODEFONY_ADMIN"] },
        );
        assertBehaves(up, "updateOne");
        assert.equal(up!.hasRole("ROLE_NODEFONY_ADMIN"), true);
        assert.equal(
          await users.updateOne({ identifier: "absent" }, { password: "x" }),
          null,
          "critère sans correspondance → null",
        );
      });

      it("upsert : met à jour l'existant, crée sinon — remappé dans les deux cas", async () => {
        await users.create({ identifier: "crud-a", roles: ["ROLE_USER"] });
        const updated = await users.upsert(
          { identifier: "crud-a" },
          { password: "h2" },
        );
        assertBehaves(updated, "upsert (update)");
        assert.equal(await users.count(), 1, "aucun doublon créé");

        const created = await users.upsert(
          { identifier: "crud-b" },
          { password: "h3" },
          { roles: ["ROLE_USER"] },
        );
        assertBehaves(created, "upsert (insert)");
        assert.equal(created.identifier, "crud-b");
      });

      it("createMany remappe TOUT le lot", async () => {
        const made = await users.createMany([
          { identifier: "crud-a" },
          { identifier: "crud-b" },
        ]);
        assert.equal(made.length, 2);
        for (const u of made) assertBehaves(u, "createMany");
      });

      it("findOneAndDelete rend l'utilisateur supprimé, puis null", async () => {
        await users.create({ identifier: "crud-a", roles: ["ROLE_USER"] });
        const gone = await users.findOneAndDelete({ identifier: "crud-a" });
        assertBehaves(gone, "findOneAndDelete");
        assert.equal(
          await users.findOneAndDelete({ identifier: "crud-a" }),
          null,
        );
      });

      it("exists / deleteOne / delete / updateMany : comptes exacts", async () => {
        await users.createMany([
          { identifier: "crud-a", roles: [] },
          { identifier: "crud-b", roles: [] },
        ]);
        assert.equal(await users.exists({ identifier: "crud-a" }), true);
        assert.equal(await users.exists({ identifier: "absent" }), false);

        assert.equal(
          await users.updateMany({ identifier: "crud-a" }, { password: "h" }),
          1,
        );
        assert.equal(await users.deleteOne({ identifier: "crud-a" }), true);
        assert.equal(
          await users.deleteOne({ identifier: "crud-a" }),
          false,
          "seconde suppression : false, jamais une erreur",
        );
        assert.equal(await users.delete({}), 1);
        assert.equal(await users.count(), 0);
      });

      // `increment` n'est PAS exercé ici : l'entité `User` n'a aucun champ
      // numérique (rôles JSON, dates, booléens), le verbe n'a donc pas de cible
      // réaliste. Il est couvert — avec un vrai compteur et sur les 3 dialectes —
      // par le banc de contrat `IRepository` (`repository-contract.ts`).
    });
  });
}
