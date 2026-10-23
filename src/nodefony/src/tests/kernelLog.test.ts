import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
  vi,
} from "vitest";
import Kernel from "../kernel/Kernel";
import { KernelLogSetup } from "../kernel/kernelLog";
import type { ILogHost } from "../kernel/kernelLog";
import type { TypeKernelOptions } from "../kernel/Kernel";
import CliKernel from "../kernel/CliKernel";
import Syslog from "../syslog/Syslog";
import { isLogColorEnabled, setLogColor } from "../syslog/logColor";
import {
  getActiveLogDriver,
  registerLogDriverFactory,
  setActiveLogDriver,
} from "../syslog/drivers/logDriverRegistry";
import type { ILogDriver } from "../syslog/drivers/ILogDriver";
import type { ITransport } from "../types/ITransport";

/**
 * Caractérisation de la famille LOG du noyau (#488) : le montage du journal par
 * `initializeLog` — sink, drivers du backplane, transports d'écriture et leur
 * ré-entrance, seuils de sévérité, couleur, aiguillage CLI. Les blocs
 * « Kernel — initializeLog (…) » ont été écrits et vus verts sur le code
 * d'ORIGINE avant tout déplacement : ils ne passent que par l'API publique du
 * Kernel (`initializeLog`, `syslog`, `isTTY`, `environment`, `options`), donc
 * ils tiennent quel que soit l'endroit où vit l'implémentation.
 *
 * Les fabriques de drivers `kl-a` / `kl-b` sont des doublures : elles ne
 * montent rien tant que `plan.enabled` est faux (le registre de fabriques est
 * global au process, et `development` monte TOUTES les fabriques enregistrées).
 */

// `initCluster` écrit sur la sortie standard à la construction d'un Kernel.
let origConsoleLog: typeof console.log;
beforeAll(() => {
  origConsoleLog = console.log;
  console.log = () => {};
});
afterAll(() => {
  console.log = origConsoleLog;
});

/** Transport doublure : compte ses fermetures (le Syslog ferme ce qu'il retire). */
interface ISpyTransport extends ITransport {
  closes: number;
}

/** Plan des doublures : actives seulement quand un test le demande. */
const plan = {
  enabled: false,
  /** Compteur du nom des transports de `kl-c` : un nom NEUF à chaque passage. */
  serial: 0,
  /** Tous les transports construits par les fabriques, dans l'ordre. */
  created: [] as ISpyTransport[],
};

function stubDriver(name: string): ILogDriver {
  return {
    name,
    capabilities: { write: true, query: false, stream: false },
  };
}

function mkSpyTransport(name: string): ISpyTransport {
  const t: ISpyTransport = {
    name,
    closes: 0,
    send: () => Promise.resolve(),
    close: () => {
      t.closes += 1;
      return Promise.resolve();
    },
  };
  plan.created.push(t);
  return t;
}

// `kl-a` et `kl-b` partagent la MÊME destination d'écriture (`writeKey`) : un
// seul transport doit être branché, comme `file` / `cluster-file`.
registerLogDriverFactory("kl-a", () =>
  plan.enabled
    ? {
        driver: stubDriver("kl-a"),
        transport: mkSpyTransport("kl-a"),
        writeKey: "kl-shared",
      }
    : null,
);
registerLogDriverFactory("kl-b", () =>
  plan.enabled
    ? {
        driver: stubDriver("kl-b"),
        transport: mkSpyTransport("kl-b"),
        writeKey: "kl-shared",
      }
    : null,
);

// `kl-c` donne à chaque passage un transport de NOM différent : la dédup par nom
// d'`addTransport` ne peut alors plus masquer un démontage oublié.
registerLogDriverFactory("kl-c", () => {
  if (!plan.enabled) return null;
  plan.serial += 1;
  return {
    driver: stubDriver("kl-c"),
    transport: mkSpyTransport(`kl-c-${plan.serial}`),
    writeKey: `kl-c-${plan.serial}`,
  };
});

// `kl-app` relève le nom d'application que le montage passe aux fabriques.
let seenAppName: string | undefined | null = null;
registerLogDriverFactory("kl-app", (ctx) => {
  if (!plan.enabled) return null;
  seenAppName = ctx.appName;
  return { driver: stubDriver("kl-app") };
});

