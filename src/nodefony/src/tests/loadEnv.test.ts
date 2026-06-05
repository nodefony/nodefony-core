import { expect } from "chai";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "../index";

// Clés dédiées au test (préfixe improbable) → pas de collision avec l'env réel ;
// purgées avant/après chaque cas pour rester déterministe.
const KEYS = ["LOADENV_A", "LOADENV_B", "LOADENV_C", "LOADENV_D"] as const;

describe("loadEnv — cascade .env Convention B (Vite/Next) sans écrasement", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nodefony-loadenv-"));
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const k of KEYS) delete process.env[k];
  });

  it("injecte les clés absentes depuis .env.<runtimeEnv>", () => {
    writeFileSync(join(dir, ".env.development"), "LOADENV_A=fromEnvFile\n");
    const n = loadEnv({ runtimeEnv: "development", cwd: dir });
    expect(process.env.LOADENV_A).to.equal("fromEnvFile");
    expect(n).to.equal(1);
  });

  it("n'écrase JAMAIS une variable déjà posée (process.env gagne)", () => {
    process.env.LOADENV_A = "fromShell";
    writeFileSync(join(dir, ".env.development"), "LOADENV_A=fromEnvFile\n");
    const n = loadEnv({ runtimeEnv: "development", cwd: dir });
    expect(process.env.LOADENV_A).to.equal("fromShell");
    expect(n).to.equal(0);
  });

  it("précédence conv B : .env.<env>.local > .env.local > .env.<env> > .env", () => {
    writeFileSync(
      join(dir, ".env"),
      "LOADENV_A=fromDotEnv\nLOADENV_D=fromDotEnv\n",
    );
    writeFileSync(
      join(dir, ".env.development"),
      "LOADENV_A=fromDev\nLOADENV_B=fromDev\nLOADENV_D=fromDev\n",
    );
    writeFileSync(
      join(dir, ".env.local"),
      "LOADENV_A=fromLocal\nLOADENV_B=fromLocal\nLOADENV_C=fromLocal\n",
    );
    writeFileSync(
      join(dir, ".env.development.local"),
      "LOADENV_A=fromDevLocal\n",
    );
    loadEnv({ runtimeEnv: "development", cwd: dir });
    expect(process.env.LOADENV_A).to.equal("fromDevLocal"); // .env.<env>.local le + fort
    expect(process.env.LOADENV_B).to.equal("fromLocal"); // .env.local > .env.<env>
    expect(process.env.LOADENV_C).to.equal("fromLocal"); // seul .env.local le pose
    expect(process.env.LOADENV_D).to.equal("fromDev"); // .env.<env> > .env
  });

  it("axe déploiement : .env.<appEnv> prime sur .env.<runtimeEnv>", () => {
    // staging déployé tourne en mode production mais charge .env.staging.
    writeFileSync(
      join(dir, ".env.production"),
      "LOADENV_A=fromProd\nLOADENV_B=fromProd\n",
    );
    writeFileSync(join(dir, ".env.staging"), "LOADENV_A=fromStaging\n");
    writeFileSync(
      join(dir, ".env.staging.local"),
      "LOADENV_C=fromStagingLocal\n",
    );
    loadEnv({ runtimeEnv: "production", appEnv: "staging", cwd: dir });
    expect(process.env.LOADENV_A).to.equal("fromStaging"); // appEnv > runtimeEnv
    expect(process.env.LOADENV_B).to.equal("fromProd"); // seul .env.production le pose
    expect(process.env.LOADENV_C).to.equal("fromStagingLocal"); // .env.<appEnv>.local
  });

  it("appEnv égal au runtimeEnv → pas de niveau dupliqué", () => {
    writeFileSync(join(dir, ".env.production"), "LOADENV_A=fromProd\n");
    const n = loadEnv({
      runtimeEnv: "production",
      appEnv: "production",
      cwd: dir,
    });
    expect(process.env.LOADENV_A).to.equal("fromProd");
    expect(n).to.equal(1); // .env.production lu une seule fois
  });

  it("ignore silencieusement un fichier absent (aucune exception)", () => {
    expect(() =>
      loadEnv({ runtimeEnv: "production", cwd: dir }),
    ).to.not.throw();
    expect(loadEnv({ runtimeEnv: "production", cwd: dir })).to.equal(0);
  });

  it("saute le niveau .env.<env> si runtimeEnv omis (charge quand même .env)", () => {
    writeFileSync(join(dir, ".env.development"), "LOADENV_A=dev\n");
    writeFileSync(join(dir, ".env"), "LOADENV_D=common\n");
    const n = loadEnv({ cwd: dir });
    expect(process.env.LOADENV_A).to.equal(undefined); // .env.development non chargé
    expect(process.env.LOADENV_D).to.equal("common"); // .env (commun) chargé
    expect(n).to.equal(1);
  });
});
