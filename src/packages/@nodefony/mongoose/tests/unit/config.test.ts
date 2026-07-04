import assert from "node:assert/strict";
import {
  defineMongooseConfig,
  mongooseConfigJsonSchema,
} from "../../nodefony/config/defineModuleConfig";

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

    it("MONGODB_DEBUG=1 → debug true", () => {
      const prev = process.env.MONGODB_DEBUG;
      process.env.MONGODB_DEBUG = "1";
      try {
        assert.equal(defineMongooseConfig().debug, true);
      } finally {
        if (prev === undefined) delete process.env.MONGODB_DEBUG;
        else process.env.MONGODB_DEBUG = prev;
      }
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