let dir = "";
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ["NF__DEBUG", "NO_COLOR", "FORCE_COLOR"] as const;
let savedColor = false;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "nf-kernel-log-"));
  plan.enabled = false;
  plan.serial = 0;
  plan.created.length = 0;
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  savedColor = isLogColorEnabled();
});

afterEach(() => {
  vi.restoreAllMocks();
  plan.enabled = false;
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  setLogColor(savedColor);
  try {
    setActiveLogDriver("memory");
  } catch {
    /* registre pas encore peuplé — sans objet */
  }
  Syslog.setLogSink(null);
  Syslog.setOutputBuffering("auto");
  Syslog.setLineFormat("text");
  seenAppName = null;
  rmSync(dir, { recursive: true, force: true });
});

/** Noyau de développement dont les fichiers de log vont sous la racine temporaire. */
function mkKernel(
  env: "development" | "production" = "development",
  log: NonNullable<TypeKernelOptions["log"]> = {},
): Kernel {
  return new Kernel(env, null, { log: { active: true, dir, ...log } });
}

/** Noms des transports d'écriture branchés sur le journal du noyau. */
function mountedNames(k: { readonly syslog: Syslog | null }): string[] {
  return (k.syslog?.listTransports() ?? []).map((t) => t.name);
}

describe("Kernel — initializeLog (ré-entrance des transports)", () => {
  it("un second passage démonte et ferme ceux du premier, sans doublon", () => {
    plan.enabled = true;
    const k = mkKernel();
    k.initializeLog();
    const afterFirst = k.syslog?.transportCount;
    assert.ok(mountedNames(k).includes("kl-a"), "kl-a monté au 1er passage");
    const first = plan.created.filter((t) => t.name === "kl-a");
    assert.strictEqual(first.length, 1);

    k.initializeLog();
    assert.strictEqual(
      k.syslog?.transportCount,
      afterFirst,
      "même nombre de transports après le 2e passage",
    );
    assert.strictEqual(
      mountedNames(k).filter((n) => n === "kl-a").length,
      1,
      "un seul kl-a branché",
    );
    const all = plan.created.filter((t) => t.name === "kl-a");
    assert.strictEqual(all.length, 2, "une instance neuve par passage");
    assert.strictEqual(all[0]!.closes, 1, "l'ancien est fermé une fois");
    assert.strictEqual(all[1]!.closes, 0, "le nouveau reste ouvert");

    k.initializeLog();
    const third = plan.created.filter((t) => t.name === "kl-a");
    assert.strictEqual(third.length, 3);
    assert.strictEqual(third[1]!.closes, 1, "le 3e passage ferme le 2e");
    assert.strictEqual(third[2]!.closes, 0);
    assert.strictEqual(k.syslog?.transportCount, afterFirst);
  });

  it("des transports de noms différents ne s'accumulent pas d'un passage à l'autre", () => {
    plan.enabled = true;
    const k = mkKernel();
    k.initializeLog();
    const base = k.syslog?.transportCount ?? 0;
    k.initializeLog();
    k.initializeLog();
    assert.strictEqual(k.syslog?.transportCount, base);
    const kc = plan.created.filter((t) => t.name.startsWith("kl-c-"));
    assert.strictEqual(kc.length, 3);
    assert.deepStrictEqual(
      kc.map((t) => t.closes),
      [1, 1, 0],
      "chaque ancien transport est fermé une fois, le dernier reste ouvert",
    );
    assert.deepStrictEqual(
      mountedNames(k).filter((n) => n.startsWith("kl-c-")),
      ["kl-c-3"],
    );
  });

  it("le passage suivant démonte même si le journal est désactivé entre-temps", () => {
    plan.enabled = true;
    const k = mkKernel();
    k.initializeLog();
    assert.ok(mountedNames(k).includes("kl-a"));
    const mounted = plan.created.find((t) => t.name === "kl-a");
    assert.ok(mounted);
    const builtBefore = plan.created.length;

    if (k.options.log) k.options.log.active = false;
    k.initializeLog();
    assert.ok(!mountedNames(k).includes("kl-a"), "kl-a démonté");
    assert.strictEqual(mounted.closes, 1, "et fermé");
    assert.strictEqual(plan.created.length, builtBefore, "rien de neuf monté");
  });

  it("log sans `active` → retour immédiat, rien de monté", () => {
    plan.enabled = true;
    const k = new Kernel("development", null, { log: { dir } });
    const before = k.syslog?.transportCount;
    assert.strictEqual(k.initializeLog(), undefined);
    assert.strictEqual(k.syslog?.transportCount, before);
    assert.strictEqual(plan.created.length, 0);
  });

  it("deux drivers de même `writeKey` → UN seul transport, le premier enregistré", () => {
    plan.enabled = true;
    const k = mkKernel();
    k.initializeLog();
    const names = mountedNames(k);
    assert.ok(names.includes("kl-a"));
    assert.ok(!names.includes("kl-b"));
  });
});

