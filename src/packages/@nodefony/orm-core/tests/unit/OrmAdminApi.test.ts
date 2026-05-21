import assert from "node:assert/strict";
import { ormRegistry } from "../../nodefony/src/OrmRegistry";
import { entityRegistry } from "../../nodefony/src/EntityRegistry";
import {
  buildOrmGraph,
  createOrmAdminApi,
  toDbml,
} from "../../nodefony/src/OrmAdminApi";
import type { IColumnInfo, IOrm, IEntity } from "../../nodefony/interfaces/index";
import type { IAdminRequest } from "nodefony";

const ORM = "testblog";

/** Stub IOrm : seuls `isConnected` + `describeEntity` sont lus par le graphe. */
const cols: Record<string, IColumnInfo[]> = {
  Author: [
    { name: "id", type: "text", primaryKey: true, nullable: false, unique: false },
    { name: "email", type: "text", primaryKey: false, nullable: false, unique: true },
  ],
  Article: [
    { name: "id", type: "text", primaryKey: true, nullable: false, unique: false },
    { name: "title", type: "text", primaryKey: false, nullable: false, unique: false },
    { name: "authorId", type: "text", primaryKey: false, nullable: true, unique: false },
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
  schema: {},
  relations: [{ type: "one-to-many", target: "Article", field: "articles" }],
};
const article: IEntity = {
  name: "Article",
  orm: ORM,
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
      default: false,
      connected: true,
      entityCount: 2,
    });
    const author = g.entities.find((e) => e.name === "Author");
    assert.ok(author);
    assert.equal(author.columns.length, 2);
    assert.equal(author.columns[0].name, "id");
    assert.equal(author.relations[0].target, "Article");
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
