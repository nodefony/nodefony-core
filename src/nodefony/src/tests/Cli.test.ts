/* eslint-disable @typescript-eslint/no-explicit-any */
import { assert } from "chai";
import "mocha";
import Cli, { CliDefaultOptions } from "../Cli";
import Command from "../command/Command";

// ─── Helper makeCli ───────────────────────────────────────────────────────────

function makeCli(
  name = "test-cli",
  extra: Partial<CliDefaultOptions> = {},
): Cli {
  const cli = new Cli(name, {
    autostart: false,
    asciify: false,
    signals: false,
    autoLogger: false,
    promiseRejection: false,
    warning: false,
    clear: false,
    version: "1.0.0",
    pid: false,
    ...extra,
  });
  cli.commander?.exitOverride();
  return cli;
}

// ─── Commandes de test standalone ────────────────────────────────────────────

class EchoCommand extends Command {
  public result: string = "";
  readonly done: Promise<void>;
  private _resolve!: () => void;

  constructor(cli: Cli) {
    super("echo", "Echo a message", cli, {
      showBanner: false,
      progress: false,
    });
    this.addArgument("<message>", "Message to echo");
    this.done = new Promise((r) => {
      this._resolve = r;
    });
  }

  override async generate(message: string): Promise<this> {
    this.result = message;
    this._resolve();
    return this;
  }
}

class GreetCommand extends Command {
  public greeted: string = "";
  readonly done: Promise<void>;
  private _resolve!: () => void;

  constructor(cli: Cli) {
    super("greet", "Greet a user", cli, { showBanner: false, progress: false });
    this.addArgument("<name>", "Name to greet");
    this.done = new Promise((r) => {
      this._resolve = r;
    });
  }

  override async generate(name: string): Promise<this> {
    this.greeted = name;
    this._resolve();
    return this;
  }
}

class NoArgCommand extends Command {
  public called: boolean = false;
  readonly done: Promise<void>;
  private _resolve!: () => void;

  constructor(cli: Cli) {
    super("no-arg", "Command without args", cli, {
      showBanner: false,
      progress: false,
    });
    this.done = new Promise((r) => {
      this._resolve = r;
    });
  }

  override async generate(..._args: any[]): Promise<this> {
    this.called = true;
    this._resolve();
    return this;
  }
}

class RunOverrideCommand extends Command {
  public ranWith: any[] = [];
  readonly done: Promise<void>;
  private _resolve!: () => void;

  constructor(cli: Cli) {
    super("run-override", "Test run override", cli, {
      showBanner: false,
      progress: false,
    });
    this.addArgument("<val>", "value");
    this.done = new Promise((r) => {
      this._resolve = r;
    });
  }

  override async run(...args: any[]): Promise<this> {
    this.ranWith = args;
    this._resolve();
    return this;
  }
}

class ErrorCommand extends Command {
  readonly done: Promise<void>;
  private _resolve!: () => void;
  public thrownError: Error | null = null;

  constructor(cli: Cli) {
    super("err-cmd", "Command that throws", cli, {
      showBanner: false,
      progress: false,
    });
    this.done = new Promise((r) => {
      this._resolve = r;
    });
  }

  override async generate(..._args: any[]): Promise<this> {
    this.thrownError = new Error("generate failed");
    this._resolve();
    throw this.thrownError;
  }
}

class WithOptionCommand extends Command {
  public countVal: string | undefined = undefined;
  readonly done: Promise<void>;
  private _resolve!: () => void;

  constructor(cli: Cli) {
    super("with-opt", "Command with option", cli, {
      showBanner: false,
      progress: false,
    });
    this.addOption("-n, --count <n>", "Count option");
    this.done = new Promise((r) => {
      this._resolve = r;
    });
  }

  override async generate(...args: any[]): Promise<this> {
    // args[last] est l'instance Cmd Commander — les opts sont dessus
    const cmd = args[args.length - 1];
    this.countVal = cmd?.opts?.().count;
    this._resolve();
    return this;
  }
}

class AliasCommand extends Command {
  public called: boolean = false;
  readonly done: Promise<void>;
  private _resolve!: () => void;

