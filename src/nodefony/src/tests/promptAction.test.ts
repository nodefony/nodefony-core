/**
 * Les verbes du superviseur comme actions de l'invite
 * (`service/dev/promptAction.ts`, ADR-0013 §7).
 */
import { describe, expect, it, vi } from "vitest";
import {
  SUPERVISOR_VERBS,
  cliCommandAction,
  describeUnmatchedInput,
  isPromptCommand,
  promptVerb,
  splitPromptLine,
  supervisorActions,
  type IPromptIO,
} from "../service/dev/promptAction";

function io(
  builds: (Promise<boolean> | null)[] = [],
): IPromptIO & { out: string[] } {
  const out: string[] = [];
  return {
    out,
    write: (text, stream = "out") => out.push(`${stream}:${text}`),
    confirm: () => Promise.reject(new Error("non")),
    suspend: () => Promise.reject(new Error("non")),
    ask: () => Promise.resolve({ action: "cancel" }),
    columns: 80,
    pendingBuild: () => builds.shift() ?? null,
  };
}

/**
 * Un manifeste minimal : deux commandes qui refusent l'invite (déclaré, comme
 * le publie `buildCliManifest`), une qui se lance.
 */
const RUNTIME_MANIFEST = {
  version: "0.0.0",
  globalOptions: [],
  commands: [
    {
      name: "development",
      aliases: ["dev"],
      description: "développement",
      options: [],
      prompt: "refuse" as const,
    },
    {
      name: "production",
      aliases: ["prod"],
      description: "production",
      options: [],
      prompt: "refuse" as const,
    },
    { name: "build", aliases: [], description: "build", options: [] },
  ],
};

describe("supervisorActions — les verbes de l'invite", () => {
  const verbs = {
    restart: vi.fn(async () => true),
    clear: vi.fn(),
    close: vi.fn(() => true),
    help: vi.fn(),
    quit: vi.fn(),
    status: vi.fn(async (_signal: AbortSignal) => {}),
  };
  const actions = supervisorActions(verbs);
  const find = (input: string) => actions.find((a) => a.matches(input));

  it("un verbe par entrée de SUPERVISOR_VERBS, dans l'ordre", () => {
    expect(actions.map((a) => a.id)).to.deep.equal(
      SUPERVISOR_VERBS.map((v) => v.id),
    );
  });

  it("reconnaît `/quit` et les espaces autour — jamais `quit` nu, `/quit now` ni `/qui`", () => {
    expect(find("/quit")?.id).to.equal("quit");
    expect(find("  /clear ")?.id).to.equal("clear");
    expect(find("quit")).to.equal(undefined);
    expect(find("clear")).to.equal(undefined);
    expect(find("/quit now")).to.equal(undefined);
    expect(find("/qui")).to.equal(undefined);
  });

  it("les autres noms : `/exit` = quit, `/reboot` = restart", () => {
    expect(find("/exit")?.id).to.equal("quit");
    expect(find("/reboot")?.id).to.equal("restart");
    expect(find("exit")).to.equal(undefined);
  });

  it("chaque verbe appelle SON geste et rend 0", async () => {
    const signal = new AbortController().signal;
    for (const id of [
      "clear",
      "close",
      "help",
      "quit",
      "restart",
      "status",
    ] as const) {
      expect(await find(`/${id}`)?.run(`/${id}`, io(), signal)).to.equal(0);
      expect(verbs[id]).toHaveBeenCalledTimes(1);
    }
  });

  it("close refusé (onglet qui ne se ferme pas) : code 1, et il le dit", async () => {
    const close = supervisorActions({
      ...verbs,
      close: () => false,
    }).find((a) => a.id === "close");
    const sink = io();
    expect(
      await close?.run("/close", sink, new AbortController().signal),
    ).to.equal(1);
    expect(sink.out[0]).to.contain("cet onglet ne se ferme pas");
  });

  it("restart refusé (rechargement en cours) : code 1, et il le dit", async () => {
    const restart = supervisorActions({
      ...verbs,
      restart: async () => false,
    }).find((a) => a.id === "restart");
    const sink = io();
    expect(
      await restart?.run("restart", sink, new AbortController().signal),
    ).to.equal(1);
    expect(sink.out).to.deep.equal(["err:un rechargement est déjà en cours\n"]);
  });

  it("complete : le nom principal d'abord, l'autre nom seulement s'il est seul à prolonger", () => {
    expect(find("/restart")?.complete?.("/re")).to.deep.equal(["/restart"]);
    expect(find("/restart")?.complete?.("/reb")).to.deep.equal(["/reboot"]);
    expect(find("/quit")?.complete?.("/ex")).to.deep.equal(["/exit"]);
    expect(find("/restart")?.complete?.("re")).to.deep.equal([]);
  });

  it("promptVerb : le premier mot, sans le `/`", () => {
    expect(promptVerb("  /inspect routes ")).to.equal("inspect");
    expect(promptVerb("")).to.equal("");
  });

  it("saisie non reconnue : la commande inconnue nommée, ou la règle du `/` rappelée", () => {
    expect(describeUnmatchedInput("/nope x")).to.equal(
      "commande inconnue : /nope — /help pour l'aide\n",
    );
    expect(describeUnmatchedInput("quit")).to.equal(
      "les commandes commencent par « / » — /help pour l'aide\n",
    );
  });
});

