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
  supervisorActions,
  type IPromptIO,
} from "../service/dev/promptAction";

function io(): IPromptIO & { out: string[] } {
  const out: string[] = [];
  return {
    out,
    write: (text, stream = "out") => out.push(`${stream}:${text}`),
    confirm: () => Promise.reject(new Error("non")),
    suspend: () => Promise.reject(new Error("non")),
    columns: 80,
  };
}

describe("supervisorActions — les verbes de l'invite", () => {
  const verbs = {
    restart: vi.fn(async () => true),
    clear: vi.fn(),
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
    for (const id of ["clear", "help", "quit", "restart", "status"] as const) {
      expect(await find(`/${id}`)?.run(`/${id}`, io(), signal)).to.equal(0);
      expect(verbs[id]).toHaveBeenCalledTimes(1);
    }
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
  const action = cliCommandAction();
  const signal = new AbortController().signal;

  it("reconnaît le mot `/nodefony`, seul ou suivi d'une commande — jamais `/nodefonyx`", () => {
    expect(action.matches("/nodefony")).to.equal(true);
    expect(action.matches("  /nodefony build --force ")).to.equal(true);
    expect(action.matches("/nodefonyx")).to.equal(false);
    expect(action.matches("nodefony build")).to.equal(false);
    expect(action.complete?.("/nod")).to.deep.equal(["/nodefony"]);
  });

  it("une commande de runtime ne se lance jamais ; une autre pas encore, avec la ligne à taper", async () => {
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
      command("development", ["--watch"]),
      command("doctor"),
      command("status"),
      command("start"),
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
    expect(isPromptCommand("build")).to.equal(true);
    expect(isPromptCommand("development")).to.equal(false);
    expect(isPromptCommand("status")).to.equal(false);
  });
});
