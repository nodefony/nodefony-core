import { describe, it, expect } from "vitest";
import {
  failedTaskOutput,
  runCapturedCommand,
} from "../service/dev/DevSupervisor";

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

  // La borne court dès le lancement, démarrage de `node` compris : sous la
  // suite entière, ce démarrage a dépassé 3 s (vu en local). Le cas muet n'y
  // est pas sensible — muet, il est calé quoi qu'il arrive ; le cas bavard,
  // si. Il parle donc aussitôt, et dure PLUS que sa borne (10 s > 8 s) : c'est
  // la propriété prouvée — la borne porte sur l'inactivité, pas la durée.
  it("long mais BAVARD : rien n'est interrompu", async () => {
    const r = await node(
      "let n = 0; process.stdout.write('départ\\n'); const t = setInterval(() => { process.stdout.write('tâche ' + n + '\\n'); if (++n === 40) { clearInterval(t); process.exit(0); } }, 250);",
      8_000,
    );
    expect(r.ok).toBe(true);
    expect(r.output).not.toContain("déclaré calé");
  }, 30_000);

  it("un échec ordinaire reste un échec, sans être dit calé", async () => {
    const r = await node("process.stderr.write('boom\\n'); process.exit(2);");
    expect(r.ok).toBe(false);
    expect(r.output).toContain("boom");
    expect(r.output).not.toContain("déclaré calé");
  });
});
