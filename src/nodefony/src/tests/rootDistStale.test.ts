import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { isRootDistStale } from "../service/dev/DevSupervisor";

/**
 * Fraîcheur du `dist/` de l'app au démarrage du superviseur de dev.
 *
 * Le cas qui a mordu : dans le dépôt du framework (présence de `turbo.json`),
 * seuls les trois fichiers racine étaient comparés. Une config éditée serveur
 * arrêté (`nodefony/config/security.ts`) démarrait alors sur l'ancien `dist`.
 */
const root = mkdtempSync(path.join(os.tmpdir(), "nf-rootdist-"));
let n = 0;

/** Une app fraîche : sources datées de T, `dist` bâti à T+10 s. */
function freshApp(withTurbo: boolean): string {
  const cwd = path.join(root, `app-${n++}`);
  mkdirSync(path.join(cwd, "dist"), { recursive: true });
  mkdirSync(path.join(cwd, "nodefony", "config"), { recursive: true });
  mkdirSync(path.join(cwd, "modules", "local"), { recursive: true });
  for (const f of [
    "index.ts",
    "nodefony.config.ts",
    "env.ts",
    path.join("nodefony", "config", "security.ts"),
    path.join("modules", "local", "index.ts"),
  ]) {
    writeFileSync(path.join(cwd, f), "");
    utimesSync(path.join(cwd, f), 1000, 1000);
  }
  if (withTurbo) writeFileSync(path.join(cwd, "turbo.json"), "{}");
  for (const f of ["index.js", "index.js.map"]) {
    writeFileSync(path.join(cwd, "dist", f), "");
    utimesSync(path.join(cwd, "dist", f), 1010, 1010);
  }
  return cwd;
}

/** Rend `file` plus récent que le `dist`. */
function touch(cwd: string, file: string): void {
  const p = path.join(cwd, file);
  writeFileSync(p, "");
  utimesSync(p, 2000, 2000);
}

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe.each([
  ["application autonome", false],
  ["dépôt du framework (turbo.json)", true],
])("isRootDistStale — %s", (_label, withTurbo) => {
  let cwd: string;
  beforeEach(() => {
    cwd = freshApp(withTurbo);
  });

  it("dist à jour → rien à rebâtir", () => {
    expect(isRootDistStale(cwd)).toBe(false);
  });

  it("dist absent → à rebâtir", () => {
    rmSync(path.join(cwd, "dist"), { recursive: true });
    expect(isRootDistStale(cwd)).toBe(true);
  });

  it("dist sans sourcemaps (bâti pour la production) → à rebâtir", () => {
    rmSync(path.join(cwd, "dist", "index.js.map"));
    expect(isRootDistStale(cwd)).toBe(true);
  });

  it("fichier racine plus récent → à rebâtir", () => {
    touch(cwd, "env.ts");
    expect(isRootDistStale(cwd)).toBe(true);
  });

  it("config de l'app (`nodefony/config/*.ts`) plus récente → à rebâtir", () => {
    touch(cwd, path.join("nodefony", "config", "security.ts"));
    expect(isRootDistStale(cwd)).toBe(true);
  });

  it("module local plus récent → pas le dist de l'app (il a le sien)", () => {
    touch(cwd, path.join("modules", "local", "index.ts"));
    expect(isRootDistStale(cwd)).toBe(false);
  });

  it("fichier non-TypeScript plus récent sous `nodefony/` → ignoré", () => {
    touch(cwd, path.join("nodefony", "config", "cert.pem"));
    expect(isRootDistStale(cwd)).toBe(false);
  });
});