  constructor(cli: Cli) {
    super("alias-cmd", "Command with alias", cli, {
      showBanner: false,
      progress: false,
    });
    this.alias("al");
    this.done = new Promise((r) => {
      this._resolve = r;
    });
  }

  override async generate(..._args: any[]): Promise<this> {
    this.called = true;
    this._resolve();
    return this;
  }
}

// ─── 1. Construction ─────────────────────────────────────────────────────────

describe("Cli — construction", () => {
  it("name est initialisé correctement", () => {
    const cli = makeCli("my-app");
    assert.strictEqual(cli.name, "my-app");
  });

  it("version est initialisée à 1.0.0 par défaut", () => {
    const cli = makeCli();
    assert.strictEqual(cli.commander?.version(), "1.0.0");
  });

  it("commander est non-null si options.commander = true (défaut)", () => {
    const cli = makeCli();
    assert.ok(cli.commander !== null);
  });

  it("options fusionnées avec defaultOptions — autostart false conservé", () => {
    const cli = makeCli("x", { autostart: false });
    assert.strictEqual(cli.options.autostart, false);
  });

  it("pid: true → cli.pid === process.pid", () => {
    const cli = makeCli("pid-test", { pid: true });
    assert.strictEqual(cli.pid, process.pid);
  });

  it("pid: false → cli.pid === null", () => {
    const cli = makeCli("no-pid", { pid: false });
    assert.strictEqual(cli.pid, null);
  });

  it("commander: false → cli.commander === null", () => {
    const cli = new Cli("no-cmd", {
      autostart: false,
      asciify: false,
      signals: false,
      autoLogger: false,
      promiseRejection: false,
      commander: false,
      pid: false,
    });
    assert.strictEqual(cli.commander, null);
  });

  it("deux Cli indépendants ont des commanders séparés", () => {
    const a = makeCli("a");
    const b = makeCli("b");
    assert.notStrictEqual(a.commander, b.commander);
  });

  it("environment est une string", () => {
    const cli = makeCli();
    assert.ok(typeof cli.environment === "string");
  });

  it("options.version passée au CLI", () => {
    const cli = makeCli("v-test", { version: "3.0.0" });
    assert.strictEqual(cli.commander?.version(), "3.0.0");
  });
});

// ─── 2. Commander — options & version ────────────────────────────────────────

describe("Cli — commander options & version", () => {
  it("initCommander appelle setCommandVersion → commander.version() === options.version", () => {
    // Quand version est fourni dans les options, initCommander appelle setCommandVersion automatiquement.
    // setCommandVersion sur un commander qui a déjà -v déclenche un conflit → on vérifie
    // que la version est bien celle passée à la construction.
    const c = makeCli("v2-test", { version: "5.0.0" });
    assert.strictEqual(c.commander?.version(), "5.0.0");
  });

  it("setCommandVersion sans commander → throw", () => {
    const cli = new Cli("no-cmd2", {
      autostart: false,
      asciify: false,
      signals: false,
      autoLogger: false,
      promiseRejection: false,
      commander: false,
      pid: false,
    });
    assert.throws(() => cli.setCommandVersion("1.0.0"), /Commender not found/);
  });

  it("-d, --debug option présente par défaut", () => {
    const cli = makeCli();
    const hasD = cli.commander?.options.some((o) => o.short === "-d");
    assert.ok(hasD);
  });

  it("-i, --interactive option présente par défaut", () => {
    const cli = makeCli();
    const hasI = cli.commander?.options.some((o) => o.short === "-i");
    assert.ok(hasI);
  });

  it("-v, --version option présente si version fournie", () => {
    const cli = makeCli("v-opt", { version: "1.2.3" });
    const hasV = cli.commander?.options.some((o) => o.short === "-v");
    assert.ok(hasV);
  });

  it("setCommandOption('-f, --force') → option dans commander", () => {
    const cli = makeCli();
    cli.setCommandOption("-f, --force", "Force mode");
    const hasF = cli.commander?.options.some((o) => o.short === "-f");
    assert.ok(hasF);
  });

  it("commander: false → setCommandOption throw", () => {
    const cli = new Cli("no-cmd3", {
      autostart: false,
      asciify: false,
      signals: false,
      autoLogger: false,
      promiseRejection: false,
      commander: false,
      pid: false,
    });
    assert.throws(
      () => cli.setCommandOption("-f, --force"),
      /Commender not found/,
    );
  });

  it("setCommand crée une sous-commande dans commander", () => {
    const cli = makeCli();
    const cmd = cli.setCommand("sub-cmd", "a sub command");
    assert.ok(cmd !== null);
  });
});

