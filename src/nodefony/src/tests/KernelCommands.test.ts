/* eslint-disable @typescript-eslint/no-explicit-any */
/*
 *   Tests des commandes kernel Nodefony
 *   Vérifie : construction, options, description, alias, kernelEvent
 *   Sans lancer le kernel — CliKernel minimal mocké
 */

import assert from "node:assert";
import { expect } from "chai";
import "mocha";
import CliKernel from "../kernel/CliKernel";
import Command from "../command/Command";
import BuildCommand from "../kernel/commands/BuildCommand";
import DevCommand from "../kernel/commands/DevCommand";
import InstallCommand from "../kernel/commands/InstallCommand";
import KillCommand from "../kernel/commands/KillCommnand";
import OutdatedCommand from "../kernel/commands/OutdatedCommand";
import ProdCommand from "../kernel/commands/ProdCommand";
import StagingCommand from "../kernel/commands/StagingCommand";
import StartCommand from "../kernel/commands/StartCommand";
import Pm2Command from "../kernel/commands/pm2/Pm2Command";

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeCli(): CliKernel {
  return new CliKernel("development");
}

// ─── 1. BuildCommand ─────────────────────────────────────────────────────────

describe("KernelCommand — BuildCommand", () => {
  let cli: CliKernel;
  beforeEach(() => {
    cli = makeCli();
  });

  it("instance Command", () => {
    const cmd = new BuildCommand(cli);
    assert(cmd instanceof Command);
    assert(cmd instanceof BuildCommand);
  });

  it("name = 'build'", () => {
    const cmd = new BuildCommand(cli);
    assert.strictEqual(cmd.name, "build");
  });

  it("description contient 'build'", () => {
    const cmd = new BuildCommand(cli);
    expect(cmd.description().toLowerCase()).to.include("build");
  });

  it("alias 'compile' enregistré", () => {
    const cmd = new BuildCommand(cli);
    assert.strictEqual(cmd.command.alias(), "compile");
  });

  it("kernelEvent = 'onRegister'", () => {
    const cmd = new BuildCommand(cli);
    assert.strictEqual(cmd.kernelEvent, "onRegister");
  });

  it("showBanner = false", () => {
    const cmd = new BuildCommand(cli);
    assert.strictEqual((cmd.options as any).showBanner, false);
  });

  it("onKernelStart est défini (override async)", () => {
    const cmd = new BuildCommand(cli);
    expect(cmd.onKernelStart).to.be.a("function");
  });

  it("generate() sans kernel retourne Promise", async () => {
    const cmd = new BuildCommand(cli);
    const p = cmd.generate();
    assert.ok(p instanceof Promise);
    await p;
  });
});

// ─── 2. DevCommand ───────────────────────────────────────────────────────────

describe("KernelCommand — DevCommand", () => {
  let cli: CliKernel;
  beforeEach(() => {
    cli = makeCli();
  });

  it("instance Command", () => {
    const cmd = new DevCommand(cli);
    assert(cmd instanceof Command);
  });

  it("name = 'development'", () => {
    const cmd = new DevCommand(cli);
    assert.strictEqual(cmd.name, "development");
  });

  it("alias 'dev' enregistré", () => {
    const cmd = new DevCommand(cli);
    assert.strictEqual(cmd.command.alias(), "dev");
  });

  it("kernelEvent = 'onPostReady'", () => {
    const cmd = new DevCommand(cli);
    assert.strictEqual(cmd.kernelEvent, "onPostReady");
  });

  it("description non vide", () => {
    const cmd = new DevCommand(cli);
    expect(cmd.description()).to.have.length.greaterThan(0);
  });

  it("onKernelStart est défini", () => {
    const cmd = new DevCommand(cli);
    expect(cmd.onKernelStart).to.be.a("function");
  });
});

// ─── 3. InstallCommand ───────────────────────────────────────────────────────

describe("KernelCommand — InstallCommand", () => {
  let cli: CliKernel;
  beforeEach(() => {
    cli = makeCli();
  });

  it("instance Command", () => {
    const cmd = new InstallCommand(cli);
    assert(cmd instanceof Command);
  });

  it("name = 'install'", () => {
    const cmd = new InstallCommand(cli);
    assert.strictEqual(cmd.name, "install");
  });

  it("kernelEvent = 'onRegister'", () => {
    const cmd = new InstallCommand(cli);
    assert.strictEqual(cmd.kernelEvent, "onRegister");
  });

  it("option --force enregistrée", () => {
    const cmd = new InstallCommand(cli);
    const opts = cmd.command.options;
    const force = opts.find((o: any) => o.long === "--force");
    assert.ok(force, "option --force manquante");
  });

  it("generate() sans kernel retourne this", async () => {
    const cmd = new InstallCommand(cli);
    const res = await cmd.generate({});
    assert.strictEqual(res, cmd);
  });
});

