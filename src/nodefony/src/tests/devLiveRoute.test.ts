import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import {
  DEV_CHILD_ENV,
  LIVE_COMMAND_TIMEOUT_MS,
  MAX_LIVE_REQUEST_BYTES,
  NOT_LIVE,
  type CommandExecuteResult,
} from "../service/dev/devChannel";
import { LiveCommandRoute, LIVE_READY_WAIT_MS } from "../service/dev/liveRoute";
import type {
  IPromptIO,
  PromptCommandLauncher,
} from "../service/dev/promptAction";
import { PROMPT_INTERRUPTED_CODE } from "../service/dev/promptLaunch";
import type { LiveCommandExecutor } from "../kernel/supervisorLink";
import CliKernel from "../kernel/CliKernel";
import { until, wireLive } from "./devLiveFakes";

/** L'onglet de l'invite : ce qui s'y écrit, sur quelle voie. */
function tab(columns = 100) {
  const out: string[] = [];
  const err: string[] = [];
  const io: IPromptIO = {
    write: (text, stream) => (stream === "err" ? err : out).push(text),
    confirm: () => Promise.reject(new Error("aucune confirmation attendue")),
    ask: () => Promise.reject(new Error("aucune question attendue")),
    suspend: (task) => task(),
    pendingBuild: () => null,
    columns,
  };
  return { io, out, err };
}

/** Le sous-processus : il compte ses lancements et rend 42. */
function subprocess() {
  const runs: (readonly string[])[] = [];
  const launch: PromptCommandLauncher = async (argv) => {
    runs.push(argv);
    return 42;
  };
  return { launch, runs };
}

/** Un serveur relié à la route, ouvert ou pas encore. */
function server(
  route: LiveCommandRoute,
  execute: LiveCommandExecutor,
  serve = true,
) {
  return wireLive(
    execute,
    (child, onError) => route.connect(child, onError),
    serve,
  );
}

const TEXT: CommandExecuteResult = {
  live: true,
  code: 0,
  parts: [{ text: "Environnement : development\n" }],
};

let previous: string | undefined;
beforeEach(() => {
  previous = process.env[DEV_CHILD_ENV];
  process.env[DEV_CHILD_ENV] = "1";
});
afterEach(() => {
  if (previous === undefined) delete process.env[DEV_CHILD_ENV];
  else process.env[DEV_CHILD_ENV] = previous;
  vi.useRealTimers();
});