describe("Kernel — initializeLog (drivers montés selon la config)", () => {
  it("production sans queryDriver → rien de plus que `memory` (opt-in strict)", () => {
    plan.enabled = true;
    const k = mkKernel("production");
    k.initializeLog();
    assert.ok(!mountedNames(k).includes("kl-a"));
    assert.strictEqual(getActiveLogDriver()?.name, "memory");
  });

  it("production + queryDriver → monte ce driver et l'active", () => {
    plan.enabled = true;
    const k = mkKernel("production", { queryDriver: "kl-a" });
    k.initializeLog();
    assert.ok(mountedNames(k).includes("kl-a"));
    assert.strictEqual(getActiveLogDriver()?.name, "kl-a");
  });

  it("queryDriver inconnu → repli sur `memory`, sans lever", () => {
    // Un autre driver est actif AVANT : sans repli, il resterait en place.
    plan.enabled = true;
    mkKernel("production", { queryDriver: "kl-a" }).initializeLog();
    assert.strictEqual(getActiveLogDriver()?.name, "kl-a");
    const k = mkKernel("production", { queryDriver: "ghost" });
    assert.doesNotThrow(() => k.initializeLog());
    assert.strictEqual(getActiveLogDriver()?.name, "memory");
  });

  // Port 9 (discard) en local : aucune requête ne part pendant ces tests — le
  // transport n'est jamais vidé, il est retiré au passage suivant.
  const LOKI = "http://127.0.0.1:9";

  it("loki `write: false` → relecture active, AUCUN transport d'envoi monté", () => {
    const k = mkKernel("production", { loki: { url: LOKI, write: false } });
    k.initializeLog();
    const active = getActiveLogDriver();
    assert.strictEqual(active?.name, "loki");
    assert.strictEqual(
      active?.capabilities.write,
      true,
      "Loki reste persistant",
    );
    assert.ok(!mountedNames(k).includes("loki"), mountedNames(k).join(","));
  });

  it("loki sans `write` → le transport d'envoi est monté, puis retiré en relecture seule", () => {
    const k = mkKernel("production", { loki: { url: LOKI } });
    k.initializeLog();
    assert.ok(mountedNames(k).includes("loki"));
    assert.strictEqual(getActiveLogDriver()?.capabilities.write, true);
    k.options.log!.loki = { url: LOKI, write: false };
    k.initializeLog();
    assert.ok(!mountedNames(k).includes("loki"));
  });

  it("opensearch `write: false` → relecture active, AUCUN transport d'envoi monté", () => {
    const k = mkKernel("production", {
      opensearch: { url: "http://127.0.0.1:9", write: false },
    });
    k.initializeLog();
    assert.strictEqual(getActiveLogDriver()?.name, "opensearch");
    assert.strictEqual(getActiveLogDriver()?.capabilities.write, true);
    assert.ok(!mountedNames(k).includes("opensearch"));
  });

  it("development monte toutes les fabriques enregistrées (switch à chaud)", () => {
    plan.enabled = true;
    const k = mkKernel("development");
    k.initializeLog();
    assert.ok(mountedNames(k).includes("kl-a"));
    assert.ok(mountedNames(k).includes("file"), "driver fichier natif monté");
    assert.strictEqual(getActiveLogDriver()?.name, "memory");
  });
});

describe("Kernel — initializeLog (forme des lignes)", () => {
  it("`log.format: json` → lignes JSON ; absent → texte", () => {
    mkKernel("production", { format: "json" }).initializeLog();
    assert.strictEqual(Syslog.lineFormat, "json");
    mkKernel("production").initializeLog();
    assert.strictEqual(Syslog.lineFormat, "text");
  });
});