describe("cliCommandAction — `/nodefony <commande>`", () => {
  const action = cliCommandAction(() => RUNTIME_MANIFEST);
  const signal = new AbortController().signal;

  it("reconnaît le mot `/nodefony`, seul ou suivi d'une commande — jamais `/nodefonyx`", () => {
    expect(action.matches("/nodefony")).to.equal(true);
    expect(action.matches("  /nodefony build --force ")).to.equal(true);
    expect(action.matches("/nodefonyx")).to.equal(false);
    expect(action.matches("nodefony build")).to.equal(false);
    expect(action.complete?.("/nod")).to.deep.equal(["/nodefony"]);
  });

  it("une commande de runtime ne se lance jamais ; sans lanceur, une autre donne la ligne à taper", async () => {
    const runtime = io();
    expect(await action.run("/nodefony dev", runtime, signal)).to.equal(1);
    expect(runtime.out[0]).to.contain("ne se lance jamais depuis l'invite");
    const other = io();
    expect(await action.run("/nodefony build --force", other, signal)).to.equal(
      1,
    );
    expect(other.out[0]).to.contain("npx nodefony build --force");
  });

  it("seule, elle rappelle sa forme (64, erreur d'usage)", async () => {
    const sink = io();
    expect(await action.run("/nodefony", sink, signal)).to.equal(64);
    expect(sink.out[0]).to.contain("/nodefony <commande>");
  });

  it("sans lanceur, aucun onglet : le refus se dit là où l'on tape", () => {
    expect(action.tabTitle?.("/nodefony build")).to.equal(null);
  });
});

describe("cliCommandAction — lancée en sous-processus, dans son onglet (#538, lot 2a)", () => {
  const signal = new AbortController().signal;
  const launch = vi.fn(async () => 0);
  const action = cliCommandAction(() => RUNTIME_MANIFEST, launch);

  it("son onglet porte le nom de la commande ; un refus ou une erreur d'usage n'en ouvre pas", () => {
    expect(action.tabTitle?.("/nodefony build --force")).to.equal("build");
    expect(action.tabTitle?.("/nodefony dev")).to.equal(null);
    expect(action.tabTitle?.("/nodefony")).to.equal(null);
    expect(action.tabTitle?.('/nodefony build "ouvert')).to.equal(null);
  });

  it("lance les arguments découpés et rend le code du lanceur", async () => {
    launch.mockResolvedValueOnce(3);
    const sink = io();
    expect(
      await action.run(
        `/nodefony create service "Mon Service" --force`,
        sink,
        signal,
      ),
    ).to.equal(3);
    expect(launch).toHaveBeenLastCalledWith(
      ["create", "service", "Mon Service", "--force"],
      sink,
      signal,
    );
  });

  it("une commande de runtime n'atteint jamais le lanceur", async () => {
    launch.mockClear();
    expect(await action.run("/nodefony production", io(), signal)).to.equal(1);
    expect(launch).not.toHaveBeenCalled();
  });

  it("le refus déclaré mord sur l'alias tapé, pas seulement sur le nom", async () => {
    launch.mockClear();
    const sink = io();
    expect(
      await action.run("/nodefony prod --workers 2", sink, signal),
    ).to.equal(1);
    expect(sink.out[0]).to.contain("ne se lance jamais depuis l'invite");
    expect(launch).not.toHaveBeenCalled();
  });

  it("manifeste illisible : rien ne se lance à l'aveugle, ni onglet", async () => {
    launch.mockClear();
    const blind = cliCommandAction(() => null, launch);
    expect(blind.tabTitle?.("/nodefony build")).to.equal(null);
    const sink = io();
    expect(await blind.run("/nodefony build", sink, signal)).to.equal(1);
    expect(sink.out[0]).to.contain("npx nodefony build");
    expect(launch).not.toHaveBeenCalled();
  });

  it("un guillemet ouvert : 64, dit, rien de lancé", async () => {
    launch.mockClear();
    const sink = io();
    expect(await action.run('/nodefony build "x', sink, signal)).to.equal(64);
    expect(sink.out[0]).to.contain("guillemet non fermé");
    expect(launch).not.toHaveBeenCalled();
  });

  it("un guillemet ouvert : la ligne rappelée ne montre pas le secret", async () => {
    const sink = io();
    await action.run(
      '/nodefony security:user:add bob --password "hunter2',
      sink,
      signal,
    );
    expect(sink.out[0]).to.contain("--password ***");
    expect(sink.out.join("")).to.not.contain("hunter2");
  });

  it("un build qui en suit un autre : elle attend les DEUX, puis part une seule fois", async () => {
    launch.mockClear();
    const sink = io([Promise.resolve(true), Promise.resolve(true)]);
    expect(await action.run("/nodefony build", sink, signal)).to.equal(0);
    expect(sink.out).to.deep.equal([
      "out:attend la fin du build…\n",
      "out:attend la fin du build…\n",
    ]);
    expect(launch).toHaveBeenCalledTimes(1);
  });
});

