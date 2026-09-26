import { DrizzleOrm } from "../../index";
import { entityRegistry, ormRegistry, defineEntity } from "@nodefony/orm-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Les contraintes d'intégrité arrivent-elles VRAIMENT en base, et mordent-elles ?
 *
 * Une colonne de relation naissait indexée et sans contrainte : la base acceptait
 * une ligne qui désigne un parent inexistant, et rien ne le signalait. Deux
 * pièges rendent la vérification indispensable, et aucun des deux ne lève :
 *
 * - une contrainte peut être ÉCRITE dans le schéma et sans effet — SQLite ignore
 *   les clés étrangères tant que `PRAGMA foreign_keys` n'est pas posé, et il vaut
 *   OFF par défaut ;
 * - une table créée avant sa cible échoue à la création, donc c'est l'ORDRE qui
 *   décide si le schéma existe.
 *
 * On interroge donc la base, jamais le code : ce qui compte est ce qu'elle refuse.
 */
const ORM = "test-ddl-fk";

const authorTable = sqliteTable("fk_authors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

const postTable = sqliteTable("fk_posts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  // Obligatoire → `restrict` : la colonne ne peut pas passer à NULL, donc son
  // parent ne peut pas s'en aller.
  author: text("author")
    .references(() => authorTable.id, { onDelete: "restrict" })
    .notNull(),
});

const commentTable = sqliteTable("fk_comments", {
  id: text("id").primaryKey(),
  body: text("body").notNull(),
  // Facultative → `set null` : l'enfant survit, et son orphelinage est explicite.
  post: text("post").references(() => postTable.id, { onDelete: "set null" }),
  // Auto-référence : aucune dépendance d'ordre, la table se désigne elle-même
  // dans son propre `CREATE TABLE`.
  parent: text("parent").references((): AnySQLiteColumn => commentTable.id, {
    onDelete: "set null",
  }),
});

// Deux entités qui se désignent l'une l'autre : aucun ordre de création ne
// satisfait les deux. Le cas ne s'obtient pas par accident, il se construit.
const cycleLeft = sqliteTable("fk_cycle_left", {
  id: text("id").primaryKey(),
  right: text("right").references((): AnySQLiteColumn => cycleRight.id, {
    onDelete: "set null",
  }),
});
const cycleRight = sqliteTable("fk_cycle_right", {
  id: text("id").primaryKey(),
  left: text("left").references((): AnySQLiteColumn => cycleLeft.id, {
    onDelete: "set null",
  }),
});

const AuthorEntity = defineEntity({
  name: "FkAuthor",
  module: "test",
  schema: authorTable,
});
const PostEntity = defineEntity({
  name: "FkPost",
  module: "test",
  schema: postTable,
});
const CommentEntity = defineEntity({
  name: "FkComment",
  module: "test",
  schema: commentTable,
});

/** Le SQL que la base a réellement retenu pour une table. */
async function schemaOf(orm: DrizzleOrm, table: string): Promise<string> {
  const db = orm.getNativeConnection() as {
    all(query: unknown): Promise<{ sql: string }[]>;
  };
  const rows = await db.all(
    sql`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ${table}`,
  );
  return rows[0]?.sql ?? "";
}

