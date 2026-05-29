import { expect } from "chai";
import "mocha";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "../index";

// Clés dédiées au test (préfixe improbable) → pas de collision avec l'env réel ;
// purgées avant/après chaque cas pour rester déterministe.
const KEYS = ["LOADENV_A", "LOADENV_B", "LOADENV_C"] as const;

describe("loadEnv — cascade .env sans écrasement", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nodefony-loadenv-"));
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const k of KEYS) delete process.env[k];
  });

  it("injecte les clés absentes depuis .env.<env>", () => {
    writeFileSync(join(dir, ".env.development"), "LOADENV_A=fromEnvFile\n");
    const n = loadEnv("development", dir);
    expect(process.env.LOADENV_A).to.equal("fromEnvFile");
    expect(n).to.equal(1);
  });

  it("n'écrase JAMAIS une variable déjà posée (process.env gagne)", () => {
    process.env.LOADENV_A = "fromShell";
    writeFileSync(join(dir, ".env.development"), "LOADENV_A=fromEnvFile\n");
    const n = loadEnv("development", dir);
    expect(process.env.LOADENV_A).to.equal("fromShell");
    expect(n).to.equal(0);
  });

  it("précédence .env > .env.local > .env.<env>", () => {
    writeFileSync(join(dir, ".env"), "LOADENV_A=fromDotEnv\n");
    writeFileSync(
      join(dir, ".env.local"),
      "LOADENV_A=fromLocal\nLOADENV_B=fromLocal\n",
    );
    writeFileSync(
      join(dir, ".env.development"),
      "LOADENV_A=fromDev\nLOADENV_B=fromDev\nLOADENV_C=fromDev\n",
    );
    loadEnv("development", dir);
    expect(process.env.LOADENV_A).to.equal("fromDotEnv"); // .env le plus fort
    expect(process.env.LOADENV_B).to.equal("fromLocal"); // .env.local > .env.<env>
    expect(process.env.LOADENV_C).to.equal("fromDev"); // seul .env.<env> le pose
  });

  it("ignore silencieusement un fichier absent (aucune exception)", () => {
    expect(() => loadEnv("production", dir)).to.not.throw();
    expect(loadEnv("production", dir)).to.equal(0);
  });

  it("saute le niveau .env.<env> si environment omis", () => {
    writeFileSync(join(dir, ".env.development"), "LOADENV_A=dev\n");
    const n = loadEnv(undefined, dir);
    expect(process.env.LOADENV_A).to.equal(undefined);
    expect(n).to.equal(0);
  });
});
