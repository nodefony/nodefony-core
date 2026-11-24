/**
 * #909 — sur une VRAIE Vite : une famille partagée dont la racine est celle
 * d'un module sans configuration Svelte (`host/`), et une entrée Svelte en
 * second (`module/`) qui porte la sienne. Le préprocesseur témoin de
 * `module/svelte.config.js` remplace un jeton : s'il survit dans le code
 * servi, la configuration du module a été ignorée — ce que faisait le plugin
 * laissé à lui-même, qui ne cherche qu'à la racine de l'instance.
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { IResolvedFrontendEntry } from "../../interfaces/IFrontBuilder.js";
import type { IVitePluginSpec } from "../../interfaces/IFrontPreset.js";
import {
  composePresets,
  loadVitePlugins,
  toPortablePath,
} from "../../src/presets/compose.js";
import { getBuiltinPreset } from "../../src/presets/index.js";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/svelte-shared-family",
);
const HOST = path.join(FIXTURE, "host");
const MODULE = path.join(FIXTURE, "module");
const MISSING = "__NF_PREPROCESSOR_MISSING__";

const cacheDir = mkdtempSync(path.join(os.tmpdir(), "nf-svelte-family-"));
afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));

function entry(
  root: string,
  type: IResolvedFrontendEntry["type"],
): IResolvedFrontendEntry {
  const name = path.basename(root);
  return {
    moduleName: name,
    entryName: name,
    type,
    root,
    entryFile: "index.html",
    outDir: path.join(root, "dist"),
    publicPath: `/_assets/${name}/`,
  };
}

/** Code servi pour le composant du module, sous les plugins décrits. */
async function servedProbe(
  specs: ReadonlyArray<IVitePluginSpec>,
): Promise<string> {
  const { createServer } = await import("vite");
  const server = await createServer({
    root: HOST,
    configFile: false,
    cacheDir,
    logLevel: "silent",
    appType: "custom",
    plugins: await loadVitePlugins(specs),
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, watch: null },
  });
  try {
    const url = `/@fs/${toPortablePath(path.join(MODULE, "Probe.svelte")).replace(/^\//, "")}`;
    const result = await server.transformRequest(url);
    return result?.code ?? "";
  } finally {
    await server.close();
  }
}

/** La composition de la famille : racine = `host` (vanilla), Svelte en second. */
function familySpecs(): ReadonlyArray<IVitePluginSpec> {
  return composePresets(
    [entry(HOST, "vanilla"), entry(MODULE, "svelte5")],
    getBuiltinPreset,
  ).plugins;
}

describe("famille Vite partagée — la configuration Svelte du module (#909)", () => {
  it("témoin : plugin sans `configFile`, la configuration du module est ignorée", async () => {
    const bare = familySpecs().map(({ specifier, exportName }) => ({
      specifier,
      exportName,
    }));
    expect(await servedProbe(bare)).to.contain(MISSING);
  }, 30_000);

  it("plugin décrit par le preset : le préprocesseur du module s'applique", async () => {
    const code = await servedProbe(familySpecs());
    expect(code).to.contain("nf-preprocessed");
    expect(code).not.to.contain(MISSING);
  }, 30_000);
});
