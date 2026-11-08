import { afterAll, assert, describe, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ScaffoldWriter } from "../cli/scaffold/writer";
import { wireModuleManifest } from "../cli/scaffold/engine";

/**
 * La politique de chargement d'une entrée du manifeste voyage sous ses DEUX
 * formes — `use()` et objet nu. Écrite sans elle, un module de développement
 * (la démo, #747) part en production sans un mot : le gating du noyau ne lit
 * que l'entrée.
 */
describe("wireModuleManifest — politique de chargement de l'entrée", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "nf-manifest-policy-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const wire = (source: string, policy?: "dev"): string => {
    const config = path.join(
      mkdtempSync(path.join(root, "app-")),
      "nodefony.config.ts",
    );
    writeFileSync(config, source);
    const writer = new ScaffoldWriter();
    const note = wireModuleManifest(
      config,
      "@app/demo",
      writer,
      policy === undefined ? {} : { policy },
    );
    assert.isNull(note);
    return writer.read(config);
  };

  const withUse = `import { defineConfig, use } from "nodefony";\nexport default defineConfig({\n  modules: [\n    use("@nodefony/http", {}),\n  ],\n});\n`;
  const withoutUse = `export default {\n  modules: [\n    "@nodefony/http",\n  ],\n};\n`;

  it("forme use() : la politique devient le troisième argument", () => {
    assert.include(
      wire(withUse, "dev"),
      'use("@app/demo", {}, { policy: "dev" }),',
    );
  });

  it("forme nue : la politique devient une entrée objet", () => {
    assert.include(
      wire(withoutUse, "dev"),
      '{ name: "@app/demo", policy: "dev" },',
    );
  });

  it("sans politique, l'entrée reste celle d'un module chargé partout", () => {
    assert.include(wire(withUse), 'use("@app/demo", {}),');
    assert.include(wire(withoutUse), '"@app/demo",');
    assert.notInclude(wire(withUse), "policy");
  });
});