describe("Kernel — initializeLog (sink, tampon, ring)", () => {
  it("driver `null` → sink `null` ; défaut → `stdout`", () => {
    mkKernel("development", { driver: "null" }).initializeLog();
    assert.strictEqual(Syslog.logSinkName, "null");
    mkKernel("development").initializeLog();
    assert.strictEqual(Syslog.logSinkName, "stdout");
  });

  it("`buffered` : défaut `auto`, valeur de la config sinon", () => {
    const spy = vi.spyOn(Syslog, "setOutputBuffering");
    mkKernel().initializeLog();
    assert.deepStrictEqual(spy.mock.calls.at(-1), ["auto"]);
    mkKernel("development", { buffered: false }).initializeLog();
    assert.deepStrictEqual(spy.mock.calls.at(-1), [false]);
  });

  it("ring : 2000 en development, inchangé hors development sans `maxStack`", () => {
    const dev = mkKernel("development");
    dev.initializeLog();
    assert.strictEqual(dev.syslog?.bufferCapacity, 2000);

    const prod = mkKernel("production");
    const defaultCapacity = prod.syslog?.bufferCapacity;
    prod.initializeLog();
    assert.strictEqual(prod.syslog?.bufferCapacity, defaultCapacity);
  });
});

describe("Kernel — initializeLog (couleur et TTY)", () => {
  it("la couleur suit `isTTY` lu au moment de l'appel", () => {
    const k = mkKernel();
    k.isTTY = true;
    k.initializeLog();
    assert.strictEqual(isLogColorEnabled(), true);
    k.isTTY = false;
    k.initializeLog();
    assert.strictEqual(isLogColorEnabled(), false);
  });

  it("journal désactivé → la couleur n'est pas touchée", () => {
    const k = new Kernel("development", null, { log: { active: false } });
    setLogColor(true);
    k.isTTY = false;
    k.initializeLog();
    assert.strictEqual(isLogColorEnabled(), true);
  });
});

describe("Kernel — initializeLog (seuils de sévérité)", () => {
  it("production sans debug → DEBUG filtré, INFO passe", () => {
    const k = mkKernel("production");
    k.initializeLog();
    assert.strictEqual(k.syslog?.severityEnabled("DEBUG"), false);
    assert.strictEqual(k.syslog?.severityEnabled("INFO"), true);
  });

  it("production + `log.debug` → plus de gate", () => {
    const k = mkKernel("production", { debug: true });
    k.initializeLog();
    assert.strictEqual(k.debug, true);
    assert.strictEqual(k.syslog?.severityEnabled("DEBUG"), true);
  });

  it("development → pas de gate", () => {
    const k = mkKernel("development");
    k.initializeLog();
    assert.strictEqual(k.syslog?.severityEnabled("DEBUG"), true);
  });

  it("l'environnement est lu à l'appel : le passage suivant re-résout le seuil", () => {
    const k = mkKernel("development");
    k.initializeLog();
    assert.strictEqual(k.syslog?.severityEnabled("DEBUG"), true);
    k.environment = "production";
    k.initializeLog();
    assert.strictEqual(k.syslog?.severityEnabled("DEBUG"), false);
    k.environment = "development";
    k.initializeLog();
    assert.strictEqual(k.syslog?.severityEnabled("DEBUG"), true);
  });

  it("`NF__DEBUG=*` lève le gate global en production", () => {
    process.env.NF__DEBUG = "*";
    const k = mkKernel("production");
    k.initializeLog();
    assert.strictEqual(k.syslog?.severityEnabled("DEBUG"), true);
  });

  it("`NF__DEBUG=MODULE:DEBUG` ne rallume que ce module en production", () => {
    process.env.NF__DEBUG = "KLMOD:DEBUG";
    const k = mkKernel("production");
    k.initializeLog();
    assert.strictEqual(k.syslog?.severityEnabled("DEBUG"), false);
    k.syslog?.log("rallumé", "DEBUG", "KLMOD");
    k.syslog?.log("filtré", "DEBUG", "AUTRE");
    const ring = k.syslog?.ringStack ?? [];
    assert.ok(ring.some((p) => p.msgid === "KLMOD"));
    assert.ok(!ring.some((p) => p.msgid === "AUTRE"));
  });

  it("`NF__DEBUG` retiré → le passage suivant ne le relit plus", () => {
    process.env.NF__DEBUG = "*";
    const k = mkKernel("production");
    k.initializeLog();
    assert.strictEqual(k.syslog?.severityEnabled("DEBUG"), true);
    delete process.env.NF__DEBUG;
    k.initializeLog();
    assert.strictEqual(k.syslog?.severityEnabled("DEBUG"), false);
  });
});

