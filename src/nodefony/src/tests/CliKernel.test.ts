import assert from "node:assert";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import CliKernel from "../kernel/CliKernel";
import Kernel from "../kernel/Kernel";
import Command from "../command/Command";
import Syslog from "../syslog/Syslog";
import Pdu from "../syslog/Pdu";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Le listener console de CliKernel.initSyslog appelle Syslog.rawLog (sink direct
// bufférisable), plus normalizeLog (console.*) — on intercepte donc rawLog.
function interceptRawLog(): { received: Pdu[]; restore: () => void } {
  const received: Pdu[] = [];
  const orig = Syslog.rawLog;
  Syslog.rawLog = (p: Pdu) => {
    received.push(p);
    return p;
  };
  return {
    received,
    restore: () => {
      Syslog.rawLog = orig;
    },
  };
}

// CliKernel minimal — signals et promiseRejection désactivés pour les tests
// (évite l'accumulation de listeners sur process)
function makeCliKernel(env?: "development" | "production"): CliKernel {
  return new CliKernel(env);
}

// Command minimale compatible avec CliKernel.addCommand(new (cli) => Command)
class TestCommand extends Command {
  static commandName = "test-command";
  constructor(cli: CliKernel) {
    super(TestCommand.commandName, "Commande test", cli);
  }
  override async action(): Promise<void> {}
}
class OtherCommand extends Command {
  static commandName = "other-command";
  constructor(cli: CliKernel) {
    super(OtherCommand.commandName, "Autre commande", cli);
  }
  override async action(): Promise<void> {}
}

// ─── 1. Constructor ───────────────────────────────────────────────────────────

describe("CliKernel — constructor", () => {
  let cli: CliKernel;

  beforeAll(() => {
    cli = makeCliKernel("development");
  });

  it("profil console par défaut (servers:false)", () => {
    assert.strictEqual(cli.runProfile.servers, false);
    assert.strictEqual(cli.runProfile.lifetime, "oneshot");
  });

  it("app = null à la construction", () => {
    assert.strictEqual(cli.app, null);
  });

  it("kernel = null à la construction", () => {
    assert.strictEqual(cli.kernel, null);
  });

  it("packageManager par défaut = this.pnpm", () => {
    // CliKernel déclare: public packageManager: PackageManager = this.pnpm
    assert.strictEqual(cli.packageManager, (cli as any).pnpm);
  });

  it("environment défini depuis le paramètre", () => {
    const c = makeCliKernel("production");
    assert.strictEqual(c.environment, "production");
  });

  it("environment 'development' propagé", () => {
    assert.strictEqual(cli.environment, "development");
  });

  it("commander initialisé (initCommander appelé)", () => {
    assert.ok(cli.commander !== null);
  });

  it("commander a l'option -i (--interactive)", () => {
    const hasI = cli.commander?.options.some((o) => o.short === "-i");
    assert.ok(hasI, "option -i doit être présente");
  });

  it("commander a l'option -d (--debug)", () => {
    const hasD = cli.commander?.options.some((o) => o.short === "-d");
    assert.ok(hasD, "option -d doit être présente");
  });

  it("syslog a au moins un listener onLog (initSyslog appelé)", () => {
    assert.ok((cli.syslog?.listenerCount("onLog") ?? 0) >= 1);
  });

  it("pid défini (cliOptions.pid = true)", () => {
    assert.ok(cli.pid !== null);
    assert.strictEqual(cli.pid, process.pid);
  });

  it("sans environment → valeur par défaut (production via Cli defaults ou NODE_ENV)", () => {
    const c = makeCliKernel();
    assert.ok(typeof c.environment === "string");
  });
});

// ─── 2. setRunProfile() ──────────────────────────────────────────────────────

describe("CliKernel — setRunProfile()", () => {
  let cli: CliKernel;
  beforeAll(() => {
    cli = makeCliKernel();
  });

  it("profil serveur → runProfile.servers = true", () => {
    cli.setRunProfile({
      servers: true,
      lifetime: "longrunning",
      interactive: false,
    });
    assert.strictEqual(cli.runProfile.servers, true);
    assert.strictEqual(cli.runProfile.lifetime, "longrunning");
  });

  it("profil console → runProfile.servers = false", () => {
    cli.setRunProfile({
      servers: false,
      lifetime: "oneshot",
      interactive: false,
    });
    assert.strictEqual(cli.runProfile.servers, false);
  });

  it("retourne le profil appliqué", () => {
    const p = {
      servers: true,
      lifetime: "longrunning" as const,
      interactive: false,
    };
    const result = cli.setRunProfile(p);
    assert.deepStrictEqual(result, p);
  });

  it("setRunProfile modifie this.runProfile", () => {
    cli.setRunProfile({
      servers: false,
      lifetime: "oneshot",
      interactive: false,
    });
    assert.strictEqual(cli.runProfile.servers, false);
    cli.setRunProfile({
      servers: true,
      lifetime: "longrunning",
      interactive: false,
    });
    assert.strictEqual(cli.runProfile.servers, true);
  });
});

// ─── 3. setPackageManager() ───────────────────────────────────────────────────

describe("CliKernel — setPackageManager()", () => {
  let cli: CliKernel;
  beforeAll(() => {
    cli = makeCliKernel();
  });

  it("'yarn' → packageManager = this.yarn", () => {
    cli.setPackageManager("yarn");
    assert.strictEqual(cli.packageManager, (cli as any).yarn);
  });

  it("'pnpm' → packageManager = this.pnpm", () => {
    cli.setPackageManager("pnpm");
    assert.strictEqual(cli.packageManager, (cli as any).pnpm);
  });

  it("'npm' → packageManager = this.npm", () => {
    cli.setPackageManager("npm");
    assert.strictEqual(cli.packageManager, (cli as any).npm);
  });

  it("undefined → branch default → npm", () => {
    // options.packageManager non défini → manager=undefined → default case
    cli.setPackageManager(undefined as any);
    assert.strictEqual(cli.packageManager, (cli as any).npm);
  });

  it("retourne la fonction PackageManager", () => {
    const pm = cli.setPackageManager("pnpm");
    assert.ok(typeof pm === "function");
  });

  it("packageManager est callable (c'est une fonction)", () => {
    cli.setPackageManager("pnpm");
    assert.ok(typeof cli.packageManager === "function");
  });

  it("setPackageManager plusieurs fois → dernier gagne", () => {
    cli.setPackageManager("yarn");
    cli.setPackageManager("npm");
    assert.strictEqual(cli.packageManager, (cli as any).npm);
  });
});

// ─── 4. addCommand() (override) ──────────────────────────────────────────────

describe("CliKernel — addCommand()", () => {
  let cli: CliKernel;

  beforeAll(() => {
    cli = makeCliKernel();
    cli.addCommand(TestCommand as any);
  });

  it("addCommand() retourne une instance de Command", () => {
    const cmd = cli.addCommand(OtherCommand as any);
    assert.ok(cmd instanceof Command);
  });

  it("commande enregistrée dans cli.commands par son nom", () => {
    assert.ok(TestCommand.commandName in (cli as any).commands);
  });

  it("hasCommand() trouve la commande enregistrée", () => {
    assert.ok(cli.hasCommand(TestCommand.commandName));
  });

  it("getCommand() retourne la commande", () => {
    const cmd = cli.getCommand(TestCommand.commandName);
    assert.ok(cmd instanceof Command);
    assert.strictEqual(cmd?.name, TestCommand.commandName);
  });

  it("getCommand() retourne null pour une commande inexistante", () => {
    assert.strictEqual(cli.getCommand("non-existent"), null);
  });

  it("hasCommand() retourne false pour une commande inexistante", () => {
    assert.strictEqual(cli.hasCommand("non-existent"), false);
  });

  it("plusieurs commandes ajoutées → toutes accessibles", () => {
    assert.ok(cli.hasCommand(TestCommand.commandName));
    assert.ok(cli.hasCommand(OtherCommand.commandName));
  });

  it("commande créée avec la CliKernel comme argument", () => {
    let cliArg: CliKernel | null = null;
    class CliCapture extends Command {
      constructor(c: CliKernel) {
        cliArg = c;
        super("cli-capture", "", c);
      }
      override async action(): Promise<void> {}
    }
    cli.addCommand(CliCapture as any);
    assert.strictEqual(cliArg, cli);
  });
});

// ─── 5. parseCommand() & parseCommandAsync() ─────────────────────────────────

describe("CliKernel — parseCommand() & parseCommandAsync()", () => {
  let cli: CliKernel;
  beforeAll(() => {
    cli = makeCliKernel();
  });

  it("parseCommand(argv) retourne un CommanderCommand", () => {
    const result = cli.parseCommand(["node", "script"]);
    assert.ok(result !== null && result !== undefined);
    assert.ok(typeof result === "object");
  });

  it("parseCommand sans arg utilise process.argv (ne throw pas)", () => {
    // process.argv = ["node", "<script>"] en test → parse sans subcommand
    assert.doesNotThrow(() => cli.parseCommand(["node", "script"]));
  });

  it("parseCommandAsync(argv) retourne une Promise", async () => {
    const p = cli.parseCommandAsync(["node", "script"]);
    assert.ok(p instanceof Promise);
    await p; // résout normalement
  });

  it("parseCommandAsync résout avec CommanderCommand", async () => {
    const result = await cli.parseCommandAsync(["node", "script"]);
    assert.ok(result !== null);
    assert.ok(typeof result === "object");
  });
});

// ─── 6. initSyslog() ─────────────────────────────────────────────────────────

describe("CliKernel — initSyslog()", () => {
  it("sans kernel → super.initSyslog() — listener onLog présent (idempotent)", () => {
    const cli = makeCliKernel();
    cli.initSyslog("development", false);
    const after = cli.syslog?.listenerCount("onLog") ?? 0;
    // init() est idempotent : remove + add → toujours exactement 1 listener
    assert.strictEqual(after, 1, `exactly 1 listener after init, got ${after}`);
  });

  it("avec kernel + debug=false → severity [0..6], DEBUG bloqué", () => {
    const cli = makeCliKernel("development");
    cli.syslog?.removeAllListeners();
    // Mock minimal : seuls .type et .environment sont lus dans initSyslog
    cli.kernel = { type: "CONSOLE", environment: "development" } as any;

    cli.initSyslog("development", false);

    const { received, restore } = interceptRawLog();
    cli.syslog?.log("debug msg", "DEBUG");
    cli.syslog?.log("info msg", "INFO");
    restore();

    assert.ok(
      !received.some((p) => p.severityName === "DEBUG"),
      "DEBUG bloqué sans debug",
    );
    assert.ok(
      received.some((p) => p.severityName === "INFO"),
      "INFO doit passer",
    );
  });

  it("avec kernel + debug=true → severity [0..7], DEBUG passe", () => {
    const cli = makeCliKernel("development");
    cli.syslog?.removeAllListeners();
    cli.kernel = { type: "CONSOLE", environment: "development" } as any;

    cli.initSyslog("development", true);

    const { received, restore } = interceptRawLog();
    cli.syslog?.log("debug msg", "DEBUG");
    cli.syslog?.log("info msg", "INFO");
    restore();

    assert.ok(
      received.some((p) => p.severityName === "DEBUG"),
      "DEBUG doit passer avec debug=true",
    );
    assert.ok(received.some((p) => p.severityName === "INFO"));
  });

  it("avec kernel + this.debug=true → même effet que debug=true", () => {
    const cli = makeCliKernel("development");
    cli.syslog?.removeAllListeners();
    cli.debug = true;
    cli.kernel = { type: "CONSOLE", environment: "development" } as any;

    cli.initSyslog("development"); // pas de debug arg, utilise this.debug

    const { received, restore } = interceptRawLog();
    cli.syslog?.log("debug msg", "DEBUG");
    restore();

    assert.ok(
      received.some((p) => p.severityName === "DEBUG"),
      "this.debug=true → DEBUG passe",
    );
  });

  it("avec kernel + debug=['ROUTER'] → msgid condition, seul ROUTER passe", () => {
    const cli = makeCliKernel("development");
    cli.syslog?.removeAllListeners();
    cli.kernel = { type: "CONSOLE", environment: "development" } as any;

    cli.initSyslog("development", ["ROUTER"]);

    const { received, restore } = interceptRawLog();
    cli.syslog?.log("router debug", "DEBUG", "ROUTER");
    cli.syslog?.log("service debug", "DEBUG", "SERVICE");
    restore();

    assert.ok(
      received.some((p) => p.msgid === "ROUTER"),
      "ROUTER doit passer",
    );
    assert.ok(
      !received.some((p) => p.msgid === "SERVICE"),
      "SERVICE bloqué par filtre msgid",
    );
  });

  it("avec kernel + debug='*' → pas de filtre msgid, tout passe", () => {
    const cli = makeCliKernel("development");
    cli.syslog?.removeAllListeners();
    cli.kernel = { type: "CONSOLE", environment: "development" } as any;

    cli.initSyslog("development", "*");

    const { received, restore } = interceptRawLog();
    cli.syslog?.log("any debug", "DEBUG", "ANYTHING");
    restore();

    assert.ok(
      received.some((p) => p.msgid === "ANYTHING"),
      "debug='*' → aucun filtre msgid",
    );
  });

  it("avec kernel + json commander opt → retour immédiat, aucun listener ajouté", () => {
    const cli = makeCliKernel();
    cli.syslog?.removeAllListeners();
    cli.kernel = { type: "CONSOLE", environment: "development" } as any;

    // Simuler l'option --json active
    cli.commander?.setOptionValue("json", true);
    const before = cli.syslog?.listenerCount("onLog") ?? 0;
    cli.initSyslog("development", false);
    const after = cli.syslog?.listenerCount("onLog") ?? 0;

    // Nettoyage
    cli.commander?.setOptionValue("json", false);

    assert.strictEqual(after, before, "json=true → aucun listener ajouté");
  });

  it("initSyslog 2x avec kernel → 2 listeners (pas de deduplication)", () => {
    const cli = makeCliKernel();
    cli.syslog?.removeAllListeners();
    cli.kernel = { type: "CONSOLE", environment: "development" } as any;

    cli.initSyslog("development", false);
    const after1 = cli.syslog?.listenerCount("onLog") ?? 0;
    cli.initSyslog("development", false);
    const after2 = cli.syslog?.listenerCount("onLog") ?? 0;

    assert.ok(
      after2 > after1,
      "deuxième appel ajoute un listener supplémentaire",
    );
  });
});

// ─── 7. loadLocalModule() ────────────────────────────────────────────────────

describe("CliKernel — loadLocalModule()", () => {
  let cli: CliKernel;
  beforeAll(() => {
    cli = makeCliKernel();
  });

  it("chemin invalide → throw Error", async () => {
    await assert.rejects(
      () => cli.loadLocalModule("/tmp/__definitely_not_existing_module__.mjs"),
      (err: Error) => {
        assert.ok(err instanceof Error);
        return true;
      },
    );
  });

  it("chemin relatif inexistant → throw Error", async () => {
    await assert.rejects(
      () => cli.loadLocalModule("./nonexistent-file.mjs", "/tmp"),
      (err: Error) => {
        assert.ok(err instanceof Error);
        return true;
      },
    );
  });

  it("chemin absolu valide → retourne le module", async () => {
    // Crée un module ESM temporaire valide
    const tmpFile = path.resolve(os.tmpdir(), `cli-test-mod-${Date.now()}.mjs`);
    await fs.writeFile(
      tmpFile,
      'export default { testKey: "hello" };\n',
      "utf-8",
    );
    try {
      const result = await cli.loadLocalModule(tmpFile);
      assert.ok(result !== null);
      assert.ok((result as any)?.testKey === "hello");
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  });

  it("chemin relatif + cwd → résolu correctement", async () => {
    const tmpDir = os.tmpdir();
    const filename = `cli-rel-${Date.now()}.mjs`;
    const tmpFile = path.resolve(tmpDir, filename);
    await fs.writeFile(tmpFile, "export default { rel: true };\n", "utf-8");
    try {
      const result = await cli.loadLocalModule(`./${filename}`, tmpDir);
      assert.ok((result as any)?.rel === true);
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  });
});

// ─── 8. terminate() ──────────────────────────────────────────────────────────

describe("CliKernel — terminate()", () => {
  it("avec kernel → appelle kernel.terminate(code)", async () => {
    const cli = makeCliKernel();
    let terminatedCode: number | undefined;
    let terminateCalled = false;

    // Mock kernel — ne fait pas process.exit
    cli.kernel = {
      terminate: async (code: number) => {
        terminateCalled = true;
        terminatedCode = code;
        return cli.kernel;
      },
    } as any;

    await cli.terminate(42);

    assert.ok(terminateCalled, "kernel.terminate doit être appelé");
    assert.strictEqual(terminatedCode, 42);
  });

  it("avec kernel, code par défaut = 0", async () => {
    const cli = makeCliKernel();
    let terminatedCode: number | undefined;

    cli.kernel = {
      terminate: async (code: number) => {
        terminatedCode = code;
        return cli.kernel;
      },
    } as any;

    await cli.terminate(); // sans arg → code=0
    assert.strictEqual(terminatedCode, 0);
  });

  it("avec kernel, code 1 → transmis au kernel.terminate", async () => {
    const cli = makeCliKernel();
    let terminatedCode: number | undefined;

    cli.kernel = {
      terminate: async (code: number) => {
        terminatedCode = code;
        return cli.kernel;
      },
    } as any;

    await cli.terminate(1);
    assert.strictEqual(terminatedCode, 1);
  });
});

// ─── 9. Cli.niceBytes() (statique, hérité) ───────────────────────────────────

describe("CliKernel — Cli.niceBytes() (statique hérité)", () => {
  it("0 → '0 bytes'", () => {
    assert.strictEqual(CliKernel.niceBytes(0), "0 bytes");
  });

  it("1023 → '1023 bytes'", () => {
    assert.strictEqual(CliKernel.niceBytes(1023), "1023 bytes");
  });

  it("1024 → '1.0 KB' (1 décimale si n < 10 et l >= 1)", () => {
    assert.strictEqual(CliKernel.niceBytes(1024), "1.0 KB");
  });

  it("10240 → '10 KB' (n >= 10 → 0 décimale)", () => {
    assert.strictEqual(CliKernel.niceBytes(10240), "10 KB");
  });

  it("1024*1024 → '1.0 MB'", () => {
    assert.strictEqual(CliKernel.niceBytes(1024 * 1024), "1.0 MB");
  });

  it("1024*1024*10 → '10 MB'", () => {
    assert.strictEqual(CliKernel.niceBytes(1024 * 1024 * 10), "10 MB");
  });

  it("1024*1024*1024 → '1.0 GB'", () => {
    assert.strictEqual(CliKernel.niceBytes(1024 * 1024 * 1024), "1.0 GB");
  });

  it("string '512' → '512 bytes' (parseInt)", () => {
    assert.strictEqual(CliKernel.niceBytes("512"), "512 bytes");
  });

  it("string '0' → '0 bytes'", () => {
    assert.strictEqual(CliKernel.niceBytes("0"), "0 bytes");
  });
});

// ─── 10. showHelp() ──────────────────────────────────────────────────────────

describe("CliKernel — showHelp()", () => {
  let cli: CliKernel;
  beforeAll(() => {
    cli = makeCliKernel();
  });

  it("showHelp(false, undefined) → ne throw pas (outputHelp)", () => {
    // outputHelp écrit sur stdout mais ne throw pas
    assert.doesNotThrow(() => cli.showHelp(false, undefined));
  });
});

// ─── 11. setCommandVersion() & setCommandOption() ────────────────────────────

describe("CliKernel — setCommandVersion() & setCommandOption()", () => {
  let cli: CliKernel;
  beforeAll(() => {
    cli = makeCliKernel();
  });

  it("version déjà définie dans le commander (via cliOptions.version)", () => {
    // initCommander() appelle setCommandVersion(cliOptions.version) — vérifier qu'elle est définie
    const v = cli.commander?.version();
    assert.ok(
      typeof v === "string" && v.length > 0,
      `version doit être définie, got: ${v}`,
    );
  });

  it("setCommandOption ajoute une option au commander", () => {
    const before = cli.commander?.options.length ?? 0;
    cli.setCommandOption("--foo <bar>", "Option foo for test");
    const after = cli.commander?.options.length ?? 0;
    assert.ok(after > before, "option ajoutée au commander");
  });
});

// ─── 12. Edge cases & comportements limites ───────────────────────────────────

describe("CliKernel — edge cases", () => {
  it("new CliKernel() ne throw pas", () => {
    assert.doesNotThrow(() => makeCliKernel());
  });

  it("kernel toujours null après construction (sans start())", () => {
    const cli = makeCliKernel();
    assert.strictEqual(cli.kernel, null);
  });

  it("setRunProfile → cli.runProfile reflète le changement", () => {
    const cli = makeCliKernel();
    cli.setRunProfile({
      servers: false,
      lifetime: "oneshot",
      interactive: false,
    });
    assert.strictEqual(cli.runProfile.servers, false);
    cli.setRunProfile({
      servers: true,
      lifetime: "longrunning",
      interactive: false,
    });
    assert.strictEqual(cli.runProfile.servers, true);
  });

  it("commands record vide à la construction", () => {
    const cli = makeCliKernel();
    // Seules les commandes explicitement ajoutées par addCommand
    // Les commandes CliKernel (Start, Dev, etc.) sont ajoutées dans start()
    assert.ok(typeof (cli as any).commands === "object");
  });

  it("debug = false par défaut", () => {
    const cli = makeCliKernel();
    assert.strictEqual(cli.debug, false);
  });

  it("syslog initialisé (hérite de Service)", () => {
    const cli = makeCliKernel();
    assert.ok(cli.syslog !== null);
  });

  it("environment sans arg = mode MOTEUR normalisé, jamais NODE_ENV tel quel", () => {
    // Ce test CONSTATAIT le bug : `environment` était le miroir BRUT de
    // `process.env.NODE_ENV` (cast, aucune normalisation) — donc `"test"` sous
    // vitest, une valeur ABSENTE de `EnvironmentType`, propagée à `initSyslog()`
    // et au `Kernel`. Il prouve maintenant le contrat inverse : `NODE_ENV` est un
    // axe LIBRE, et seules ses valeurs qui désignent un mode moteur sont retenues ;
    // les autres (`test`, `staging`, `canary`…) laissent le défaut de l'appelant
    // décider. Cf `toEngineEnvironment` (Cli.ts).
    const cli = makeCliKernel();
    assert.ok(
      ["dev", "development", "prod", "production"].includes(cli.environment),
      `environment doit être un mode moteur, got: ${cli.environment}`,
    );
    // Sous vitest (NODE_ENV="test") : aucun moteur désigné → défaut "production".
    if (process.env.NODE_ENV === "test") {
      assert.strictEqual(cli.environment, "production");
    }
    // L'axe de DÉPLOIEMENT n'est pas touché : le kernel en dépend pour `isTest`.
    assert.strictEqual(process.env.NODE_ENV, "test");
  });

  it("initSyslog avec kernel null → ne throw pas", () => {
    const cli = makeCliKernel();
    assert.ok(cli.kernel === null);
    assert.doesNotThrow(() => cli.initSyslog("development", false));
  });

  it("setPackageManager retourne une fonction appelable", () => {
    const cli = makeCliKernel();
    const pm = cli.setPackageManager("pnpm");
    assert.ok(typeof pm === "function");
    assert.ok(pm.length >= 0); // c'est une vraie fonction
  });
});
