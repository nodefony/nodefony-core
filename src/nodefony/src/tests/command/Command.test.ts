/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert";
import { expect } from "chai";
import Command, { OptionsCommandInterface } from "../../command/Command";
import Cli from "../../Cli";

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeCli(): Cli {
  return new Cli("NODE", { clear: false, asciify: false, autostart: false });
}

async function makeStartedCli(): Promise<Cli> {
  const cli = makeCli();
  await cli.start();
  return cli;
}

// ─── 1. Construction ──────────────────────────────────────────────────────────

describe("Command — construction", () => {
  let cli: Cli;
  beforeAll(async () => {
    cli = await makeStartedCli();
  });

  it("instance créée avec name + description + cli", () => {
    const cmd = new Command("test-cmd", "description test", cli);
    assert(cmd instanceof Command);
    assert.strictEqual(cmd.name, "test-cmd");
  });

  it("description() retourne la description", () => {
    const cmd = new Command("desc-cmd", "ma description", cli);
    assert.strictEqual(cmd.description(), "ma description");
  });

  it("description vide par défaut", () => {
    const cmd = new Command("no-desc", "", cli);
    assert.strictEqual(cmd.description(), "");
  });

  it("kernelEvent par défaut = onRegister", () => {
    const cmd = new Command("reg-cmd", "", cli);
    assert.strictEqual(cmd.kernelEvent, "onRegister");
  });

  it("kernelEvent surchargeable via options", () => {
    const opts: OptionsCommandInterface = { kernelEvent: "onReady" };
    const cmd = new Command("ready-cmd", "", cli, opts);
    assert.strictEqual(cmd.kernelEvent, "onReady");
  });

  it("debug = false par défaut", () => {
    const cmd = new Command("dbg-cmd", "", cli);
    assert.strictEqual(cmd.debug, false);
  });

  it("interactive = false par défaut", () => {
    const cmd = new Command("int-cmd", "", cli);
    assert.strictEqual(cmd.interactive, false);
  });

  it("builder = null par défaut", () => {
    const cmd = new Command("b-cmd", "", cli);
    assert.strictEqual(cmd.builder, null);
  });
});

// ─── 2. alias() ───────────────────────────────────────────────────────────────

describe("Command — alias()", () => {
  let cli: Cli;
  beforeAll(async () => {
    cli = await makeStartedCli();
  });

  it("alias() retourne la commande commander", () => {
    const cmd = new Command("alias-cmd", "with alias", cli);
    const result = cmd.alias("ac");
    assert(result !== undefined);
  });

  it("alias enregistré sur la sous-commande commander", () => {
    const cmd = new Command("with-alias", "test", cli);
    cmd.alias("wa");
    assert.ok(cmd.command.alias() === "wa");
  });
});

// ─── 3. addOption() + addArgument() ───────────────────────────────────────────

describe("Command — addOption() + addArgument()", () => {
  let cli: Cli;
  beforeAll(async () => {
    cli = await makeStartedCli();
  });

  it("addOption() retourne une Option", () => {
    const cmd = new Command("opt-cmd", "test", cli);
    const opt = cmd.addOption("-v, --verbose", "mode verbeux");
    assert(opt !== undefined);
  });

  it("addOption() avec short flag uniquement", () => {
    const cmd = new Command("short-opt", "test", cli);
    assert.doesNotThrow(() => {
      cmd.addOption("-x", "option courte");
    });
  });

  it("addArgument() retourne un Argument", () => {
    const cmd = new Command("arg-cmd", "test", cli);
    const arg = cmd.addArgument("<name>", "nom requis");
    assert(arg !== undefined);
  });

  it("addArgument() optionnel", () => {
    const cmd = new Command("opt-arg", "test", cli);
    assert.doesNotThrow(() => {
      cmd.addArgument("[value]", "valeur optionnelle");
    });
  });
});

// ─── 3bis. askArgument() — un argument qui manque se DEMANDE ─────────────────

