/// <reference types="node" />
import { expect } from "chai";
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
    const c = testRunCommand(vitestModule, "tests/unit/x.test.ts");
    expect(c.cmd).to.equal("npx");
    // `--` ferait tourner la suite ENTIÈRE : vitest ignore ce qui le suit.
    expect(c.args).to.not.include("--");
    expect(c.args).to.deep.equal(["vitest", "run", "tests/unit/x.test.ts"]);
    expect(c.mode).to.equal("vitest run tests/unit/x.test.ts");
  });

  it("sans fichier → run-all, reporters coverage forcés vers .coverage", () => {
    const c = testRunCommand(vitestModule);
    expect(c.cmd).to.equal("npx");
    expect(c.args.slice(0, 3)).to.deep.equal(["vitest", "run", "--coverage"]);
    expect(c.args).to.include("--coverage.reporter=json-summary");
    expect(c.args).to.include("--coverage.reportsDirectory=.coverage");
    expect(c.args).to.not.include("--");
    expect(c.mode).to.equal("vitest run --coverage (reporters forcés)");
  });

  it("sans vitest.config.ts (le cœur) → son script coverage, fichier demandé ou non", () => {
    expect(testRunCommand(coreLike)).to.deep.equal({
      cmd: "npm",
      args: ["run", "coverage"],
      mode: "npm run coverage (suite complète)",
    });
    expect(testRunCommand(coreLike, "src/tests/x.test.ts").args).to.deep.equal([
      "run",
      "coverage",
    ]);
  });
});
