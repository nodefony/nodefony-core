import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DUPLICATE_SIGNAL_WINDOW_MS,
  installShutdownSignals,
  type ISignalTarget,
  type ShutdownSignal,
} from "../service/dev/shutdownSignals";

/**
 * Les signaux d'arrêt du superviseur de développement (#598).
 *
 * Le défaut d'origine : sous `npm run dev`, un Ctrl+C livre le SIGINT DEUX fois
 * au superviseur, dans la même milliseconde — le groupe du terminal, puis le
 * relais de npm. Écouté par `once`, le second déclenchait l'action par défaut :
 * le superviseur mourait en plein arrêt, et le serveur, chef de son propre
 * groupe, restait orphelin sur les ports.
 *
 * Les cas « vrai processus » sont la preuve qui compte : l'action par défaut
 * d'un signal n'existe que dans un processus réel, aucune cible simulée ne la
 * reproduit.
 */

const HELPER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "service",
  "dev",
  "shutdownSignals.ts",
);

/** Une cible de signaux en mémoire, pilotée à la main. */
function fakeTarget(): ISignalTarget & {
  emit(signal: ShutdownSignal): void;
  count(): number;
} {
  const listeners = new Map<ShutdownSignal, Array<() => void>>();
  return {
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
    },
    removeListener(event, listener) {
      const list = listeners.get(event) ?? [];
      listeners.set(
        event,
        list.filter((l) => l !== listener),
      );
    },
    emit(signal) {
      for (const l of listeners.get(signal) ?? []) l();
    },
    count() {
      let n = 0;
      for (const list of listeners.values()) n += list.length;
      return n;
    },
  };
}

describe("signaux d'arrêt du superviseur — règle", () => {
  it("le premier signal lance l'arrêt propre, un doublon immédiat est absorbé", () => {
    const target = fakeTarget();
    let clock = 0;
    const calls: string[] = [];
    installShutdownSignals(
      {
        graceful: (s) => calls.push(`graceful:${s}`),
        force: (s) => calls.push(`force:${s}`),
      },
      { target, now: () => clock },
    );
    target.emit("SIGINT");
    clock = 1;
    target.emit("SIGINT");
    assert.deepEqual(calls, ["graceful:SIGINT"]);
  });

  it("une insistance après la fenêtre force l'arrêt, une seule fois", () => {
    const target = fakeTarget();
    let clock = 0;
    const calls: string[] = [];
    installShutdownSignals(
      {
        graceful: (s) => calls.push(`graceful:${s}`),
        force: (s) => calls.push(`force:${s}`),
      },
      { target, now: () => clock },
    );
    target.emit("SIGINT");
    clock = DUPLICATE_SIGNAL_WINDOW_MS;
    target.emit("SIGTERM");
    clock += 5000;
    target.emit("SIGINT");
    assert.deepEqual(calls, ["graceful:SIGINT", "force:SIGTERM"]);
  });

  it("les écouteurs restent posés pendant l'arrêt, et se retirent sur demande", () => {
    const target = fakeTarget();
    const remove = installShutdownSignals(
      { graceful: () => {}, force: () => {} },
      { target },
    );
    assert.equal(target.count(), 3);
    target.emit("SIGINT");
    // Retirés après le premier signal, le second retrouverait l'action par
    // défaut — c'est exactement le défaut d'origine.
    assert.equal(target.count(), 3);
    remove();
    assert.equal(target.count(), 0);
  });
});

/**
 * Le script d'un enfant réel : arrêt propre de 400 ms (le temps de tuer un
 * arbre), qui écrit un témoin puis sort en 0. Mourir avant le témoin, c'est
 * reproduire l'orphelin de #598.
 */
const CHILD_SCRIPT = `
import { writeFileSync } from "node:fs";
import { installShutdownSignals } from ${JSON.stringify(pathToFileURL(HELPER).href)};
const marker = process.argv[2];
installShutdownSignals({
  graceful: () => {
    writeFileSync(marker + ".stopping", "");
    setTimeout(() => { writeFileSync(marker, "propre"); process.exit(0); }, 400);
  },
  force: () => { writeFileSync(marker, "force"); process.exit(130); },
});
writeFileSync(marker + ".ready", "");
setInterval(() => {}, 1000);
`;

interface IChildRun {
  child: ChildProcess;
  ended: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

function track(child: ChildProcess): IChildRun {
  const ended = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  return { child, ended };
}

async function waitFile(file: string, timeoutMs = 15_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      readFileSync(file);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  assert.fail(`${file} jamais écrit`);
}

describe("signaux d'arrêt du superviseur — processus réel", () => {
  let dir: string;
  let marker: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "nf-shutdown-signals-"));
    marker = path.join(dir, "marker");
    writeFileSync(path.join(dir, "child.mjs"), CHILD_SCRIPT);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("le SIGINT relayé PENDANT l'arrêt ne le coupe pas", async () => {
    const run = track(
      spawn(process.execPath, [path.join(dir, "child.mjs"), marker], {
        stdio: "ignore",
      }),
    );
    await waitFile(`${marker}.ready`);
    // Ce que reçoit l'enfant de `npm run` au Ctrl+C : le groupe, puis le
    // relais de npm — mesuré jusqu'à 1,5 s plus tard, donc APRÈS que le
    // premier a été traité. Deux `kill` collés ne reproduisent RIEN : libuv
    // les capte ensemble avant que le JS ne retire quoi que ce soit.
    run.child.kill("SIGINT");
    await waitFile(`${marker}.stopping`);
    run.child.kill("SIGINT");
    const { code, signal } = await run.ended;
    assert.equal(signal, null, "tué par l'action par défaut du second SIGINT");
    assert.equal(code, 0);
    assert.equal(readFileSync(marker, "utf8"), "propre");
  });

  it("une insistance après la fenêtre force l'arrêt au lieu d'être ignorée", async () => {
    writeFileSync(
      path.join(dir, "child.mjs"),
      CHILD_SCRIPT.replace("400", "5000"),
    );
    const run = track(
      spawn(process.execPath, [path.join(dir, "child.mjs"), marker], {
        stdio: "ignore",
      }),
    );
    await waitFile(`${marker}.ready`);
    run.child.kill("SIGINT");
    await new Promise((r) => setTimeout(r, DUPLICATE_SIGNAL_WINDOW_MS + 200));
    run.child.kill("SIGINT");
    const { code } = await run.ended;
    assert.equal(code, 130);
    assert.equal(readFileSync(marker, "utf8"), "force");
  }, 15_000);
});
