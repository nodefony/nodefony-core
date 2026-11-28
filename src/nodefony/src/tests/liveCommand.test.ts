import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
  vi,
} from "vitest";
import CliKernel from "../kernel/CliKernel";
import Command from "../command/Command";
import { createTestModule } from "../testing";
import type { ICommandResult } from "../command/readState";
import { liveCommandExecutor } from "../kernel/liveCommand";
import { buildProjectEnvReport, readEnvState } from "../cli/env";
import { DEV_CHILD_ENV, NOT_LIVE } from "../service/dev/devChannel";
import type { IRpcCall, IRpcProgressUpdate } from "../realtime/JsonRpcPeer";
import type { IReadStateContext } from "../command/readState";

/** Un appel du pair, sans pair : signal lu à la demande, étapes relevées. */
function fakeCall() {
  const controller = new AbortController();
  const steps: IRpcProgressUpdate[] = [];
  let signalReads = 0;
  const call: IRpcCall = {
    id: 1,
    get signal() {
      signalReads++;
      return controller.signal;
    },
    progress(update) {
      steps.push(update);
      return true;
    },
  };
  return { call, controller, steps, reads: () => signalReads };
}

const PARAMS = { command: "env", arguments: [], columns: 100 } as const;

describe("exécuteur de command.execute — le serveur vivant appelle readState()", () => {
  it("commande inconnue, sans readState(), ou qui refuse ces arguments : live: false", async () => {
    const { call } = fakeCall();
    const unknown = liveCommandExecutor({ findCommand: () => null });
    assert.deepEqual(await unknown(PARAMS, call), NOT_LIVE);
    const bare = liveCommandExecutor({ findCommand: () => ({}) });
    assert.deepEqual(await bare(PARAMS, call), NOT_LIVE);
    const refuses = liveCommandExecutor({
      findCommand: () => ({ readState: async () => null }),
    });
    assert.deepEqual(await refuses(PARAMS, call), NOT_LIVE);
    const orphan = liveCommandExecutor(null);
    assert.deepEqual(await orphan(PARAMS, call), NOT_LIVE);
  });

  it("le résultat part tel quel ; arguments, largeur, signal et étapes viennent de l'appel", async () => {
    const { call, controller, steps, reads } = fakeCall();
    const seen: { args: readonly string[]; ctx: IReadStateContext }[] = [];
    const execute = liveCommandExecutor({
      findCommand: (name) =>
        name === "env"
          ? {
              readState: async (args, ctx) => {
                seen.push({ args, ctx });
                return { code: 78, parts: [{ text: "manque NF_X\n" }] };
              },
            }
          : null,
    });
    const result = await execute(
      { command: "env", arguments: ["--json"], columns: 42 },
      call,
    );
    assert.deepEqual(result, {
      live: true,
      code: 78,
      parts: [{ text: "manque NF_X\n" }],
    });
    const first = seen[0];
    assert.ok(first !== undefined);
    const { args, ctx } = first;
    assert.deepEqual(args, ["--json"]);
    assert.equal(ctx.columns, 42);
    // Le signal du pair ne naît qu'à la première lecture : qui ne le lit pas
    // ne le paie pas.
    assert.equal(reads(), 0);
    controller.abort(new Error("Ctrl+C"));
    assert.equal(ctx.signal.aborted, true);
    assert.equal(reads(), 1);
    assert.equal(ctx.progress({ message: "étape" }), true);
    assert.deepEqual(steps, [{ message: "étape" }]);
  });

  it("une commande de MODULE se sert en direct : findCommand la trouve, getCommand non", async () => {
    // Le serveur vivant passe SON CliKernel. Une commande posée par
    // `Module.addCommand` n'entre que dans `Module.commands` : chercher dans
    // `cli.commands` seul la renvoyait toujours en sous-processus.
    class Stats extends Command {
      constructor(cli: CliKernel) {
        super("blog:stats", "statistiques", cli);
      }
      override async readState(): Promise<ICommandResult> {
        return { code: 0, parts: [{ text: "3 articles\n" }] };
      }
    }
    const cli = new CliKernel("development");
    const blog = createTestModule({ name: "blog" });
    blog.commands["blog:stats"] = new Stats(cli);
    Object.assign(cli, { kernel: { getModules: () => ({ blog }) } });
    assert.equal(cli.getCommand("blog:stats"), null);
    assert.equal(cli.findCommand("constructor"), null);
    const { call } = fakeCall();
    assert.deepEqual(
      await liveCommandExecutor(cli)(
        { command: "blog:stats", arguments: [], columns: 80 },
        call,
      ),
      { live: true, code: 0, parts: [{ text: "3 articles\n" }] },
    );
  });

  it("les intégrées qui se servent en direct ne sont jamais de cycle de vie", () => {
    const cli = new CliKernel("development");
    cli.registerBuiltinCommands();
    const live = cli
      .buildBuiltinManifest()
      .commands.map((c) => cli.getCommand(c.name))
      .filter((c): c is NonNullable<typeof c> => c?.readState !== undefined);
    // Population amputée = faux vert : `env` est le pilote.
    assert.ok(live.some((c) => c.name === "env"));
    const lifecycle = live
      .filter(
        (c) =>
          c.servesTraffic ||
          c.lifetime === "longrunning" ||
          c.runProfile?.servers === true,
      )
      .map((c) => c.name);
    assert.deepEqual(lifecycle, []);
  });
});