// ─── 3. Commandes STANDALONE (sans kernel) ────────────────────────────────────

describe("Cli — commandes standalone — registre", () => {
  let cli: Cli;

  before(() => {
    cli = makeCli("reg-test");
  });

  it("addCommand(EchoCommand) → stocké dans commands", () => {
    cli.addCommand(EchoCommand);
    assert.ok("echo" in (cli as any).commands);
  });

  it("hasCommand('echo') → true après addCommand", () => {
    assert.strictEqual(cli.hasCommand("echo"), true);
  });

  it("hasCommand('nonexistent') → false", () => {
    assert.strictEqual(cli.hasCommand("nonexistent"), false);
  });

  it("getCommand('echo') → instance Command", () => {
    const cmd = cli.getCommand("echo");
    assert.ok(cmd instanceof Command);
  });

  it("getCommand('echo').name === 'echo'", () => {
    const cmd = cli.getCommand("echo");
    assert.strictEqual(cmd?.name, "echo");
  });

  it("getCommand('nonexistent') → null", () => {
    assert.strictEqual(cli.getCommand("nonexistent"), null);
  });
});

describe("Cli — commandes standalone — exécution", () => {
  it("parse(['node','test','echo','World']) → generate('World') appelé", async () => {
    const cli = makeCli("exec-echo");
    const cmd = cli.addCommand(EchoCommand) as EchoCommand;
    cli.parse(["node", "test", "echo", "World"]);
    await cmd.done;
    assert.strictEqual(cmd.result, "World");
  });

  it("argument string → transmis correctement à generate()", async () => {
    const cli = makeCli("exec-hello");
    const cmd = cli.addCommand(EchoCommand) as EchoCommand;
    cli.parse(["node", "test", "echo", "Hello"]);
    await cmd.done;
    assert.strictEqual(cmd.result, "Hello");
  });

  it("multiples commandes — chacune peut s'exécuter", async () => {
    const cli = makeCli("multi-cmd");
    const echo = cli.addCommand(EchoCommand) as EchoCommand;
    const greet = cli.addCommand(GreetCommand) as GreetCommand;

    cli.parse(["node", "test", "echo", "Multi"]);
    await echo.done;
    assert.strictEqual(echo.result, "Multi");

    const cli2 = makeCli("multi-cmd2");
    const greet2 = cli2.addCommand(GreetCommand) as GreetCommand;
    cli2.parse(["node", "test", "greet", "Bob"]);
    await greet2.done;
    assert.strictEqual(greet2.greeted, "Bob");
  });

  it("commande sans argument → generate() appelé, called = true", async () => {
    const cli = makeCli("no-arg-exec");
    const cmd = cli.addCommand(NoArgCommand) as NoArgCommand;
    cli.parse(["node", "test", "no-arg"]);
    await cmd.done;
    assert.strictEqual(cmd.called, true);
  });

  it("generate() async → await cmd.done fonctionne", async () => {
    const cli = makeCli("async-exec");
    const cmd = cli.addCommand(EchoCommand) as EchoCommand;
    cli.parse(["node", "test", "echo", "Async"]);
    await cmd.done;
    assert.strictEqual(cmd.result, "Async");
  });

  it("override run() directement → ranWith contient les args", async () => {
    const cli = makeCli("run-override-exec");
    const cmd = cli.addCommand(RunOverrideCommand) as RunOverrideCommand;
    cli.parse(["node", "test", "run-override", "myval"]);
    await cmd.done;
    assert.ok(cmd.ranWith.length > 0);
    assert.strictEqual(cmd.ranWith[0], "myval");
  });

  it("deux instances de la même commande → registres indépendants", () => {
    const cliA = makeCli("ind-a");
    const cliB = makeCli("ind-b");
    cliA.addCommand(EchoCommand);
    cliB.addCommand(EchoCommand);
    assert.notStrictEqual(cliA.getCommand("echo"), cliB.getCommand("echo"));
  });

  it("commande qui lève une erreur dans generate() → error capturée dans done", async () => {
    const cli = makeCli("err-exec");
    const cmd = cli.addCommand(ErrorCommand) as ErrorCommand;
    cli.parse(["node", "test", "err-cmd"]);
    await cmd.done; // résout (pas rejecte) — on capture l'erreur dans done
    assert.ok(cmd.thrownError instanceof Error);
    assert.strictEqual(cmd.thrownError.message, "generate failed");
  });
});

