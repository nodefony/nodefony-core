import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleUserRepository } from "../../nodefony/src/DrizzleUserRepository";

/**
 * Un champ métier ajouté à la table `User` par l'APPLICATION doit se relire.
 *
 * Le défaut corrigé est une asymétrie silencieuse : l'écriture posait bien la
 * valeur en base, et la relecture rendait un utilisateur sans elle — le dépôt
 * reconstruisait l'objet à partir des seules colonnes du contrat. Le
 * développeur voyait sa donnée en base et vide dans son code, sans une erreur.
 *
 * La table ci-dessous est écrite comme une application l'écrit : les colonnes du
 * contrat, plus les siennes. C'est le décor qui vient (l'application possède sa
 * table) ; l'écrire à la main ici, plutôt que de dériver la table du framework,
 * est ce qui rend le banc représentatif.
 */
const ORM = "db_user_business_fields";

const appUserTable = sqliteTable("User", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  identifier: text("identifier").notNull().unique(),
  password: text("password"),
  roles: text("roles", { mode: "json" })
    .notNull()
    .$defaultFn(() => []),
  enabled: integer("enabled", { mode: "boolean" })
    .notNull()
    .$defaultFn(() => true),
  locked: integer("locked", { mode: "boolean" })
    .notNull()
    .$defaultFn(() => false),
  currentRole: text("currentRole"),
  socialProviders: text("socialProviders", { mode: "json" })
    .notNull()
    .$defaultFn(() => []),
  metadata: text("metadata", { mode: "json" })
    .notNull()
    .$defaultFn(() => ({})),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  // Ce que l'application ajoute, et que le framework ne connaît pas.
  firstName: text("firstName"),
  department: text("department"),
});

describe("champs métier de l'application sur `User` (Drizzle sqlite)", () => {
  let orm: DrizzleOrm;
  let users: DrizzleUserRepository;
  /** LA porte d'écriture : le dépôt générique, seul à accepter ces champs. */
  let generic: IRepository<Record<string, unknown>>;

  beforeAll(async () => {
    entityRegistry.register({
      connector: ORM,
      name: "User",
      module: "user",
      schema: appUserTable,
    });
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
    users = DrizzleUserRepository.from(orm);
    generic = orm.getRepository<Record<string, unknown>>("User");
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
    assert.equal((user as unknown as { firstName: string }).firstName, "Carol");
    assert.equal((user as unknown as { department: string }).department, "R&D");
  });

  it("le comportement du contrat est intact", async () => {
    const user = await users.findByIdentifier("carol@example.com");
    assert.ok(user);
    // Toujours un BaseUser, pas une ligne nue.
    assert.equal(typeof user.hasRole, "function");
    assert.equal(user.isActive(), true);
    assert.deepEqual(user.roles, []);
    // Et les horodatages de la ligne restent reportés (DTO admin).
    assert.ok(
      (user as unknown as { createdAt: Date }).createdAt instanceof Date,
    );
  });

  it("un champ métier absent en base ne fabrique rien", async () => {
    await generic.create({ identifier: "dave@example.com" });
    const user = await users.findByIdentifier("dave@example.com");
    assert.ok(user);
    assert.equal((user as unknown as { firstName: unknown }).firstName, null);
  });

  it("le listing paginé rend lui aussi les champs métier", async () => {
    const page = await users.listPage({ q: "carol", limit: 10 });
    assert.equal(page.items.length, 1);
    assert.equal(
      (page.items[0] as unknown as { firstName: string }).firstName,
      "Carol",
    );
  });
});
