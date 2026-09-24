import assert from "node:assert/strict";
import {
  defineDrizzleConfig,
  drizzleConfigJsonSchema,
} from "../../nodefony/config/defineModuleConfig";

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

  describe("surcharge env (infra database — NF_DATABASE_URL)", () => {
    function withEnv(vars: Record<string, string>, fn: () => void): void {
      const saved: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(vars)) {
        saved[key] = process.env[key];
        process.env[key] = value;
      }
      try {
        fn();
      } finally {
        for (const [key, prev] of Object.entries(saved)) {
          if (prev === undefined) delete process.env[key];
          else process.env[key] = prev;
        }
      }
    }

    it("NF_DATABASE_URL=sqlite:… → filename du connecteur primaire `default`", () => {
      withEnv({ NF_DATABASE_URL: "sqlite:/tmp/app.db" }, () => {
        const c = defineDrizzleConfig();
        assert.equal(c.connectors.default.dialect, "sqlite");
        assert.equal(c.connectors.default.filename, "/tmp/app.db");
      });
    });

    it("NF_DATABASE_URL=postgres:// → dialect + url (filename écarté)", () => {
      withEnv({ NF_DATABASE_URL: "postgres://u:p@h:5432/db" }, () => {
        const c = defineDrizzleConfig({
          connectors: { default: { filename: ":memory:" } },
        });
        assert.equal(c.connectors.default.dialect, "postgres");
        assert.equal(c.connectors.default.url, "postgres://u:p@h:5432/db");
        assert.equal(c.connectors.default.filename, undefined);
      });
    });

    it("alias plateforme DATABASE_URL honoré (NF_ absent)", () => {
      withEnv({ DATABASE_URL: "sqlite::memory:" }, () => {
        const c = defineDrizzleConfig();
        assert.equal(c.connectors.default.filename, ":memory:");
      });
    });

    it("NF_DATABASE_URL=mongodb:// → AUCUN connecteur `default` (personne ne l'a demandé)", () => {
      withEnv({ NF_DATABASE_URL: "mongodb://h:27017/db" }, () => {
        const c = defineDrizzleConfig();
        // Le connecteur créé en trop ouvrait `var/databases/nodefony-drizzle.db`
        // et y dupliquait le schéma framework (#456).
        assert.deepEqual(Object.keys(c.connectors), []);
      });
    });

    it("NF_DATABASE_URL=mongodb:// → au BOOT, le `default` des défauts du module ne compte pas comme demandé", () => {
      withEnv({ NF_DATABASE_URL: "mongodb://h:27017/db" }, () => {
        // Le kernel fusionne les défauts du module (`config.ts`) AVANT la
        // validation : la config reçue porte donc un `default` que personne n'a
        // écrit. Seul `declared` (ce que l'application a posé) tranche.
        const merged = {
          connectors: { default: { dialect: "sqlite" as const } },
        };
        assert.deepEqual(
          Object.keys(defineDrizzleConfig(merged, {}).connectors),
          [],
        );
        assert.deepEqual(
          Object.keys(defineDrizzleConfig(merged, merged).connectors),
          ["default"],
        );
      });
    });

    it("NF_DATABASE_URL=mongodb:// → un `default` ÉCRIT par l'app est gardé, les autres aussi", () => {
      withEnv({ NF_DATABASE_URL: "mongodb://h:27017/db" }, () => {
        const c = defineDrizzleConfig({
          connectors: {
            default: { dialect: "sqlite", filename: ":memory:" },
            media: { dialect: "sqlite", filename: ":memory:" },
          },
        });
        assert.deepEqual(Object.keys(c.connectors).sort(), [
          "default",
          "media",
        ]);
        // L'URL Mongo n'est toujours pas lue par Drizzle.
        assert.equal(c.connectors.default?.dialect, "sqlite");
        assert.equal(c.connectors.default?.url, undefined);
      });
    });

    it("sans infra déclarée → le `default` du schéma reste (comportement inchangé)", () => {
      const saved = {
        NF_DATABASE_URL: process.env.NF_DATABASE_URL,
        DATABASE_URL: process.env.DATABASE_URL,
      };
      delete process.env.NF_DATABASE_URL;
      delete process.env.DATABASE_URL;
      try {
        assert.ok(defineDrizzleConfig().connectors.default);
      } finally {
        for (const [k, v] of Object.entries(saved)) {
          if (v !== undefined) process.env[k] = v;
        }
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
