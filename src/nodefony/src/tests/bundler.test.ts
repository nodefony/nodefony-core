import { assert } from "chai";
import type { RolldownOptions } from "rolldown";
import {
  defineNodefonyRolldownConfig,
  nodefonyExternalMatcher,
  nodefonyTreeshake,
  nodefonyInput,
} from "../bundler/index";

// Le cwd vitest = src/nodefony → le package.json lu est celui du core ("nodefony").
describe("nodefony/bundler — socle rolldown partagé (subpath publiable)", () => {
  describe("nodefonyExternalMatcher", () => {
    const matcher = nodefonyExternalMatcher(["nodefony", "@nodefony/http"]);

    it("exact-match", () => {
      assert.isTrue(matcher("nodefony"));
      assert.isTrue(matcher("@nodefony/http"));
    });

    it("préfixe <nom>/ pour les paquets scoped", () => {
      assert.isTrue(matcher("@nodefony/http/context"));
    });

    it("nodefony = exact-match SEULEMENT (chunks preserveModules internes)", () => {
      assert.isFalse(matcher("nodefony/service/service"));
    });

    it("ni '.' ni les inconnus", () => {
      assert.isFalse(matcher("."));
      assert.isFalse(matcher("commander"));
    });
  });

  describe("nodefonyTreeshake", () => {
    it("side-effect reflect-metadata préservé même externe", () => {
      assert.isTrue(
        nodefonyTreeshake.moduleSideEffects("reflect-metadata", true),
      );
    });

    it("les autres externes sont side-effect-free", () => {
      assert.isFalse(nodefonyTreeshake.moduleSideEffects("commander", true));
    });

    it("les modules internes gardent leurs side-effects", () => {
      assert.isTrue(nodefonyTreeshake.moduleSideEffects("./src/x.ts", false));
    });
  });

  describe("nodefonyInput", () => {
    it("porte toujours l'entrée index", () => {
      const input = nodefonyInput(["src/bundler/**/*.ts"]);
      assert.equal(input["index"], "./index.ts");
      assert.equal(input["src/bundler/index"], "./src/bundler/index.ts");
    });

    it("exclut tests et .d.ts", () => {
      const input = nodefonyInput(["src/tests/bundler.test.ts"]);
      assert.deepEqual(Object.keys(input), ["index"]);
    });
  });

  describe("defineNodefonyRolldownConfig", () => {
    it("défauts : node ESM preserveModules, dist, sans sourcemap", () => {
      const config = defineNodefonyRolldownConfig({
        input: { index: "./index.ts" },
      }) as RolldownOptions & {
        output: {
          dir: string;
          format: string;
          preserveModules: boolean;
          sourcemap: boolean;
        };
      };
      assert.equal(config.platform, "node");
      assert.equal(config.output.dir, "dist");
      assert.equal(config.output.format, "esm");
      assert.isTrue(config.output.preserveModules);
      assert.isFalse(config.output.sourcemap);
    });

    it("le nom propre du paquet est TOUJOURS externe (anti self-import)", () => {
      const config = defineNodefonyRolldownConfig({
        input: { index: "./index.ts" },
      });
      const external = config.external as (id: string) => boolean;
      assert.isTrue(external("nodefony"));
    });

    it("externalDeps: true externalise dependencies + peerDependencies", () => {
      const config = defineNodefonyRolldownConfig({
        input: { index: "./index.ts" },
        externalDeps: true,
      });
      const external = config.external as (id: string) => boolean;
      assert.isTrue(external("commander"), "dependency du package.json");
      assert.isTrue(external("zod"), "peerDependency du package.json");
      assert.isFalse(external("left-pad"), "hors package.json → bundlé");
    });

    it("externalDeps par défaut OFF (liste explicite des packages du repo)", () => {
      const config = defineNodefonyRolldownConfig({
        input: { index: "./index.ts" },
      });
      const external = config.external as (id: string) => boolean;
      assert.isFalse(external("commander"));
    });
  });
});