// ─── 4. KillCommand ──────────────────────────────────────────────────────────

describe("KernelCommand — KillCommand", () => {
  let cli: CliKernel;
  beforeEach(() => {
    cli = makeCli();
  });

  it("instance Command", () => {
    const cmd = new KillCommand(cli);
    assert(cmd instanceof Command);
  });

  it("name = 'kill'", () => {
    const cmd = new KillCommand(cli);
    assert.strictEqual(cmd.name, "kill");
  });

  it("kernelEvent = 'onStart'", () => {
    const cmd = new KillCommand(cli);
    assert.strictEqual(cmd.kernelEvent, "onStart");
  });

  it("description contient 'kill' ou 'PM2'", () => {
    const cmd = new KillCommand(cli);
    const desc = cmd.description().toLowerCase();
    expect(desc).to.satisfy(
      (d: string) => d.includes("kill") || d.includes("pm2"),
    );
  });

  it("onKernelStart est défini", () => {
    const cmd = new KillCommand(cli);
    expect(cmd.onKernelStart).to.be.a("function");
  });
});

// ─── 5. OutdatedCommand ──────────────────────────────────────────────────────

describe("KernelCommand — OutdatedCommand", () => {
  let cli: CliKernel;
  beforeEach(() => {
    cli = makeCli();
  });

  it("instance Command", () => {
    const cmd = new OutdatedCommand(cli);
    assert(cmd instanceof Command);
  });

  it("name = 'outdated'", () => {
    const cmd = new OutdatedCommand(cli);
    assert.strictEqual(cmd.name, "outdated");
  });

  it("kernelEvent = 'onRegister'", () => {
    const cmd = new OutdatedCommand(cli);
    assert.strictEqual(cmd.kernelEvent, "onRegister");
  });

  it("generate() sans kernel retourne this", async () => {
    const cmd = new OutdatedCommand(cli);
    const res = await cmd.generate();
    assert.strictEqual(res, cmd);
  });
});

// ─── 6. ProdCommand ──────────────────────────────────────────────────────────

describe("KernelCommand — ProdCommand", () => {
  let cli: CliKernel;
  beforeEach(() => {
    cli = makeCli();
  });

  it("instance Command", () => {
    const cmd = new ProdCommand(cli);
    assert(cmd instanceof Command);
  });

  it("name = 'production'", () => {
    const cmd = new ProdCommand(cli);
    assert.strictEqual(cmd.name, "production");
  });

  it("alias 'prod' enregistré", () => {
    const cmd = new ProdCommand(cli);
    assert.strictEqual(cmd.command.alias(), "prod");
  });

  it("kernelEvent = 'onPostReady'", () => {
    const cmd = new ProdCommand(cli);
    assert.strictEqual(cmd.kernelEvent, "onPostReady");
  });

  it("option --no-daemon enregistrée", () => {
    const cmd = new ProdCommand(cli);
    const opts = cmd.command.options;
    const noDaemon = opts.find((o: any) => o.long === "--no-daemon");
    assert.ok(noDaemon, "option --no-daemon manquante");
  });

  it("onKernelStart est défini", () => {
    const cmd = new ProdCommand(cli);
    expect(cmd.onKernelStart).to.be.a("function");
  });
});

// ─── 7. StagingCommand ───────────────────────────────────────────────────────

describe("KernelCommand — StagingCommand", () => {
  let cli: CliKernel;
  beforeEach(() => {
    cli = makeCli();
  });

  it("instance Command", () => {
    const cmd = new StagingCommand(cli);
    assert(cmd instanceof Command);
  });

  it("name = 'staging'", () => {
    const cmd = new StagingCommand(cli);
    assert.strictEqual(cmd.name, "staging");
  });

  it("alias 'preprod' enregistré", () => {
    const cmd = new StagingCommand(cli);
    assert.strictEqual(cmd.command.alias(), "preprod");
  });

  it("kernelEvent = 'onStart'", () => {
    const cmd = new StagingCommand(cli);
    assert.strictEqual(cmd.kernelEvent, "onStart");
  });

  it("cpu est un nombre positif", () => {
    const cmd = new StagingCommand(cli);
    expect(cmd.cpu).to.be.a("number").and.greaterThan(0);
  });

  it("onKernelStart est défini", () => {
    const cmd = new StagingCommand(cli);
    expect(cmd.onKernelStart).to.be.a("function");
  });

  it("preProd() ne throw pas si cluster.isPrimary", () => {
    const cmd = new StagingCommand(cli);
    assert.doesNotThrow(() => {
      cmd.preProd();
    });
  });
});

