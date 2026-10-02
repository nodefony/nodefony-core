/*
 *   Sourcemaps de l'application en DÉVELOPPEMENT.
 *
 *   En dev, le serveur exécute `dist/` : sans maps, une erreur dans le
 *   contrôleur de l'utilisateur pointe vers le `.js` compilé, et un point d'arrêt
 *   posé dans son `.ts` ne s'arrête jamais. Le superviseur bâtit donc avec
 *   `APP_DEV_BUILD_ARGS`, et le serveur de dev appelle `enableDevSourceMaps()`.
 *
 *   Le test rejoue la VRAIE chaîne — le binaire rolldown sur une config qui
 *   déclare `sourcemap: false` (le défaut de `nodefony/bundler`), puis un process
 *   Node qui exécute `enableDevSourceMaps` (le `.ts` tel quel) AVANT de charger
 *   l'application — et lit la pile produite. Le témoin prouve que l'assertion
 *   sait distinguer.
 */

import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APP_DEV_BUILD_ARGS } from "../service/dev/DevSupervisor";

const require = createRequire(import.meta.url);
const rolldownCli = path.join(
  path.dirname(require.resolve("rolldown/package.json")),
  "bin",
  "cli.mjs",
);

const sourceMapsHelper = pathToFileURL(
  path.join(import.meta.dirname, "..", "service", "dev", "sourceMaps.ts"),
).href;

/**
 * Bâtit l'app témoin avec `buildArgs`, la charge (après `enableDevSourceMaps`
 * si `devServer`), rend la sortie d'erreur du crash.
 */
function buildAndCrash(
  buildArgs: readonly string[],
  devServer: boolean,
): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nf-devmaps-"));
  try {
    writeFileSync(
      path.join(dir, "index.ts"),
      'export function boom(n: number): number {\n  throw new Error("boom " + n);\n}\nboom(1);\n',
    );
    writeFileSync(
      path.join(dir, "rolldown.config.ts"),
      'export default { input: "index.ts", output: { dir: "dist", sourcemap: false } };\n',
    );
    const build = spawnSync(process.execPath, [rolldownCli, ...buildArgs], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.strictEqual(build.status, 0, build.stderr);
    const app = pathToFileURL(path.join(dir, "dist", "index.js")).href;
    const boot = devServer
      ? `const m = await import(${JSON.stringify(sourceMapsHelper)}); m.enableDevSourceMaps(); await import(${JSON.stringify(app)});`
      : `await import(${JSON.stringify(app)});`;
    const run = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", boot],
      { cwd: dir, encoding: "utf8" },
    );
    return run.stderr;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("DevSupervisor — sourcemaps du build de développement", () => {
  it("la pile d'une erreur pointe vers la ligne du .ts", () => {
    const stderr = buildAndCrash(APP_DEV_BUILD_ARGS, true);
    assert.match(stderr, /index\.ts:2\b/);
  }, 30_000);

  it("témoin : le build de production pointe vers le .js compilé", () => {
    const stderr = buildAndCrash(["-c", "rolldown.config.ts"], false);
    assert.doesNotMatch(stderr, /index\.ts:2\b/);
    assert.match(stderr, /index\.js:\d+/);
  }, 30_000);
});