describe("nodefony env en direct — ce que le SERVEUR a lu, pas le disque", () => {
  let dir = "";
  beforeAll(() => {
    // Hors projet, et un `.env` sur le disque que le serveur n'a jamais lu.
    dir = mkdtempSync(path.join(os.tmpdir(), "nf-live-env-"));
    writeFileSync(path.join(dir, ".env"), "NF_LIVE_DISK_ONLY=1\n");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env[DEV_CHILD_ENV];
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (previous === undefined) delete process.env[DEV_CHILD_ENV];
    else process.env[DEV_CHILD_ENV] = previous;
  });

  it("le rapport en direct porte l'environnement du processus ; la CLI relit le disque", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    // Ce que le superviseur pose au SEUL serveur : le rapport en direct le
    // montre, parmi les variables posées par le framework.
    process.env[DEV_CHILD_ENV] = "1";
    const live = await readEnvState(["--json"], 100);
    assert.ok(live !== null);
    assert.equal(live.json, true);
    const report: unknown = JSON.parse(live.text);
    assert.ok(
      typeof report === "object" &&
        report !== null &&
        "unknown" in report &&
        "reserved" in report,
    );
    assert.ok(JSON.stringify(report.reserved).includes(DEV_CHILD_ENV));
    const names = JSON.stringify(report.unknown);
    assert.ok(!names.includes("NF_LIVE_DISK_ONLY"), names);
    // Le témoin : la voie de la CLI, elle, voit le fichier.
    const disk = await buildProjectEnvReport(null, dir);
    assert.ok(JSON.stringify(disk.unknown).includes("NF_LIVE_DISK_ONLY"));
  });

  it("texte à la largeur de l'onglet ; code 0 quand rien de requis ne manque", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    const live = await readEnvState([], 60);
    assert.ok(live !== null);
    assert.equal(live.json, false);
    assert.equal(live.code, 0);
    const over = live.text
      .split("\n")
      .map(stripVTControlCharacters)
      .filter((l) => l.length > 59);
    assert.deepEqual(over, []);
  });

  it("aide, erreur d'usage, --example et --cwd ne se servent pas en direct", async () => {
    for (const args of [
      ["--help"],
      ["--nope"],
      ["--example"],
      ["--cwd", dir],
      ["--env"],
    ]) {
      assert.equal(await readEnvState(args, 80), null, args.join(" "));
    }
  });

  it("la commande env rend une part text, typée JSON avec --json", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    const cli = new CliKernel("development");
    cli.registerBuiltinCommands();
    const env = cli.getCommand("env");
    assert.ok(env?.readState !== undefined);
    const ctx: IReadStateContext = {
      columns: 80,
      signal: new AbortController().signal,
      progress: () => false,
    };
    const json = await env.readState(["--json"], ctx);
    assert.equal(json?.parts.length, 1);
    assert.deepEqual(
      json.parts.map((p) => ("mediaType" in p ? p.mediaType : null)),
      ["application/json"],
    );
    const text = await env.readState([], ctx);
    assert.ok(text?.parts[0] !== undefined && "text" in text.parts[0]);
    assert.ok(!("mediaType" in text.parts[0]));
    assert.equal(await env.readState(["--example"], ctx), null);
  });
});