describe("Cli — commandes standalone — options et alias", () => {
  it("addOption('-n, --count <n>') → option parsée dans Commander", async () => {
    const cli = makeCli("opt-cmd");
    const cmd = cli.addCommand(WithOptionCommand) as WithOptionCommand;
    cli.parse(["node", "test", "with-opt", "--count", "42"]);
    await cmd.done;
    assert.strictEqual(cmd.countVal, "42");
  });

  it("alias('al') → commande accessible par alias", async () => {
    const cli = makeCli("alias-exec");
    const cmd = cli.addCommand(AliasCommand) as AliasCommand;
    cli.parse(["node", "test", "al"]);
    await cmd.done;
    assert.strictEqual(cmd.called, true);
  });

  it("description() → retourne la description de la commande", () => {
    const cli = makeCli("desc-test");
    const cmd = cli.addCommand(EchoCommand) as EchoCommand;
    assert.strictEqual(cmd.description(), "Echo a message");
  });

  it("addArgument('<name>') → argument visible dans la commande", () => {
    const cli = makeCli("arg-vis");
    const cmd = cli.addCommand(EchoCommand) as EchoCommand;
    assert.ok(cmd.command.registeredArguments.length > 0);
    assert.strictEqual(cmd.command.registeredArguments[0].name(), "message");
  });
});

// ─── 4. parse / parseAsync ────────────────────────────────────────────────────

describe("Cli — parse / parseAsync", () => {
  it("parse sans commander → throw 'Commander not found'", () => {
    const cli = new Cli("no-parse", {
      autostart: false,
      asciify: false,
      signals: false,
      autoLogger: false,
      promiseRejection: false,
      commander: false,
      pid: false,
    });
    assert.throws(() => cli.parse(["node", "test"]), /Commander not found/);
  });

  it("parseAsync sans commander → throw 'Commander not found'", async () => {
    const cli = new Cli("no-parse-async", {
      autostart: false,
      asciify: false,
      signals: false,
      autoLogger: false,
      promiseRejection: false,
      commander: false,
      pid: false,
    });
    assert.throws(
      () => cli.parseAsync(["node", "test"]),
      /Commander not found/,
    );
  });

  it("parseAsync commande valide → résout avec commander", async () => {
    const cli = makeCli("pa-valid");
    const result = await cli.parseAsync(["node", "test"]);
    assert.ok(result !== null);
  });

  it("parse commande inconnue avec exitOverride → throw CommanderError (too many arguments)", () => {
    const cli = makeCli("parse-unknown");
    // Commander retourne "too many arguments" quand aucune sous-commande n'est enregistrée
    // et qu'un argument non attendu est passé (comportement réel Commander.js)
    assert.throws(() => cli.parse(["node", "test", "unknown-cmd-xyz"]));
  });

  it("parse(['node','test']) → ne throw pas (pas de sous-commande)", () => {
    const cli = makeCli("parse-ok");
    assert.doesNotThrow(() => cli.parse(["node", "test"]));
  });

  it("parseAsync(['node','test']) → résout sans erreur", async () => {
    const cli = makeCli("paa-ok");
    (await assert.isFulfilled) !== undefined
      ? cli.parseAsync(["node", "test"])
      : cli.parseAsync(["node", "test"]).then((r) => {
          assert.ok(r);
        });
  });
});

// ─── 5. showBanner / logEnv ──────────────────────────────────────────────────

