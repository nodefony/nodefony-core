import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { Criteria } from "@nodefony/orm-core";
import type {
  IPasswordAuthenticatedUser,
  ISocialProvider,
} from "@nodefony/user";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleUserRepository } from "../../nodefony/src/DrizzleUserRepository";
import {
  registerUserEntity,
  type UserRow,
} from "../../nodefony/entity/userTable";

/**
 * e2e **MySQL** du repository utilisateur (S4 multi-dialecte) — miroir de
 * l'e2e Postgres : defaults JS (UUID/roles/flags/dates), colonnes `dateMs`
 * (datetime(3) UTC ↔ `Date`), UNIQUE `identifier` (varchar 512), et le POINT
 * DUR du lot : `findBySocialProvider` routé queryKit = `JSON_CONTAINS`
 * (l'équivalent sémantique du `@>` jsonb — Shadow User OAuth). Les verbes
 * create/updateOne passent ici par les chemins mysql SANS RETURNING
 * ($returningId + relecture par PK).
 *
 * GATE : `NF_MYSQL_URL` (sinon skip) — cf repository-contract-mysql.e2e.test.ts.
 */

const MYSQL_URL = process.env.NF_MYSQL_URL;
const ORM = "user_mysql_e2e";

/** Lien social complet (le JSON stocké porte AUSSI createdAt → teste le containment partiel). */
function social(provider: string, providerId: string): ISocialProvider {
  return { provider, providerId, createdAt: new Date(1_700_000_000_000) };
}

describe.skipIf(!MYSQL_URL)(
  "DrizzleUserRepository — e2e MySQL (S4 multi-dialecte)",
  () => {
    let orm: DrizzleOrm;
    let users: DrizzleUserRepository;

    beforeAll(async () => {
      registerUserEntity(ORM, "mysql"); // variante mysqlTable, AVANT connect
      orm = new DrizzleOrm(ORM, { dialect: "mysql", url: MYSQL_URL });
      await orm.connect(); // DDL dérivé : CREATE TABLE IF NOT EXISTS `User`
      users = DrizzleUserRepository.from(orm);
      await orm.getRepository<UserRow>("User").delete({});
    });

    afterAll(async () => {
      await orm.disconnect();
      entityRegistry.unregister("User", ORM);
      ormRegistry.unregister(ORM);
    });

    it("create : defaults JS posés (UUID, roles [], enabled, datetime(3) → Date)", async () => {
      const alice = await users.create({
        identifier: "my-alice",
        password: "argon2id$fake",
      });
      assert.match(
        alice.id,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        "id UUID via defaultFn (relu par $returningId + relecture PK)",
      );
      assert.deepEqual(alice.roles, []);
      assert.equal(alice.enabled, true);
      assert.equal(alice.locked, false);
      assert.deepEqual(alice.socialProviders, []);
      const entity = alice as unknown as { createdAt: Date; updatedAt: Date };
      assert.ok(entity.createdAt instanceof Date, "dateMs relue en Date");
      assert.ok(entity.updatedAt instanceof Date);
      assert.equal(alice.isActive(), true);
    });

    it("findByIdentifier + UNIQUE : le doublon de login est REFUSÉ par MySQL", async () => {
      const found = await users.findByIdentifier("my-alice");
      assert.equal(found?.identifier, "my-alice");
      assert.equal(await users.findByIdentifier("my-ghost"), null);
      await assert.rejects(
        () => users.create({ identifier: "my-alice" }),
        (err: unknown) => {
          // drizzle/mysql2 wrappe l'erreur (« Failed query: … ») ; la violation
          // ER_DUP_ENTRY vit dans la chaîne des causes.
          const chain = [
            String((err as Error)?.message),
            String((err as { cause?: Error })?.cause?.message),
          ].join(" | ");
          return /duplicate entry|unique/i.test(chain);
        },
        "contrainte UNIQUE(identifier) réelle en base",
      );
    });

    it("updateOne (chemin mysql sans RETURNING) : patch appliqué, updatedAt régénéré, createdAt intact", async () => {
      const before = (await users.findByIdentifier("my-alice")) as unknown as {
        createdAt: Date;
        updatedAt: Date;
      };
      await new Promise((r) => setTimeout(r, 5));
      const updated = await users.updateOne(
        { identifier: "my-alice" } as Criteria<IPasswordAuthenticatedUser>,
        { currentRole: "ROLE_ADMIN" },
      );
      assert.equal(updated?.currentRole, "ROLE_ADMIN");
      const after = updated as unknown as { createdAt: Date; updatedAt: Date };
      assert.equal(
        after.createdAt.getTime(),
        before.createdAt.getTime(),
        "createdAt jamais réécrit",
      );
      assert.ok(
        after.updatedAt.getTime() > before.updatedAt.getTime(),
        "updatedAt régénéré à l'UPDATE (onUpdateFn)",
      );
    });

    it("findBySocialProvider (JSON_CONTAINS) : match exact provider+providerId, clés extra ignorées", async () => {
      await users.create({
        identifier: "my-bob",
        socialProviders: [social("github", "gh-42"), social("google", "g-7")],
      });
      const byGithub = await users.findBySocialProvider("github", "gh-42");
      assert.equal(byGithub?.identifier, "my-bob", "élément 1 du tableau");
      const byGoogle = await users.findBySocialProvider("google", "g-7");
      assert.equal(byGoogle?.identifier, "my-bob", "élément 2 du tableau");
      // Le containment matche l'élément malgré sa clé createdAt supplémentaire,
      // et EXIGE la conjonction des deux champs sur le MÊME élément :
      assert.equal(
        await users.findBySocialProvider("github", "g-7"),
        null,
        "provider d'un élément + providerId d'un autre ≠ match",
      );
      assert.equal(await users.findBySocialProvider("github", "gh-999"), null);
      assert.equal(await users.findBySocialProvider("gitlab", "gh-42"), null);
    });

    it("findBySocialProvider : valeurs hostiles BINDÉES (pas d'injection JSON possible)", async () => {
      assert.equal(
        await users.findBySocialProvider("gh\"]'; DROP TABLE `User`; --", "x"),
        null,
      );
      assert.equal(
        await users.findBySocialProvider("github", `{"providerId":"gh-42"}`),
        null,
      );
      assert.ok(
        await users.findByIdentifier("my-bob"),
        "la table existe toujours",
      );
    });

    it("count / delete : fin de vie sur MySQL (compteurs affectedRows)", async () => {
      assert.equal(await users.count(), 2);
      assert.equal(
        await users.delete({
          identifier: "my-bob",
        } as Criteria<IPasswordAuthenticatedUser>),
        1,
        "delete compté via affectedRows",
      );
      assert.equal(await users.count(), 1);
    });
  },
);
