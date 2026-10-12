import { afterAll, describe, it } from "vitest";
import { assert } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readModuleShortcuts } from "../cli/env";

/**
 * La découverte des noms courts par `nodefony env`, SANS démarrer l'application :
 * le module DÉCLARE son schéma (`package.json` → `nodefony.configSchema`).
 *
 * Ce qui est éprouvé, c'est l'honnêteté : un schéma déclaré qu'on ne peut pas
 * lire est NOMMÉ, avec sa raison. Le taire faisait ressortir les variables du
 * module « lues par personne » — le mensonge que ce mécanisme existe pour
 * supprimer.
 */
describe("nodefony env — découverte des réglages de modules", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "nf-env-modules-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(
    path.join(root, "nodefony.config.ts"),
    `export default defineConfig({ modules: [use("@x/built"), use("@x/unbuilt"), use("@x/noexport"), use("@x/silent")] });\n`,
  );
  const pkg = (
    name: string,
    nodefony: Record<string, string> | null,
  ): string => {
    const dir = path.join(root, "node_modules", "@x", name);
    mkdirSync(path.join(dir, "dist"), { recursive: true });
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: `@x/${name}`, ...(nodefony ? { nodefony } : {}) }),
    );
    return dir;
  };
  const declared = { configSchema: "./dist/configSchema.js" };
  writeFileSync(
    path.join(pkg("built", declared), "dist", "configSchema.js"),
    `export function configJsonSchema() {
      return { type: "object", properties: { host: { type: "string", default: "h", env: "NF_BUILT_HOST" } } };
    }\n`,
  );
  pkg("unbuilt", declared);
  writeFileSync(
    path.join(pkg("noexport", declared), "dist", "configSchema.js"),
    `export const autre = 1;\n`,
  );
  pkg("silent", null);

  it("lit le schéma déclaré et rend ses noms courts, module compris", async () => {
    const { shortcuts } = await readModuleShortcuts(root);
    assert.deepEqual(
      shortcuts.map((s) => [s.env, s.module, s.path.join(".")]),
      [["NF_BUILT_HOST", "@x/built", "host"]],
    );
  });

  it("NOMME le module non construit et celui sans export — jamais un silence", async () => {
    const { unreadable } = await readModuleShortcuts(root);
    const byModule = Object.fromEntries(
      unreadable.map((u) => [u.module, u.reason]),
    );
    assert.match(byModule["@x/unbuilt"]!, /non construit/u);
    assert.match(byModule["@x/noexport"]!, /configJsonSchema/u);
    // Ne rien déclarer n'est pas une erreur : le module ne propose pas de nom court.
    assert.notProperty(byModule, "@x/silent");
  });
});
