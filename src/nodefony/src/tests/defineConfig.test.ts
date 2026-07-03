import assert from "node:assert";

import {
  defineConfig,
  isConfigDescriptor,
  defaultAppConfig,
} from "../config/index";
import type { ConfigContext } from "../config/types";

/** Contexte d'env de test (prod par défaut, surchargeable). */
function makeCtx(over: Partial<ConfigContext> = {}): ConfigContext {
  return {
    env: {},
    appEnv: "production",
    runtimeEnv: "production",
    isProd: true,
    isDev: false,
    isTest: false,
    ...over,
  };
}

/**
 * Golden snapshot des défauts framework. Toute dérive ACCIDENTELLE de
 * `defaultAppConfig` casse ce test (anti-drift comportemental — Lot 1).
 * Un changement VOULU se reflète ici sciemment.
 */
const GOLDEN_DEFAULTS = {
  modules: [],
  locale: "en_en",
  templating: "eta",
  packageManager: "npm",
  // Deadline globale du shutdown (0.7) — filet anti-listener-pendu de terminate.
  shutdownDeadline: 15_000,
  domain: "localhost",
  servers: {
    statics: true,
    http: { port: 5151 },
    https: { port: 5152, protocol: "2.0" },
    ws: {},
    wss: {},
  },
  log: {
    active: true,
    debug: [],
    requestFormat: "auto",
    buffered: "auto",
    driver: "stdout",
    file: { sync: false },
    queryDriver: "auto",
  },
};

describe("config — defineConfig (moteur Lot 1)", () => {
  describe("descripteur", () => {
    it("defineConfig(obj) retourne un descripteur reconnu", () => {
      const desc = defineConfig({});
      assert.strictEqual(isConfigDescriptor(desc), true);
      assert.strictEqual(typeof desc.resolve, "function");
    });

    it("isConfigDescriptor rejette les valeurs non-descripteurs", () => {
      assert.strictEqual(isConfigDescriptor(null), false);
      assert.strictEqual(isConfigDescriptor(undefined), false);
      assert.strictEqual(isConfigDescriptor({}), false);
      assert.strictEqual(isConfigDescriptor({ resolve() {} }), false);
      assert.strictEqual(isConfigDescriptor("x"), false);
    });
  });

  describe("resolve — merge des défauts", () => {
    it("config vide → tous les défauts framework", () => {
      const r = defineConfig({}).resolve(makeCtx());
      assert.strictEqual(r.servers?.http?.port, 5151);
      assert.strictEqual(r.servers?.https?.protocol, "2.0");
      assert.strictEqual(r.log?.active, true);
      assert.strictEqual(r.domain, "localhost");
      assert.strictEqual(r.packageManager, "npm");
    });

    it("servers.https: false accepté (TLS à l'ingress) — remplace l'objet défaut au merge", () => {
      const r = defineConfig({ servers: { https: false } }).resolve(makeCtx());
      assert.strictEqual(r.servers?.https, false);
      // Sibling préservé : le serveur HTTP garde son défaut.
      assert.strictEqual((r.servers?.http as { port?: number })?.port, 5151);
    });

    it("override user en profondeur sans écraser les siblings", () => {
      const r = defineConfig({
        servers: { http: { port: 8080 } },
      }).resolve(makeCtx());
      assert.strictEqual(r.servers?.http?.port, 8080); // overridé
      assert.strictEqual(r.servers?.https?.port, 5152); // défaut préservé
      assert.strictEqual(r.servers?.statics, true); // défaut préservé
    });

    it("log.debug override remplace le défaut []", () => {
      const r = defineConfig({ log: { debug: "*" } }).resolve(makeCtx());
      assert.strictEqual(r.log?.debug, "*");
      assert.strictEqual(r.log?.active, true); // défaut préservé
    });

    it("modules user remplace proprement l'array vide par défaut", () => {
      const r = defineConfig({
        modules: ["@nodefony/http", "@nodefony/framework"],
      }).resolve(makeCtx());
      assert.deepStrictEqual(r.modules, [
        "@nodefony/http",
        "@nodefony/framework",
      ]);
    });

    it("ne mute NI les défauts NI l'input", () => {
      const input = { servers: { http: { port: 9090 } } };
      defineConfig(input).resolve(makeCtx());
      // défauts intacts
      assert.strictEqual(defaultAppConfig.servers?.http?.port, 5151);
      // input intact (pas de defaults injectés dedans)
      assert.strictEqual(input.servers.http.port, 9090);
      assert.strictEqual((input as { log?: unknown }).log, undefined);
    });
  });

  describe("resolve — forme fonction (par-env, D3)", () => {
    it("ctx pilote la valeur résolue", () => {
      const desc = defineConfig((ctx) => ({
        domain: ctx.isProd ? "0.0.0.0" : "127.0.0.1",
      }));
      assert.strictEqual(
        desc.resolve(makeCtx({ isProd: true })).domain,
        "0.0.0.0",
      );
      assert.strictEqual(
        desc.resolve(makeCtx({ isProd: false, isDev: true })).domain,
        "127.0.0.1",
      );
    });

    it("ctx.env typé est transmis à la fonction", () => {
      const desc = defineConfig<{ FOO: string }>((ctx) => ({
        locale: ctx.env.FOO,
      }));
      const r = desc.resolve(makeCtx({ env: { FOO: "xx" } }));
      assert.strictEqual(r.locale, "xx");
    });
  });

  describe("resolve — validation Zod", () => {
    it("type invalide → throw au message clair", () => {
      const desc = defineConfig({
        servers: { http: { port: "nope" as unknown as number } },
      });
      assert.throws(
        () => desc.resolve(makeCtx()),
        /Configuration d'application invalide/,
      );
    });

    it("packageManager hors enum → throw", () => {
      const desc = defineConfig({
        packageManager: "cargo" as unknown as "npm",
      });
      assert.throws(() => desc.resolve(makeCtx()), /invalide/);
    });

    it("config valide complète → ne throw pas", () => {
      assert.doesNotThrow(() =>
        defineConfig({
          domain: "example.com",
          servers: {
            http: { port: 80 },
            https: { port: 443, protocol: "1.1" },
          },
          log: { requestFormat: "json", driver: "file" },
        }).resolve(makeCtx()),
      );
    });
  });

  describe("défauts framework", () => {
    it("golden snapshot (anti-drift)", () => {
      assert.deepStrictEqual(defaultAppConfig, GOLDEN_DEFAULTS);
    });

    it("INVARIANT : aucun array non-vide (sûreté du merge par index)", () => {
      const offenders: string[] = [];
      const walk = (node: unknown, path: string): void => {
        if (Array.isArray(node)) {
          if (node.length > 0) offenders.push(path);
          return;
        }
        if (node && typeof node === "object") {
          for (const [k, v] of Object.entries(node)) {
            walk(v, path ? `${path}.${k}` : k);
          }
        }
      };
      walk(defaultAppConfig, "");
      assert.deepStrictEqual(
        offenders,
        [],
        `arrays non-vides dans defaultAppConfig: ${offenders.join(", ")}`,
      );
    });
  });
});
