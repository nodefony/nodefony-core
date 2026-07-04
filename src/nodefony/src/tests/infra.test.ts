import assert from "node:assert";

import {
  resolveInfra,
  resolveAutoStore,
  parseDatabaseUrl,
  sqliteFilenameFromUrl,
  type IInfra,
} from "../config/index";
import { resolveQueryDriver } from "../syslog/drivers/builtinLogDrivers";

const NO_ROLES: IInfra = { database: null, cache: null, logs: null };

describe("config — infra (modèle « infra déclarée », Phase 0.8)", () => {
  describe("resolveInfra", () => {
    it("env vide → aucune infra déclarée", () => {
      const roles = resolveInfra({});
      assert.deepStrictEqual(roles, NO_ROLES);
    });

    it("NF_DATABASE_URL sqlite → infra database sql/sqlite", () => {
      const roles = resolveInfra({
        NF_DATABASE_URL: "sqlite:./nodefony/databases/app.db",
      });
      assert.strictEqual(roles.database?.family, "sql");
      assert.strictEqual(roles.database?.dialect, "sqlite");
      assert.strictEqual(roles.database?.scheme, "sqlite");
    });

    it("postgres:// et postgresql:// → dialecte postgres", () => {
      for (const url of ["postgres://u:p@h:5432/db", "postgresql://h/db"]) {
        const roles = resolveInfra({ NF_DATABASE_URL: url });
        assert.strictEqual(roles.database?.dialect, "postgres");
      }
    });

    it("mongodb:// et mongodb+srv:// → famille mongo, dialecte null", () => {
      for (const url of ["mongodb://h:27017/db", "mongodb+srv://cluster/db"]) {
        const roles = resolveInfra({ NF_DATABASE_URL: url });
        assert.strictEqual(roles.database?.family, "mongo");
        assert.strictEqual(roles.database?.dialect, null);
      }
    });

    it("alias plateforme : NF_DATABASE_URL prioritaire sur DATABASE_URL", () => {
      const roles = resolveInfra({
        NF_DATABASE_URL: "postgres://nf/db",
        DATABASE_URL: "mysql://platform/db",
      });
      assert.strictEqual(roles.database?.dialect, "postgres");
      const fallback = resolveInfra({ DATABASE_URL: "mysql://platform/db" });
      assert.strictEqual(fallback.database?.dialect, "mysql");
    });

    it("NF_REDIS_URL / REDIS_URL → infra cache (NF_ prioritaire)", () => {
      const roles = resolveInfra({
        NF_REDIS_URL: "redis://nf:6379",
        REDIS_URL: "redis://platform:6379",
      });
      assert.strictEqual(roles.cache?.url, "redis://nf:6379");
      const fallback = resolveInfra({ REDIS_URL: "redis://platform:6379" });
      assert.strictEqual(fallback.cache?.url, "redis://platform:6379");
    });

    it("URLs logs → infra logs (les deux possibles)", () => {
      const roles = resolveInfra({
        NF_LOKI_URL: "http://loki:3100",
        NF_OPENSEARCH_URL: "http://os:9200",
      });
      assert.strictEqual(roles.logs?.lokiUrl, "http://loki:3100");
      assert.strictEqual(roles.logs?.opensearchUrl, "http://os:9200");
    });

    it("valeur vide = non déclarée (pas d'infra fantôme)", () => {
      const roles = resolveInfra({ NF_DATABASE_URL: "", NF_REDIS_URL: "" });
      assert.deepStrictEqual(roles, NO_ROLES);
    });

    it("scheme non supporté → throw fail-loud (jamais de repli sqlite)", () => {
      assert.throws(
        () => resolveInfra({ NF_DATABASE_URL: "oracle://h/db" }),
        /non supporté/,
      );
      assert.throws(() => parseDatabaseUrl("pasduneurl"), /non supporté/);
    });
  });

  describe("sqliteFilenameFromUrl", () => {
    it("formes acceptées", () => {
      assert.strictEqual(sqliteFilenameFromUrl("sqlite::memory:"), ":memory:");
      assert.strictEqual(sqliteFilenameFromUrl("sqlite:"), ":memory:");
      assert.strictEqual(sqliteFilenameFromUrl("sqlite:./x.db"), "./x.db");
      assert.strictEqual(
        sqliteFilenameFromUrl("sqlite:/abs/x.db"),
        "/abs/x.db",
      );
      assert.strictEqual(
        sqliteFilenameFromUrl("sqlite:///abs/x.db"),
        "/abs/x.db",
      );
    });
  });

  describe("resolveAutoStore", () => {
    const roles = (over: Partial<IInfra>): IInfra => ({
      ...NO_ROLES,
      ...over,
    });
    const DB_SQL = roles({
      database: {
        url: "postgres://h/db",
        scheme: "postgres",
        family: "sql",
        dialect: "postgres",
      },
    });
    const DB_MONGO = roles({
      database: {
        url: "mongodb://h/db",
        scheme: "mongodb",
        family: "mongo",
        dialect: null,
      },
    });
    const CACHE = roles({ cache: { url: "redis://h:6379" } });

    it("durable + infra database sql → drizzle", () => {
      const r = resolveAutoStore("durable", DB_SQL, ["memory", "drizzle"]);
      assert.strictEqual(r.store, "drizzle");
    });

    it("durable + infra database mongo → mongoose", () => {
      const r = resolveAutoStore("durable", DB_MONGO, ["memory", "mongoose"]);
      assert.strictEqual(r.store, "mongoose");
    });

    it("durable ignore le infra cache (redis ≠ durable)", () => {
      const r = resolveAutoStore("durable", CACHE, ["memory", "redis"]);
      assert.strictEqual(r.store, "memory");
    });

    it("ephemeral préfère cache > database", () => {
      const both = roles({
        cache: { url: "redis://h" },
        database: DB_SQL.database,
      });
      const r = resolveAutoStore("ephemeral", both, [
        "memory",
        "drizzle",
        "redis",
      ]);
      assert.strictEqual(r.store, "redis");
      const noRedis = resolveAutoStore("ephemeral", both, [
        "memory",
        "drizzle",
      ]);
      assert.strictEqual(noRedis.store, "drizzle");
    });

    it("session : cache > database > files (fallback paramétrable)", () => {
      const r = resolveAutoStore(
        "session",
        NO_ROLES,
        ["files", "drizzle"],
        "files",
      );
      assert.strictEqual(r.store, "files");
      const withDb = resolveAutoStore(
        "session",
        DB_SQL,
        ["files", "drizzle"],
        "files",
      );
      assert.strictEqual(withDb.store, "drizzle");
    });

    it("couverture partielle : backend de l'infra non enregistré → repli ANNONCÉ", () => {
      const r = resolveAutoStore("durable", DB_MONGO, ["memory", "drizzle"]);
      assert.strictEqual(r.store, "memory");
      assert.match(r.reason, /indisponible/);
      assert.match(r.reason, /mongoose/);
    });

    it("aucune infra → fallback avec raison explicite", () => {
      const r = resolveAutoStore("durable", NO_ROLES, ["memory"]);
      assert.strictEqual(r.store, "memory");
      assert.match(r.reason, /aucune infra/);
    });
  });

  describe("resolveQueryDriver — dérivation URL ⇒ driver (infra logs)", () => {
    it("explicite respecté même avec URLs déclarées", () => {
      const driver = resolveQueryDriver("memory", false, {
        loki: "http://loki:3100",
      });
      assert.strictEqual(driver, "memory");
    });

    it("auto + 1 URL → driver de la destination", () => {
      assert.strictEqual(
        resolveQueryDriver("auto", false, { loki: "http://loki:3100" }),
        "loki",
      );
      assert.strictEqual(
        resolveQueryDriver(undefined, false, { opensearch: "http://os:9200" }),
        "opensearch",
      );
    });

    it("auto + 2 URLs → throw fail-loud", () => {
      assert.throws(
        () =>
          resolveQueryDriver("auto", false, {
            loki: "http://loki:3100",
            opensearch: "http://os:9200",
          }),
        /ambigu/,
      );
    });

    it("auto sans URL → comportement historique (memory / cluster-file)", () => {
      assert.strictEqual(resolveQueryDriver("auto", false), "memory");
      assert.strictEqual(resolveQueryDriver(undefined, true), "cluster-file");
    });
  });
});
