/* eslint-disable @typescript-eslint/no-explicit-any */
/*
 *   Tests du dispatch CLI built-in vs commande de module (CliKernel)
 *   Régression du bug `nodefony frontend:build` → `unknown command` (fallback serveur).
 *   On teste la CLASSIFICATION (helpers privés) sans booter le kernel.
 */

import assert from "node:assert";
import "mocha";
import CliKernel from "../kernel/CliKernel";
import Build from "../kernel/commands/BuildCommand";
import Dev from "../kernel/commands/DevCommand";
import Cluster from "../kernel/commands/ClusterCommand";

// Enregistre quelques built-ins dans commander, comme le fait `start()`.
function makeCliWithBuiltins(): CliKernel {
  const cli = new CliKernel("development");
  cli.addCommand(Build); // name "build", alias "compile"
  cli.addCommand(Dev); // name "development", alias "dev"
  cli.addCommand(Cluster); // name "cluster"
  return cli;
}

describe("CliKernel — dispatch built-in vs module", () => {
  let savedArgv: string[];
  beforeEach(() => {
    savedArgv = process.argv;
  });
  afterEach(() => {
    process.argv = savedArgv;
  });

  describe("getRequestedCommandName()", () => {
    it("retourne le 1er token non-option", () => {
      const cli = new CliKernel("development");
      process.argv = ["node", "nodefony", "frontend:build", "--force"];
      assert.strictEqual(
        (cli as any).getRequestedCommandName(),
        "frontend:build",
      );
    });

    it("ignore les options en tête", () => {
      const cli = new CliKernel("development");
      process.argv = ["node", "nodefony", "-d", "network"];
      assert.strictEqual((cli as any).getRequestedCommandName(), "network");
    });

    it("null si aucune commande (--help)", () => {
      const cli = new CliKernel("development");
      process.argv = ["node", "nodefony", "--help"];
      assert.strictEqual((cli as any).getRequestedCommandName(), null);
    });

    it("null si invocation nue", () => {
      const cli = new CliKernel("development");
      process.argv = ["node", "nodefony"];
      assert.strictEqual((cli as any).getRequestedCommandName(), null);
    });
  });

  describe("getBuiltinCommandNames()", () => {
    it("inclut noms ET alias des built-ins enregistrés", () => {
      const cli = makeCliWithBuiltins();
      const names = (cli as any).getBuiltinCommandNames() as Set<string>;
      assert.ok(names.has("build"));
      assert.ok(names.has("compile")); // alias de build
      assert.ok(names.has("development"));
      assert.ok(names.has("dev")); // alias de development
      assert.ok(names.has("cluster"));
    });

    it("n'inclut PAS une commande de module", () => {
      const cli = makeCliWithBuiltins();
      const names = (cli as any).getBuiltinCommandNames() as Set<string>;
      assert.ok(!names.has("frontend:build"));
      assert.ok(!names.has("network"));
    });
  });

  describe("classification (cœur du fix)", () => {
    it("built-in (+ alias) → PAS différé", () => {
      const cli = makeCliWithBuiltins();
      const names = (cli as any).getBuiltinCommandNames() as Set<string>;
      for (const builtin of [
        "build",
        "compile",
        "development",
        "dev",
        "cluster",
      ]) {
        assert.ok(names.has(builtin), `${builtin} doit être built-in`);
      }
    });

    it("commande module → différée (absente des built-ins)", () => {
      const cli = makeCliWithBuiltins();
      const names = (cli as any).getBuiltinCommandNames() as Set<string>;
      process.argv = ["node", "nodefony", "frontend:build"];
      const requested = (cli as any).getRequestedCommandName() as string;
      assert.strictEqual(requested, "frontend:build");
      assert.ok(!names.has(requested)); // ⇒ chemin différé pris
    });
  });
});
