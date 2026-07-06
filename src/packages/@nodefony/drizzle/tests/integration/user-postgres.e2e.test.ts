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
 * e2e **Postgres** du repository utilisateur (S2 multi-dialecte) — la brique
 * user complète sur PG réel : defaults JS (UUID/roles/flags/dates), colonnes
 * `dateMs` (timestamptz ↔ `Date`), UNIQUE `identifier`, et le POINT DUR du
 * lot : `findBySocialProvider` routé queryKit = containment jsonb `@>`
 * (l'équivalent sémantique du `json_each` SQLite — Shadow User OAuth).
 *
 * GATE : `NF_PG_URL` (sinon skip) — cf token-store-postgres.e2e.test.ts.
 */

const PG_URL = process.env.NF_PG_URL;
const ORM = "user_pg_e2e";

/** Lien social complet (le JSON stocké porte AUSSI createdAt → teste le containment partiel). */
function social(provider: string, providerId: string): ISocialProvider {
  return { provider, providerId, createdAt: new Date(1_700_000_000_000) };
}

describe.skipIf(!PG_URL)(
  "DrizzleUserRepository — e2e Postgres (S2 multi-dialecte)",
  () => {
    let orm: DrizzleOrm;
    let users: DrizzleUserRepository;

    beforeAll(async () => {
      registerUserEntity(ORM, "postgres"); // variante pgTable, AVANT connect
      orm = new DrizzleOrm(ORM, { dialect: "postgres", url: PG_URL });
      await orm.connect(); // DDL dérivé : CREATE TABLE IF NOT EXISTS "User"
      users = DrizzleUserRepository.from(orm);
      await orm.getRepository<UserRow>("User").delete({});
    });

    afterAll(async () => {
      await orm.disconnect();
      entityRegistry.unregister("User", ORM);
      ormRegistry.unregister(ORM);
    });

    it("create : defaults JS posés (UUID, roles [], enabled, dates timestamptz → Date)", async () => {
      const alice = await users.create({
        identifier: "pg-alice",
        password: "argon2id$fake",
      });
      assert.match(
        alice.id,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        "id UUID via defaultFn",
      );
      assert.deepEqual(alice.roles, []);
      assert.equal(alice.enabled, true);
      assert.equal(alice.locked, false);
      assert.deepEqual(alice.socialProviders, []);
      const entity = alice as unknown as { createdAt: Date; updatedAt: Date };
      assert.ok(entity.createdAt instanceof Date, "dateMs relue en Date");
      assert.ok(entity.updatedAt instanceof Date);
      // BaseUser : le comportement voyage avec l'objet (pas une ligne nue).
      assert.equal(alice.isActive(), true);
    });

    it("findByIdentifier + UNIQUE : le doublon de login est REFUSÉ par PG", async () => {
      const found = await users.findByIdentifier("pg-alice");
      assert.equal(found?.identifier, "pg-alice");
      assert.equal(await users.findByIdentifier("pg-ghost"), null);
      await assert.rejects(
        () => users.create({ identifier: "pg-alice" }),
        (err: unknown) => {
          // drizzle/node-postgres wrappe l'erreur PG (« Failed query: … ») ;
          // la violation 23505 vit dans la chaîne des causes.
          const chain = [
            String((err as Error)?.message),
            String((err as { cause?: Error })?.cause?.message),
          ].join(" | ");
          return /duplicate key|unique/i.test(chain);
        },
        "contrainte UNIQUE(identifier) réelle en base",
      );
    });

    it("updateOne : patch appliqué, updatedAt régénéré (onUpdateFn), createdAt intact", async () => {
      const before = (await users.findByIdentifier("pg-alice")) as unknown as {
        createdAt: Date;
        updatedAt: Date;
      };
      await new Promise((r) => setTimeout(r, 5));
      const updated = await users.updateOne(
        { identifier: "pg-alice" } as Criteria<IPasswordAuthenticatedUser>,
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

    it("findBySocialProvider (@> jsonb) : match exact provider+providerId, clés extra ignorées", async () => {
      await users.create({
        identifier: "pg-bob",
        socialProviders: [social("github", "gh-42"), social("google", "g-7")],
      });
      const byGithub = await users.findBySocialProvider("github", "gh-42");
      assert.equal(byGithub?.identifier, "pg-bob", "élément 1 du tableau");
      const byGoogle = await users.findBySocialProvider("google", "g-7");
      assert.equal(byGoogle?.identifier, "pg-bob", "élément 2 du tableau");
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

    it("findBySocialProvider : valeurs hostiles BINDÉES (pas d'injection jsonb possible)", async () => {
      // Si le motif était concaténé, ces payloads casseraient la requête ou
      // matcheraient tout ; bindé, ils ne sont QUE des valeurs sans match.
      assert.equal(
        await users.findBySocialProvider(`gh"]'; DROP TABLE "User"; --`, "x"),
        null,
      );
      assert.equal(
        await users.findBySocialProvider("github", `{"providerId":"gh-42"}`),
        null,
      );
      assert.ok(
        await users.findByIdentifier("pg-bob"),
        "la table existe toujours",
      );
    });

    it("Shadow User post-lien : le rechargement passe par le chemin typé (roles/flags parsés)", async () => {
      const linked = await users.findBySocialProvider("github", "gh-42");
      assert.ok(linked);
      assert.equal(linked.enabled, true, "boolean PG parsé");
      assert.deepEqual(linked.roles, [], "jsonb parsé");
      assert.equal(
        linked.socialProviders.length,
        2,
        "les liens complets voyagent avec l'utilisateur",
      );
      assert.equal(linked.isActive(), true, "BaseUser reconstruit");
    });

    it("count / delete : fin de vie sur PG (compteurs rowCount)", async () => {
      assert.equal(await users.count(), 2);
      assert.equal(
        await users.delete({
          identifier: "pg-bob",
        } as Criteria<IPasswordAuthenticatedUser>),
        1,
        "delete compté via rowCount",
      );
      assert.equal(await users.count(), 1);
    });
  },
);