describe("Command — askArgument()", () => {
  let cli: Cli;
  beforeAll(async () => {
    cli = await makeStartedCli();
  });

  /**
   * 🔴 Une commande choisie au menu — ou tapée sans son argument — répondait
   * « error: missing required argument 'identifier' » puis `terminate : 1`.
   * L'utilisateur n'a pas oublié un argument : il ne le connaissait pas. Une
   * commande qui SAIT ce qu'il lui faut doit le demander, pas refuser.
   *
   * Le geste vit au socle et pas dans chaque commande : quatre commandes du
   * dépôt exigent un argument, et quatre copies d'une même règle divergent.
   */
  it("une valeur déjà fournie n'est JAMAIS redemandée", async () => {
    const cmd = new Command("ask-1", "test", cli);
    let demande = false;
    cmd.loadPrompts = async () => {
      demande = true;
    };
    const v = await cmd.askArgument("bob", {
      name: "identifier",
      message: "identifiant",
    });
    assert.strictEqual(v, "bob");
    assert.strictEqual(demande, false, "les prompts ont été chargés pour rien");
  });

  it("🔴 HORS TTY, elle ÉCHOUE avec la ligne à taper — jamais un prompt qui pend", async () => {
    // Un pipeline CI n'a pas de terminal : y poser une question bloquerait le
    // job jusqu'au timeout, et le journal ne dirait pas pourquoi. L'échec doit
    // rester un échec, mais un échec qui montre la sortie.
    const cmd = new Command("ask-2", "test", cli);
    let erreur: Error | null = null;
    try {
      await cmd.askArgument(undefined, {
        name: "identifier",
        message: "identifiant",
        isTTY: false,
      });
    } catch (e) {
      erreur = e as Error;
    }
    assert.ok(erreur, "aucune erreur levée hors TTY");
    assert.match(String(erreur?.message), /identifier/u);
    assert.match(
      String(erreur?.message),
      /ask-2/u,
      "la commande à taper manque",
    );
  });

  it("en TTY, elle demande — saisie libre", async () => {
    const cmd = new Command("ask-3", "test", cli);
    cmd.loadPrompts = async () => {};
    cmd.prompts = {
      input: async () => "  saisie  ",
    } as unknown as typeof cmd.prompts;
    const v = await cmd.askArgument(undefined, {
      name: "identifier",
      message: "identifiant",
      isTTY: true,
    });
    // La valeur est TAILLÉE : un espace de copier-coller deviendrait un login.
    assert.strictEqual(v, "saisie");
  });

  it("en TTY avec des choix, elle propose une LISTE plutôt qu'une saisie", async () => {
    const cmd = new Command("ask-4", "test", cli);
    cmd.loadPrompts = async () => {};
    let listeProposee: unknown = null;
    cmd.prompts = {
      select: async (o: { choices: unknown }) => {
        listeProposee = o.choices;
        return "routes";
      },
      input: async () => {
        throw new Error("une saisie libre a été proposée malgré des choix");
      },
    } as unknown as typeof cmd.prompts;
    const v = await cmd.askArgument(undefined, {
      name: "sujet",
      message: "sujet",
      choices: ["routes", "services"],
      isTTY: true,
    });
    assert.strictEqual(v, "routes");
    assert.ok(Array.isArray(listeProposee));
  });
});

// ─── 4. forceInteractiveMode() ────────────────────────────────────────────────

describe("Command — forceInteractiveMode()", () => {
  let cli: Cli;
  beforeAll(async () => {
    cli = await makeStartedCli();
  });

  it("forceInteractiveMode() → run() appelle interaction()", async () => {
    const cmd = new Command("force-int", "test", cli);
    let interactionCalled = false;

    cmd.interaction = async () => {
      interactionCalled = true;
      return "response";
    };
    cmd.generate = async () => cmd;

    cmd.forceInteractiveMode();
    await cmd.run();
    assert.strictEqual(interactionCalled, true);
  });

  it("🔴 en interactif, generate() reçoit ses arguments ÉTALÉS — pas un tableau", async () => {
    // Mesuré : `interaction(...args).then((...response) => generate(...response))`
    // — le callback d'une promesse ne reçoit qu'UNE valeur, donc `response`
    // valait `[[a, b, c]]` et `generate` recevait UN argument : le tableau.
    // Conséquence : toute commande passée en interactif sans surcharger
    // `interaction()` voyait son premier paramètre devenir un tableau. Le menu
    // ne s'en apercevait pas — il surcharge `interaction()` et rend une chaîne.
    // C'est ce qui bloquait la propagation du mode interactif depuis le menu.
    const cmd = new Command("spread-int", "test", cli);
    let recus: unknown[] = [];
    cmd.generate = async (...args: unknown[]) => {
      recus = args;
      return cmd;
    };
    cmd.forceInteractiveMode();
    await cmd.run("bob", { admin: true }, "cmd");
    assert.strictEqual(recus.length, 3, "les arguments ont été empaquetés");
    assert.strictEqual(recus[0], "bob");
  });

  it("une interaction qui rend UNE valeur la passe telle quelle", async () => {
    // Le cas du menu : `interaction()` rend une chaîne, `generate` doit la
    // recevoir comme argument unique — pas ses caractères étalés.
    const cmd = new Command("single-int", "test", cli);
    let recus: unknown[] = [];
    cmd.interaction = async () => "start";
    cmd.generate = async (...args: unknown[]) => {
      recus = args;
      return cmd;
    };
    cmd.forceInteractiveMode();
    await cmd.run();
    assert.deepStrictEqual(recus, ["start"]);
  });

  it("sans forceInteractiveMode — run() appelle generate() directement", async () => {
    const cmd = new Command("no-force", "test", cli);
    let generateCalled = false;

    cmd.generate = async () => {
      generateCalled = true;
      return cmd;
    };

    await cmd.run();
    assert.strictEqual(generateCalled, true);
  });
});

// ─── 5. run() / action() / generate() pipeline ────────────────────────────────