// ─── 8. StartCommand ─────────────────────────────────────────────────────────

describe("KernelCommand — StartCommand", () => {
  let cli: CliKernel;
  beforeEach(() => {
    cli = makeCli();
  });

  it("instance Command", () => {
    const cmd = new StartCommand(cli);
    assert(cmd instanceof Command);
  });

  it("name = 'start'", () => {
    const cmd = new StartCommand(cli);
    assert.strictEqual(cmd.name, "start");
  });

  it("kernelEvent = 'onStart'", () => {
    const cmd = new StartCommand(cli);
    assert.strictEqual(cmd.kernelEvent, "onStart");
  });

  it("description non vide", () => {
    const cmd = new StartCommand(cli);
    expect(cmd.description()).to.have.length.greaterThan(0);
  });

  it("interaction() override défini", () => {
    const cmd = new StartCommand(cli);
    expect(cmd.interaction).to.be.a("function");
  });

  it("generate() override défini", () => {
    const cmd = new StartCommand(cli);
    expect(cmd.generate).to.be.a("function");
  });
});

// ─── 9. Pm2Command ───────────────────────────────────────────────────────────

describe("KernelCommand — Pm2Command", () => {
  let cli: CliKernel;
  beforeEach(() => {
    cli = makeCli();
  });

  it("instance Command", () => {
    const cmd = new Pm2Command(cli);
    assert(cmd instanceof Command);
  });

  it("name = 'pm2'", () => {
    const cmd = new Pm2Command(cli);
    assert.strictEqual(cmd.name, "pm2");
  });

  it("kernelEvent = 'onStart'", () => {
    const cmd = new Pm2Command(cli);
    assert.strictEqual(cmd.kernelEvent, "onStart");
  });

  it("description non vide", () => {
    const cmd = new Pm2Command(cli);
    expect(cmd.description()).to.have.length.greaterThan(0);
  });
});

// ─── 10. Registre complet — toutes les commandes enregistrables ───────────────

describe("KernelCommands — registre complet", () => {
  it("9 commandes kernel construites sans erreur", () => {
    const cli = makeCli();
    const commands: Command[] = [];
    assert.doesNotThrow(() => {
      commands.push(new BuildCommand(cli));
      commands.push(new DevCommand(cli));
      commands.push(new InstallCommand(cli));
      commands.push(new KillCommand(cli));
      commands.push(new OutdatedCommand(cli));
      commands.push(new ProdCommand(cli));
      commands.push(new StagingCommand(cli));
      commands.push(new StartCommand(cli));
      commands.push(new Pm2Command(cli));
    });
    assert.strictEqual(commands.length, 9);
  });

  it("noms uniques", () => {
    const cli = makeCli();
    const names = [
      new BuildCommand(cli).name,
      new DevCommand(cli).name,
      new InstallCommand(cli).name,
      new KillCommand(cli).name,
      new OutdatedCommand(cli).name,
      new ProdCommand(cli).name,
      new StagingCommand(cli).name,
      new StartCommand(cli).name,
      new Pm2Command(cli).name,
    ];
    const unique = new Set(names);
    assert.strictEqual(unique.size, names.length);
  });

  it("toutes instanceof Command", () => {
    const cli = makeCli();
    const cmds = [
      new BuildCommand(cli),
      new DevCommand(cli),
      new InstallCommand(cli),
      new KillCommand(cli),
      new OutdatedCommand(cli),
      new ProdCommand(cli),
      new StagingCommand(cli),
      new StartCommand(cli),
      new Pm2Command(cli),
    ];
    for (const cmd of cmds) {
      assert(cmd instanceof Command, `${cmd.name} n'est pas instanceof Command`);
    }
  });
});

// ─── 11. Performance ─────────────────────────────────────────────────────────

describe("KernelCommands — performance", () => {
  it("construction de toutes les commandes × 10 < 1000ms", () => {
    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      const cli = makeCli();
      new BuildCommand(cli);
      new DevCommand(cli);
      new InstallCommand(cli);
      new KillCommand(cli);
      new OutdatedCommand(cli);
      new ProdCommand(cli);
      new StagingCommand(cli);
      new StartCommand(cli);
      new Pm2Command(cli);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).to.be.lessThan(1000);
  });
});