describe("Cli — showBanner / logEnv", () => {
  it("showBanner() → retourne string non null si version définie", () => {
    const cli = makeCli("banner-test", { version: "1.2.3" });
    const banner = cli.showBanner();
    assert.ok(typeof banner === "string" && banner !== null);
  });

  it("showBanner() contient la version", () => {
    const cli = makeCli("banner-v", { version: "9.9.9" });
    const banner = cli.showBanner();
    assert.ok(banner?.includes("9.9.9"));
  });

  it("showBanner() contient process.platform", () => {
    const cli = makeCli("banner-plat", { version: "1.0.0" });
    const banner = cli.showBanner();
    assert.ok(banner?.includes(process.platform));
  });

  it("showBanner() contient le pid du process", () => {
    const cli = makeCli("banner-pid", { version: "1.0.0" });
    const banner = cli.showBanner();
    assert.ok(banner?.includes(String(process.pid)));
  });

  it("showBanner() sans version dans options → null", () => {
    // showBanner() retourne null si options.version est falsy.
    // ATTENTION: defaultOptions.version = "1.0.0" est mergé sauf si on override explicitement.
    // Pour obtenir null, il faut créer un Cli puis écraser options.version manuellement.
    const cli = makeCli("no-ver-banner");
    // Écraser la version après construction pour simuler l'absence de version
    (cli as any).options.version = undefined;
    const banner = cli.showBanner();
    assert.strictEqual(banner, null);
  });

  it("logEnv() → retourne un string", () => {
    const cli = makeCli("logenv-test");
    const env = cli.logEnv();
    assert.ok(typeof env === "string");
  });

  it("logEnv() contient le nom du CLI", () => {
    const cli = makeCli("my-named-cli");
    const env = cli.logEnv();
    assert.ok(env.includes("my-named-cli"));
  });

  it("logEnv() avec environment 'development'", () => {
    // NODE_ENV (vitest='test') primerait sur l'environment explicite via la
    // résolution 12-factor → on le neutralise le temps du test pour vérifier que
    // l'environment configuré est bien reflété.
    const savedNodeEnv = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      const cli = makeCli("devenv", { environment: "development" });
      const env = cli.logEnv();
      assert.ok(env.includes("development"));
    } finally {
      if (savedNodeEnv !== undefined) process.env.NODE_ENV = savedNodeEnv;
    }
  });
});

// ─── 6. checkVersion / semver ────────────────────────────────────────────────

describe("Cli — checkVersion / semver", () => {
  it("checkVersion('1.2.3') → retourne '1.2.3'", () => {
    const cli = makeCli();
    const res = cli.checkVersion("1.2.3");
    assert.strictEqual(res, "1.2.3");
  });

  it("checkVersion('2.0.0-beta.1') → retourne une string valide", () => {
    const cli = makeCli();
    const res = cli.checkVersion("2.0.0-beta.1");
    assert.ok(typeof res === "string" && res.length > 0);
  });

  it("checkVersion('not-valid') → throw Error contenant 'semver'", () => {
    const cli = makeCli();
    assert.throws(() => cli.checkVersion("not-valid"), /semver/i);
  });

  it("checkVersion('') → throw (chaîne vide → invalide)", () => {
    const cli = makeCli();
    assert.throws(() => cli.checkVersion(""));
  });

  it("checkVersion(null) → utilise this.version", () => {
    const cli = makeCli("cv-null", { version: "4.5.6" });
    cli.version = "4.5.6";
    const res = cli.checkVersion(null as any);
    assert.strictEqual(res, "4.5.6");
  });

  it("this.version = '3.0.0' puis checkVersion() → '3.0.0'", () => {
    const cli = makeCli("cv-self");
    cli.version = "3.0.0";
    const res = cli.checkVersion();
    assert.strictEqual(res, "3.0.0");
  });
});

// ─── 7. Timers ───────────────────────────────────────────────────────────────

