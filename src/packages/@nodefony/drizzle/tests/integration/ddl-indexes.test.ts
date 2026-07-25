import { DrizzleOrm } from "../../index";
import { entityRegistry, ormRegistry, defineEntity } from "@nodefony/orm-core";
import { sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import {
  registerSessionEntity,
  SESSION_ENTITY_NAME,
} from "../../nodefony/entity/sessionEntity";

/**
 * Les index déclarés arrivent-ils VRAIMENT en base ?
 *
 * Ils étaient construits sur la table Drizzle depuis toujours, et le DDL dérivé
 * du mode développement ne les émettait pas : une colonne déclarée indexée ne
 * l'était nulle part. Rien ne le signalait — la requête restait correcte,
 * seulement lente. C'est l'écart le plus coûteux à découvrir, parce qu'il ne se
 * voit qu'en charge.
 *
 * On interroge donc `sqlite_master`, pas le code : ce qui compte est ce que la
 * base a réellement créé.
 */
const ORM = "test-ddl-indexes";

const articleTable = sqliteTable(
  "ddl_articles",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    author: text("author").notNull(),
    tenant: text("tenant").notNull(),
  },
  (t) => [
    index("ddl_articles_author_idx").on(t.author),
    uniqueIndex("ddl_articles_slug_uidx").on(t.slug),
  ],
);

const ArticleEntity = defineEntity({
  name: "DdlArticle",
  module: "test",
  schema: articleTable,
});

/** Index réellement présents dans la base, lus au catalogue SQLite. */
async function indexesInDatabase(orm: DrizzleOrm): Promise<string[]> {
  const db = orm.getNativeConnection() as {
    all(query: unknown): Promise<{ name: string }[]>;
  };
  const rows = await db.all(
    sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ddl_articles'`,
  );
  return rows.map((row) => row.name).sort();
}

describe("DDL de développement — les index déclarés sont émis", () => {
  let orm: DrizzleOrm;

  beforeAll(async () => {
    entityRegistry.register({ ...ArticleEntity, connector: ORM });
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister("DdlArticle", ORM);
    ormRegistry.unregister(ORM);
  });

  it("un index simple existe dans le catalogue de la base", async () => {
    const names = await indexesInDatabase(orm);
    if (!names.includes("ddl_articles_author_idx")) {
      throw new Error(
        `index absent de la base — présents : ${names.join(", ") || "aucun"}`,
      );
    }
  });

  it("un index UNIQUE est émis comme tel, et contraint réellement", async () => {
    const names = await indexesInDatabase(orm);
    if (!names.includes("ddl_articles_slug_uidx")) {
      throw new Error(
        `index unique absent — présents : ${names.join(", ") || "aucun"}`,
      );
    }
    // La preuve qui compte : la base REFUSE le doublon. Un index unique présent
    // au catalogue mais sans effet ne vaudrait pas mieux qu'absent.
    const repo = orm.getRepository<{
      id: string;
      slug: string;
      author: string;
      tenant: string;
    }>("DdlArticle");
    await repo.create({
      id: "a1",
      slug: "meme-slug",
      author: "u1",
      tenant: "t1",
    });
    let refused = false;
    try {
      await repo.create({
        id: "a2",
        slug: "meme-slug",
        author: "u2",
        tenant: "t1",
      });
    } catch {
      refused = true;
    }
    if (!refused) {
      throw new Error(
        "le doublon a été accepté : l'index unique ne contraint rien",
      );
    }
  });

  it("la colonne `user` des sessions est indexée EN BASE", async () => {
    // Le data plane filtre les sessions par utilisateur (`listSessions`,
    // `countSessions`) et la révocation en dépend. Le TSDoc du storage promettait
    // un « WHERE indexable côté SQL » que le schéma ne tenait pas : sans cet
    // index, chaque appel balaie la table la plus volumineuse d'une application
    // vivante. On lit le catalogue, pas la spec — c'est la base qui arbitre.
    const sessionOrm = new DrizzleOrm(`${ORM}-session`, {
      filename: ":memory:",
    });
    registerSessionEntity(`${ORM}-session`);
    await sessionOrm.connect();
    try {
      const db = sessionOrm.getNativeConnection() as {
        all(query: unknown): Promise<{ name: string }[]>;
      };
      const rows = await db.all(
        sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'session'`,
      );
      const names = rows.map((row) => row.name);
      if (!names.includes("session_user_idx")) {
        throw new Error(
          `index de session absent — présents : ${names.join(", ") || "aucun"}`,
        );
      }
    } finally {
      await sessionOrm.disconnect();
      entityRegistry.unregister(SESSION_ENTITY_NAME, `${ORM}-session`);
      ormRegistry.unregister(`${ORM}-session`);
    }
  });

  it("rejouer le DDL sur une base existante ne lève pas", async () => {
    // `CREATE INDEX IF NOT EXISTS` : redémarrer une application de développement
    // ne doit pas échouer sur des index déjà créés.
    const second = new DrizzleOrm(`${ORM}-bis`, { filename: ":memory:" });
    entityRegistry.register({ ...ArticleEntity, connector: `${ORM}-bis` });
    await second.connect();
    await second.connect();
    await second.disconnect();
    entityRegistry.unregister("DdlArticle", `${ORM}-bis`);
    ormRegistry.unregister(`${ORM}-bis`);
  });
});