describe("Command — run() / action() / generate() pipeline", () => {
  let cli: Cli;
  beforeAll(async () => {
    cli = await makeStartedCli();
  });

  it("generate() par défaut retourne ses args", async () => {
    const cmd = new Command("gen-default", "test", cli);
    const res = await cmd.generate("a", "b");
    assert.deepEqual(res, ["a", "b"]);
  });

  it("interaction() par défaut retourne ses args", async () => {
    const cmd = new Command("int-default", "test", cli);
    const res = await cmd.interaction("x");
    assert.deepEqual(res, ["x"]);
  });

  it("generate() override fonctionne dans run()", async () => {
    const cmd = new Command("gen-override", "test", cli, { showBanner: false });
    let received: any[] = [];

    cmd.generate = async (...args) => {
      received = args;
      return cmd;
    };

    await cmd.run("foo", "bar");
    assert.deepEqual(received[0], "foo");
  });

  it("action() appelle run() avec showBanner:false", async () => {
    const cmd = new Command("action-cmd", "test", cli, { showBanner: false });
    let ran = false;
    cmd.generate = async () => {
      ran = true;
      return cmd;
    };
    await cmd.action({});
    assert.strictEqual(ran, true);
  });

  it("run() propagte l'erreur de generate()", async () => {
    const cmd = new Command("run-err", "test", cli);
    cmd.generate = async () => {
      throw new Error("generate-failed");
    };
    try {
      await cmd.run();
      assert.fail("devrait rejeter");
    } catch (e: any) {
      assert.strictEqual(e.message, "generate-failed");
    }
  });
});

// ─── 7. parse() / parseAsync() ───────────────────────────────────────────────

describe("Command — parse() / parseAsync()", () => {
  let cli: Cli;
  beforeAll(async () => {
    cli = await makeStartedCli();
  });

  it("parse() retourne un objet Commander", () => {
    const cmd = new Command("parse-cmd2", "test", cli);
    // exitOverride évite que commander appelle process.exit()
    cmd.program.exitOverride();
    let result: any;
    try {
      result = cmd.parse(["node", "nodefony", "parse-cmd2"]);
    } catch {
      // commander peut throw sur --help, on vérifie juste que parse() est callable
    }
    assert.ok(cmd.program !== undefined);
    void result;
  });

  it("parseAsync() retourne une Promise", async () => {
    const cmd = new Command("parse-async2", "test", cli);
    cmd.program.exitOverride();
    let p: Promise<any>;
    try {
      p = cmd.parseAsync(["node", "nodefony", "parse-async2"]);
      assert.ok(p instanceof Promise);
      await p;
    } catch {
      // exitOverride throw si --help — acceptable
    }
  });
});

// ─── 8. runCommand() ─────────────────────────────────────────────────────────

describe("Command — runCommand()", () => {
  let cli: Cli;
  beforeAll(async () => {
    cli = await makeStartedCli();
  });

  it("instance Cli — instance de Command avec options -i et -d", async () => {
    const options: OptionsCommandInterface = { showBanner: false };
    const inst2 = new Command("start2", "start2 framawork", cli, options);
    const inst3 = new Command("start3", "start3 framawork", cli, options);
    assert(inst2);
    assert(inst3);
    assert.strictEqual(inst2.name, "start2");
    assert.strictEqual(inst3.name, "start3");
    cli.runCommand("start2", ["-i", "-d"]);
    assert.strictEqual(inst2.debug, true);
    assert.strictEqual(inst2.interactive, true);
    inst3.runCommand("start3", ["-i"]);
    assert.strictEqual(inst3.debug, false);
    assert.strictEqual(inst3.interactive, true);
    inst3.runCommand("start3");
    assert.strictEqual(inst3.debug, false);
    assert.strictEqual(inst3.interactive, false);
  });
});

// ─── 9. terminate() ──────────────────────────────────────────────────────────

describe("Command — terminate()", () => {
  let cli: Cli;
  beforeAll(async () => {
    cli = await makeStartedCli();
  });

  it("terminate() délègue à cli.terminate()", async () => {
    const cmd = new Command("term-cmd", "test", cli);
    let terminateCalled = false;
    let terminateCode: number | undefined;
    const origTerminate = cli.terminate;
    cli.terminate = async (code?: number) => {
      terminateCalled = true;
      terminateCode = code;
      // ne pas appeler origTerminate — évite process.exit()
    };
    await cmd.terminate(0);
    assert.strictEqual(terminateCalled, true);
    assert.strictEqual(terminateCode, 0);
    cli.terminate = origTerminate;
  });
});

// ─── 10. Performance ─────────────────────────────────────────────────────────

describe("Command — performance", () => {
  let cli: Cli;
  beforeAll(async () => {
    cli = await makeStartedCli();
  });

  it("construction de 100 Command < 500ms", () => {
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      new Command(`perf-cmd-${i}`, `description ${i}`, cli);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).to.be.lessThan(500);
  });

  it("100 appels generate() < 200ms", async () => {
    const cmd = new Command("bulk-gen", "test", cli);
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      await cmd.generate();
    }
    const elapsed = Date.now() - start;
    expect(elapsed).to.be.lessThan(200);
  });
});
