/* eslint-disable @typescript-eslint/no-explicit-any */
/*
 *   Tests du dispatch CLI built-in vs commande de module (CliKernel)
 *   Régression du bug `nodefony frontend:build` → `unknown command` (fallback serveur).
 *   On teste la CLASSIFICATION (helpers privés) sans booter le kernel.
 */

import assert from "node:assert";
import CliKernel from "../kernel/CliKernel";
import Command from "../command/Command";
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

  // ─── resolveCommand — point UNIQUE de résolution (refacto parse-pur) ─────────
  // Le callback commander ne fait plus que signaler le match ; resolveCommand
  // centralise : mutation kernel + application du runProfile DÉCLARÉ + setEvents.
  describe("resolveCommand — point unique de résolution", () => {
    /** Stub kernel minimal : cible des mutations + récepteur des once() de setEvents. */
    function makeKernelStub() {
      return {
        command: null as unknown,
        commandArgs: [] as unknown[],
        runProfile: {
          servers: false,
          lifetime: "oneshot",
          interactive: false,
        },
        onceCalls: [] as string[],
        once(event: string) {
          this.onceCalls.push(event);
        },
      };
    }

    /** CliKernel câblé sur le stub (container + propriété kernel). */
    function makeCliWithKernelStub() {
      const cli = new CliKernel("development");
      const stub = makeKernelStub();
      cli.container?.set("kernel", stub);
      (cli as any).kernel = stub;
      return { cli, stub };
    }

    it("lie la commande au kernel (command + commandArgs) et câble kernelEvent", () => {
      const { cli, stub } = makeCliWithKernelStub();
      class Batch extends Command {
        constructor(c: CliKernel) {
          super("test:resolve", "", c, { kernelEvent: "onRegister" });
        }
      }
      const cmd = cli.addCommand(Batch as any);
      cli.resolveCommand(cmd, ["arg1", { opt: true }]);
      assert.strictEqual(stub.command, cmd);
      assert.deepStrictEqual(stub.commandArgs, ["arg1", { opt: true }]);
      // setEvents a câblé l'exécution sur la phase déclarée.
      assert.ok(stub.onceCalls.includes("onRegister"));
    });

    it("applique le runProfile DÉCLARÉ et resynchronise kernel.runProfile (cas module post-onStart)", () => {
      const { cli, stub } = makeCliWithKernelStub();
      // Simule le boot réel : kernel.runProfile déjà copié à onStart (profil console).
      // Une commande de module est résolue APRÈS (onPreRegister) → le re-sync doit
      // toucher le kernel, sinon `servers: true` déclaré resterait lettre morte.
      class ModServe extends Command {
        constructor(c: CliKernel) {
          super("mod:serve", "", c, {
            kernelEvent: "onPostReady",
            runProfile: {
              servers: true,
              lifetime: "longrunning",
              interactive: false,
            },
          });
        }
      }
      const cmd = cli.addCommand(ModServe as any);
      cli.resolveCommand(cmd, []);
      assert.strictEqual(cli.runProfile.servers, true);
      assert.strictEqual((stub.runProfile as any).servers, true);
      assert.strictEqual((stub.runProfile as any).lifetime, "longrunning");
      // Copie défensive : la déclaration statique n'est jamais la réf runtime.
      assert.notStrictEqual(cli.runProfile, cmd.runProfile);
    });

    it("sans runProfile déclaré → profil du run inchangé", () => {
      const { cli, stub } = makeCliWithKernelStub();
      class Plain extends Command {
        constructor(c: CliKernel) {
          super("plain:cmd", "", c, { kernelEvent: "onRegister" });
        }
      }
      const cmd = cli.addCommand(Plain as any);
      const before = cli.runProfile;
      cli.resolveCommand(cmd, []);
      assert.strictEqual(cmd.runProfile, null);
      assert.strictEqual(cli.runProfile, before);
      assert.strictEqual((stub.runProfile as any).servers, false);
    });

    it("parse commander → resolveCommand (le match ne fait que signaler)", async () => {
      const { cli, stub } = makeCliWithKernelStub();
      class Signal extends Command {
        constructor(c: CliKernel) {
          super("signal:me", "", c, { kernelEvent: "onBoot" });
        }
      }
      const cmd = cli.addCommand(Signal as any);
      cli.commander?.exitOverride();
      await cli.commander?.parseAsync(["node", "nodefony", "signal:me"]);
      // Le parse n'a PAS exécuté la commande : il l'a résolue (mutation kernel +
      // câblage à sa phase). L'exécution appartient au lifecycle.
      assert.strictEqual(stub.command, cmd);
      assert.ok(stub.onceCalls.includes("onBoot"));
    });
  });
});
