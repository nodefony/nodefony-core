/*
 *   Tests de la complétion shell CLI (cli/completion.ts).
 *
 *   Unitaires PURS : extraction de flags, build du manifest depuis un commander réel
 *   (CliKernel + built-ins, sans boot), calcul des candidats (protocole « dernier mot
 *   = en cours de frappe »), rendu des scripts shell. Le fast-path e2e est couvert
 *   dans CliIntegration.test.ts.
 */

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import CliKernel from "../kernel/CliKernel";
import {
  extractFlags,
  buildCliManifest,
  computeCompletions,
  renderCompletionScript,
  cliManifestFile,
  upsertBlock,
  removeBlock,
  installCompletion,
  uninstallCompletion,
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
    const names = new Set(m.commands.map((c) => c.name));
    for (const n of ["build", "cluster", "status", "stop", "completion"]) {
      assert.ok(names.has(n), `${n} attendu dans le manifest`);
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

  it("argument positionnel à choix : `create <TAB>` propose app", () => {
    const m = makeManifest();
    const out = computeCompletions(m, ["create", ""]);
    assert.ok(out.includes("app"), "app (choices de <type>) doit être proposé");
    assert.ok(out.includes("--preset")); // les options restent proposées
  });

  it("position suivante : `create app <TAB>` ne repropose PAS app (name libre)", () => {
    const m = makeManifest();
    const out = computeCompletions(m, ["create", "app", ""]);
    assert.ok(!out.includes("app"));
    assert.ok(out.includes("--force"));
  });

  it("valeur d'option ignorée dans le comptage : `create --preset minimal <TAB>` → app", () => {
    const m = makeManifest();
    const out = computeCompletions(m, ["create", "--preset", "minimal", ""]);
    assert.ok(out.includes("app"));
  });

  it("manifest cache ANCIEN (sans champ args) → comportement inchangé", () => {
    const m = makeManifest();
    for (const c of m.commands) delete (c as { args?: string[][] }).args;
    const out = computeCompletions(m, ["create", ""]);
    assert.ok(!out.includes("app"));
    assert.ok(out.includes("--preset"));
  });
});

