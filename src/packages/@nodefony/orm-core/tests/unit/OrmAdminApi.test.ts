import assert from "node:assert/strict";
import { ormRegistry } from "../../nodefony/src/OrmRegistry";
import { entityRegistry } from "../../nodefony/src/EntityRegistry";
import {
  buildOrmGraph,
  createOrmAdminApi,
  toDbml,
  toJsonSchema,
} from "../../nodefony/src/OrmAdminApi";
import type {
  IColumnInfo,
  IOrm,
  IEntity,
} from "../../nodefony/interfaces/index";
import type { IAdminRequest } from "nodefony";

const ORM = "testblog";

/** Stub IOrm : seuls `isConnected` + `describeEntity` sont lus par le graphe. */
const cols: Record<string, IColumnInfo[]> = {
  Author: [
    {
      name: "id",
      type: "text",
      primaryKey: true,
      nullable: false,
      unique: false,
    },
    {
      name: "email",
      type: "text",
      primaryKey: false,
      nullable: false,
      unique: true,
    },
  ],
  Article: [
    {
      name: "id",
      type: "text",
      primaryKey: true,
      nullable: false,
      unique: false,
    },
    {
      name: "title",
      type: "text",
      primaryKey: false,
      nullable: false,
      unique: false,
    },
    {
      name: "authorId",
      type: "text",
      primaryKey: false,
      nullable: true,
      unique: false,
    },
  ],
};

const stubOrm: IOrm = {
  name: ORM,
  isConnected: () => true,
  describeEntity: (name: string) => cols[name] ?? [],
  connect: async () => {},
  disconnect: async () => {},
  getRepository: () => {
    throw new Error("unused");
  },
  transaction: async () => {
    throw new Error("unused");
  },
  getNativeConnection: () => {
    throw new Error("unused");
  },
};

const author: IEntity = {
  name: "Author",
  orm: ORM,
  module: "blog",
  schema: {},
  relations: [{ type: "one-to-many", target: "Article", field: "articles" }],
};
const article: IEntity = {
  name: "Article",
  orm: ORM,
  module: "blog",
  schema: {},
  relations: [{ type: "many-to-one", target: "Author", field: "author" }],
};

/** Requête admin minimale pour invoquer un handler. */
const req = (
  params: Record<string, string> = {},
  query: Record<string, string> = {},
): IAdminRequest => ({ params, query, body: null, user: null, roles: [] });

