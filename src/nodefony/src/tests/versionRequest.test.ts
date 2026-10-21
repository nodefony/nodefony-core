import { describe, it, expect } from "vitest";
import { isVersionRequest } from "../cli/versionRequest";

/**
 * SPEC — `nodefony -v` / `--version` est une DONNÉE, rendue avant tout
 * chargement du cœur. La même règle sert le binaire (chemin rapide) et
 * `CliKernel` : ce banc est celui des deux.
 */
describe("isVersionRequest — la version du CLI, et seulement elle", () => {
  it("`-v` et `--version` seuls demandent la version", () => {
    expect(isVersionRequest(["-v"])).toBe(true);
    expect(isVersionRequest(["--version"])).toBe(true);
  });

  it("d'autres options autour ne changent rien (aucun positionnel)", () => {
    expect(isVersionRequest(["--debug", "--version"])).toBe(true);
    expect(isVersionRequest(["-v", "-i"])).toBe(true);
  });

  it("un positionnel présent : la commande décide, pas le CLI", () => {
    expect(isVersionRequest(["dev", "--version"])).toBe(false);
    expect(isVersionRequest(["--version", "dev"])).toBe(false);
    expect(isVersionRequest(["orm:migrate", "-v"])).toBe(false);
  });

  it("ni invocation nue, ni aide, ni `-V` (inconnue du CLI)", () => {
    expect(isVersionRequest([])).toBe(false);
    expect(isVersionRequest(["--help"])).toBe(false);
    expect(isVersionRequest(["-V"])).toBe(false);
  });
});