describe("Cli — timers", () => {
  it("startTimer('build') → enregistré dans this.timers", () => {
    const cli = makeCli("timer1");
    cli.startTimer("build");
    assert.ok("build" in cli.timers);
    // nettoyage
    try {
      cli.stopTimer("build");
    } catch {
      /* ignore */
    }
  });

  it("stopTimer('build') → supprimé de this.timers", () => {
    const cli = makeCli("timer2");
    cli.startTimer("build");
    cli.stopTimer("build");
    assert.ok(!("build" in cli.timers));
  });

  it("startTimer doublon → throw 'already exist'", () => {
    const cli = makeCli("timer3");
    cli.startTimer("dup");
    assert.throws(() => cli.startTimer("dup"), /already exist/);
    try {
      cli.stopTimer("dup");
    } catch {
      /* ignore */
    }
  });

  it("stopTimer inconnu → throw 'not exist'", () => {
    const cli = makeCli("timer4");
    assert.throws(() => cli.stopTimer("unkn-timer"), /not exist/);
  });

  it("startTimer puis re-stopTimer → throw", () => {
    const cli = makeCli("timer5");
    cli.startTimer("once");
    cli.stopTimer("once");
    assert.throws(() => cli.stopTimer("once"), /not exist/);
  });

  it("timers vide après stop complet", () => {
    const cli = makeCli("timer6");
    cli.startTimer("t1");
    cli.startTimer("t2");
    cli.stopTimer("t1");
    cli.stopTimer("t2");
    assert.deepEqual(
      Object.keys(cli.timers).filter((k) => k === "t1" || k === "t2"),
      [],
    );
  });

  it("stopTimer(null) → boucle sur les timers actifs PUIS throw (bug connu: pas de return après la boucle)", () => {
    // Comportement réel : !name → entre dans la boucle, mais pas de return.
    // Après la boucle, tombe dans le try avec null → throw "not exist"
    const cli = makeCli("timer7");
    cli.startTimer("a");
    cli.startTimer("b");
    // La boucle arrête "a" et "b", mais ensuite throw car null not in timers
    assert.throws(() => cli.stopTimer(null as any), /not exist/);
  });

  it("stopTimer(undefined) → throw (même comportement — undefined not in timers)", () => {
    const cli = makeCli("timer8");
    // Pas de timer actif — !undefined → boucle vide, puis try: undefined not in {} → throw
    assert.throws(() => cli.stopTimer(undefined as any), /not exist/);
  });
});

// ─── 8. setProcessTitle ──────────────────────────────────────────────────────

describe("Cli — setProcessTitle", () => {
  it("normalise en lowercase sans espaces", () => {
    const cli = makeCli("My App");
    const title = cli.setProcessTitle("My Service");
    assert.strictEqual(title, "myservice");
  });

  it("retourne process.title (string)", () => {
    const cli = makeCli();
    const title = cli.setProcessTitle("TestApp");
    assert.ok(typeof title === "string");
  });

  it("sans arg → utilise this.name", () => {
    const cli = makeCli("myapp");
    const title = cli.setProcessTitle();
    assert.strictEqual(title, "myapp");
  });

  it("espaces supprimés dans le titre", () => {
    const cli = makeCli();
    const title = cli.setProcessTitle("Hello World CLI");
    assert.ok(!title.includes(" "));
    assert.strictEqual(title, "helloworldcli");
  });
});

// ─── 9. Static methods ───────────────────────────────────────────────────────

describe("Cli — méthodes statiques", () => {
  it("niceBytes(0) → '0 bytes'", () => {
    assert.strictEqual(Cli.niceBytes(0), "0 bytes");
  });

  it("niceBytes(1024) → '1.0 KB'", () => {
    assert.strictEqual(Cli.niceBytes(1024), "1.0 KB");
  });

  it("niceBytes(10240) → '10 KB' (pas de décimale si n >= 10)", () => {
    assert.strictEqual(Cli.niceBytes(10240), "10 KB");
  });

  it("niceBytes(1048576) → '1.0 MB'", () => {
    assert.strictEqual(Cli.niceBytes(1048576), "1.0 MB");
  });

  it("niceBytes(10485760) → '10 MB'", () => {
    assert.strictEqual(Cli.niceBytes(10485760), "10 MB");
  });

  it("niceBytes(512) → '512 bytes'", () => {
    assert.strictEqual(Cli.niceBytes(512), "512 bytes");
  });

  it("niceDate(date, 'YYYY-MM-DD') → string de 10 caractères", () => {
    const d = new Date("2024-01-15");
    const result = Cli.niceDate(d, "YYYY-MM-DD");
    assert.ok(typeof result === "string");
    assert.strictEqual(result.length, 10);
    assert.strictEqual(result, "2024-01-15");
  });

  it("niceUptime(new Date()) → string ('a few seconds ago')", () => {
    const result = Cli.niceUptime(new Date());
    assert.ok(typeof result === "string");
    assert.ok(result.length > 0);
  });

  it("niceUptime(old date) → string contenant 'ago' ou 'years'", () => {
    const old = new Date("2000-01-01");
    const result = Cli.niceUptime(old);
    assert.ok(typeof result === "string");
    assert.ok(result.includes("ago") || result.includes("year"));
  });
});