describe("Kernel — initializeLog (aiguillage CLI / kernel)", () => {
  it("sans CLI : `Kernel.initSyslog(environment, debug)` et sa valeur est rendue", () => {
    const k = mkKernel("development", { debug: ["ROUTER"] });
    const spy = vi.spyOn(k, "initSyslog").mockReturnValue(null);
    assert.strictEqual(k.initializeLog(), null);
    assert.deepStrictEqual(spy.mock.calls, [["development", ["ROUTER"]]]);
    assert.deepStrictEqual(k.debug, ["ROUTER"]);
  });

  it("avec CLI : `cli.initSyslog` prend la main, le kernel n'est pas appelé", () => {
    const k = mkKernel("development");
    const cli = new CliKernel("development");
    k.cli = cli;
    const cliSpy = vi.spyOn(cli, "initSyslog").mockReturnValue(null);
    const kernelSpy = vi.spyOn(k, "initSyslog");
    assert.strictEqual(k.initializeLog(), null);
    assert.deepStrictEqual(cliSpy.mock.calls, [["development", false]]);
    assert.strictEqual(kernelSpy.mock.calls.length, 0);
  });

  it("avec CLI : la CLI prime, `log.debug` ne pose pas `debug`", () => {
    const k = mkKernel("development", { debug: "*" });
    const cli = new CliKernel("development");
    vi.spyOn(cli, "initSyslog").mockReturnValue(null);
    k.cli = cli;
    k.initializeLog();
    assert.strictEqual(k.debug, false);
  });

  it("sans CLI, `debug` déjà posé n'est pas écrasé par `log.debug`", () => {
    const k = mkKernel("development", { debug: ["ROUTER"] });
    k.debug = "*";
    k.initializeLog();
    assert.strictEqual(k.debug, "*");
  });

  it("journal désactivé → `initSyslog` n'est pas appelé", () => {
    const k = new Kernel("development", null, { log: { active: false } });
    const spy = vi.spyOn(k, "initSyslog");
    assert.strictEqual(k.initializeLog(), undefined);
    assert.strictEqual(spy.mock.calls.length, 0);
  });
});

// ─── La classe extraite, devant un hôte fictif ───────────────────────────────

/** Hôte fictif : tous les champs sont réaffectables entre deux passages. */
type MutableHost = { -readonly [K in keyof ILogHost]: ILogHost[K] };

function mkHost(overrides: Partial<MutableHost> = {}): {
  host: MutableHost;
  initSyslog: ReturnType<typeof vi.fn>;
} {
  const initSyslog = vi.fn((): void | null => undefined);
  const host: MutableHost = {
    options: { log: { active: true, dir } },
    syslog: new Syslog(),
    environment: "development",
    isTTY: false,
    appName: undefined,
    debug: false,
    cli: null,
    initSyslog,
    ...overrides,
  };
  return { host, initSyslog };
}

describe("KernelLogSetup — nom de l'application", () => {
  it("passe aux fabriques le nom du paquet de l'app, lu à l'appel", () => {
    plan.enabled = true;
    const { host } = mkHost();
    const setup = new KernelLogSetup(host);
    setup.initialize();
    assert.strictEqual(seenAppName, undefined, "avant loadApp : pas de nom");
    host.appName = "shop";
    setup.initialize();
    assert.strictEqual(seenAppName, "shop");
  });
});

