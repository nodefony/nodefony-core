/**
 * Unit — la portée d'une page de doc (`publish: user | core | none`), et le
 * signal « dépôt du framework » qui décide si une page `core` se montre.
 *
 * Une seule règle, lue par le site public, le portail de Studio et l'onglet
 * Docs d'un module : c'est ici qu'elle s'éprouve.
 */
import { describe, it, afterAll } from "vitest";
import assert from "node:assert";
import path from "node:path";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  readDocScope,
  isDocVisible,
  isFrameworkRepository,
} from "../runtime/docScope";

const aSupprimer: string[] = [];
afterAll(() => {
  for (const d of aSupprimer) rmSync(d, { recursive: true, force: true });
});
function decor(): string {
  const d = mkdtempSync(path.join(tmpdir(), "nf-doc-scope-"));
  aSupprimer.push(d);
  return d;
}
/** Lie `node_modules/nodefony` vers `cible` — `junction` : sans privilège sous Windows. */
function lier(racine: string, cible: string): void {
  mkdirSync(cible, { recursive: true });
  mkdirSync(path.join(racine, "node_modules"), { recursive: true });
  symlinkSync(cible, path.join(racine, "node_modules", "nodefony"), "junction");
}

describe("readDocScope — la clé publish", () => {
  it("les trois portées, et la forme booléenne historique", () => {
    assert.equal(readDocScope("user"), "user");
    assert.equal(readDocScope("core"), "core");
    assert.equal(readDocScope("none"), "none");
    assert.equal(readDocScope(true), "user");
    assert.equal(readDocScope("false"), "core");
  });
  it("absente ou inconnue : aucune portée déclarée", () => {
    assert.equal(readDocScope(undefined), null);
    assert.equal(readDocScope("publique"), null);
  });
});

describe("isDocVisible — qui voit quoi", () => {
  it("🔴 une page core n'est montrée QUE dans le dépôt du framework", () => {
    assert.equal(isDocVisible("core", true), true);
    assert.equal(isDocVisible("core", false), false);
  });
  it("une page none n'est montrée nulle part, une page user partout", () => {
    assert.equal(isDocVisible("none", true), false);
    assert.equal(isDocVisible("user", false), true);
    assert.equal(isDocVisible(null, false), true);
  });
});

describe("isFrameworkRepository — le fait se constate", () => {
  it("🔴 nodefony SOURCE du projet (lien vers un dossier du projet) → dépôt", () => {
    const racine = decor();
    lier(racine, path.join(racine, "src", "nodefony"));
    assert.equal(isFrameworkRepository(racine), true);
  });
  it("nodefony installé dans node_modules → application", () => {
    const racine = decor();
    mkdirSync(path.join(racine, "node_modules", "nodefony"), {
      recursive: true,
    });
    assert.equal(isFrameworkRepository(racine), false);
  });
  it("nodefony lié HORS du projet (--link vers un checkout) → application", () => {
    const racine = decor();
    lier(racine, path.join(decor(), "checkout", "nodefony"));
    assert.equal(isFrameworkRepository(racine), false);
  });
  it("nodefony introuvable → application, jamais une exception", () => {
    assert.equal(isFrameworkRepository(decor()), false);
  });
});
