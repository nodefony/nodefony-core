import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { entity, entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";

/**
 * Red-team (passe 1, threat-first) : un nom de champ venu de la requête — tri
 * `?sort=`, filtre `?field=` — atteint le repository. La liste blanche est le
 * SCHÉMA de l'entité ; l'attaque vise ce qui passe une liste blanche écrite
 * en `table[nom]` : les clés HÉRITÉES du prototype, qui ne sont pas des
 * colonnes mais ne valent pas `undefined`.
 *
 * Verdict exigé : refus nommé (`Unknown criteria field` / `InvalidOrderOption`),
 * jamais un SQL émis ni une erreur du pilote, jamais un résultat.
 */
const ORM = "db_attack_order";

interface Account {
  id: string;
  email: string;
  password: string;
  age: number;
}

const accountsTable = sqliteTable("Account", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  age: integer("age").notNull(),
});

@entity({ connector: ORM, name: "Account", schema: accountsTable })
class AccountEntity {}
void AccountEntity;

const PROTO_KEYS = [
  "constructor",
  "__proto__",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "__defineGetter__",
];
const SQL_KEYS = ['age" ; DROP TABLE "Account', "age--", "1", "age ASC, email"];
const REFUSAL = /Unknown criteria field|InvalidOrderOption|order/i;

describe("red-team — noms de champ hostiles (tri, critère, distinct)", () => {
  let orm: DrizzleOrm;
  let accounts: IRepository<Account>;

  beforeAll(async () => {
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
    accounts = orm.getRepository<Account>("Account");
    await accounts.create({ email: "a@x.io", password: "h1", age: 30 });
    await accounts.create({ email: "b@x.io", password: "h2", age: 40 });
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister("Account");
    ormRegistry.unregister(ORM);
  });

  it("contrôle positif : un tri et un critère légitimes répondent", async () => {
    const rows = await accounts.find({ age: { $gt: 0 } }, {
      order: [["age", "DESC"]],
    } as never);
    assert.deepEqual(
      rows.map((r) => r.email),
      ["b@x.io", "a@x.io"],
    );
  });

  for (const key of [...PROTO_KEYS, ...SQL_KEYS]) {
    it(`tri préparé sur « ${key} » → refus nommé`, async () => {
      await assert.rejects(
        () => accounts.find({}, { order: [[key, "ASC"]] } as never),
        REFUSAL,
      );
    });

    it(`tri direct (opérateur riche) sur « ${key} » → refus nommé`, async () => {
      await assert.rejects(
        () =>
          accounts.find({ age: { $gt: 0 } }, {
            order: [[key, "DESC"]],
          } as never),
        REFUSAL,
      );
    });

    it(`critère sur « ${key} » → refus nommé`, async () => {
      await assert.rejects(
        () => accounts.find(JSON.parse(`{"${key.replaceAll('"', '\\"')}": 1}`)),
        REFUSAL,
      );
    });

    it(`countDistinct sur « ${key} » → refus nommé`, async () => {
      await assert.rejects(() => accounts.countDistinct(key as never), REFUSAL);
    });
  }

  for (const dir of [
    "ASC; DROP TABLE Account",
    "asc",
    "",
    "DESC NULLS FIRST",
  ]) {
    it(`sens de tri « ${dir} » → refus (seuls ASC/DESC)`, async () => {
      await assert.rejects(
        () => accounts.find({}, { order: [["age", dir]] } as never),
        /InvalidOrderOption|order/i,
      );
    });
  }

  it("la table a survécu à toutes les tentatives", async () => {
    assert.equal(await accounts.count(), 2);
  });
});
