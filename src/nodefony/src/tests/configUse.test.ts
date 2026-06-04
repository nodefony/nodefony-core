import assert from "node:assert";
import { resolve } from "node:path";

import { use, defineConfig } from "../config/index";
import type { ConfigOf } from "../config/use";
import type { ResolvedAppConfig } from "../config/types";
import Kernel from "../kernel/Kernel";
import Module from "../kernel/Module";
import { Nodefony } from "../Nodefony";

// Augmentation LOCALE du registre — simule ce qu'un module fait réellement via
// `declare module "nodefony" { interface NodefonyModuleConfig { … } }`. Prouve le
// niveau ③ (config typée par module) au typecheck. Inoffensif pour les autres
// tests (clé fictive ajoutée au registre).
declare module "../config/use" {
  interface NodefonyModuleConfig {
    "@nodefony/demo-typed": { secret: string; ttl: number };
  }
}

// Chemin d'un dossier réel portant un package.json (setPath du Module).
const PKG = resolve(process.cwd(), "package.json");

function makeKernelReal(opts = {}): Kernel {
  return new Kernel("development", null, { log: { active: false }, ...opts });
}

describe("config — use() (Lot 3 : colocation + registre typé)", () => {
  describe("fabrique d'entrée", () => {
    it("use(name, config) → { name, config }", () => {
      const e = use("@nodefony/http", { port: 8080 });
      assert.deepStrictEqual(e, {
        name: "@nodefony/http",
        config: { port: 8080 },
      });
    });

    it("use(name) seul → { name }, PAS de clé config", () => {
      const e = use("@nodefony/http");
      assert.deepStrictEqual(e, { name: "@nodefony/http" });
      assert.ok(!("config" in e), "aucune clé config quand non fournie");
    });

    it("use(name, config, { policy, when }) → entrée complète", () => {
      // `when` reçoit la CONFIG RÉSOLUE (pas le contexte d'env) — le gating par
      // env passe par `policy:"dev"` ou un flag calculé dans defineConfig((ctx)…).
      const when = (c: ResolvedAppConfig) => c.domainCheck === true;
      const e = use("@nodefony/studio", { a: 1 }, { policy: "dev", when });
      assert.strictEqual(e.name, "@nodefony/studio");
      assert.deepStrictEqual(e.config, { a: 1 });
      assert.strictEqual(e.policy, "dev");
      assert.strictEqual(e.when, when);
    });

    it("use(name, undefined, { policy }) → policy sans config", () => {
      const e = use("@nodefony/test", undefined, { policy: "dev" });
      assert.deepStrictEqual(e, { name: "@nodefony/test", policy: "dev" });
      assert.ok(!("config" in e));
    });

    it("accepte un module tiers (string & {})", () => {
      const e = use("@acme/widget", { token: "z" });
      assert.strictEqual(e.name, "@acme/widget");
      assert.deepStrictEqual(e.config, { token: "z" });
    });
  });

  describe("typage par module (niveau ③ — compile-time)", () => {
    it("registre augmenté → clés du module typées (tsc valide)", () => {
      // tsc exige secret:string + ttl:number — échouerait si config était un
      // Record<string, unknown> libre (le typage par module ne marcherait pas).
      const e = use("@nodefony/demo-typed", { secret: "s", ttl: 30 });
      const cfg = e.config as { secret: string; ttl: number };
      assert.strictEqual(cfg.secret, "s");
      assert.strictEqual(cfg.ttl, 30);
      // ConfigOf résout le type enregistré.
      const typed: ConfigOf<"@nodefony/demo-typed"> = { secret: "a", ttl: 1 };
      assert.strictEqual(typed.ttl, 1);
    });

    it("module non enregistré → config = objet libre (jamais bloqué)", () => {
      const free: ConfigOf<"@nodefony/redis"> = { anything: true, n: 2 };
      assert.strictEqual(free.n, 2);
    });

    it("clé invalide rejetée par le typage du module enregistré", () => {
      // @ts-expect-error — 'wrong' n'existe pas sur la config de demo-typed.
      use("@nodefony/demo-typed", { wrong: true });
    });
  });

  describe("intégration defineConfig", () => {
    it("use() dans modules → entrée présente dans la config résolue", () => {
      const cfg = defineConfig({
        modules: [
          "@nodefony/http",
          use("@nodefony/security", { firewall: "main" }),
        ],
      });
      const resolved = cfg.resolve({
        env: {},
        appEnv: "test",
        runtimeEnv: "test",
        isProd: false,
        isDev: false,
        isTest: true,
      });
      const entry = (resolved.modules as unknown[]).find(
        (m): m is { name: string; config: Record<string, unknown> } =>
          typeof m === "object" &&
          m !== null &&
          (m as { name?: string }).name === "@nodefony/security",
      );
      assert.ok(entry, "l'entrée use() doit survivre au merge");
      assert.deepStrictEqual(entry.config, { firewall: "main" });
    });
  });

  describe("câblage Kernel — application de la config colocalisée", () => {
    // `new Kernel()` écrase le singleton `Nodefony.getKernel()` (piège connu) ;
    // ce fichier tourne tôt dans la suite → sans restauration il polluerait
    // index.test / Injector.test (qui attendent un singleton propre). On capture
    // l'état avant et on le restaure après le bloc.
    let prevKernel: Kernel | null;
    before(() => {
      prevKernel = Nodefony.getKernel();
    });
    after(() => {
      Nodefony.setKernel(prevKernel as Kernel);
    });

    it("loadModulesFromManifest deep-merge la config dans mod.options", async () => {
      const kernel = makeKernelReal();
      const mod = new Module("DefaultsMod", kernel, PKG, {
        base: 1,
        nested: { a: 1, keep: "x" },
      });
      // Mock de l'import dynamique : retourne notre module sans charger un package.
      kernel.loadModule = async () => {
        kernel.modules[mod.name] = mod;
        return mod;
      };
      kernel.options.modules = [
        { name: "DefaultsMod", config: { added: true, nested: { b: 2 } } },
      ];

      await (
        kernel as unknown as { loadModulesFromManifest(): Promise<void> }
      ).loadModulesFromManifest();

      const o = mod.options as Record<string, unknown> & {
        nested: Record<string, unknown>;
      };
      assert.strictEqual(o.base, 1, "clé default préservée");
      assert.strictEqual(o.added, true, "clé colocalisée ajoutée");
      assert.strictEqual(o.nested.a, 1, "deep: default imbriqué préservé");
      assert.strictEqual(o.nested.b, 2, "deep: colocalisé imbriqué fusionné");
      assert.strictEqual(o.nested.keep, "x", "deep: voisin préservé");
    });

    it("entrée sans config → mod.options inchangé", async () => {
      const kernel = makeKernelReal();
      const mod = new Module("NoCfgMod", kernel, PKG, { base: 1 });
      kernel.loadModule = async () => mod;
      kernel.options.modules = ["NoCfgMod"];

      await (
        kernel as unknown as { loadModulesFromManifest(): Promise<void> }
      ).loadModulesFromManifest();

      assert.deepStrictEqual(mod.options, { base: 1 });
    });

    it("module gaté (when=false) → loadModule jamais appelé", async () => {
      const kernel = makeKernelReal();
      let called = false;
      kernel.loadModule = async () => {
        called = true;
        return { name: "Gated", options: {} } as unknown as Module;
      };
      kernel.options.modules = [
        { name: "Gated", when: () => false, config: { a: 1 } },
      ];

      await (
        kernel as unknown as { loadModulesFromManifest(): Promise<void> }
      ).loadModulesFromManifest();

      assert.strictEqual(called, false);
    });
  });
});