describe("KernelLogSetup — hôte lu À L'APPEL", () => {
  it("environment : le seuil et le ring suivent la valeur de CE passage", () => {
    const { host } = mkHost({ environment: "development" });
    const setup = new KernelLogSetup(host);
    setup.initialize();
    assert.strictEqual(host.syslog?.severityEnabled("DEBUG"), true);
    assert.strictEqual(host.syslog?.bufferCapacity, 2000);

    host.environment = "production";
    host.syslog?.setMaxStack(50);
    setup.initialize();
    assert.strictEqual(host.syslog?.severityEnabled("DEBUG"), false);
    assert.strictEqual(host.syslog?.bufferCapacity, 50, "plus de ring de dev");

    host.environment = "development";
    setup.initialize();
    assert.strictEqual(host.syslog?.severityEnabled("DEBUG"), true);
  });

  it("isTTY : la couleur suit la valeur de CE passage", () => {
    const { host } = mkHost({ isTTY: true });
    const setup = new KernelLogSetup(host);
    setup.initialize();
    assert.strictEqual(isLogColorEnabled(), true);
    host.isTTY = false;
    setup.initialize();
    assert.strictEqual(isLogColorEnabled(), false);
  });

  it("options : un objet `log` remplacé entre deux passages est relu", () => {
    const { host } = mkHost({
      options: { log: { active: true, dir, driver: "null" } },
    });
    const setup = new KernelLogSetup(host);
    setup.initialize();
    assert.strictEqual(Syslog.logSinkName, "null");
    host.options = { log: { active: true, dir } };
    setup.initialize();
    assert.strictEqual(Syslog.logSinkName, "stdout");
    host.options = { log: { active: false } };
    assert.strictEqual(
      setup.initialize(),
      undefined,
      "désactivé : retour immédiat",
    );
  });

  it("cli : posée entre deux passages, elle prend la main sur l'hôte", () => {
    const { host, initSyslog } = mkHost();
    const setup = new KernelLogSetup(host);
    setup.initialize();
    assert.strictEqual(initSyslog.mock.calls.length, 1);

    const cliInit = vi.fn((): void | null => null);
    host.cli = { initSyslog: cliInit };
    assert.strictEqual(setup.initialize(), null);
    assert.strictEqual(
      initSyslog.mock.calls.length,
      1,
      "l'hôte n'est plus appelé",
    );
    assert.deepStrictEqual(cliInit.mock.calls, [["development", false]]);

    host.cli = null;
    setup.initialize();
    assert.strictEqual(
      initSyslog.mock.calls.length,
      2,
      "CLI retirée : l'hôte reprend",
    );
  });

  it("syslog : lu à l'appel, un hôte nettoyé (`null`) ne fait pas lever", () => {
    const { host, initSyslog } = mkHost();
    const setup = new KernelLogSetup(host);
    setup.initialize();
    host.syslog = null;
    assert.doesNotThrow(() => setup.initialize());
    assert.strictEqual(initSyslog.mock.calls.length, 2);
  });
});

describe("KernelLogSetup — debug et valeur rendue", () => {
  it("pose `host.debug` depuis `log.debug` seulement sans CLI et sans debug", () => {
    const { host } = mkHost({
      options: { log: { active: true, dir, debug: ["ROUTER"] } },
    });
    new KernelLogSetup(host).initialize();
    assert.deepStrictEqual(host.debug, ["ROUTER"]);

    const already = mkHost({
      options: { log: { active: true, dir, debug: ["ROUTER"] } },
      debug: "*",
    });
    new KernelLogSetup(already.host).initialize();
    assert.strictEqual(already.host.debug, "*");

    const withCli = mkHost({
      options: { log: { active: true, dir, debug: ["ROUTER"] } },
      cli: { initSyslog: () => null },
    });
    new KernelLogSetup(withCli.host).initialize();
    assert.strictEqual(withCli.host.debug, false);
  });

  it("transmet environment ET le debug résolu à `initSyslog`, et rend sa valeur", () => {
    const { host, initSyslog } = mkHost({
      environment: "production",
      options: { log: { active: true, dir, debug: true } },
    });
    initSyslog.mockReturnValue(null);
    assert.strictEqual(new KernelLogSetup(host).initialize(), null);
    assert.deepStrictEqual(initSyslog.mock.calls, [["production", true]]);
  });
});

describe("KernelLogSetup — propriétaire des transports montés", () => {
  it("une instance démonte ceux de SON passage précédent, pas ceux d'une autre", () => {
    plan.enabled = true;
    const { host } = mkHost();
    const first = new KernelLogSetup(host);
    first.initialize();
    const afterFirst = plan.created.filter((t) => t.name.startsWith("kl-c-"));
    assert.strictEqual(afterFirst.length, 1);

    // Une instance NEUVE ne connaît pas les transports de la première : elle n'en
    // retire aucun (preuve que l'état vit dans l'instance, et non dans l'hôte).
    const second = new KernelLogSetup(host);
    second.initialize();
    assert.strictEqual(afterFirst[0]!.closes, 0, "kl-c-1 reste monté");
    assert.ok(mountedNames(host).includes("kl-c-1"));
    assert.ok(mountedNames(host).includes("kl-c-2"));

    first.initialize();
    assert.strictEqual(
      afterFirst[0]!.closes,
      1,
      "la première instance retire le sien",
    );
    assert.ok(!mountedNames(host).includes("kl-c-1"));
  });
});
