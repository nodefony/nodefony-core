import type { ChildProcess } from "node:child_process";
import { describe, it, expect } from "vitest";
import {
  failedTaskOutput,
  runCapturedCommand,
} from "../service/dev/DevSupervisor";
import { signalProcessGroup } from "../service/dev/devProcess";

/**
 * Un build qui échoue sous le superviseur montre SON erreur, pas la sortie
 * rejouée de tous les paquets en cache (#533 — vu : des centaines de lignes de
 * bundles réussis au-dessus d'une erreur de syntaxe dans un seul module).
 */
describe("failedTaskOutput", () => {
  const sortie = [
    "nodefony:build: <DIR>/Container.js   chunk │ size: 13.51 kB",
    "@nodefony/http:build: <DIR>/x.js   chunk │ size: 1 kB",
    "@nodefony/test:build:  ERROR  Build failed with 1 error:",
    "@nodefony/test:build:      ╭─[ nodefony/controller/AlsController.ts:378:7 ]",
    "@nodefony/test:build: npm error code 1",
    " Tasks:    24 successful, 25 total",
  ].join("\n");

  it("ne garde que la tâche en échec, et le résumé", () => {
    expect(failedTaskOutput(sortie).split("\n")).toEqual([
      "@nodefony/test:build:  ERROR  Build failed with 1 error:",
      "@nodefony/test:build:      ╭─[ nodefony/controller/AlsController.ts:378:7 ]",
      "@nodefony/test:build: npm error code 1",
      " Tasks:    24 successful, 25 total",
    ]);
  });

  it("aucune tâche identifiée : tout est rendu, rien n'est tu", () => {
    const brut = "✗ rolldown: Expected expression";
    expect(failedTaskOutput(brut)).toBe(brut);
  });
});

/**
 * Un build qui se TAIT est calé : vécu sous Windows + Node 26, `turbo.exe`
 * affiche son résumé puis ne rend jamais la main, et le démarrage restait figé
 * sans un mot. La borne porte sur l'INACTIVITÉ, pas sur la durée.
 */