describe("completion — scripts shell", () => {
  it("zsh : compdef + délégation __complete + résolution binaire projet", () => {
    const s = renderCompletionScript("zsh");
    assert.ok(s.includes("#compdef nodefony"));
    assert.ok(s.includes("__complete --"));
    assert.ok(s.includes("compdef _nodefony nodefony"));
    // Priorité au binaire DU PROJET, fallback npx --no-install (question npx).
    assert.ok(s.includes("./node_modules/.bin/nodefony"));
    assert.ok(s.includes("npx --no-install nodefony"));
  });

  it("bash : complete -F + compgen + résolution binaire projet", () => {
    const s = renderCompletionScript("bash");
    assert.ok(s.includes("complete -F _nodefony_completions nodefony"));
    assert.ok(s.includes("__complete --"));
    assert.ok(s.includes("./node_modules/.bin/nodefony"));
  });

  it("fish : complete -c nodefony + résolution binaire projet", () => {
    const s = renderCompletionScript("fish");
    assert.ok(s.includes("complete -c nodefony"));
    assert.ok(s.includes("./node_modules/.bin/nodefony"));
  });

  // Exécution zsh RÉELLE (zsh -f = zéro rc) : le source enregistre bien _nodefony
  // dans compsys, y compris SANS compinit préalable (auto-init du script — le
  // symptôme « TAB liste les fichiers » = compdef silencieusement absent).
  it("zsh réel : source du script → complétion ENREGISTRÉE (compinit auto)", async (ctx) => {
    const { spawnSync } = await import("node:child_process");
    if (spawnSync("command", ["-v", "zsh"], { shell: true }).status !== 0) {
      return ctx.skip();
    }
    const fsMod = await import("node:fs");
    const osMod = await import("node:os");
    const pathMod = await import("node:path");
    const dir = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), "nf-compl-"));
    const script = pathMod.join(dir, "completion.zsh");
    fsMod.writeFileSync(script, renderCompletionScript("zsh"), "utf8");
    try {
      // HOME jetable (zcompdump) ; PAS de compinit préalable → l'auto-init joue.
      const r = spawnSync(
        "zsh",
        [
          "-fc",
          `source ${script} && [[ \${_comps[nodefony]} == _nodefony ]] && echo REGISTERED`,
        ],
        { env: { ...process.env, HOME: dir } },
      );
      assert.ok(
        r.stdout.toString().includes("REGISTERED"),
        `compdef doit être posé\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
      );
    } finally {
      fsMod.rmSync(dir, { recursive: true, force: true });
    }
    // Timeout large : ce test paie un `zsh -f` + `compinit` RÉELS (~7 s quand la
    // suite complète sature le CPU). Les 5 s par défaut en font un flake de
    // contention, vert en isolation — pas un bug du script généré.
  }, 30_000);

  it("zsh réel : _nodefony transmet les mots APRÈS le binaire (offset :1)", async (ctx) => {
    const { spawnSync } = await import("node:child_process");
    if (spawnSync("command", ["-v", "zsh"], { shell: true }).status !== 0) {
      return ctx.skip();
    }
    const fsMod = await import("node:fs");
    const osMod = await import("node:os");
    const pathMod = await import("node:path");
    const dir = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), "nf-complw-"));
    const script = pathMod.join(dir, "completion.zsh");
    fsMod.writeFileSync(script, renderCompletionScript("zsh"), "utf8");
    // Faux binaire projet : capture ses args (la priorité ./node_modules/.bin joue).
    const binDir = pathMod.join(dir, "node_modules", ".bin");
    fsMod.mkdirSync(binDir, { recursive: true });
    const fakeBin = pathMod.join(binDir, "nodefony");
    fsMod.writeFileSync(fakeBin, `#!/bin/sh\necho "$@" > "${dir}/args.txt"\n`);
    fsMod.chmodSync(fakeBin, 0o755);
    try {
      const harness = `
        compdef() { :; }
        compadd() { :; }
        source ${script}
        words=(nodefony development --)
        _nodefony
      `;
      const r = spawnSync("zsh", ["-fc", harness], {
        cwd: dir,
        env: { ...process.env, HOME: dir },
      });
      assert.strictEqual(r.status, 0, r.stderr.toString());
      const args = fsMod.readFileSync(pathMod.join(dir, "args.txt"), "utf8");
      // La commande tapée DOIT être transmise (bug historique : offset :2 la perdait
      // → __complete répondait des noms de commandes au lieu des options).
      assert.strictEqual(args.trim(), "__complete -- development --");
    } finally {
      fsMod.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  // La syntaxe shell RÉELLE des scripts générés — `zsh -n` / `bash -n` parsent sans
  // exécuter. Skip si le shell n'est pas sur la machine (CI minimaliste).
  for (const sh of ["zsh", "bash"] as const) {
    it(`${sh} -n : le script généré parse sans erreur`, async (ctx) => {
      const { execFileSync, spawnSync } = await import("node:child_process");
      if (spawnSync("command", ["-v", sh], { shell: true }).status !== 0) {
        return ctx.skip();
      }
      const fsMod = await import("node:fs");
      const osMod = await import("node:os");
      const pathMod = await import("node:path");
      const file = pathMod.join(
        osMod.tmpdir(),
        `nodefony-compl-${sh}-${process.pid}.sh`,
      );
      fsMod.writeFileSync(file, renderCompletionScript(sh), "utf8");
      try {
        execFileSync(sh, ["-n", file]); // throw si erreur de syntaxe
      } finally {
        fsMod.rmSync(file, { force: true });
      }
    });
  }

  it("cliManifestFile — cache par projet sous node_modules/.cache/nodefony", () => {
    assert.ok(
      cliManifestFile("/x").endsWith(
        "node_modules/.cache/nodefony/cli-manifest.json",
      ),
    );
  });
});

describe("completion — install/uninstall (HOME jetable, fs réel)", () => {
  function tmpHome(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "nf-compl-home-"));
  }

  it("upsertBlock : idempotent (2 runs = 1 seul bloc) + préserve le rc", () => {
    const rc = "# mon zshrc\nexport FOO=bar\n";
    const once = upsertBlock(rc, "/x/completion.zsh");
    const twice = upsertBlock(once, "/x/completion.zsh");
    assert.strictEqual(once, twice);
    assert.ok(twice.includes("export FOO=bar"));
    assert.strictEqual(
      twice.split("# >>> nodefony completion >>>").length,
      2, // 1 occurrence
    );
  });

  it("removeBlock : retire le bloc, préserve le reste, no-op si absent", () => {
    const rc = "export FOO=bar\n";
    const withBlock = upsertBlock(rc, "/x/completion.zsh");
    const cleaned = removeBlock(withBlock);
    assert.ok(cleaned.includes("export FOO=bar"));
    assert.ok(!cleaned.includes("nodefony completion"));
    assert.strictEqual(removeBlock(rc), rc);
  });

  it("install zsh : script écrit + bloc dans .zshrc (créé) ; uninstall = réversible", () => {
    const home = tmpHome();
    try {
      const { scriptFile, rcFile } = installCompletion("zsh", home);
      assert.ok(fs.existsSync(scriptFile));
      assert.ok(
        fs.readFileSync(scriptFile, "utf8").includes("#compdef nodefony"),
      );
      const rc = fs.readFileSync(rcFile as string, "utf8");
      assert.ok(rc.includes("# >>> nodefony completion >>>"));
      assert.ok(rc.includes(scriptFile));
      // Re-run : idempotent.
      installCompletion("zsh", home);
      assert.strictEqual(
        fs
          .readFileSync(rcFile as string, "utf8")
          .split("# >>> nodefony completion >>>").length,
        2,
      );
      // Uninstall : bloc retiré + script supprimé.
      uninstallCompletion("zsh", home);
      assert.ok(!fs.existsSync(scriptFile));
      assert.ok(
        !fs
          .readFileSync(rcFile as string, "utf8")
          .includes("nodefony completion"),
      );
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("install préserve un .zshrc existant (contenu utilisateur intact)", () => {
    const home = tmpHome();
    try {
      fs.writeFileSync(
        path.join(home, ".zshrc"),
        "# config perso\nalias ll='ls -la'\n",
        "utf8",
      );
      installCompletion("zsh", home);
      const rc = fs.readFileSync(path.join(home, ".zshrc"), "utf8");
      assert.ok(rc.includes("alias ll='ls -la'"));
      assert.ok(rc.includes("# >>> nodefony completion >>>"));
      uninstallCompletion("zsh", home);
      const cleaned = fs.readFileSync(path.join(home, ".zshrc"), "utf8");
      assert.ok(cleaned.includes("alias ll='ls -la'"));
      assert.ok(!cleaned.includes("nodefony completion"));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("install fish : fichier completions/ autoload, AUCUN rc touché", () => {
    const home = tmpHome();
    try {
      const { scriptFile, rcFile } = installCompletion("fish", home);
      assert.strictEqual(rcFile, null);
      assert.ok(scriptFile.endsWith(".config/fish/completions/nodefony.fish"));
      assert.ok(fs.existsSync(scriptFile));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
