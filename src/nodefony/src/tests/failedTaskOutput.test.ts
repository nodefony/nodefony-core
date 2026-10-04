import { describe, it, expect } from "vitest";
import { failedTaskOutput } from "../service/dev/DevSupervisor";

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
