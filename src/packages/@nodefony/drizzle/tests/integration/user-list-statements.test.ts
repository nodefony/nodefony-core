import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { registerUserEntity } from "../../nodefony/entity/userTable";
import { DrizzleUserRepository } from "../../nodefony/src/DrizzleUserRepository";

// La page d'utilisateurs (console d'administration) exécute trois requêtes :
// les identifiants de la page, le total, puis la relecture des lignes par
// `$in`. Mesuré au profileur : les trois étaient RECOMPILÉES par SQLite à
// chaque requête HTTP (~285 µs de CPU par page). Ce banc compte les
// compilations natives (`Database.prototype.prepare` espionné) : une page
// rejouée ne doit plus en payer aucune.

const ORM = "db_user_list_statements";
type PrepareFn = typeof Database.prototype.prepare;

describe("liste des utilisateurs — requêtes compilées une seule fois (sqlite)", () => {
  let orm: DrizzleOrm;
  let users: DrizzleUserRepository;
  let prepared: string[] = [];
  const originalPrepare: PrepareFn = Database.prototype.prepare;

  beforeAll(async () => {
    Database.prototype.prepare = function (
      this: InstanceType<typeof Database>,
      source: string,
    ) {
      prepared.push(source);
      return originalPrepare.call(this, source);
    } as PrepareFn;
    registerUserEntity(ORM);
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
    users = DrizzleUserRepository.from(orm);
    for (const name of ["alice", "bob", "chloé", "dan", "eve"]) {
      await users.create({ identifier: `${name}@nodefony.dev`, roles: [] });
    }
  });

  afterAll(async () => {
    Database.prototype.prepare = originalPrepare;
    await orm.disconnect();
    entityRegistry.unregister("User", ORM);
    ormRegistry.unregister(ORM);
  });

  it("la même page rejouée ne recompile rien, et rend les mêmes lignes", async () => {
    const first = await users.listPage({ limit: 3, offset: 0 });
    prepared = [];
    const again = await users.listPage({ limit: 3, offset: 0 });
    // Débranché (cache de queryKit ou `$in` préparé retiré) : 3 par page.
    assert.deepEqual(prepared, [], "aucune compilation sur une page rejouée");
    // Page suivante, 2 lignes : la relecture `$in` a une autre cardinalité,
    // donc UNE forme neuve — compilée une fois, puis réutilisée.
    const next = await users.listPage({ limit: 3, offset: 3 });
    assert.equal(prepared.length, 1, "nouvelle cardinalité = 1 compilation");
    prepared = [];
    await users.listPage({ limit: 3, offset: 3 });
    assert.deepEqual(prepared, [], "rejouée : plus aucune");
    assert.deepEqual(
      again.items.map((u) => u.identifier),
      first.items.map((u) => u.identifier),
    );
    assert.equal(first.total, 5);
    assert.equal(first.hasNext, true);
    // Page suivante, autre offset ET autre cardinalité (2 lignes) : valeurs re-bindées.
    assert.deepEqual(
      next.items.map((u) => u.identifier),
      ["dan@nodefony.dev", "eve@nodefony.dev"],
    );
    assert.equal(next.hasNext, false);
  });
});
