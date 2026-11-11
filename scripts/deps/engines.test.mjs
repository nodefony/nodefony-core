/**
 * Planchers Node des dépendances face au nôtre — vécu : `@inquirer/prompts`
 * 8.8.0 exigeait `^24.15.0` sous un dépôt à `>=24.14.0`, sans que rien ne le dise.
 */
import { describe, it, expect } from "vitest";
import { enginesBelowFloor } from "./lib/engines.mjs";

const INQUIRER = "^22.22.2 || ^24.15.0 || >=26.0.0";

describe("enginesBelowFloor — la plage du paquet doit CONTENIR la nôtre", () => {
  it("🔴 le cas vécu : inquirer 8.8.0 sous un plancher 24.14 est signalé", () => {
    expect(
      enginesBelowFloor(">=24.14.0", [
        { name: "@inquirer/prompts", version: "8.8.0", node: INQUIRER },
      ]),
    ).toEqual([
      {
        name: "@inquirer/prompts",
        version: "8.8.0",
        requires: INQUIRER,
        unreadable: false,
      },
    ]);
  });
  it("une borne basse plus haute ne suffit pas : >=24.16 contient Node 25, exclu", () => {
    expect(
      enginesBelowFloor(">=24.16.0", [
        { name: "x", version: "1.0.0", node: INQUIRER },
      ]),
    ).toHaveLength(1);
  });
  it("un plancher qui exclut aussi Node 25 est couvert", () => {
    expect(
      enginesBelowFloor("^24.16.0 || >=26.0.0", [
        { name: "x", version: "1.0.0", node: INQUIRER },
      ]),
    ).toEqual([]);
  });
  it("une exigence plus large que la nôtre ne dit rien (better-sqlite3 : >=22)", () => {
    expect(
      enginesBelowFloor(">=24.14.0", [
        { name: "b", version: "13.1.1", node: ">=22" },
      ]),
    ).toEqual([]);
  });
  it("aucune exigence déclarée → rien à signaler", () => {
    expect(
      enginesBelowFloor(">=24.14.0", [
        { name: "a", version: "1.0.0", node: undefined },
        { name: "c", version: "1.0.0", node: "" },
      ]),
    ).toEqual([]);
  });
  it("une plage illisible est signalée, jamais tue", () => {
    expect(
      enginesBelowFloor(">=24.14.0", [
        { name: "z", version: "1.0.0", node: "n'importe quoi" },
      ]),
    ).toEqual([
      {
        name: "z",
        version: "1.0.0",
        requires: "n'importe quoi",
        unreadable: true,
      },
    ]);
  });
});