describe("OrmAdminApi — graphe canonique + DBML", () => {
  beforeEach(() => {
    ormRegistry.register(ORM, stubOrm);
    entityRegistry.register(author);
    entityRegistry.register(article);
  });
  afterEach(() => {
    entityRegistry.unregister("Author", ORM);
    entityRegistry.unregister("Article", ORM);
    ormRegistry.unregister(ORM);
  });

  it("buildOrmGraph : ORM résumé + entités avec colonnes + relations", () => {
    const g = buildOrmGraph(ORM);
    assert.equal(g.orms.length, 1);
    assert.deepEqual(g.orms[0], {
      name: ORM,
      // vendor dérivé du nom de classe ; le stub = objet littéral → ctor `Object`.
      vendor: "object",
      default: false,
      connected: true,
      entityCount: 2,
      // le stub n'implémente pas describeConnection → undefined.
      connection: undefined,
    });
    const author = g.entities.find((e) => e.name === "Author");
    assert.ok(author);
    assert.equal(author.columns.length, 2);
    assert.equal(author.columns[0].name, "id");
    assert.equal(author.relations[0].target, "Article");
    assert.equal(author.module, "blog"); // module propriétaire propagé
  });

  it('graphe : module propagé par entité (regroupement ERD) ; défaut ""', () => {
    // Une entité sans module → groupe « — » (chaîne vide), jamais undefined.
    entityRegistry.register({ name: "Orphan", orm: ORM, schema: {} });
    try {
      const g = buildOrmGraph(ORM);
      const byModule = new Map<string, string[]>();
      for (const e of g.entities) {
        byModule.set(e.module, [...(byModule.get(e.module) ?? []), e.name]);
      }
      assert.deepEqual([...(byModule.get("blog") ?? [])].sort(), [
        "Article",
        "Author",
      ]);
      assert.deepEqual(byModule.get(""), ["Orphan"]); // non rattachée
    } finally {
      entityRegistry.unregister("Orphan", ORM);
    }
  });

  it("toDbml : tables + colonnes typées + settings pk/unique/not null", () => {
    const dbml = toDbml(buildOrmGraph(ORM));
    assert.match(dbml, /Table Author \{/);
    assert.match(dbml, /id text \[pk\]/);
    assert.match(dbml, /email text \[unique, not null\]/);
  });

  it("toDbml : Ref dérivé des relations (FK convention adapters)", () => {
    const dbml = toDbml(buildOrmGraph(ORM));
    // one-to-many Author->Article : FK authorId sur Article → Article.authorId > Author.id
    assert.match(dbml, /Ref: Article\.authorId > Author\.id/);
  });

  it("toJsonSchema : $defs par entité, required = non-nullables, relations en $ref", () => {
    const schema = toJsonSchema(buildOrmGraph(ORM));
    assert.equal(
      schema.$schema,
      "https://json-schema.org/draft/2020-12/schema",
    );

    const a = schema.$defs.Author;
    assert.ok(a);
    assert.equal(a.type, "object");
    assert.equal(a.additionalProperties, false);
    assert.equal(a.properties.id.type, "string");
    assert.deepEqual(a.required, ["id", "email"]); // les deux non-nullables
    // one-to-many → tableau de $ref vers Article.
    assert.deepEqual(a.properties.articles, {
      type: "array",
      items: { $ref: "#/$defs/Article" },
    });

    const art = schema.$defs.Article;
    assert.ok(art);
    assert.deepEqual(art.required, ["id", "title"]); // authorId nullable → exclu
    // many-to-one → $ref simple vers Author.
    assert.deepEqual(art.properties.author, { $ref: "#/$defs/Author" });
  });

  it("handler export jsonschema → JSON valide (draft 2020-12)", async () => {
    const api = createOrmAdminApi();
    const ep = api.adminEndpoints().find((e) => e.path === "export/{format}")!;
    const res = (await ep.handler(
      req({ format: "jsonschema" }, { orm: ORM }),
    )) as { format: string; content: string };
    assert.equal(res.format, "jsonschema");
    const parsed = JSON.parse(res.content) as {
      $defs: Record<string, unknown>;
    };
    assert.ok(parsed.$defs.Author && parsed.$defs.Article);
  });

  it("handler orms / graph / export dbml", async () => {
    const api = createOrmAdminApi();
    const ep = (p: string) => api.adminEndpoints().find((e) => e.path === p)!;

    const orms = await ep("orms").handler(req());
    assert.ok(Array.isArray(orms) && orms.some((o) => o.name === ORM));

    const exp = (await ep("export/{format}").handler(
      req({ format: "dbml" }, { orm: ORM }),
    )) as { format: string; content: string };
    assert.equal(exp.format, "dbml");
    assert.match(exp.content, /Table Author/);
  });

  it("handler export format invalide → 400", async () => {
    const api = createOrmAdminApi();
    const ep = api.adminEndpoints().find((e) => e.path === "export/{format}")!;
    const res = (await ep.handler(req({ format: "xml" }))) as {
      status: number;
    };
    assert.equal(res.status, 400);
  });

  it("handler entity inconnue → 404", async () => {
    const api = createOrmAdminApi();
    const ep = api.adminEndpoints().find((e) => e.path === "entity/{name}")!;
    const res = (await ep.handler(req({ name: "Nope" }))) as { status: number };
    assert.equal(res.status, 404);
  });
});
