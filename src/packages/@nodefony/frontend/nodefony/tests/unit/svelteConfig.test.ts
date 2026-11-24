/**
 * #909 — la configuration Svelte d'un module lue en développement, quand le
 * module partage une instance Vite dont la racine est celle d'un AUTRE module
 * (`ViteConfigGenerator.ts#viteDevRoot`). Le choix du fichier est
 * `svelte5-vite.ts#svelteConfigFile` ; la preuve sur une vraie Vite est
 * `tests/integration/svelteSharedFamily.test.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { IResolvedFrontendEntry } from "../../interfaces/IFrontBuilder.js";
import { FrontendSvelteConfigConflictError } from "../../src/errors/FrontendError.js";
import { composePresets } from "../../src/presets/compose.js";
import { getBuiltinPreset } from "../../src/presets/index.js";
import { svelteConfigFile } from "../../src/presets/svelte5-vite.js";

const base = mkdtempSync(path.join(os.tmpdir(), "nf-svelte-config-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

let seq = 0;
/** Une racine front, avec ou sans `svelte.config.*`. */
function root(config?: { name?: string; text: string }): string {
  const dir = path.join(base, `m${++seq}`);
  mkdirSync(dir);
  if (config)
    writeFileSync(
      path.join(dir, config.name ?? "svelte.config.js"),
      config.text,
    );
  return dir;
}

function entry(
  dir: string,
  type: IResolvedFrontendEntry["type"] = "svelte5",
): IResolvedFrontendEntry {
  return {
    moduleName: path.basename(dir),
    entryName: path.basename(dir),
    type,
    root: dir,
    entryFile: "src/main.ts",
    outDir: path.join(dir, "dist"),
    publicPath: `/_assets/${path.basename(dir)}/`,
  };
}

const CONFIG = "export default { preprocess: [] };\n";

describe("svelteConfigFile — quel fichier le plugin Svelte doit lire", () => {
  it("aucune configuration : null, le plugin garde son comportement", () => {
    expect(svelteConfigFile([entry(root()), entry(root())])).to.equal(null);
  });

  it("une seule configuration, sur une entrée qui n'est PAS la première : la sienne", () => {
    const withConfig = root({ text: CONFIG });
    expect(svelteConfigFile([entry(root()), entry(withConfig)])).to.equal(
      path.join(withConfig, "svelte.config.js"),
    );
  });

  it("les noms se cherchent dans l'ordre du plugin : .js avant .ts", () => {
    const dir = root({ name: "svelte.config.ts", text: CONFIG });
    writeFileSync(path.join(dir, "svelte.config.js"), CONFIG);
    expect(svelteConfigFile([entry(dir)])).to.equal(
      path.join(dir, "svelte.config.js"),
    );
  });

  it("deux configurations au texte identique : la première", () => {
    const a = root({ text: CONFIG });
    const b = root({ text: CONFIG });
    expect(svelteConfigFile([entry(a), entry(b)])).to.equal(
      path.join(a, "svelte.config.js"),
    );
  });

  it("deux configurations différentes : erreur nommée qui cite les DEUX fichiers", () => {
    const a = root({ text: CONFIG });
    const b = root({ text: "export default {};\n" });
    const compose = () => svelteConfigFile([entry(a), entry(b)]);
    expect(compose).toThrow(FrontendSvelteConfigConflictError);
    expect(compose).toThrow(path.join(a, "svelte.config.js"));
    expect(compose).toThrow(path.join(b, "svelte.config.js"));
  });
});

describe("preset svelte5 — `configFile` dans la description du plugin", () => {
  it("famille partagée, Svelte en second : `configFile` absolu, séparé par /", () => {
    const withConfig = root({ text: CONFIG });
    const { plugins } = composePresets(
      [entry(root(), "vanilla"), entry(withConfig)],
      getBuiltinPreset,
    );
    const svelte = plugins.find(
      (p) => p.specifier === "@sveltejs/vite-plugin-svelte",
    );
    expect(svelte?.options).to.deep.equal({
      configFile: path.join(withConfig, "svelte.config.js").replace(/\\/g, "/"),
    });
  });

  it("sans configuration : aucune option — un `configFile` absent ferait échouer le plugin", () => {
    const { plugins } = composePresets([entry(root())], getBuiltinPreset);
    expect(plugins[0]?.options).to.equal(undefined);
  });
});
