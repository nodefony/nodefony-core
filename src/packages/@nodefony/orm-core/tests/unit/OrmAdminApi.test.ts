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
  connector: ORM,
  module: "blog",
  schema: {},
  relations: [{ type: "one-to-many", target: "Article", field: "articles" }],
};
const article: IEntity = {
  name: "Article",
  connector: ORM,
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
    entityRegistry.register({ name: "Orphan", connector: ORM, schema: {} });
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
      req({ format: "jsonschema" }, { connector: ORM }),
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
      req({ format: "dbml" }, { connector: ORM }),
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

  describe("migrations — l'état, ou l'empêchement NOMMÉ", () => {
    /**
     * Ce que ces contrôles tiennent : l'écran de la console d'administration
     * ne calcule RIEN. Il affiche ce que l'ORM lui rend — et quand il n'y a
     * rien à afficher, il doit recevoir de quoi le DIRE. Un tableau vide
     * ressemble à « tout va bien » : c'est le pire mode de défaillance d'un
     * écran d'exploitation, et c'est celui qu'on ferme ici.
     */
    const endpoint = () =>
      createOrmAdminApi()
        .adminEndpoints()
        .find((e) => e.path === "migrations")!;

    it("connecteur inconnu → 404 qui NOMME ceux qui existent", async () => {
      const res = (await endpoint().handler(
        req({}, { connector: "nope" }),
      )) as {
        status: number;
        body: { error: string };
      };
      assert.equal(res.status, 404);
      assert.match(res.body.error, /nope/u);
      // Le message liste les connecteurs réels : sans eux, l'utilisateur ne
      // sait pas s'il s'est trompé de nom ou si rien n'est enregistré.
      assert.match(res.body.error, new RegExp(ORM, "u"));
    });

    it("🔴 ORM sans migrations → 501 qui le NOMME, jamais une page vide", async () => {
      const res = (await endpoint().handler(req({}, { connector: ORM }))) as {
        status: number;
        body: { error: { code: string; summary: string } };
      };
      assert.equal(res.status, 501);
      assert.equal(res.body.error.code, "NF_MIGRATE_NO_MIGRATIONS");
      // La phrase dit CE QUI porte ce connecteur — un écran qui affiche
      // « non pris en charge » sans dire par qui n'apprend rien.
      assert.match(res.body.error.summary, new RegExp(ORM, "u"));
    });

    it("l'ORM répond → le plan RELAIE, sans rien recalculer", async () => {
      const rapport = {
        formatVersion: 1,
        connector: ORM,
        verdict: "pending",
        summary: "2 migrations en attente",
        nextActions: [
          { command: "nodefony orm:migrate", args: ["orm:migrate"] },
        ],
        sources: [
          {
            name: "app",
            applied: 1,
            pending: 2,
            failed: 0,
            entries: [{ tag: "0000_init", status: "applied", appliedAt: 42 }],
          },
        ],
        driver: { kind: "sql", dialect: "sqlite" },
      };
      ormRegistry.unregister(ORM);
      ormRegistry.register(ORM, {
        ...stubOrm,
        migrationStatus: async () => rapport,
      });
      const res = await endpoint().handler(req({}, { connector: ORM }));
      // Égalité PROFONDE, pas « contient » : un relais qui reformate est un
      // second producteur, et deux producteurs finissent par se contredire.
      assert.deepEqual(res, rapport);
    });

    it("sans ?connector, c'est « default » — jamais le premier venu", async () => {
      const res = (await endpoint().handler(req())) as {
        status: number;
        body: { error: string };
      };
      // `default` n'est pas enregistré dans ce banc : la réponse doit le
      // nommer LUI, ce qui prouve qu'aucun connecteur n'a été deviné.
      assert.equal(res.status, 404);
      assert.match(res.body.error, /default/u);
    });
  });
});
