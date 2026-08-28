import assert from "node:assert/strict";
import {
  defineMongooseConfig,
  mongooseConfigJsonSchema,
} from "../../nodefony/config/defineModuleConfig";
import MongooseService from "../../nodefony/service/MongooseService";

describe("@nodefony/mongoose — config (Zod, Ph.2)", () => {
  describe("défauts", () => {
    it("config vide → connecteur `nodefony` localhost:27017/nodefony, debug false", () => {
      const c = defineMongooseConfig();
      assert.equal(c.debug, false);
      assert.ok(c.connectors.nodefony);
      assert.equal(c.connectors.nodefony.host, "localhost");
      assert.equal(c.connectors.nodefony.port, 27017);
      assert.equal(c.connectors.nodefony.dbname, "nodefony");
    });

    it("la config retournée est gelée (immuable)", () => {
      const c = defineMongooseConfig();
      assert.throws(() => {
        (c as { debug: boolean }).debug = true;
      });
    });
  });

  describe("surcharge app (use)", () => {
    it("merge un connecteur custom et applique les défauts manquants", () => {
      const c = defineMongooseConfig({
        debug: true,
        connectors: { app: { dbname: "app" } },
      });
      assert.equal(c.debug, true);
      assert.equal(c.connectors.app.host, "localhost"); // défaut
      assert.equal(c.connectors.app.port, 27017); // défaut
      assert.equal(c.connectors.app.dbname, "app");
    });
  });

  /**
   * `autoIndex` décide si les contraintes d'unicité sont construites au
   * démarrage. Il passait déjà — noyé dans le fourre-tout `options`, sans type
   * ni description — ce qui revenait à ne pas l'offrir : un réglage qu'on ne
   * peut pas découvrir dans la configuration n'existe pas pour qui l'écrit.
   */
  describe("autoIndex — réglage typé du connecteur", () => {
    it("absent par défaut : le comportement de mongoose (construire) est conservé", () => {
      const c = defineMongooseConfig();
      assert.equal(c.connectors.nodefony.autoIndex, undefined);
      assert.equal(
        MongooseService.buildConnectOptions(c.connectors.nodefony),
        undefined,
        "rien à poser : aucune option fabriquée pour rien",
      );
    });

    it("déclaré, il atteint les options de connexion", () => {
      const c = defineMongooseConfig({
        connectors: { prod: { autoIndex: false } },
      });
      assert.equal(c.connectors.prod.autoIndex, false);
      assert.deepEqual(MongooseService.buildConnectOptions(c.connectors.prod), {
        autoIndex: false,
      });
    });

    it("le champ typé PRIME sur une clé homonyme du fourre-tout `options`", () => {
      const c = defineMongooseConfig({
        connectors: {
          prod: {
            autoIndex: false,
            options: { autoIndex: true, maxPoolSize: 5 },
          },
        },
      });
      const options = MongooseService.buildConnectOptions(c.connectors.prod);
      assert.equal(
        options?.autoIndex,
        false,
        "entre deux canaux, celui qui est déclaré gagne",
      );
      assert.equal(
        options?.maxPoolSize,
        5,
        "le reste d'`options` est préservé",
      );
    });

    it("non déclaré, une clé écrite dans `options` reste transmise", () => {
      const c = defineMongooseConfig({
        connectors: { prod: { options: { autoIndex: false } } },
      });
      assert.equal(
        MongooseService.buildConnectOptions(c.connectors.prod)?.autoIndex,
        false,
      );
    });

    it("refuse une valeur non booléenne", () => {
      assert.throws(() =>
        defineMongooseConfig({
          connectors: {
            x: { autoIndex: "yes" as unknown as boolean },
          },
        }),
      );
    });
  });

  describe("validation", () => {
    it("port hors plage → throw ZodError", () => {
      assert.throws(() =>
        defineMongooseConfig({ connectors: { x: { port: 0 } } }),
      );
    });
  });

  describe("surcharge env", () => {
    it("MONGODB_URI → uri du connecteur primaire `nodefony`", () => {
      const prev = process.env.MONGODB_URI;
      process.env.MONGODB_URI = "mongodb://h:1/db";
      try {
        const c = defineMongooseConfig();
        assert.equal(c.connectors.nodefony.uri, "mongodb://h:1/db");
      } finally {
        if (prev === undefined) delete process.env.MONGODB_URI;
        else process.env.MONGODB_URI = prev;
      }
    });

    it("NF_MONGODB_DEBUG=1 → debug true", () => {
      const prev = process.env.NF_MONGODB_DEBUG;
      process.env.NF_MONGODB_DEBUG = "1";
      try {
        assert.equal(defineMongooseConfig().debug, true);
      } finally {
        if (prev === undefined) delete process.env.NF_MONGODB_DEBUG;
        else process.env.NF_MONGODB_DEBUG = prev;
      }
    });

    /**
     * Branche INFRA (`resolveInfra`) — celle par laquelle une plateforme cloud
     * injecte sa base : `NF_DATABASE_URL` / `DATABASE_URL`. Elle n'était couverte
     * par aucun test, alors que c'est le seul chemin utilisé en production
     * managée, et qu'elle porte un tri de FAMILLE : une URL SQL passant par là
     * ne doit surtout pas devenir l'`uri` d'un connecteur Mongo.
     */
    /** Pose des variables d'env le temps d'un cas, puis restaure exactement. */
    const withEnv = (
      vars: Record<string, string | undefined>,
      run: () => void,
    ) => {
      const previous = new Map<string, string | undefined>();
      for (const [k, v] of Object.entries(vars)) {
        previous.set(k, process.env[k]);
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      try {
        run();
      } finally {
        for (const [k, v] of previous) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    };

    it("NF_DATABASE_URL de famille mongo → uri du connecteur primaire", () => {
      withEnv(
        {
          MONGODB_URI: undefined,
          NF_DATABASE_URL: "mongodb://infra:27017/appdb",
          DATABASE_URL: undefined,
        },
        () => {
          const c = defineMongooseConfig();
          assert.equal(
            c.connectors.nodefony.uri,
            "mongodb://infra:27017/appdb",
          );
        },
      );
    });

    it("`mongodb+srv://` est reconnu comme mongo (Atlas)", () => {
      withEnv(
        {
          MONGODB_URI: undefined,
          NF_DATABASE_URL: "mongodb+srv://u:p@cluster.example.net/appdb",
          DATABASE_URL: undefined,
        },
        () => {
          const c = defineMongooseConfig();
          assert.equal(
            c.connectors.nodefony.uri,
            "mongodb+srv://u:p@cluster.example.net/appdb",
          );
        },
      );
    });

    it("une URL SQL par la même variable est IGNORÉE (elle appartient à drizzle)", () => {
      withEnv(
        {
          MONGODB_URI: undefined,
          NF_DATABASE_URL: "postgres://u:p@db:5432/appdb",
          DATABASE_URL: undefined,
        },
        () => {
          const c = defineMongooseConfig();
          assert.notEqual(
            c.connectors.nodefony.uri,
            "postgres://u:p@db:5432/appdb",
          );
        },
      );
    });

    it("MONGODB_URI l'emporte sur l'infra (surcharge la plus spécifique)", () => {
      withEnv(
        {
          MONGODB_URI: "mongodb://explicite:1/db",
          NF_DATABASE_URL: "mongodb://infra:27017/appdb",
          DATABASE_URL: undefined,
        },
        () => {
          const c = defineMongooseConfig();
          assert.equal(c.connectors.nodefony.uri, "mongodb://explicite:1/db");
        },
      );
    });
  });

  describe("JSON Schema (Studio)", () => {
    it("mongooseConfigJsonSchema() produit un objet introspectable", () => {
      const js = mongooseConfigJsonSchema() as Record<string, unknown>;
      assert.equal(typeof js, "object");
      assert.ok("properties" in js || "type" in js);
    });
  });
});