describe("DDL de développement — les contraintes d'intégrité sont émises", () => {
  let orm: DrizzleOrm;

  beforeAll(async () => {
    // Enregistrées dans le DÉSORDRE volontairement — mais ce n'est PAS ici que
    // l'ordre de création se prouve : SQLite résout ses clés étrangères
    // TARDIVEMENT, et accepte sans broncher une table qui en désigne une qui
    // n'existe pas encore (constaté en débranchant le tri : ce banc restait
    // vert). PostgreSQL et MySQL, eux, refusent. Le tri se prouve donc à deux
    // autres endroits : `ddl-plan.test.ts` (l'algorithme, sans base) et les
    // bancs e2e des deux serveurs.
    entityRegistry.register({ ...PostEntity, connector: ORM });
    entityRegistry.register({ ...CommentEntity, connector: ORM });
    entityRegistry.register({ ...AuthorEntity, connector: ORM });
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister("FkPost", ORM);
    entityRegistry.unregister("FkComment", ORM);
    entityRegistry.unregister("FkAuthor", ORM);
    ormRegistry.unregister(ORM);
  });

  it("la contrainte figure dans le schéma retenu par la base", async () => {
    const schema = await schemaOf(orm, "fk_posts");
    if (!/FOREIGN KEY/iu.test(schema)) {
      throw new Error(`aucune clé étrangère dans : ${schema}`);
    }
    if (!/ON DELETE RESTRICT/iu.test(schema)) {
      throw new Error(`politique d'effacement absente de : ${schema}`);
    }
  });

  // Le réglage est REDONDANT avec le pilote actuel (`better-sqlite3` compile
  // SQLite avec `SQLITE_DEFAULT_FOREIGN_KEYS=1`), et c'est précisément pourquoi
  // on le contrôle : sans ce banc, plus rien ne distingue « nous l'avons posé »
  // de « le pilote l'a fait pour nous », et la garantie disparaîtrait le jour
  // où l'application ouvre sa base autrement.
  it("le réglage qui rend les contraintes effectives est POSÉ", async () => {
    const db = orm.getNativeConnection() as {
      all(query: unknown): Promise<Record<string, number>[]>;
    };
    const rows = await db.all(sql`PRAGMA foreign_keys`);
    const value = Object.values(rows[0] ?? {})[0];
    if (value !== 1) {
      throw new Error(
        `foreign_keys vaut ${String(value)} : les contraintes sont décoratives`,
      );
    }
  });

  it("une colonne facultative passe à NULL, pas en RESTRICT", async () => {
    const schema = await schemaOf(orm, "fk_comments");
    if (!/ON DELETE SET NULL/iu.test(schema)) {
      throw new Error(`politique attendue absente de : ${schema}`);
    }
  });

  // LA preuve : sans `PRAGMA foreign_keys = ON`, tout ce qui précède reste vrai
  // et la base accepte quand même l'orphelin.
  it("la base REFUSE une ligne qui désigne un parent inexistant", async () => {
    const posts = orm.getRepository<{
      id: string;
      title: string;
      author: string;
    }>("FkPost");
    let refused = false;
    try {
      await posts.create({ id: "p1", title: "orphelin", author: "inconnu" });
    } catch {
      refused = true;
    }
    if (!refused) {
      throw new Error(
        "la contrainte est DÉCORATIVE : la base a accepté un parent inexistant",
      );
    }
  });

  it("la base REFUSE d'effacer un parent encore désigné", async () => {
    const authors = orm.getRepository<{ id: string; name: string }>("FkAuthor");
    const posts = orm.getRepository<{
      id: string;
      title: string;
      author: string;
    }>("FkPost");
    await authors.create({ id: "a1", name: "Camus" });
    await posts.create({ id: "p2", title: "La Peste", author: "a1" });
    let refused = false;
    try {
      await authors.deleteOne({ id: "a1" });
    } catch {
      refused = true;
    }
    if (!refused) {
      throw new Error("le parent a été effacé alors qu'un enfant le désigne");
    }
  });
});

describe("DDL de développement — un cycle est posé, et DIT", () => {
  const ORM = "test-ddl-fk-cycle";
  let orm: DrizzleOrm;
  const avertissements: string[] = [];

  beforeAll(async () => {
    entityRegistry.register({
      ...defineEntity({
        name: "FkCycleLeft",
        module: "test",
        schema: cycleLeft,
      }),
      connector: ORM,
    });
    entityRegistry.register({
      ...defineEntity({
        name: "FkCycleRight",
        module: "test",
        schema: cycleRight,
      }),
      connector: ORM,
    });
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    // L'espion est posé AVANT la connexion : c'est pendant elle que le DDL est
    // dérivé, donc c'est le seul moment où l'avertissement peut sortir.
    const original = orm.log.bind(orm);
    orm.log = (message: unknown, severity?: unknown, ...rest: unknown[]) => {
      if (severity === "WARNING") {
        avertissements.push(String(message));
      }
      return original(
        message,
        severity as Parameters<typeof original>[1],
        ...(rest as []),
      );
    };
    await orm.connect();
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister("FkCycleLeft", ORM);
    entityRegistry.unregister("FkCycleRight", ORM);
    ormRegistry.unregister(ORM);
  });

  // Refuser de démarrer serait hors de proportion ; se taire serait pire — on
  // croirait tenir une garantie qui n'existe pas.
  it("l'application démarre quand même, les deux tables existent", async () => {
    for (const table of ["fk_cycle_left", "fk_cycle_right"]) {
      const schema = await schemaOf(orm, table);
      if (!schema) {
        throw new Error(
          `table « ${table} » absente : le cycle a bloqué le DDL`,
        );
      }
    }
  });

  it("l'avertissement NOMME les tables, la cause et le geste", () => {
    const message = avertissements.find((texte) => texte.includes("cycle"));
    if (!message) {
      throw new Error(
        `aucun avertissement de cycle — reçus : ${avertissements.join(" | ") || "aucun"}`,
      );
    }
    for (const attendu of ["fk_cycle_", "orm:generate"]) {
      if (!message.includes(attendu)) {
        throw new Error(`« ${attendu} » absent de : ${message}`);
      }
    }
  });
});
