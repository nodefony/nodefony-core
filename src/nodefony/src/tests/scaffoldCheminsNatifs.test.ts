/// <reference types="node" />
import path from "node:path";
import { describe, it, expect } from "vitest";
import { toNativeRelativePath } from "../cli/scaffold/engine";

/**
 * Ce que cette suite prouve : la liste des fichiers qu'un scaffold annonce ne
 * mélange pas deux grammaires de chemin.
 *
 * Le défaut réparé : deux entrées sur une quarantaine étaient écrites en `/`
 * littéral — des pages d'agent et le pointeur `.github/copilot-instructions.md`
 * —, tout le reste arrivant par `path.join`.
 * Sous Linux les deux coïncident et rien ne se voit ; sous Windows le plan du
 * `dry-run` cesse de correspondre à ce que le scaffold écrit vraiment. Trois
 * jobs de la forge sont restés rouges, et les autres plateformes vertes.
 *
 * La grammaire étant un PARAMÈTRE, la règle s'éprouve depuis n'importe quel
 * poste : `path.win32` rend le cas Windows observable sans machine Windows.
 * C'est le seul montage qui MORD ici — une assertion sur la plateforme courante
 * resterait verte sous Linux avec le défaut en place.
 */
describe("scaffold — un chemin publié se compose dans la grammaire de la plateforme", () => {
  it("compose en séparateurs Windows sous la grammaire win32", () => {
    expect(
      toNativeRelativePath(".agents/skills/nodefony-dev.md", path.win32),
    ).to.equal(".agents\\skills\\nodefony-dev.md");
    expect(
      toNativeRelativePath(".github/copilot-instructions.md", path.win32),
    ).to.equal(".github\\copilot-instructions.md");
  });

  it("laisse un chemin POSIX intact sous la grammaire posix", () => {
    expect(
      toNativeRelativePath(".agents/skills/nodefony-dev.md", path.posix),
    ).to.equal(".agents/skills/nodefony-dev.md");
  });

  it("laisse intact un chemin sans séparateur, quelle que soit la grammaire", () => {
    // `AGENTS.md` et `README.md` entrent dans la même liste : la fonction ne
    // doit rien leur ajouter, sous aucune grammaire.
    for (const grammar of [path.win32, path.posix]) {
      expect(toNativeRelativePath("AGENTS.md", grammar)).to.equal("AGENTS.md");
    }
  });

  it("emploie la grammaire de la PLATEFORME quand on ne lui en donne pas", () => {
    // Le défaut est ce que le scaffold utilise réellement : si quelqu'un le
    // remplace un jour par une constante, ce cas tombe sur l'une des deux
    // plateformes — jamais sur les deux, ce qui est précisément le piège.
    expect(toNativeRelativePath(".agents/skills/x.md")).to.equal(
      path.join(".agents", "skills", "x.md"),
    );
  });
});
