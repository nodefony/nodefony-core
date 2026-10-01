/// <reference types="node" />
import { expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRunCommand } from "../../src/docsReader";

/**
 * La commande que Studio lance quand on clique « lancer ce fichier » / « tout
 * lancer » sur un module. Composée sans process : ce qu'on vérifie ici, c'est
 * la FORME des arguments — un `--` de trop et vitest joue la suite entière en
 * répondant vert (vécu, en 4.1.11 comme en 5.0.0).
 */
describe("docsReader.testRunCommand — ce que Studio lance pour un module", () => {
  let vitestModule = "";
  let coreLike = "";

  beforeAll(() => {
    vitestModule = mkdtempSync(join(tmpdir(), "nf-testrun-vitest-"));
    writeFileSync(
      join(vitestModule, "vitest.config.ts"),
      "export default {};\n",
    );
    coreLike = mkdtempSync(join(tmpdir(), "nf-testrun-core-"));
  });

  afterAll(() => {
    rmSync(vitestModule, { recursive: true, force: true });
    rmSync(coreLike, { recursive: true, force: true });
  });

  it("un fichier → vitest le reçoit en FILTRE positionnel, jamais derrière `--`", () => {
    const c = testRunCommand(vitestModule, "tests/unit/x.test.ts", "pnpm");
    expect(c.cmd).to.equal("pnpm");
    // `--` ferait tourner la suite ENTIÈRE : vitest ignore ce qui le suit.
    expect(c.args).to.not.include("--");
    expect(c.args).to.deep.equal([
      "exec",
      "vitest",
      "run",
      "tests/unit/x.test.ts",
    ]);
    expect(c.mode).to.equal("vitest run tests/unit/x.test.ts");
  });

  it("sans fichier → run-all, reporters coverage forcés vers .coverage", () => {
    const c = testRunCommand(vitestModule, undefined, "pnpm");
    expect(c.cmd).to.equal("pnpm");
    expect(c.args.slice(0, 4)).to.deep.equal([
      "exec",
      "vitest",
      "run",
      "--coverage",
    ]);
    expect(c.args).to.include("--coverage.reporter=json-summary");
    expect(c.args).to.include("--coverage.reportsDirectory=.coverage");
    expect(c.args).to.not.include("--");
    expect(c.mode).to.equal("vitest run --coverage (reporters forcés)");
  });

  it("sans vitest.config.ts (le cœur) → son script coverage, fichier demandé ou non", () => {
    expect(testRunCommand(coreLike, undefined, "npm")).to.deep.equal({
      cmd: "npm",
      args: ["run", "coverage"],
      mode: "npm run coverage (suite complète)",
    });
    expect(
      testRunCommand(coreLike, "src/tests/x.test.ts", "bun").args,
    ).to.deep.equal(["run", "coverage"]);
  });

  it("le gestionnaire est celui du PROJET : son verrou décide, pas `npx`", () => {
    // `npx` n'existe pas chez bun ; sous npm, `npm exec --` est sa forme, et
    // le `--` y protège les options de vitest, jamais un filtre de fichier.
    writeFileSync(join(vitestModule, "bun.lock"), "");
    const c = testRunCommand(vitestModule, "tests/unit/x.test.ts");
    expect(c.cmd).to.equal("bun");
    expect(c.args).to.deep.equal([
      "run",
      "vitest",
      "run",
      "tests/unit/x.test.ts",
    ]);
  });
});
