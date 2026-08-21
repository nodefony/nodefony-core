import { describe, it } from "vitest";
import { assert } from "chai";
import {
  buildStartMenu,
  buildInspectMenu,
  filterStartMenu,
  START_MENU_CATALOG,
  MODULE_COMMANDS_GROUP,
  type StartMenuItem,
} from "../cli/startMenu";
import { INSPECT_SUBJECTS } from "../kernel/inspect/adminSubjects";

/** describe() qui connaît tout le catalogue — le cas nominal. */
const describeAll = (name: string) => `résumé de ${name}`;

function choices(items: StartMenuItem[]) {
  return items.filter((i) => i.kind === "choice");
}
function separators(items: StartMenuItem[]) {
  return items.filter((i) => i.kind === "separator");
}

describe("startMenu — composition pure du menu interactif", () => {
  it("projet : les groupes sont titrés, dans l'ordre, et portent les gestes du projet", () => {
    const { message, items } = buildStartMenu({
      inProject: true,
      projectName: "mon-app",
      describe: describeAll,
    });
    assert.include(message, "mon-app");
    const titles = separators(items).map((s) =>
      s.kind === "separator" ? s.label : "",
    );
    assert.deepEqual(titles, [
      "Serveur",
      "Comprendre",
      "Faire évoluer",
      "Outillage",
    ]);
    const values = choices(items).map((c) =>
      c.kind === "choice" ? c.value : "",
    );
    // Les gestes du quotidien — leur ABSENCE était le défaut n°1 de l'audit.
    for (const expected of [
      "development",
      "production",
      "cluster",
      "status",
      "stop",
      "check",
      "inspect",
      "env",
      "card",
      "create",
      "build",
      "install",
      "outdated",
      "git:hooks",
      "ai:sync",
      "completion",
    ]) {
      assert.include(values, expected, `« ${expected} » manque au menu projet`);
    }
  });

  it("hors projet : seuls les gestes qui ont un sens partout", () => {
    const { message, items } = buildStartMenu({
      inProject: false,
      describe: describeAll,
    });
    assert.include(message, "Aucun projet");
    const values = choices(items).map((c) =>
      c.kind === "choice" ? c.value : "",
    );
    assert.deepEqual(values, ["create", "status", "stop", "completion"]);
    // Aucun geste de projet ne doit fuir hors projet.
    for (const forbidden of ["development", "build", "inspect", "git:hooks"]) {
      assert.notInclude(values, forbidden);
    }
  });

  it("chaque entrée porte une EXPLICATION propre, distincte du résumé", () => {
    const { items } = buildStartMenu({
      inProject: true,
      describe: describeAll,
      moduleCommands: [{ name: "blog:sync", description: "sync du blog" }],
    });
    for (const c of choices(items)) {
      if (c.kind !== "choice") continue;
      assert.isAbove(
        c.description.length,
        30,
        `« ${c.value} » : explication indigente`,
      );
      assert.notInclude(
        c.description,
        "résumé de",
        `« ${c.value} » : l'explication recopie le résumé commander`,
      );
      // Champs BRUTS : le label est le nom nu (le rendu vit dans l'adaptateur),
      // et le résumé commander est porté séparément.
      assert.isFalse(
        /\x1b/.test(c.label),
        `« ${c.value} » : du style a fui dans la composition`,
      );
      assert.isAbove(c.summary.length, 0, `« ${c.value} » : résumé vide`);
    }
  });

  it("une commande retirée du CLI sort du menu toute seule (describe → null)", () => {
    const { items } = buildStartMenu({
      inProject: true,
      describe: (name) => (name === "cluster" ? null : describeAll(name)),
    });
    const values = choices(items).map((c) =>
      c.kind === "choice" ? c.value : "",
    );
    assert.notInclude(values, "cluster");
    assert.include(values, "development");
  });

  it("un groupe entièrement vide n'émet pas son séparateur", () => {
    // Seul « create » répond : les groupes Serveur/Comprendre/Outillage
    // disparaissent AVEC leur titre — un titre sans entrée est un mensonge.
    const { items } = buildStartMenu({
      inProject: true,
      describe: (name) => (name === "create" ? "résumé" : null),
    });
    const titles = separators(items).map((s) =>
      s.kind === "separator" ? s.label : "",
    );
    assert.deepEqual(titles, ["Faire évoluer"]);
  });

  it("commandes de module : groupe dédié en projet, jamais hors projet", () => {
    const moduleCommands = [
      { name: "security:user:add", description: "crée un utilisateur" },
    ];
    const inProject = buildStartMenu({
      inProject: true,
      describe: describeAll,
      moduleCommands,
    });
    const labels = separators(inProject.items).map((s) =>
      s.kind === "separator" ? s.label : "",
    );
    assert.include(labels, MODULE_COMMANDS_GROUP);
    const values = choices(inProject.items).map((c) =>
      c.kind === "choice" ? c.value : "",
    );
    assert.include(values, "security:user:add");

    const outside = buildStartMenu({
      inProject: false,
      describe: describeAll,
      moduleCommands,
    });
    const outsideValues = choices(outside.items).map((c) =>
      c.kind === "choice" ? c.value : "",
    );
    assert.notInclude(outsideValues, "security:user:add");
  });

  it("inspect : le sous-menu vient de la table SOURCE et écarte les sujets à paramètre", () => {
    const { items } = buildInspectMenu(INSPECT_SUBJECTS);
    const values = choices(items).map((c) =>
      c.kind === "choice" ? c.value : "",
    );
    for (const [name, subject] of Object.entries(INSPECT_SUBJECTS)) {
      if (subject.param) {
        assert.notInclude(values, name, `« ${name} » exige un paramètre`);
      } else {
        assert.include(values, name);
      }
    }
    assert.include(values, "routes");
  });

  it("scripts npm : proposés SEULEMENT s'ils existent au package.json, groupés, préfixés npm:", () => {
    const { items } = buildStartMenu({
      inProject: true,
      describe: describeAll,
      npmScripts: ["verify", "test", "infra:up", "un-script-inconnu"],
    });
    const values = choices(items).map((c) =>
      c.kind === "choice" ? c.value : "",
    );
    assert.include(values, "npm:verify");
    assert.include(values, "npm:test");
    assert.include(values, "npm:infra:up");
    // Hors catalogue → jamais proposé (le menu ne déverse pas 30 scripts).
    assert.notInclude(values, "npm:un-script-inconnu");
    // Déclaré au catalogue mais ABSENT du package.json → pas proposé.
    assert.notInclude(values, "npm:test:e2e");
    const labels = separators(items).map((s) =>
      s.kind === "separator" ? s.label : "",
    );
    assert.include(labels, "Qualité (npm run)");
    assert.include(labels, "Infra (docker)");
  });

  it("scripts npm : jamais hors projet, et aucun groupe sans script présent", () => {
    const outside = buildStartMenu({
      inProject: false,
      describe: describeAll,
      npmScripts: ["verify"],
    });
    const outsideValues = choices(outside.items).map((c) =>
      c.kind === "choice" ? c.value : "",
    );
    assert.notInclude(outsideValues, "npm:verify");

    const noInfra = buildStartMenu({
      inProject: true,
      describe: describeAll,
      npmScripts: ["verify"],
    });
    const labels = separators(noInfra.items).map((s) =>
      s.kind === "separator" ? s.label : "",
    );
    assert.notInclude(labels, "Infra (docker)");
  });

  it("filtre à la frappe : accents ignorés, groupes suivent leurs entrées, terme vide = tout", () => {
    const { items } = buildStartMenu({
      inProject: true,
      describe: describeAll,
      npmScripts: ["verify"],
    });
    assert.strictEqual(filterStartMenu(items, ""), items);
    const dev = filterStartMenu(items, "rechargement");
    const devValues = dev
      .filter((i) => i.kind === "choice")
      .map((i) => (i.kind === "choice" ? i.value : ""));
    assert.include(devValues, "development");
    assert.notInclude(devValues, "production");
    const devTitles = dev
      .filter((i) => i.kind === "separator")
      .map((i) => (i.kind === "separator" ? i.label : ""));
    assert.deepEqual(devTitles, ["Serveur"]);
    const grp = filterStartMenu(items, "serveur");
    const grpValues = grp
      .filter((i) => i.kind === "choice")
      .map((i) => (i.kind === "choice" ? i.value : ""));
    assert.include(grpValues, "development");
    assert.include(grpValues, "stop");
    const q = filterStartMenu(items, "qualite");
    const qValues = q
      .filter((i) => i.kind === "choice")
      .map((i) => (i.kind === "choice" ? i.value : ""));
    assert.include(qValues, "npm:verify");
    assert.deepEqual(filterStartMenu(items, "zzzz-introuvable"), []);
  });

  it("le catalogue ne référence que des groupes déclarés pour chacun de ses contextes", () => {
    for (const entry of START_MENU_CATALOG) {
      for (const context of entry.contexts) {
        assert.isString(
          entry.group[context],
          `« ${entry.value} » : contexte ${context} sans groupe`,
        );
      }
    }
  });
});
