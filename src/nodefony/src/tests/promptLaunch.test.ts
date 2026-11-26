/**
 * Une commande de l'invite en sous-processus (#538, lot 2a) : de VRAIS
 * processus Node, pour que le test tourne tel quel sur les trois plateformes.
 * Le critère du ticket : Ctrl+C pendant une commande interrompt l'ARBRE.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
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