describe("splitPromptLine — la ligne en arguments, sans shell", () => {
  it("blancs, guillemets doubles et simples, échappement", () => {
    expect(splitPromptLine("  build   --force ")).to.deep.equal([
      "build",
      "--force",
    ]);
    expect(splitPromptLine(`a "b c" 'd e' f\\ g`)).to.deep.equal([
      "a",
      "b c",
      "d e",
      "f g",
    ]);
    expect(splitPromptLine(`"a \\"b\\"" '\\n'`)).to.deep.equal([
      'a "b"',
      "\\n",
    ]);
    expect(splitPromptLine(`x "" y`)).to.deep.equal(["x", "", "y"]);
  });

  it("aucune substitution : $VAR, * et ~ restent tels quels", () => {
    expect(splitPromptLine("$HOME * ~")).to.deep.equal(["$HOME", "*", "~"]);
  });

  it("un guillemet ouvert : null", () => {
    expect(splitPromptLine('build "ouvert')).to.equal(null);
    expect(splitPromptLine("build 'ouvert")).to.equal(null);
  });
});

describe("cliCommandAction — Tab par computeCompletions (D12)", () => {
  const command = (
    name: string,
    options: string[] = [],
    extra: Record<string, unknown> = {},
  ) => ({ name, aliases: [], description: name, options, ...extra });
  const manifest = {
    version: "0.0.0",
    globalOptions: ["--debug"],
    commands: [
      command("build", ["--force", "--filter"]),
      command("development", ["--watch"], { prompt: "refuse" }),
      command("doctor"),
      command("status"),
      command("start", [], { prompt: "refuse" }),
      command("create", ["--preset"], {
        args: [["app", "module"]],
        optionValues: { "--preset": ["minimal", "full"] },
      }),
    ],
  };
  const complete = (prefix: string) =>
    cliCommandAction(() => manifest).complete?.(prefix);

  it("le nom de la commande — jamais une commande de runtime ni un verbe", () => {
    expect(complete("/nodefony bu")).to.deep.equal(["/nodefony build"]);
    expect(complete("/nodefony d")).to.deep.equal(["/nodefony doctor"]);
    expect(complete("/nodefony st")).to.deep.equal([]);
  });

  it("ses options, ses arguments, la valeur qu'une option attend — en saisie entière", () => {
    expect(complete("/nodefony build --f")).to.deep.equal([
      "/nodefony build --force",
      "/nodefony build --filter",
    ]);
    expect(complete("/nodefony create ")).to.include("/nodefony create app");
    expect(complete("/nodefony create app --preset m")).to.deep.equal([
      "/nodefony create app --preset minimal",
    ]);
  });

  it("la forme courte d'une option seulement si l'on tape `-x`", () => {
    const flags = cliCommandAction(() => ({
      ...manifest,
      commands: [command("build", ["-f", "--force"])],
    }));
    expect(flags.complete?.("/nodefony build ")).to.deep.equal([
      "/nodefony build --force",
      "/nodefony build --debug",
    ]);
    expect(flags.complete?.("/nodefony build -")).to.include(
      "/nodefony build -f",
    );
    expect(flags.complete?.("/nodefony build -f")).to.deep.equal([
      "/nodefony build -f",
    ]);
  });

  it("sans manifeste : `/nodefony` seul ; jamais hors de son mot", () => {
    const bare = cliCommandAction();
    expect(bare.complete?.("/nod")).to.deep.equal(["/nodefony"]);
    expect(bare.complete?.("/nodefony build --f")).to.deep.equal([]);
    expect(complete("/nodefonyx b")).to.deep.equal([]);
    expect(complete("nodefony b")).to.deep.equal([]);
  });

  it("isPromptCommand : la règle commune à la bande et à Tab", () => {
    const [development, , build] = RUNTIME_MANIFEST.commands;
    expect(isPromptCommand(build!)).to.equal(true);
    expect(isPromptCommand(development!)).to.equal(false);
    expect(isPromptCommand(command("status"))).to.equal(false);
  });
});
