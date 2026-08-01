/// <reference types="node" />
import { describe, it } from "vitest";
import { assert } from "chai";
import { resolveModuleLayout } from "../cli/scaffold/moduleLayout";

/**
 * Le layout se CONSTATE dans les workspaces — il ne se devine ni au nom du
 * dépôt, ni à un chemin en dur. Ces cas sont ceux qui existent vraiment : une
 * app générée, le dépôt du framework, et un monorepo tiers quelconque.
 */
describe("scaffold — layout des modules", () => {
  it("app générée (workspaces modules/*) : modules/, scope dérivé du nom", () => {
    const layout = resolveModuleLayout(
      { name: "ma-boutique", workspaces: ["modules/*"] },
      "ma-boutique",
    );
    assert.equal(layout.kind, "modules");
    assert.equal(layout.createDir, "modules");
    assert.equal(layout.scope, "@ma-boutique");
    assert.isTrue(layout.workspaceDeclared);
  });

  it("app SANS workspaces : modules/ à déclarer (l'appelant doit le poser)", () => {
    const layout = resolveModuleLayout({ name: "neuve" }, "neuve");
    assert.equal(layout.createDir, "modules");
    assert.isFalse(layout.workspaceDeclared);
    assert.deepEqual(layout.targetDirs, ["modules"]);
  });

  it("dépôt du framework : le module naît dans src/packages/@nodefony, scopé @nodefony", () => {
    const layout = resolveModuleLayout(
      {
        name: "nodefony-core",
        workspaces: [
          "src/nodefony",
          "src/packages/@nodefony/*",
          "src/modules/*",
        ],
      },
      "nodefony-core",
    );
    assert.equal(layout.kind, "packages");
    assert.equal(layout.createDir, "src/packages/@nodefony");
    assert.equal(layout.scope, "@nodefony");
    // Le dépôt déclare déjà son workspace : on ne touche NI aux workspaces NI
    // aux scripts de la racine (turbo pilote déjà la chaîne).
    assert.isTrue(layout.workspaceDeclared);
    // `src/nodefony` n'est pas un dossier de modules (pas de `/*`) : exclu.
    assert.deepEqual(layout.targetDirs, [
      "src/packages/@nodefony",
      "src/modules",
    ]);
  });

  it("le scope n'est PAS écrit en dur : un autre monorepo prend le sien", () => {
    const layout = resolveModuleLayout(
      { name: "acme-mono", workspaces: ["libs/@acme/*"] },
      "acme-mono",
    );
    assert.equal(layout.kind, "packages");
    assert.equal(layout.createDir, "libs/@acme");
    assert.equal(layout.scope, "@acme");
  });

  it("workspaces écrits avec des séparateurs Windows : normalisés avant filtrage", () => {
    const layout = resolveModuleLayout(
      { name: "mono", workspaces: ["src\\packages\\@nodefony\\*"] },
      "mono",
    );
    assert.equal(layout.kind, "packages");
    assert.equal(layout.createDir, "src/packages/@nodefony");
    assert.equal(layout.scope, "@nodefony");
  });

  it("nom d'app déjà scopé : le scope du module reste un seul segment", () => {
    const layout = resolveModuleLayout(
      { name: "@acme/boutique", workspaces: ["modules/*"] },
      "boutique",
    );
    assert.equal(layout.scope, "@acme-boutique");
  });
});
