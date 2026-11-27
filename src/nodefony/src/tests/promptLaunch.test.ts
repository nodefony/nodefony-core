/**
 * Une commande de l'invite en sous-processus (#538, lot 2a) : de VRAIS
 * processus Node, pour que le test tourne tel quel sur les trois plateformes.
 * Le critère du ticket : Ctrl+C pendant une commande interrompt l'ARBRE.
 *
 * Lot 2b-2 : une commande sans terminal pose ses questions au superviseur par
 * le canal IPC. La fixture `askConsole` passe par la porte PUBLIQUE `ask()` ;
 * `io.ask` joue le superviseur.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IQuestion, IQuestionOutcome } from "../cli/question";
import {
  launchPromptCommand,
  PROMPT_INTERRUPTED_CODE,
  PROMPT_NOT_STARTED_CODE,
} from "../service/dev/promptLaunch";

/** Ce que la commande a écrit, flux par flux. */
function recorder() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      write: (text: string, stream: "out" | "err" = "out"): void => {
        (stream === "err" ? err : out).push(text);
      },
      ask: (): Promise<IQuestionOutcome> =>
        Promise.reject(new Error("aucune question attendue")),
    },
  };
}

const node = (script: string) => ({
  file: process.execPath,
  args: ["-e", script],
  cwd: process.cwd(),
  env: process.env,
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Filet : un processus que le test n'a pas réussi à tuer ne lui survit pas.
const spawned: number[] = [];
afterEach(() => {
  for (const pid of spawned.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // déjà mort
    }
  }
});

describe("launchPromptCommand — une commande de l'invite en sous-processus", () => {
  it("relaie la sortie standard et la sortie d'erreur, et rend le code de sortie", async () => {
    const { out, err, io } = recorder();
    const code = await launchPromptCommand(
      node(
        'process.stdout.write("é sur la sortie\\n"); process.stderr.write("sur l\'erreur\\n"); process.exitCode = 3;',
      ),
      io,
      new AbortController().signal,
    );
    expect(code).to.equal(3);
    expect(out.join("")).to.equal("é sur la sortie\n");
    expect(err.join("")).to.equal("sur l'erreur\n");
  });

  it("Ctrl+C interrompt l'ARBRE : la commande et le processus qu'elle a lancé", async () => {
    const { out, io } = recorder();
    const controller = new AbortController();
    // La commande lance un petit-enfant qui partage sa sortie, puis attend.
    const script = [
      'const { spawn } = require("node:child_process");',
      'spawn(process.execPath, ["-e", "process.stdout.write(\\"G:\\" + process.pid + \\"\\\\n\\"); setInterval(() => {}, 1000);"], { stdio: "inherit" });',
      'process.stdout.write("P:" + process.pid + "\\n");',
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const ended = launchPromptCommand(node(script), io, controller.signal);
    const pids = await vi.waitFor(
      () => {
        const text = out.join("");
        const parent = /P:(\d+)/.exec(text)?.[1];
        const grandchild = /G:(\d+)/.exec(text)?.[1];
        if (parent === undefined || grandchild === undefined) {
          throw new Error(`pas encore lancés : ${text}`);
        }
        return { parent: Number(parent), grandchild: Number(grandchild) };
      },
      { timeout: 5000, interval: 20 },
    );
    spawned.push(pids.parent, pids.grandchild);
    controller.abort();
    expect(await ended).to.equal(PROMPT_INTERRUPTED_CODE);
    await vi.waitFor(
      () => {
        expect(alive(pids.parent)).to.equal(false);
        expect(alive(pids.grandchild)).to.equal(false);
      },
      { timeout: 5000, interval: 50 },
    );
  }, 15000);

  it("un programme introuvable : 127, et la raison dite", async () => {
    const { err, io } = recorder();
    const code = await launchPromptCommand(
      { ...node(""), file: "nf-programme-introuvable-538" },
      io,
      new AbortController().signal,
    );
    expect(code).to.equal(PROMPT_NOT_STARTED_CODE);
    expect(err.join("")).to.contain("lancement impossible");
  });

  it("déjà interrompue : rien ne se lance", async () => {
    const { out, io } = recorder();
    const controller = new AbortController();
    controller.abort();
    const killTree = vi.fn();
    const code = await launchPromptCommand(
      node('process.stdout.write("lancée\\n")'),
      io,
      controller.signal,
      killTree,
    );
    expect(code).to.equal(PROMPT_INTERRUPTED_CODE);
    expect(out).to.deep.equal([]);
    expect(killTree).not.toHaveBeenCalled();
  });
});

const TSX = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx/esm"),
).href;
const ASK_FIXTURE = path.join(
  import.meta.dirname,
  "fixtures",
  "askConsole.fixture.mjs",
);
const ASK_SOURCE = path.join(import.meta.dirname, "..", "cli", "ask.ts");

/** La fixture des questions, lancée sur la SOURCE de la porte. */
const askConsole = () => ({
  file: process.execPath,
  args: ["--import", TSX, ASK_FIXTURE, ASK_SOURCE],
  cwd: process.cwd(),
  // Sans terminal ET sans `NF_NO_TTY` hérité d'un décor : seule la voie du
  // superviseur reste ouverte.
  env: { ...process.env, NF_NO_TTY: "" },
});

/**
 * Un faux superviseur : il note chaque question reçue et rend, dans l'ordre,
 * les réponses prévues — `null` annule.
 */
function supervisor(answers: readonly (IQuestionOutcome["value"] | null)[]) {
  const asked: IQuestion[] = [];
  const signals: AbortSignal[] = [];
  const { out, err, io } = recorder();
  let next = 0;
  return {
    asked,
    signals,
    out,
    err,
    io: {
      ...io,
      ask: (
        question: IQuestion,
        signal: AbortSignal,
      ): Promise<IQuestionOutcome> => {
        asked.push(question);
        signals.push(signal);
        const value = answers[next];
        next += 1;
        return Promise.resolve(
          value === null || value === undefined
            ? { action: "cancel" }
            : { action: "accept", value },
        );
      },
    },
  };
}

describe("launchPromptCommand — les questions remontent au superviseur (lot 2b-2)", () => {
  it("la commande pose ses questions par le canal, et finit avec les réponses", async () => {
    const s = supervisor([
      "",
      "alice",
      "s3cret!",
      "s3cret!",
      ["ROLE_USER", "ROLE_ADMIN"],
    ]);
    const code = await launchPromptCommand(
      askConsole(),
      s.io,
      AbortSignal.timeout(20000),
    );
    expect(s.err.join("")).to.equal("");
    expect(code).to.equal(0);
    expect(s.out.join("")).to.contain(
      'RÉSULTAT {"name":"alice","length":7,"roles":["ROLE_USER","ROLE_ADMIN"]}',
    );
    expect(s.asked.map((q) => q.key)).to.deep.equal([
      "name",
      "name",
      "password",
      "password-confirm",
      "roles",
    ]);
    // La réponse vide est REJUGÉE par la commande, qui repose avec son refus.
    expect(s.asked[0]?.error).to.equal(undefined);
    expect(s.asked[1]?.error).to.equal("une réponse est requise");
    expect(s.asked[2]?.kind).to.equal("secret");
    // Le secret ne revient jamais par la sortie.
    expect(s.out.join("")).not.to.contain("s3cret!");
    // Commande finie : ses questions sont retirées de l'écran.
    expect(s.signals.every((signal) => signal.aborted)).to.equal(true);
  }, 30000);

  it("une question annulée : la commande sort en 130, sans pile", async () => {
    const s = supervisor([null]);
    const code = await launchPromptCommand(
      askConsole(),
      s.io,
      AbortSignal.timeout(20000),
    );
    expect(code).to.equal(130);
    expect(s.asked.map((q) => q.key)).to.deep.equal(["name"]);
    expect(s.err.join("")).to.equal("");
  }, 30000);

  it("Ctrl+C pendant une question : la question est retirée, la commande interrompue", async () => {
    const controller = new AbortController();
    const { out, err, io } = recorder();
    let pending: AbortSignal | null = null;
    const ended = launchPromptCommand(
      askConsole(),
      {
        write: io.write,
        ask: (_question, signal) => {
          pending = signal;
          // Personne ne répond : la question reste à l'écran.
          return new Promise<IQuestionOutcome>(() => {});
        },
      },
      controller.signal,
    );
    await vi.waitFor(
      () => {
        if (pending === null)
          throw new Error(
            `pas encore demandé : ${out.join("")}${err.join("")}`,
          );
      },
      { timeout: 20000, interval: 20 },
    );
    controller.abort();
    expect(await ended).to.equal(PROMPT_INTERRUPTED_CODE);
    expect((pending as AbortSignal | null)?.aborted).to.equal(true);
  }, 30000);
});

describe("launchPromptCommand — un petit-enfant n'hérite pas du relais", () => {
  it("un `fork` de la commande refuse en nommant le drapeau, au lieu d'attendre une réponse qui ne viendra pas", async () => {
    const { err, io } = recorder();
    // La commande lance la fixture en `fork` : celle-ci hérite de la variable
    // ET d'un canal IPC — mais vers la commande, pas vers le superviseur.
    const script = [
      'const { fork } = require("node:child_process");',
      `const c = fork(${JSON.stringify(ASK_FIXTURE)}, [${JSON.stringify(ASK_SOURCE)}], { execArgv: ["--import", ${JSON.stringify(TSX)}], env: { ...process.env, NF_NO_TTY: "" } });`,
      'c.on("exit", (code) => process.exit(code ?? 1));',
    ].join("\n");
    // Borné : une régression ferait attendre la fixture sans fin — l'arbre
    // est alors tué (130), et le test rougit sans laisser d'orphelin.
    const code = await launchPromptCommand(
      node(script),
      io,
      AbortSignal.timeout(20000),
    );
    expect(code).to.equal(64);
    expect(err.join("")).to.contain("aucun terminal pour le demander");
  }, 30000);
});
