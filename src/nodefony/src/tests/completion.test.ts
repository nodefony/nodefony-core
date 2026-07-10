/*
 *   Tests de la complétion shell CLI (cli/completion.ts).
 *
 *   Unitaires PURS : extraction de flags, build du manifest depuis un commander réel
 *   (CliKernel + built-ins, sans boot), calcul des candidats (protocole « dernier mot
 *   = en cours de frappe »), rendu des scripts shell. Le fast-path e2e est couvert
 *   dans CliIntegration.test.ts.
 */

import assert from "node:assert";
import CliKernel from "../kernel/CliKernel";
import {
  extractFlags,
  buildCliManifest,
  computeCompletions,
  renderCompletionScript,
  cliManifestFile,
  type ICliManifest,
} from "../cli/completion";

/** Manifest built-ins réel — construit depuis un CliKernel en mémoire (0 boot). */
function makeManifest(): ICliManifest {
  const cli = new CliKernel("development");
  return cli.buildBuiltinManifest();
}

describe("completion — extractFlags", () => {
  it("extrait courts et longs, sans placeholders", () => {
    assert.deepStrictEqual(extractFlags("-w, --workers <number>"), [
      "-w",
      "--workers",
    ]);
    assert.deepStrictEqual(extractFlags("--detach"), ["--detach"]);
    assert.deepStrictEqual(extractFlags("--wait <sec>"), ["--wait"]);
  });
});

describe("completion — buildCliManifest (built-ins réels)", () => {
  it("contient les built-ins avec alias et options", () => {
    const m = makeManifest();
    const dev = m.commands.find((c) => c.name === "development");
    assert.ok(dev, "development doit être dans le manifest");
    assert.ok(dev.aliases.includes("dev"));
    assert.ok(dev.options.includes("--detach"));
    assert.ok(dev.options.includes("--wait"));
    const names = m.commands.map((c) => c.name);
    for (const n of ["build", "cluster", "status", "stop", "completion"]) {
      assert.ok(names.includes(n), `${n} attendu dans le manifest`);
    }
  });

  it("expose les options globales du programme (-d/--debug)", () => {
    const m = makeManifest();
    assert.ok(m.globalOptions.includes("--debug"));
  });

  it("exclut toute commande cachée __*", () => {
    const m = makeManifest();
    assert.ok(m.commands.every((c) => !c.name.startsWith("__")));
  });
});

describe("completion — computeCompletions (protocole dernier mot = frappe)", () => {
  it("aucun mot validé → toutes les commandes + alias", () => {
    const m = makeManifest();
    const out = computeCompletions(m, [""]);
    assert.ok(out.includes("development"));
    assert.ok(out.includes("dev")); // alias proposé aussi
    assert.ok(out.includes("cluster"));
  });

  it("mot partiel en cours de frappe → commandes (le shell filtre par préfixe)", () => {
    const m = makeManifest();
    // « nodefony dev<TAB> » : "dev" est le mot COURANT, pas validé → on propose les
    // commandes, le shell garde celles préfixées par "dev".
    const out = computeCompletions(m, ["dev"]);
    assert.ok(out.includes("development"));
  });

  it("commande validée → ses options + les globales", () => {
    const m = makeManifest();
    // « nodefony development --<TAB> » : development validé, "--" en frappe.
    const out = computeCompletions(m, ["development", "--"]);
    assert.ok(out.includes("--detach"));
    assert.ok(out.includes("--wait"));
    assert.ok(out.includes("--debug")); // globale
    assert.ok(!out.includes("build"), "plus de noms de commandes à ce stade");
  });

  it("alias validé → mêmes options que la commande", () => {
    const m = makeManifest();
    const out = computeCompletions(m, ["dev", ""]);
    assert.ok(out.includes("--detach"));
  });

  it("options en tête ignorées pour la sélection de commande", () => {
    const m = makeManifest();
    const out = computeCompletions(m, ["-d", "clu"]);
    assert.ok(out.includes("cluster"));
  });
});

describe("completion — scripts shell", () => {
  it("zsh : compdef + délégation __complete", () => {
    const s = renderCompletionScript("zsh");
    assert.ok(s.includes("#compdef nodefony"));
    assert.ok(s.includes("nodefony __complete --"));
    assert.ok(s.includes("compdef _nodefony nodefony"));
  });

  it("bash : complete -F + compgen", () => {
    const s = renderCompletionScript("bash");
    assert.ok(s.includes("complete -F _nodefony_completions nodefony"));
    assert.ok(s.includes("nodefony __complete --"));
  });

  it("fish : complete -c nodefony", () => {
    const s = renderCompletionScript("fish");
    assert.ok(s.includes("complete -c nodefony"));
  });

  it("cliManifestFile — cache par projet sous node_modules/.cache/nodefony", () => {
    assert.ok(
      cliManifestFile("/x").endsWith(
        "node_modules/.cache/nodefony/cli-manifest.json",
      ),
    );
  });
});
