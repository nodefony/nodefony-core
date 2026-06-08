import assert from "node:assert/strict";
import {
  defineDrizzleConfig,
  drizzleConfigJsonSchema,
} from "../../nodefony/config/defineDrizzleConfig";

describe("@nodefony/drizzle — config (Zod, alignement ORM 2026-06)", () => {
  describe("défauts", () => {
    it("config vide → connecteur `default`, filename non posé (résolu au boot)", () => {
      const c = defineDrizzleConfig();
      assert.ok(c.connectors.default);
      // `filename` reste indéfini : le chemin SQLite (kernel.path) est résolu par
      // DrizzleService au boot, pas dans le schéma pur.
      assert.equal(c.connectors.default.filename, undefined);
    });

    it("la config retournée est gelée (immuable)", () => {
      const c = defineDrizzleConfig();
      assert.throws(() => {
        (c as { connectors: unknown }).connectors = {};
      });
    });
  });

  describe("surcharge app (use)", () => {
    it("connecteur `:memory:` (tests) accepté", () => {
      const c = defineDrizzleConfig({
        connectors: { default: { filename: ":memory:" } },
      });
      assert.equal(c.connectors.default.filename, ":memory:");
    });
  });

  describe("validation", () => {
    it("filename vide → throw ZodError (min(1))", () => {
      assert.throws(() =>
        defineDrizzleConfig({ connectors: { x: { filename: "" } } }),
      );
    });
  });

  describe("surcharge env", () => {
    it("DRIZZLE_DB_FILE → filename du connecteur primaire `default`", () => {
      const prev = process.env.DRIZZLE_DB_FILE;
      process.env.DRIZZLE_DB_FILE = "/tmp/app.db";
      try {
        const c = defineDrizzleConfig();
        assert.equal(c.connectors.default.filename, "/tmp/app.db");
      } finally {
        if (prev === undefined) delete process.env.DRIZZLE_DB_FILE;
        else process.env.DRIZZLE_DB_FILE = prev;
      }
    });
  });

  describe("JSON Schema (Studio)", () => {
    it("drizzleConfigJsonSchema() produit un objet introspectable", () => {
      const js = drizzleConfigJsonSchema() as Record<string, unknown>;
      assert.equal(typeof js, "object");
      assert.ok("properties" in js || "type" in js);
    });
  });
});
