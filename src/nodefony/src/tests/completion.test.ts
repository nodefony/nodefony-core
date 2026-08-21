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
  writeCliManifest,
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
    // ⏱️ Ce test SPAWNE un process : le défaut de 5 s de vitest est un budget
    // d'assertion, pas de démarrage. Sous `test:all` (workspaces en parallèle) il
    // est dépassé sans qu'aucun défaut n'existe — vert en isolation, rouge en
    // suite. Le délai n'est pas une mesure ici : rien ne s'évalue en temps.
    it(
      `${sh} -n : le script généré parse sans erreur`,
      { timeout: 60_000 },
      async (ctx) => {
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
      },
    );
  }

  it("cliManifestFile — cache par projet sous node_modules/.cache/nodefony", () => {
    // Chemin qu'on OUVRE : il s'écrit dans la grammaire du système, `\` compris.
    // L'attendu se compose donc comme le code le compose — c'est aussi strict
    // qu'une chaîne en dur, et ça ne ment plus sur une plateforme.
    assert.ok(
      cliManifestFile("/x").endsWith(
        path.join("node_modules", ".cache", "nodefony", "cli-manifest.json"),
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
      assert.ok(
        scriptFile.endsWith(
          path.join(".config", "fish", "completions", "nodefony.fish"),
        ),
      );
      assert.ok(fs.existsSync(scriptFile));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("completion — le manifest s'écrit ATOMIQUEMENT", () => {
  /**
   * Un cache à demi écrit est PIRE qu'un cache absent : il écrase une donnée
   * valide. Vécu, et la cause de trois symptômes qui semblaient sans rapport —
   * le manifest tombait à **0 octet** après une commande courte, si bien que le
   * menu perdait toutes les commandes de module et que la complétion proposait
   * des noms de commandes au lieu des options de celle qu'on avait tapée.
   *
   * `writeFile` OUVRE et TRONQUE avant d'écrire ; appelé en fire-and-forget —
   * c'est le contrat, pour ne rien coûter au boot — il laisse un fichier vide
   * dès que le process sort avant la fin, soit le cas NOMINAL d'une commande
   * CLI. D'où l'écriture par temporaire + `rename`.
   */
  it("🔴 une écriture INTERROMPUE laisse le manifest précédent INTACT", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-manifest-"));
    try {
      const file = cliManifestFile(dir);
      const cli = new CliKernel("development");
      // `buildBuiltinManifest` enregistre les intégrées dans commander — sans
      // cet appel, `cli.commander` ne porte aucune commande et le test
      // écrirait un manifest vide, donc ne prouverait rien.
      cli.buildBuiltinManifest();
      const commander = (cli as unknown as { commander: never }).commander;
      // 1) Un manifest valide, écrit normalement.
      await writeCliManifest(commander, dir, "10.0.0");
      const bon = fs.readFileSync(file, "utf8");
      assert.ok(bon.length > 0, "le premier manifest est vide");
      const commandes = (JSON.parse(bon) as ICliManifest).commands.length;
      assert.ok(commandes > 0);

      // 2) Une écriture qui ÉCHOUE (JSON non sérialisable : référence cyclique
      //    sur le commander). Sans atomicité, le fichier serait déjà tronqué à
      //    zéro à cet instant.
      const casse = { commands: null } as unknown as never;
      await assert.rejects(() => writeCliManifest(casse, dir, "10.0.0"));

      // 3) Le manifest VALIDE est toujours là, entier.
      const apres = fs.readFileSync(file, "utf8");
      assert.strictEqual(apres, bon, "le manifest valide a été abîmé");
      assert.strictEqual(
        (JSON.parse(apres) as ICliManifest).commands.length,
        commandes,
      );

      // 4) Aucun résidu temporaire ne traîne dans le dossier du cache.
      const restes = fs
        .readdirSync(path.dirname(file))
        .filter((f) => f.includes(".tmp"));
      assert.deepStrictEqual(restes, [], `résidus : ${restes.join(", ")}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("🔴 les temporaires ORPHELINS d'un process mort sont balayés", async () => {
    // La suite du correctif précédent, constatée sur le vrai dossier de cache :
    // deux `cli-manifest.json.<pid>.tmp` de 0 octet y traînaient. Le nettoyage
    // n'existait que dans le `catch` — or le cas NOMINAL n'y passe jamais :
    // l'écriture est fire-and-forget, le process sort PENDANT le `writeFile`,
    // le fichier vide est déjà créé et aucun `catch` ne tourne. Un résidu par
    // commande interrompue, dans le `node_modules` de chaque utilisateur.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-manifest-orph-"));
    try {
      const file = cliManifestFile(dir);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // Un PID qui n'existe plus (très au-delà du maximum usuel), et le NÔTRE :
      // seul le premier doit disparaître — supprimer le temporaire d'un process
      // vivant lui arracherait son écriture en cours.
      const mort = `${file}.4194304.tmp`;
      const vivant = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(mort, "");
      fs.writeFileSync(vivant, "");

      const cli = new CliKernel("development");
      cli.buildBuiltinManifest();
      const commander = (cli as unknown as { commander: never }).commander;
      await writeCliManifest(commander, dir, "10.0.0");

      assert.ok(!fs.existsSync(mort), "le temporaire orphelin survit");
      assert.ok(fs.existsSync(file), "le manifest n'a pas été écrit");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