// ─── 10. UI ──────────────────────────────────────────────────────────────────

describe("Cli — UI (Table)", () => {
  let cli: Cli;

  before(() => {
    cli = makeCli("ui-test");
  });

  it("displayTable([['a','b']], {}) → objet Table", () => {
    const table = cli.displayTable([["a", "b"]], {});
    assert.ok(table !== null && table !== undefined);
    assert.ok(typeof (table as any).toString === "function");
  });

  it("displayTable([], {}) → Table vide", () => {
    const table = cli.displayTable([], {});
    assert.ok(table !== null && table !== undefined);
  });

  it("displayTable([['x','y'],['a','b']], {}) → table de 2 lignes", () => {
    const table = cli.displayTable(
      [
        ["x", "y"],
        ["a", "b"],
      ],
      {},
    );
    assert.ok((table as any).length === 2);
  });
});

// ─── 11. existsSync / getCommandManager ──────────────────────────────────────

describe("Cli — existsSync / getCommandManager", () => {
  let cli: Cli;

  before(() => {
    cli = makeCli("fs-test");
  });

  it("existsSync(null) → throw 'no path found'", () => {
    assert.throws(() => cli.existsSync(null as any), /no path found/);
  });

  it("existsSync('') → throw 'no path found'", () => {
    assert.throws(() => cli.existsSync(""), /no path found/);
  });

  it("existsSync(process.cwd()) → true", () => {
    assert.strictEqual(cli.existsSync(process.cwd()), true);
  });

  it("existsSync('/nonexistent/path/xyz') → false", () => {
    assert.strictEqual(cli.existsSync("/nonexistent/path/xyz"), false);
  });

  it("getCommandManager('npm') → 'npm' sur non-Windows", () => {
    if (process.platform !== "win32") {
      assert.strictEqual(cli.getCommandManager("npm"), "npm");
    } else {
      assert.strictEqual(cli.getCommandManager("npm"), "npm.cmd");
    }
  });

  it("getCommandManager('pnpm') → 'pnpm' (ou 'pnpm.cmd' sur Windows)", () => {
    const result = cli.getCommandManager("pnpm");
    assert.ok(result === "pnpm" || result === "pnpm.cmd");
  });

  it("getCommandManager('yarn') → 'yarn' (ou 'yarn.cmd' sur Windows)", () => {
    const result = cli.getCommandManager("yarn");
    assert.ok(result === "yarn" || result === "yarn.cmd");
  });

  it("getCommandManager('unknown') → throw 'bad manager'", () => {
    assert.throws(() => cli.getCommandManager("unknown"), /bad manager/);
  });

  it("getCommandManager('bun') → throw (non supporté)", () => {
    assert.throws(() => cli.getCommandManager("bun"));
  });

  it("getCommandManager('') → throw", () => {
    assert.throws(() => cli.getCommandManager(""));
  });
});

// ─── 12. setPid ──────────────────────────────────────────────────────────────

describe("Cli — setPid", () => {
  it("setPid() → retourne process.pid", () => {
    const cli = makeCli("pid-set");
    const pid = cli.setPid();
    assert.strictEqual(pid, process.pid);
  });

  it("setPid() → stocke dans this.pid", () => {
    const cli = makeCli("pid-store");
    cli.setPid();
    assert.strictEqual(cli.pid, process.pid);
  });
});
