import { expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadEnv,
  findLegacyEnvFiles,
  legacyEnvMessage,
  ENV_FILE,
} from "../index";

// Clés dédiées au test (préfixe improbable) → pas de collision avec l'env réel ;
// purgées avant/après chaque cas pour rester déterministe.
const KEYS = ["LOADENV_A", "LOADENV_B"] as const;

describe("loadEnv — un seul fichier, `.env`, sans écrasement", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nodefony-loadenv-"));
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const k of KEYS) delete process.env[k];
  });

  it("le fichier chargé s'appelle `.env`", () => {
    expect(ENV_FILE).toBe(".env");
  });

  it("injecte les clés absentes depuis .env", () => {
    writeFileSync(join(dir, ".env"), "LOADENV_A=fromEnvFile\n");
    expect(loadEnv({ cwd: dir })).toBe(1);
    expect(process.env.LOADENV_A).toBe("fromEnvFile");
  });

  it("n'écrase JAMAIS une variable déjà posée (process.env gagne)", () => {
    process.env.LOADENV_A = "fromShell";
    writeFileSync(join(dir, ".env"), "LOADENV_A=fromFile\n");
    expect(loadEnv({ cwd: dir })).toBe(0);
    expect(process.env.LOADENV_A).toBe("fromShell");
  });

  it("ne lit AUCUN autre fichier — ni .env.local ni .env.<mode>", () => {
    writeFileSync(join(dir, ".env.local"), "LOADENV_A=local\n");
    writeFileSync(join(dir, ".env.development"), "LOADENV_B=dev\n");
    loadEnv({ cwd: dir, runtimeEnv: "development" });
    expect(process.env.LOADENV_A).toBeUndefined();
    expect(process.env.LOADENV_B).toBeUndefined();
  });

  it("ignore silencieusement un .env absent (aucune exception)", () => {
    expect(loadEnv({ cwd: dir })).toBe(0);
  });
});

describe("findLegacyEnvFiles — l'ancienne convention est REFUSÉE, jamais ignorée", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nodefony-legacyenv-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const app = (): void => writeFileSync(join(dir, "nodefony.config.ts"), "");

  it("nomme .env.local, .env.<mode> et .env.<mode>.local dans une application", () => {
    app();
    for (const f of [
      ".env",
      ".env.example",
      ".env.local",
      ".env.development",
      ".env.production",
      ".env.production.local",
      ".env.staging",
    ]) {
      writeFileSync(join(dir, f), "");
    }
    expect(findLegacyEnvFiles({ cwd: dir, appEnv: "staging" })).toEqual([
      ".env.development",
      ".env.local",
      ".env.production",
      ".env.production.local",
      ".env.staging",
    ]);
  });

  it("laisse passer .env, .env.example et les fichiers d'autres outils", () => {
    app();
    for (const f of [".env", ".env.example", ".env.vault", ".env.keys"]) {
      writeFileSync(join(dir, f), "");
    }
    expect(findLegacyEnvFiles({ cwd: dir })).toEqual([]);
  });

  it("ne regarde pas hors d'une application (create app depuis un dossier quelconque)", () => {
    writeFileSync(join(dir, ".env.local"), "");
    expect(findLegacyEnvFiles({ cwd: dir })).toEqual([]);
  });

  it("le message nomme chaque fichier et dit où va chaque valeur", () => {
    const msg = legacyEnvMessage([".env.local", ".env.production"]);
    expect(msg).toContain("  - .env.local");
    expect(msg).toContain("  - .env.production");
    expect(msg).toContain("nodefony.config.ts");
    expect(msg).toContain("gestionnaire");
  });
});