describe("runCapturedCommand — borne d'inactivité", () => {
  // La borne doit dépasser le démarrage d'un `node` MUET sous la charge d'une
  // suite entière (vu > 400 ms) — sinon on mesure la machine, pas la règle.
  const IDLE_MS = 3_000;
  const node = (code: string, idleMs = IDLE_MS) =>
    runCapturedCommand(process.execPath, ["-e", code], process.cwd(), idleMs);
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it("muet au-delà de la borne : déclaré calé, NOMMÉ, et tué", async () => {
    const r = await node(
      "process.stdout.write(process.pid + ' 2 successful\\n'); setInterval(() => {}, 1000);",
    );
    expect(r.ok).toBe(false);
    expect(r.output).toContain("déclaré calé");
    expect(r.output).toContain("2 successful");
    const pid = Number.parseInt(r.output, 10);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(alive(pid)).toBe(false);
  }, 20_000);

  // La borne court dès le lancement, démarrage de `node` compris — et sous la
  // passe complète, ce démarrage a dépassé 8 s. Le cas muet n'y est pas
  // sensible (muet, il est calé quoi qu'il arrive) ; un cas qui doit SURVIVRE,
  // si. Un enfant tué avant d'avoir parlé ne dit rien de la règle : l'essai se
  // rejoue, borne doublée. Le marqueur s'assemble à l'exécution — écrit en
  // clair, il figurerait dans la ligne de commande que le rapport de calage
  // recopie, et le contrôle se tromperait (vu).
  const SPOKE = "PRÊT";
  const SAY_SPOKE = "process.stdout.write(['PR', 'ÊT'].join('') + '\\n');";
  const spokeFirst = (output: string): boolean => {
    const at = output.indexOf(SPOKE);
    const stalled = output.indexOf("déclaré calé");
    return at !== -1 && (stalled === -1 || at < stalled);
  };
  const afterStartup = async (
    run: (idleMs: number) => Promise<{ ok: boolean; output: string }>,
    idleMs: number,
  ): Promise<{ ok: boolean; output: string }> => {
    for (let attempt = 0; attempt < 3; attempt++, idleMs *= 2) {
      const r = await run(idleMs);
      if (spokeFirst(r.output)) return r;
    }
    throw new Error(
      "node n'a jamais parlé dans sa borne, même doublée deux fois",
    );
  };

  // Il dure PLUS que sa borne (1,25 ×) en parlant toutes les 250 ms : c'est la
  // propriété prouvée — la borne porte sur l'inactivité, pas sur la durée.
  it("long mais BAVARD : rien n'est interrompu", async () => {
    const r = await afterStartup(
      (idleMs) =>
        node(
          `${SAY_SPOKE} let n = 0; const t = setInterval(() => { process.stdout.write('tâche ' + n + '\\n'); if (++n === ${Math.ceil((idleMs * 1.25) / 250)}) { clearInterval(t); process.exit(0); } }, 250);`,
          idleMs,
        ),
      8_000,
    );
    expect(r.output).not.toContain("déclaré calé");
    expect(r.ok).toBe(true);
  }, 180_000);

  // Le superviseur bloqué (GC, disque, machine saturée) ne lit plus le tube :
  // à son réveil, le minuteur passe AVANT la lecture des données en attente,
  // et une horloge périmée déclarait calée une commande qui n'avait cessé de
  // parler. Le blocage est posé sur le parent APRÈS le premier mot de
  // l'enfant — le démarrage de `node` reste ainsi hors de la mesure.
  it("superviseur bloqué : ce qui attend dans le tube est lu AVANT tout verdict", async () => {
    let heardFirst = (): void => {};
    const first = new Promise<void>((resolve) => {
      heardFirst = resolve;
    });
    const pending = runCapturedCommand(
      process.execPath,
      [
        "-e",
        "let n = 0; process.stdout.write('départ\\n'); const t = setInterval(() => { process.stdout.write('tâche ' + n + '\\n'); if (++n === 60) { clearInterval(t); process.exit(0); } }, 100);",
      ],
      process.cwd(),
      3_000,
      { onSpawn: (p: ChildProcess) => p.stdout?.once("data", heardFirst) },
    );
    await first;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 4_000);
    const r = await pending;
    expect(r.output).not.toContain("déclaré calé");
    expect(r.ok).toBe(true);
  }, 60_000);

  // Ce cas ne porte pas sur la borne : il la prend large, sinon le démarrage
  // de `node` sous la suite entière (vu > 3 s) le fait déclarer calé.
  it("un échec ordinaire reste un échec, sans être dit calé", async () => {
    const r = await node(
      "process.stderr.write('boom\\n'); process.exit(2);",
      20_000,
    );
    expect(r.ok).toBe(false);
    expect(r.output).toContain("boom");
    expect(r.output).not.toContain("déclaré calé");
  });
});

/**
 * Un arrêt pendant un build doit emporter TOUT l'arbre (turbo → rolldown) :
 * laissé vivant, il écrit `dist/` pendant que le développeur relance. En
 * plein écran Ctrl+C est une touche, et un SIGTERM n'atteint que le
 * superviseur — c'est donc lui qui tue le groupe du build, qui doit en être
 * le chef. Sous Windows l'arbre se suit par filiation (`taskkill /T`).
 */
describe.skipIf(process.platform === "win32")(
  "runCapturedCommand — groupe propre pour l'arrêt",
  () => {
    const alive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    // Un enfant qui lance un petit-enfant (comme turbo lance rolldown), donne
    // son pid, puis attend.
    const TREE =
      "import('node:child_process').then(({ spawn }) => {" +
      " const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });" +
      " process.stdout.write(g.pid + '\\n'); setInterval(() => {}, 1000); });";

    it("detached : le signal au groupe emporte le petit-enfant, et onSpawn livre le processus", async () => {
      let child: ChildProcess | null = null;
      let grandchild = 0;
      const ready = new Promise<void>((resolve) => {
        const run = runCapturedCommand(
          process.execPath,
          ["-e", TREE],
          process.cwd(),
          15_000,
          {
            detached: true,
            onSpawn: (c) => {
              child = c;
              c.stdout?.once("data", (d: Buffer) => {
                grandchild = Number.parseInt(d.toString(), 10);
                resolve();
              });
            },
          },
        );
        void run;
      });
      await ready;
      const c = child as ChildProcess | null;
      expect(c?.pid).toBeTypeOf("number");
      expect(alive(grandchild)).toBe(true);
      expect(signalProcessGroup(c?.pid ?? 0, "SIGTERM")).toBe("group");
      await new Promise((resolve) => setTimeout(resolve, 300));
      const survived = alive(grandchild);
      if (survived) process.kill(grandchild, "SIGKILL");
      expect(survived, "petit-enfant survivant").toBe(false);
    }, 20_000);
  },
);