describe("invite — voie en direct d'abord, sous-processus en repli (ADR-0013 §6)", () => {
  it("serveur prêt : la commande revient du serveur, le sous-processus ne part pas", async () => {
    const route = new LiveCommandRoute();
    const seen: string[] = [];
    const s = server(route, (params) => {
      seen.push(
        `${params.command} ${params.arguments.join(" ")} @${params.columns}`,
      );
      return TEXT;
    });
    await until(() => s.peer.ready);
    const { launch, runs } = subprocess();
    const { io, out } = tab(77);
    const code = await route.launcher(launch)(
      ["env", "--json"],
      io,
      new AbortController().signal,
    );
    assert.equal(code, 0);
    assert.deepEqual(out, ["Environnement : development\n"]);
    assert.deepEqual(seen, ["env --json @77"]);
    assert.deepEqual(runs, []);
  });

  it("live: false : le sous-processus prend la commande, avec ses arguments", async () => {
    const route = new LiveCommandRoute();
    const s = server(route, () => NOT_LIVE);
    await until(() => s.peer.ready);
    const { launch, runs } = subprocess();
    const code = await route.launcher(launch)(
      ["build", "--force"],
      tab().io,
      new AbortController().signal,
    );
    assert.equal(code, 42);
    assert.deepEqual(runs, [["build", "--force"]]);
  });

  it("en démarrage : la commande attend dev.ready, puis se sert en direct", async () => {
    // Horloge figée : seul dev.ready peut réveiller l'attente, jamais son délai.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const route = new LiveCommandRoute();
    const s = server(route, () => TEXT, false);
    const { launch, runs } = subprocess();
    const { io, out } = tab();
    const pending = route.launcher(launch)(
      ["env"],
      io,
      new AbortController().signal,
    );
    await until(() => out.length > 0);
    assert.match(out[0] ?? "", /attend que le serveur soit prêt/);
    s.open();
    assert.equal(await pending, 0);
    assert.deepEqual(runs, []);
  });

  it("en rechargement : le dev.ready tardif de l'ANCIEN serveur ne réveille personne", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const route = new LiveCommandRoute();
    const old = server(route, () => TEXT, false);
    const { launch, runs } = subprocess();
    const { io } = tab();
    const pending = route.launcher(launch)(
      ["env"],
      io,
      new AbortController().signal,
    );
    const next = server(route, () => TEXT, false);
    old.open();
    await until(() => old.peer.ready);
    next.open();
    assert.equal(await pending, 0);
    assert.deepEqual(runs, []);
    assert.ok(next.peer.ready);
  });

  it("dev.ready absent 10 s : sous-processus", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const route = new LiveCommandRoute();
    server(route, () => TEXT, false);
    const { launch, runs } = subprocess();
    const pending = route.launcher(launch)(
      ["env"],
      tab().io,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(LIVE_READY_WAIT_MS - 1);
    assert.deepEqual(runs, []);
    await vi.advanceTimersByTimeAsync(1);
    assert.equal(await pending, 42);
    assert.deepEqual(runs, [["env"]]);
  });

  it("Ctrl+C pendant l'attente : 130, rien ne part", async () => {
    const route = new LiveCommandRoute();
    server(route, () => TEXT, false);
    const { launch, runs } = subprocess();
    const ctrl = new AbortController();
    const { io, out } = tab();
    const pending = route.launcher(launch)(["env"], io, ctrl.signal);
    await until(() => out.length > 0);
    ctrl.abort();
    assert.equal(await pending, PROMPT_INTERRUPTED_CODE);
    assert.deepEqual(runs, []);
  });

  it("crashed : sous-processus tout de suite ; le crash réveille qui attendait", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const route = new LiveCommandRoute();
    server(route, () => TEXT, false);
    const { launch, runs } = subprocess();
    const waiting = tab();
    const pending = route.launcher(launch)(
      ["env"],
      waiting.io,
      new AbortController().signal,
    );
    await until(() => waiting.out.length > 0);
    route.crashed();
    assert.equal(await pending, 42);
    const after = tab();
    assert.equal(
      await route.launcher(launch)(
        ["doctor"],
        after.io,
        new AbortController().signal,
      ),
      42,
    );
    // Aucune attente annoncée : on sait que personne ne répondra.
    assert.deepEqual(after.out, []);
    assert.deepEqual(runs, [["env"], ["doctor"]]);
  });

  it("crashed : une commande « requires-app » dit quoi faire au lieu de rebooter l'app", async () => {
    // Le manifeste réel des intégrées : c'est `inspect` qui DÉCLARE le besoin,
    // aucune liste de noms n'est tenue par la route.
    const cli = new CliKernel("development");
    cli.registerBuiltinCommands();
    const manifest = cli.buildBuiltinManifest();
    const route = new LiveCommandRoute(() => manifest);
    route.crashed();
    const { launch, runs } = subprocess();
    const { io, out, err } = tab();
    const code = await route.launcher(launch)(
      ["inspect", "routes"],
      io,
      new AbortController().signal,
    );
    assert.equal(code, 69);
    assert.deepEqual(out, []);
    assert.match(
      err.join(""),
      /l'application ne démarre pas — essayez \/nodefony doctor/,
    );
    // `env` ne déclare rien : il se sert sans l'application, sous-processus.
    assert.equal(
      await route.launcher(launch)(
        ["env"],
        tab().io,
        new AbortController().signal,
      ),
      42,
    );
    assert.deepEqual(runs, [["env"]]);
  });

  it("crash PENDANT l'attente de dev.ready : la même règle, sans sous-processus", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const manifest = {
      version: "0",
      globalOptions: [],
      commands: [
        {
          name: "inspect",
          aliases: [],
          description: "",
          options: [],
          prompt: "requires-app" as const,
        },
      ],
    };
    const route = new LiveCommandRoute(() => manifest);
    server(route, () => TEXT, false);
    const { launch, runs } = subprocess();
    const { io, out, err } = tab();
    const pending = route.launcher(launch)(
      ["inspect", "routes"],
      io,
      new AbortController().signal,
    );
    await until(() => out.length > 0);
    route.crashed();
    assert.equal(await pending, 69);
    assert.match(err.join(""), /essayez \/nodefony doctor/);
    assert.deepEqual(runs, []);
  });

  it("un nouveau serveur lève l'état crashed", async () => {
    const route = new LiveCommandRoute();
    route.crashed();
    const s = server(route, () => TEXT);
    await until(() => s.peer.ready);
    const { launch, runs } = subprocess();
    assert.equal(
      await route.launcher(launch)(
        ["env"],
        tab().io,
        new AbortController().signal,
      ),
      0,
    );
    assert.deepEqual(runs, []);
  });

  it("délai de 5 s : l'onglet dit que le serveur n'a pas répondu, puis sous-processus", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const route = new LiveCommandRoute();
    const s = server(route, () => new Promise<CommandExecuteResult>(() => {}));
    await until(() => s.peer.ready);
    const { launch, runs } = subprocess();
    const { io, err } = tab();
    const pending = route.launcher(launch)(
      ["env"],
      io,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(LIVE_COMMAND_TIMEOUT_MS);
    assert.equal(await pending, 42);
    assert.match(err.join(""), /n'a pas répondu en 5 s/);
    assert.deepEqual(runs, [["env"]]);
  });

  it("réponse trop grande : refus qui nomme la ligne à taper, jamais amputée ni rejouée", async () => {
    const route = new LiveCommandRoute();
    const s = server(route, () => ({
      live: true,
      code: 0,
      parts: [{ text: "x".repeat(1024 * 1024 + 1) }],
    }));
    await until(() => s.peer.ready);
    const { launch, runs } = subprocess();
    const { io, out, err } = tab();
    const code = await route.launcher(launch)(
      ["inspect", "config", "--json"],
      io,
      new AbortController().signal,
    );
    assert.equal(code, 1);
    assert.deepEqual(out, []);
    assert.match(err.join(""), /npx nodefony inspect config --json/);
    assert.deepEqual(runs, []);
  });

  it("un producteur qui lève : l'onglet le dit, et la lecture se rejoue en sous-processus", async () => {
    const route = new LiveCommandRoute();
    const s = server(route, () => {
      throw new Error("boum");
    });
    await until(() => s.peer.ready);
    const { launch, runs } = subprocess();
    const { io, err } = tab();
    assert.equal(
      await route.launcher(launch)(["env"], io, new AbortController().signal),
      42,
    );
    assert.match(err.join(""), /le serveur a refusé la commande/);
    assert.deepEqual(runs, [["env"]]);
  });

  it("le serveur meurt pendant la requête : sous-processus, sans un mot", async () => {
    const route = new LiveCommandRoute();
    const s = server(route, () => new Promise<CommandExecuteResult>(() => {}));
    await until(() => s.peer.ready);
    const { launch, runs } = subprocess();
    const { io, err } = tab();
    const pending = route.launcher(launch)(
      ["env"],
      io,
      new AbortController().signal,
    );
    s.child.emit("disconnect");
    assert.equal(await pending, 42);
    assert.deepEqual(err, []);
    assert.deepEqual(runs, [["env"]]);
  });

  it("Ctrl+C pendant la requête : 130, et rien ne se rejoue", async () => {
    const route = new LiveCommandRoute();
    const s = server(route, () => new Promise<CommandExecuteResult>(() => {}));
    await until(() => s.peer.ready);
    const { launch, runs } = subprocess();
    const ctrl = new AbortController();
    const pending = route.launcher(launch)(["env"], tab().io, ctrl.signal);
    ctrl.abort();
    assert.equal(await pending, PROMPT_INTERRUPTED_CODE);
    assert.deepEqual(runs, []);
  });

  it("une saisie hors des bornes du canal part en sous-processus sans être émise", async () => {
    const route = new LiveCommandRoute();
    let called = 0;
    const s = server(route, () => {
      called++;
      return TEXT;
    });
    await until(() => s.peer.ready);
    const { launch, runs } = subprocess();
    const huge = ["env", "x".repeat(MAX_LIVE_REQUEST_BYTES)];
    const { io, err } = tab();
    assert.equal(
      await route.launcher(launch)(huge, io, new AbortController().signal),
      42,
    );
    assert.equal(called, 0);
    // Refusée AVANT l'émission : le serveur n'a rien eu à refuser.
    assert.deepEqual(err, []);
    assert.equal(runs.length, 1);
  });
});
