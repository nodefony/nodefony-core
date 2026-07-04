import assert from "node:assert";

import {
  defineConfig,
  defineEnv,
  envString,
  envNumber,
  envBoolean,
  envEnum,
} from "../config/index";

describe("config — defineEnv (catalogue env Lot 2)", () => {
  describe("coercion + défauts", () => {
    it("source vide → défauts déclarés", () => {
      const env = defineEnv(
        {
          NF_LOG_DRIVER: envEnum(["stdout", "file", "null"], {
            default: "stdout",
          }),
          NF_LOG_FILE_SYNC: envBoolean({ default: false }),
          NF_WORKERS: envNumber({ default: 1 }),
          NF_LABEL: envString({ default: "app" }),
        },
        {},
      );
      assert.strictEqual(env.NF_LOG_DRIVER, "stdout");
      assert.strictEqual(env.NF_LOG_FILE_SYNC, false);
      assert.strictEqual(env.NF_WORKERS, 1);
      assert.strictEqual(env.NF_LABEL, "app");
    });

    it("lit + coerce les valeurs fournies", () => {
      const env = defineEnv(
        {
          DRIVER: envEnum(["stdout", "file"], { default: "stdout" }),
          SYNC: envBoolean({ default: false }),
          WORKERS: envNumber({ default: 1 }),
          LABEL: envString({ default: "x" }),
        },
        { DRIVER: "file", SYNC: "1", WORKERS: "8", LABEL: "prod" },
      );
      assert.strictEqual(env.DRIVER, "file");
      assert.strictEqual(env.SYNC, true);
      assert.strictEqual(env.WORKERS, 8); // number, pas "8"
      assert.strictEqual(env.LABEL, "prod");
    });

    it("booléen 12-factor (truthy/falsy, insensible à la casse)", () => {
      const make = (v: string) =>
        defineEnv({ B: envBoolean({ default: false }) }, { B: v }).B;
      for (const t of ["1", "true", "TRUE", "Yes", "on"])
        assert.strictEqual(make(t), true, `${t} → true`);
      for (const f of ["0", "false", "No", "off", "OFF"])
        assert.strictEqual(make(f), false, `${f} → false`);
    });

    it("chaîne vide = absente → défaut", () => {
      const env = defineEnv(
        { DRIVER: envEnum(["stdout", "file"], { default: "stdout" }) },
        { DRIVER: "" },
      );
      assert.strictEqual(env.DRIVER, "stdout");
    });

    it("optional absent → undefined", () => {
      const env = defineEnv({ NF_LOKI_URL: envString({ optional: true }) }, {});
      assert.strictEqual(env.NF_LOKI_URL, undefined);
    });
  });

  describe("fail-fast (erreurs claires au boot)", () => {
    it("enum hors liste → throw nommant la variable", () => {
      assert.throws(
        () =>
          defineEnv(
            {
              NF_LOG_DRIVER: envEnum(["stdout", "file"], { default: "stdout" }),
            },
            { NF_LOG_DRIVER: "kafka" },
          ),
        /environnement invalides.*NF_LOG_DRIVER/s,
      );
    });

    it("nombre malformé → throw", () => {
      assert.throws(
        () => defineEnv({ N: envNumber({ default: 1 }) }, { N: "abc" }),
        /N:/,
      );
    });

    it("booléen invalide (typo) → throw", () => {
      assert.throws(
        () => defineEnv({ B: envBoolean({ default: false }) }, { B: "tru" }),
        /B:/,
      );
    });

    it("requis manquant → throw", () => {
      assert.throws(() => defineEnv({ SECRET: envString() }, {}), /SECRET:/);
    });
  });

  describe("invariants", () => {
    it("résultat figé (Object.isFrozen)", () => {
      const env = defineEnv({ X: envString({ default: "x" }) }, {});
      assert.strictEqual(Object.isFrozen(env), true);
    });

    it("typage littéral préservé (compile-time)", () => {
      const env = defineEnv(
        {
          NF_LOG_DRIVER: envEnum(["stdout", "file", "null"], {
            default: "stdout",
          }),
          NF_WORKERS: envNumber({ default: 1 }),
        },
        {},
      );
      // tsc valide l'union exacte + le number (échouerait si typé string/unknown)
      const driver: "stdout" | "file" | "null" = env.NF_LOG_DRIVER;
      const workers: number = env.NF_WORKERS;
      assert.ok(driver);
      assert.strictEqual(typeof workers, "number");
    });

    it("réplique le catalogue log de l'app (env.ts) sans process.env", () => {
      const env = defineEnv(
        {
          NF_LOG_DRIVER: envEnum(["stdout", "file", "null"], {
            default: "stdout",
          }),
          NF_LOG_FILE_SYNC: envBoolean({ default: false }),
          NF_LOG_QUERY_DRIVER: envString({ default: "memory" }),
          NF_LOKI_URL: envString({ optional: true }),
          NF_OPENSEARCH_URL: envString({ optional: true }),
        },
        {
          NF_LOG_DRIVER: "file",
          NF_LOG_FILE_SYNC: "yes",
          NF_LOKI_URL: "http://loki:3100",
        },
      );
      assert.deepStrictEqual(env, {
        NF_LOG_DRIVER: "file",
        NF_LOG_FILE_SYNC: true,
        NF_LOG_QUERY_DRIVER: "memory",
        NF_LOKI_URL: "http://loki:3100",
        NF_OPENSEARCH_URL: undefined,
      });
    });
  });

  describe("intégration defineConfig (niveau 4 — ctx.env typé)", () => {
    it("le type de defineEnv alimente ctx.env dans la fonction de config", () => {
      const env = defineEnv(
        {
          NF_LOG_DRIVER: envEnum(["stdout", "file", "null"], {
            default: "stdout",
          }),
        },
        { NF_LOG_DRIVER: "file" },
      );
      // ctx.env.NF_LOG_DRIVER est typé "stdout"|"file"|"null" → assignable à log.driver
      const cfg = defineConfig<typeof env>((ctx) => ({
        log: { driver: ctx.env.NF_LOG_DRIVER },
      }));
      const resolved = cfg.resolve({
        env,
        appEnv: "production",
        runtimeEnv: "production",
        isProd: true,
        isDev: false,
        isTest: false,
      });
      assert.strictEqual(resolved.log?.driver, "file");
    });
  });
});
