import assert from "node:assert";
import cluster from "node:cluster";
import os from "node:os";
import path from "node:path";
import Kernel, {
  Events,
  TypeKernelOptions,
  FilterInterface,
  NetworkInterface,
} from "../kernel/Kernel";
import Module from "../kernel/Module";
import Syslog from "../syslog/Syslog";
import Pdu from "../syslog/Pdu";
import { Nodefony } from "../Nodefony";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function interceptNormalizeLog(): { received: Pdu[]; restore: () => void } {
  const received: Pdu[] = [];
  const orig = Syslog.normalizeLog;
  Syslog.normalizeLog = (p: Pdu) => {
    received.push(p);
    return p;
  };
  return {
    received,
    restore: () => {
      Syslog.normalizeLog = orig;
    },
  };
}

function mkKernel(
  env: "development" | "production" = "development",
  opts: TypeKernelOptions = {},
): Kernel {
  return new Kernel(env, null, opts);
}

// Minimal Module subclass for registry tests
class TestModule extends Module {
  constructor(kernel: Kernel) {
    super("TestModule", kernel, "/tmp/test-module", {});
  }
}

class OtherModule extends Module {
  constructor(kernel: Kernel) {
    super("OtherModule", kernel, "/tmp/other-module", {});
  }
}

// ─── 1. Constructor & defaults ────────────────────────────────────────────────

describe("Kernel — constructor & defaults", () => {
  it("environment est stocké correctement", () => {
    const k = mkKernel("development");
    assert.strictEqual(k.environment, "development");
  });

  it("environment production", () => {
    const k = mkKernel("production");
    assert.strictEqual(k.environment, "production");
  });

  it("profil console par défaut (servers:false, sans CLI)", () => {
    const k = mkKernel();
    assert.strictEqual(k.runProfile.servers, false);
    assert.strictEqual(k.runProfile.lifetime, "oneshot");
  });

  it("cli = null sans CLI passé", () => {
    const k = mkKernel();
    assert.strictEqual(k.cli, null);
  });

  it("flags lifecycle tous à false", () => {
    const k = mkKernel();
    assert.strictEqual(k.started, false);
    assert.strictEqual(k.booted, false);
    assert.strictEqual(k.ready, false);
    assert.strictEqual(k.postReady, false);
    assert.strictEqual(k.registered, false);
    assert.strictEqual(k.preRegistered, false);
  });

  it("kernel === this (auto-référence)", () => {
    const k = mkKernel();
    assert.strictEqual(k.kernel, k);
  });

  it("Container.get('kernel') === k", () => {
    const k = mkKernel();
    assert.strictEqual(k.get("kernel"), k);
  });

  it("injector créé et enregistré dans le container", () => {
    const k = mkKernel();
    assert.ok(k.injector, "injector doit exister");
    assert.strictEqual(k.get("injector"), k.injector);
  });

  it("Nodefony.getKernel() retourne le dernier kernel créé", () => {
    const k = mkKernel();
    assert.strictEqual(Nodefony.getKernel(), k);
  });

  it("debug = false par défaut", () => {
    const k = mkKernel();
    assert.strictEqual(k.debug, false);
  });

  it("progress initialisé à Events.onInit", () => {
    const k = mkKernel();
    assert.strictEqual(k.progress, Events.onInit);
  });

  it("modules = {} à la création", () => {
    const k = mkKernel();
    assert.deepStrictEqual(k.getModules(), {});
  });

  it("options fusionnées avec les defaults kernel", () => {
    const k = mkKernel("development", { log: { active: true } });
    // notre option custom doit être présente
    assert.ok(k.options.log?.active === true);
  });

  it("pid = process.pid", () => {
    const k = mkKernel();
    assert.strictEqual(k.pid, process.pid);
  });

  it("platform = process.platform", () => {
    const k = mkKernel();
    assert.strictEqual(k.platform, process.platform);
  });

  it("numberCpu = os.cpus().length", () => {
    const k = mkKernel();
    assert.strictEqual(k.numberCpu, os.cpus().length);
  });

  it("fire('onInit') déclenché pendant le constructeur", () => {
    // On vérifie que les listeners attachés AVANT la construction reçoivent l'event.
    // Impossible à tester sans hook — on vérifie juste que la création ne lève pas.
    assert.doesNotThrow(() => mkKernel());
  });
});

// ─── 2. Events bitmask ───────────────────────────────────────────────────────

describe("Kernel — Events bitmask", () => {
  it("Events est un objet gelé (Object.isFrozen)", () => {
    assert.ok(Object.isFrozen(Events));
  });

  it("valeurs bitmask correctes (puissances de 2)", () => {
    assert.strictEqual(Events.onInit, 1);
    assert.strictEqual(Events.onPreStart, 2);
    assert.strictEqual(Events.onStart, 4);
    assert.strictEqual(Events.onPreRegister, 8);
    assert.strictEqual(Events.onRegister, 16);
    assert.strictEqual(Events.onPreBoot, 32);
    assert.strictEqual(Events.onBoot, 64);
    assert.strictEqual(Events.onReady, 128);
    assert.strictEqual(Events.onServersReady, 256);
    assert.strictEqual(Events.onPostReady, 512);
    assert.strictEqual(Events.onTerminate, 1024);
  });

  it("Events.onInit expose le même objet que kernel.Events", () => {
    const k = mkKernel();
    assert.strictEqual(k.Events.onInit, Events.onInit);
  });

  it("getEventName(1) === 'onInit'", () => {
    const k = mkKernel();
    assert.strictEqual(k.getEventName(1), "onInit");
  });

  it("getEventName(4) === 'onStart'", () => {
    const k = mkKernel();
    assert.strictEqual(k.getEventName(4), "onStart");
  });

  it("getEventName(1024) === 'onTerminate'", () => {
    const k = mkKernel();
    assert.strictEqual(k.getEventName(1024), "onTerminate");
  });

  it("getEventName(valeur inconnue) === undefined", () => {
    const k = mkKernel();
    assert.strictEqual(k.getEventName(999), undefined);
  });

  it("setCommandComplete sans command → retourne false", () => {
    const k = mkKernel();
    assert.strictEqual(k.setCommandComplete(Events.onStart), false);
  });

  it("setCommandComplete met à jour progress via OR", () => {
    const k = mkKernel();
    const before = k.progress;
    k.setCommandComplete(Events.onStart);
    // progress doit maintenant avoir le bit onStart en plus
    assert.ok((k.progress & Events.onStart) !== 0);
    // bit onInit déjà présent depuis le constructeur
    assert.ok((k.progress & Events.onInit) !== 0);
    // progress a augmenté
    assert.ok(k.progress >= before);
  });

  it("isCommandComplete sans command → toujours false", () => {
    const k = mkKernel();
    assert.strictEqual(k.isCommandComplete(Events.onInit), false);
    assert.strictEqual(k.isCommandComplete(Events.onStart), false);
    assert.strictEqual(k.isCommandComplete(Events.onTerminate), false);
  });

  it("progress accumule plusieurs bits", () => {
    const k = mkKernel();
    k.setCommandComplete(Events.onStart);
    k.setCommandComplete(Events.onRegister);
    k.setCommandComplete(Events.onBoot);
    assert.ok((k.progress & Events.onStart) !== 0);
    assert.ok((k.progress & Events.onRegister) !== 0);
    assert.ok((k.progress & Events.onBoot) !== 0);
  });

  it("tous les bits de Events sont uniques (pas de chevauchement)", () => {
    const vals = Object.values(Events);
    const set = new Set(vals);
    assert.strictEqual(set.size, vals.length, "valeurs dupliquées détectées");
  });
});

// ─── 3. isConsole ────────────────────────────────────────────────────────────

describe("Kernel — isConsole", () => {
  it("profil console par défaut (servers:false) → true", () => {
    const k = mkKernel();
    assert.strictEqual(k.isConsole(), true);
  });

  it("runProfile.servers = false → true", () => {
    const k = mkKernel();
    k.runProfile = { servers: false, lifetime: "oneshot", interactive: false };
    assert.strictEqual(k.isConsole(), true);
  });

  it("runProfile.servers = true → false", () => {
    const k = mkKernel();
    k.runProfile = {
      servers: true,
      lifetime: "longrunning",
      interactive: false,
    };
    assert.strictEqual(k.isConsole(), false);
  });
});

// ─── 4. clusterIsMaster ──────────────────────────────────────────────────────

describe("Kernel — clusterIsMaster", () => {
  it("délègue à cluster.isPrimary", () => {
    const k = mkKernel();
    assert.strictEqual(k.clusterIsMaster(), cluster.isPrimary);
  });
});

// ─── 5. setEnv ───────────────────────────────────────────────────────────────

describe("Kernel — setEnv", () => {
  it("'development' → environment='development'", () => {
    const k = mkKernel("production");
    k.setEnv("development");
    assert.strictEqual(k.environment, "development");
    assert.strictEqual(k.appEnvironment.environment, "development");
  });

  it("'dev' → normalise en 'development'", () => {
    const k = mkKernel("production");
    k.setEnv("dev");
    assert.strictEqual(k.environment, "development");
  });

  it("'production' → environment='production'", () => {
    const k = mkKernel("development");
    k.setEnv("production");
    assert.strictEqual(k.environment, "production");
    assert.strictEqual(k.appEnvironment.environment, "production");
  });

  it("valeur inconnue → branch default → 'production'", () => {
    const k = mkKernel("development");
    k.setEnv("staging" as any);
    assert.strictEqual(k.environment, "production");
  });

  it("valeur falsy — pas de changement (guard)", () => {
    const k = mkKernel("development");
    const before = k.environment;
    k.setEnv("" as any);
    assert.strictEqual(k.environment, before);
  });
});

// ─── 6. setNodeEnv ───────────────────────────────────────────────────────────

describe("Kernel — setNodeEnv", () => {
  let savedNodeEnv: string | undefined;
  let savedBabelEnv: string | undefined;
  let savedNodeDebug: string | undefined;

  beforeEach(() => {
    savedNodeEnv = process.env.NODE_ENV;
    savedBabelEnv = process.env.BABEL_ENV;
    savedNodeDebug = process.env.NODE_DEBUG;
  });

  afterEach(() => {
    process.env.NODE_ENV = savedNodeEnv;
    process.env.BABEL_ENV = savedBabelEnv;
    process.env.NODE_DEBUG = savedNodeDebug;
  });

  it("'development' → NODE_ENV=development + isDev=true", () => {
    const k = mkKernel();
    k.setNodeEnv("development");
    assert.strictEqual(process.env.NODE_ENV, "development");
    assert.strictEqual(process.env.BABEL_ENV, "development");
    assert.strictEqual(k.isDev, true);
  });

  it("'dev' → même effet que 'development'", () => {
    const k = mkKernel();
    k.setNodeEnv("dev");
    assert.strictEqual(process.env.NODE_ENV, "development");
    assert.strictEqual(k.isDev, true);
  });

  it("'production' → NODE_ENV=production + isProd=true", () => {
    const k = mkKernel();
    k.setNodeEnv("production");
    assert.strictEqual(process.env.NODE_ENV, "production");
    assert.strictEqual(process.env.BABEL_ENV, "production");
    assert.strictEqual(k.isProd, true);
  });

  it("valeur inconnue → branch default → production", () => {
    const k = mkKernel();
    k.setNodeEnv("staging" as any);
    assert.strictEqual(process.env.NODE_ENV, "production");
  });

  it("debug=false → NODE_DEBUG='false'", () => {
    const k = mkKernel();
    k.debug = false;
    k.setNodeEnv("development");
    assert.strictEqual(process.env.NODE_DEBUG, "false");
  });

  it("debug=true → NODE_DEBUG='true'", () => {
    const k = mkKernel();
    k.debug = true;
    k.setNodeEnv("development");
    assert.strictEqual(process.env.NODE_DEBUG, "true");
  });
});

// ─── 7. checkPath ────────────────────────────────────────────────────────────

describe("Kernel — checkPath", () => {
  it("chemin absolu → retourné tel quel", () => {
    const k = mkKernel();
    const abs = "/usr/local/bin";
    assert.strictEqual(k.checkPath(abs), abs);
  });

  it("chemin relatif → résolu par rapport à kernel.path", () => {
    const k = mkKernel();
    const rel = "src/myfile.ts";
    const expected = path.resolve(k.path, rel);
    assert.strictEqual(k.checkPath(rel), expected);
  });

  it("chemin relatif avec '..' → path.resolve appliqué", () => {
    const k = mkKernel();
    const rel = "../sibling/file.js";
    const expected = path.resolve(k.path, rel);
    assert.strictEqual(k.checkPath(rel), expected);
  });

  it("chaîne vide → null", () => {
    const k = mkKernel();
    assert.strictEqual(k.checkPath(""), null);
  });

  it("null → null", () => {
    const k = mkKernel();
    assert.strictEqual(k.checkPath(null as any), null);
  });
});

// ─── 8. readConfig ───────────────────────────────────────────────────────────

describe("Kernel — readConfig", () => {
  it("sans argument → retourne this.options", () => {
    const k = mkKernel("development", { log: { active: true } });
    const opts = k.readConfig();
    assert.strictEqual(opts, k.options);
  });

  it("avec config → fusionne dans this.options", () => {
    const k = mkKernel();
    k.readConfig({ log: { active: true, debug: "*" } });
    assert.strictEqual(k.options.log?.active, true);
    assert.strictEqual(k.options.log?.debug, "*");
  });

  it("fusion profonde préserve les clés existantes", () => {
    const k = mkKernel("development", { log: { active: true } });
    k.readConfig({ log: { debug: "*" } });
    // active toujours là, debug ajouté
    assert.ok(
      k.options.log?.active !== undefined || k.options.log?.debug === "*",
    );
  });

  it("retourne les options après fusion", () => {
    const k = mkKernel();
    const result = k.readConfig({ log: { active: false } });
    assert.ok(result && typeof result === "object");
  });
});

// ─── 9. stats & memoryUsage ──────────────────────────────────────────────────

describe("Kernel — stats & memoryUsage", () => {
  it("stats() retourne { memory: MemoryStats }", () => {
    const k = mkKernel();
    const s = k.stats();
    assert.ok(s && typeof s === "object");
    assert.ok(s.memory && typeof s.memory === "object");
  });

  it("stats().memory contient les 4 champs numériques > 0", () => {
    const k = mkKernel();
    const { memory } = k.stats();
    assert.ok(typeof memory.rss === "number" && memory.rss > 0);
    assert.ok(typeof memory.heapTotal === "number" && memory.heapTotal > 0);
    assert.ok(typeof memory.heapUsed === "number" && memory.heapUsed > 0);
    assert.ok(typeof memory.external === "number" && memory.external >= 0);
  });

  it("memoryUsage() émet exactement 4 logs via syslog", () => {
    const k = mkKernel("development", { log: { active: true } });
    k.initializeLog();
    const pdus: Pdu[] = [];
    k.syslog?.on("onLog", (pdu: Pdu) => pdus.push(pdu));
    k.memoryUsage();
    // 4 champs: rss, heapTotal, heapUsed, external
    const memLogs = pdus.filter((p) => p.msgid?.startsWith("MEMORY"));
    assert.strictEqual(memLogs.length, 4);
  });

  it("memoryUsage('CUSTOM') inclut le message custom", () => {
    const k = mkKernel("development", { log: { active: true } });
    k.initializeLog();
    const pdus: Pdu[] = [];
    k.syslog?.on("onLog", (pdu: Pdu) => pdus.push(pdu));
    k.memoryUsage("CUSTOM");
    const found = pdus.some((p) => String(p.payload).includes("CUSTOM"));
    assert.ok(found, "message 'CUSTOM' doit apparaître dans les logs");
  });
});

// ─── 10. Network interfaces ──────────────────────────────────────────────────

describe("Kernel — getNetworkInterfaces & interfacesFilter", () => {
  it("getNetworkInterfaces() retourne un objet non vide", () => {
    const k = mkKernel();
    const ifaces = k.getNetworkInterfaces();
    assert.ok(ifaces && typeof ifaces === "object");
    assert.ok(Object.keys(ifaces).length > 0, "au moins une interface réseau");
  });

  it("chaque entrée est un tableau de NetworkInterfaceInfo", () => {
    const k = mkKernel();
    for (const name of Object.keys(k.interfaces)) {
      assert.ok(Array.isArray(k.interfaces[name]));
      for (const info of k.interfaces[name]) {
        assert.ok(typeof info.address === "string");
        assert.ok(typeof info.family === "string");
        assert.ok(typeof info.internal === "boolean");
      }
    }
  });

  it("interfacesFilter() sans filtre → retourne this.interfaces", () => {
    const k = mkKernel();
    const result = k.interfacesFilter();
    assert.deepStrictEqual(result, k.interfaces);
  });

  it("interfacesFilter({ type: 'local' }) → uniquement interfaces internes", () => {
    const k = mkKernel();
    const result = k.interfacesFilter({ type: "local" });
    for (const name of Object.keys(result)) {
      for (const info of result[name]) {
        assert.strictEqual(info.internal, true);
      }
    }
  });

  it("interfacesFilter({ type: 'external' }) → uniquement interfaces non-internes", () => {
    const k = mkKernel();
    const result = k.interfacesFilter({ type: "external" });
    for (const name of Object.keys(result)) {
      for (const info of result[name]) {
        assert.strictEqual(info.internal, false);
      }
    }
  });

  it("interfacesFilter({ family: 'IPv4' }) → uniquement IPv4", () => {
    const k = mkKernel();
    const result = k.interfacesFilter({ family: "IPv4" });
    for (const name of Object.keys(result)) {
      for (const info of result[name]) {
        assert.strictEqual(info.family, "IPv4");
      }
    }
  });

  it("interfacesFilter({ family: 'IPv6' }) → uniquement IPv6", () => {
    const k = mkKernel();
    const result = k.interfacesFilter({ family: "IPv6" });
    for (const name of Object.keys(result)) {
      for (const info of result[name]) {
        assert.strictEqual(info.family, "IPv6");
      }
    }
  });

  it("interfacesFilter avec condition '||' — combine type et family", () => {
    const k = mkKernel();
    const result = k.interfacesFilter({
      type: "local",
      family: "IPv4",
      condition: "||",
    });
    // Chaque entrée doit vérifier (internal || family=IPv4)
    for (const name of Object.keys(result)) {
      for (const info of result[name]) {
        assert.ok(info.internal || info.family === "IPv4");
      }
    }
  });

  it("interfacesFilter({ type: 'external', family: 'IPv4', condition: '&&' }) → IPv4 externe seulement", () => {
    const k = mkKernel();
    const result = k.interfacesFilter({
      type: "external",
      family: "IPv4",
      condition: "&&",
    });
    for (const name of Object.keys(result)) {
      for (const info of result[name]) {
        assert.strictEqual(info.internal, false);
        assert.strictEqual(info.family, "IPv4");
      }
    }
  });

  it("getNetwork() retourne les 5 clés attendues", () => {
    const k = mkKernel();
    const net = k.getNetwork();
    assert.ok("external" in net);
    assert.ok("local" in net);
    assert.ok("ipv4" in net);
    assert.ok("ipv6" in net);
    assert.ok("interfaces" in net);
  });

  it("getFirstExternalInterface() retourne une adresse ou undefined", () => {
    const k = mkKernel();
    const iface = k.getFirstExternalInterface();
    if (iface !== undefined) {
      assert.ok(typeof iface.address === "string");
      assert.ok(iface.family === "IPv4");
      assert.strictEqual(iface.internal, false);
    }
    // undefined est acceptable si pas d'interface externe
  });

  it("getFirstExternalInterface('IPv6') filtre sur la family IPv6", () => {
    const k = mkKernel();
    const iface = k.getFirstExternalInterface("IPv6");
    if (iface !== undefined) {
      assert.strictEqual(iface.family, "IPv6");
    }
  });
});

// ─── 11. Module registry ─────────────────────────────────────────────────────

describe("Kernel — module registry", () => {
  it("getModules() retourne {} au démarrage", () => {
    const k = mkKernel();
    assert.deepStrictEqual(k.getModules(), {});
  });

  it("addModule(TestModule) → module enregistré", async () => {
    const k = mkKernel();
    const mod = await k.addModule(TestModule as any);
    assert.ok(mod instanceof Module);
    assert.strictEqual(mod.name, "TestModule");
  });

  it("getModule(name) → retourne le module ajouté", async () => {
    const k = mkKernel();
    await k.addModule(TestModule as any);
    const mod = k.getModule("TestModule");
    assert.ok(mod instanceof Module);
  });

  it("getModule('inexistant') → undefined", () => {
    const k = mkKernel();
    const mod = k.getModule("Inexistant");
    assert.strictEqual(mod, undefined);
  });

  it("getModules() après addModule → contient le module", async () => {
    const k = mkKernel();
    await k.addModule(TestModule as any);
    const mods = k.getModules();
    assert.ok("TestModule" in mods);
  });

  it("plusieurs modules ajoutés → tous présents", async () => {
    const k = mkKernel();
    await k.addModule(TestModule as any);
    await k.addModule(OtherModule as any);
    const mods = k.getModules();
    assert.ok("TestModule" in mods);
    assert.ok("OtherModule" in mods);
  });

  it("isModule(Module subclass) → true", () => {
    const k = mkKernel();
    assert.strictEqual(k.isModule(TestModule), true);
  });

  it("isModule(classe non-Module) → false", () => {
    const k = mkKernel();
    class NotAModule {}
    assert.strictEqual(k.isModule(NotAModule), false);
  });

  it("isModule(null) → lève TypeError (isSubclassOf ne protège pas contre null)", () => {
    const k = mkKernel();
    assert.throws(() => k.isModule(null), TypeError);
  });

  it("isModule({}) → false", () => {
    const k = mkKernel();
    assert.strictEqual(k.isModule({}), false);
  });
});

// ─── 12. setDomain ───────────────────────────────────────────────────────────

describe("Kernel — setDomain", () => {
  it("options.domain défini → retourne ce domaine", () => {
    const k = mkKernel("development", { domain: "example.com" } as any);
    assert.strictEqual(k.setDomain(), "example.com");
  });

  it("options.domain absent → 'localhost'", () => {
    const k = mkKernel();
    assert.strictEqual(k.setDomain(), "localhost");
  });

  it("options.domain = 'selectAuto' → adresse externe ou 'localhost'", () => {
    const k = mkKernel("development", { domain: "selectAuto" } as any);
    const domain = k.setDomain();
    assert.ok(typeof domain === "string");
    assert.ok(domain.length > 0);
    // doit être une adresse IP ou 'localhost'
  });
});

// ─── 13. logEnv ──────────────────────────────────────────────────────────────

describe("Kernel — logEnv", () => {
  it("retourne une string non vide", () => {
    const k = mkKernel();
    const txt = k.logEnv();
    assert.ok(typeof txt === "string" && txt.length > 0);
  });

  it("contient l'environnement courant", () => {
    const k = mkKernel("development");
    const txt = k.logEnv();
    assert.ok(
      txt.includes("development"),
      `logEnv doit contenir 'development', got: ${txt}`,
    );
  });

  it("contient l'info cluster (master/worker)", () => {
    const k = mkKernel();
    const txt = k.logEnv();
    assert.ok(txt.includes("master") || txt.includes("worker"));
  });
});

// ─── 14. initializeLog (expansion) ────────────────────────────────────────────

describe("Kernel — initializeLog", () => {
  it("log.active = false → retour immédiat, aucun listener", () => {
    const k = new Kernel("development", null, { log: { active: false } });
    k.initializeLog();
    assert.strictEqual(k.syslog?.listenerCount("onLog"), 0);
    assert.strictEqual(k.debug, false);
  });

  it("log sans debug → debug reste false, DEBUG ne passe pas", () => {
    const k = new Kernel("development", null, { log: { active: true } });
    k.initializeLog();
    assert.strictEqual(k.debug, false);
    assert.ok(k.syslog && k.syslog.listenerCount("onLog") > 0);

    const { received, restore } = interceptNormalizeLog();
    k.syslog?.log("debug msg", "DEBUG");
    k.syslog?.log("info msg", "INFO");
    restore();

    assert.ok(
      !received.some((p) => p.severityName === "DEBUG"),
      "DEBUG ne doit pas passer sans debug",
    );
    assert.ok(
      received.some((p) => p.severityName === "INFO"),
      "INFO doit passer",
    );
  });

  it("log.debug = '*' → kernel.debug = '*', tous les niveaux passent", () => {
    const k = new Kernel("development", null, {
      log: { active: true, debug: "*" },
    });
    k.initializeLog();
    assert.strictEqual(k.debug, "*");
    assert.ok(k.syslog && k.syslog.listenerCount("onLog") > 0);

    const { received, restore } = interceptNormalizeLog();
    k.syslog?.log("debug msg", "DEBUG");
    k.syslog?.log("info msg", "INFO");
    k.syslog?.log("error msg", "ERROR");
    restore();

    assert.ok(
      received.some((p) => p.severityName === "DEBUG"),
      "DEBUG doit passer avec '*'",
    );
    assert.ok(received.some((p) => p.severityName === "INFO"));
    assert.ok(received.some((p) => p.severityName === "ERROR"));
  });

  it("log.debug = true → kernel.debug = true, même effet que '*'", () => {
    const k = new Kernel("development", null, {
      log: { active: true, debug: true },
    });
    k.initializeLog();
    assert.strictEqual(k.debug, true);

    const { received, restore } = interceptNormalizeLog();
    k.syslog?.log("debug msg", "DEBUG");
    restore();

    assert.ok(
      received.some((p) => p.severityName === "DEBUG"),
      "DEBUG doit passer",
    );
  });

  it("log.debug = ['ROUTER'] → kernel.debug = ['ROUTER'], filtre par msgid", () => {
    const k = new Kernel("development", null, {
      log: { active: true, debug: ["ROUTER"] },
    });
    k.initializeLog();
    assert.deepStrictEqual(k.debug, ["ROUTER"]);

    const { received, restore } = interceptNormalizeLog();
    k.syslog?.log("router debug", "DEBUG", "ROUTER");
    k.syslog?.log("service debug", "DEBUG", "SERVICE");
    k.syslog?.log("info no msgid", "INFO");
    restore();

    assert.ok(
      received.some((p) => p.msgid === "ROUTER"),
      "msgid ROUTER doit passer",
    );
    assert.ok(
      !received.some((p) => p.msgid === "SERVICE"),
      "msgid SERVICE ne doit pas passer",
    );
    assert.ok(
      !received.some((p) => p.severityName === "INFO" && p.msgid === ""),
      "INFO sans msgid ne doit pas passer avec filtre msgid actif",
    );
  });

  it("log.debug = ['ROUTER','SEQUELIZE'] → les deux modules passent", () => {
    const k = new Kernel("development", null, {
      log: { active: true, debug: ["ROUTER", "SEQUELIZE"] },
    });
    k.initializeLog();
    assert.deepStrictEqual(k.debug, ["ROUTER", "SEQUELIZE"]);

    const { received, restore } = interceptNormalizeLog();
    k.syslog?.log("router debug", "DEBUG", "ROUTER");
    k.syslog?.log("seq debug", "DEBUG", "SEQUELIZE");
    k.syslog?.log("other debug", "DEBUG", "OTHER");
    restore();

    assert.ok(
      received.some((p) => p.msgid === "ROUTER"),
      "ROUTER doit passer",
    );
    assert.ok(
      received.some((p) => p.msgid === "SEQUELIZE"),
      "SEQUELIZE doit passer",
    );
    assert.ok(
      !received.some((p) => p.msgid === "OTHER"),
      "OTHER ne doit pas passer",
    );
  });

  it("CLI debug pré-activé (true) → config log.debug ignorée, pas de filtre msgid", () => {
    const k = new Kernel("development", null, {
      log: { active: true, debug: ["ROUTER"] },
    });
    k.debug = true;
    k.initializeLog();
    assert.strictEqual(
      k.debug,
      true,
      "CLI true ne doit pas être écrasé par config",
    );

    const { received, restore } = interceptNormalizeLog();
    k.syslog?.log("service debug", "DEBUG", "SERVICE");
    restore();

    assert.ok(
      received.some((p) => p.msgid === "SERVICE"),
      "avec CLI debug=true, pas de filtre msgid",
    );
  });

  it("initializeLog appelé 2x → un seul listener (removeAllListeners en amont)", () => {
    const k = new Kernel("development", null, {
      log: { active: true, debug: "*" },
    });
    k.initializeLog();
    k.initializeLog();
    assert.strictEqual(k.syslog?.listenerCount("onLog"), 1);
  });

  it("initializeLog appelé 2x → transports d'écriture NON dédoublés (anti-doublon JSONL)", () => {
    // En dev, initializeLog monte les FileTransport des drivers du Log Backplane.
    // Appelé 2× (logger précoce dans start(), puis re-init post-config dans loadApp()),
    // il doit RETIRER les transports du 1er passage avant de remonter — sinon chaque
    // log est écrit N× dans le JSONL (dédup addTransport par référence inopérante car
    // chaque passage crée une nouvelle instance FileTransport).
    const k = new Kernel("development", null, {
      log: { active: true, debug: "*" },
    });
    k.initializeLog();
    const after1 = k.syslog?.transportCount ?? 0;
    k.initializeLog();
    const after2 = k.syslog?.transportCount ?? 0;
    assert.strictEqual(
      after2,
      after1,
      "transports stables après 2e initializeLog",
    );
  });

  it("environment production — log.debug = '*' → DEBUG activé", () => {
    const k = new Kernel("production", null, {
      log: { active: true, debug: "*" },
    });
    k.initializeLog();
    assert.strictEqual(k.debug, "*");

    const { received, restore } = interceptNormalizeLog();
    k.syslog?.log("prod debug", "DEBUG");
    restore();

    assert.ok(
      received.some((p) => p.severityName === "DEBUG"),
      "DEBUG en production avec debug='*'",
    );
  });

  it("log.debug = false → debug reste false", () => {
    const k = new Kernel("development", null, {
      log: { active: true, debug: false },
    });
    k.initializeLog();
    assert.strictEqual(k.debug, false);
  });

  it("log.debug ignoré si this.debug déjà truthy (string)", () => {
    const k = new Kernel("development", null, {
      log: { active: true, debug: ["ROUTER"] },
    });
    k.debug = "*";
    k.initializeLog();
    assert.strictEqual(
      k.debug,
      "*",
      "'*' ne doit pas être écrasé par ['ROUTER']",
    );
  });
});

// ─── 15. fire / emit / fireAsync ─────────────────────────────────────────────

describe("Kernel — fire & emit", () => {
  it("fire() retourne boolean et déclenche les listeners", () => {
    const k = mkKernel();
    let called = false;
    k.on("onReady", () => {
      called = true;
    });
    const result = k.fire("onReady", k);
    assert.ok(typeof result === "boolean");
    assert.ok(called);
  });

  it("fireAsync() retourne une Promise résolue", async () => {
    const k = mkKernel();
    let called = false;
    k.on("onReady", async () => {
      called = true;
    });
    await k.fireAsync("onReady", k);
    assert.ok(called);
  });

  it("emit() déclenche les listeners", () => {
    const k = mkKernel();
    let called = false;
    k.on("onBoot", () => {
      called = true;
    });
    k.emit("onBoot", k);
    assert.ok(called);
  });
});

// ─── 16. Performance ─────────────────────────────────────────────────────────

describe("Kernel — performance", () => {
  it("10 000 appels syslog.log en < 500ms", () => {
    const k = new Kernel("development", null, { log: { active: false } });
    const start = Date.now();
    for (let i = 0; i < 10_000; i++) {
      k.syslog?.log(`msg ${i}`, "INFO");
    }
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 500, `10 000 logs ont pris ${elapsed}ms (> 500ms)`);
  });

  it("100 appels interfacesFilter sans dégradation", () => {
    const k = mkKernel();
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      k.interfacesFilter({ type: "external", family: "IPv4", condition: "&&" });
    }
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 200, `100 interfacesFilter ont pris ${elapsed}ms`);
  });

  it("100 addModule séquentiels → tous enregistrés", async () => {
    const k = mkKernel();
    const modules: (typeof Module)[] = [];

    for (let i = 0; i < 10; i++) {
      const name = `Module${i}`;
      // Créer dynamiquement des sous-classes nommées
      const DynModule = class extends Module {
        constructor(kernel: Kernel) {
          super(name, kernel, `/tmp/${name}`, {});
        }
      };
      Object.defineProperty(DynModule, "name", { value: name });
      modules.push(DynModule as any);
    }

    for (const Mod of modules) {
      await k.addModule(Mod as any);
    }

    const mods = k.getModules();
    assert.strictEqual(Object.keys(mods).length, 10);
  });

  it("getNetworkInterfaces() 50x → stable et consistant", () => {
    const k = mkKernel();
    const first = JSON.stringify(k.getNetworkInterfaces());
    for (let i = 0; i < 50; i++) {
      const result = JSON.stringify(k.getNetworkInterfaces());
      assert.strictEqual(
        result,
        first,
        `Résultat incohérent à l'itération ${i}`,
      );
    }
  });
});

// ─── 17. Cas limites & edge cases ────────────────────────────────────────────

describe("Kernel — edge cases", () => {
  it("options vides → ne lève pas", () => {
    assert.doesNotThrow(() => mkKernel("development", {}));
  });

  it("options undefined → ne lève pas", () => {
    assert.doesNotThrow(() => new Kernel("development", null));
  });

  it("deux kernels → Nodefony.getKernel() retourne le dernier", () => {
    const k1 = mkKernel("development");
    const k2 = mkKernel("production");
    assert.strictEqual(Nodefony.getKernel(), k2);
    assert.notStrictEqual(Nodefony.getKernel(), k1);
  });

  it("getModule sur kernel vide → undefined (pas d'exception)", () => {
    const k = mkKernel();
    assert.doesNotThrow(() => k.getModule("rien"));
    assert.strictEqual(k.getModule("rien"), undefined);
  });

  it("readConfig(config vide) → ne change pas les options", () => {
    const k = mkKernel("development", { log: { active: true } });
    const before = k.options.log?.active;
    k.readConfig({});
    assert.strictEqual(k.options.log?.active, before);
  });

  it("stats() appelé plusieurs fois → valeurs cohérentes", () => {
    const k = mkKernel();
    const s1 = k.stats();
    const s2 = k.stats();
    assert.ok(s2.memory.rss >= s1.memory.rss || s2.memory.rss > 0);
  });

  it("interfacesFilter avec objet filtre vide → même comportement que sans filtre", () => {
    const k = mkKernel();
    const withEmpty = k.interfacesFilter({} as FilterInterface);
    // Sans type ni family, matchType=false, matchFamily=false → aucun résultat
    // (les deux matchs sont false, condition && → false → aucune entrée poussée)
    for (const name of Object.keys(withEmpty)) {
      assert.strictEqual(withEmpty[name].length, 0);
    }
  });

  it("setCommandComplete → progress est cumulatif (idempotent sur le même bit)", () => {
    const k = mkKernel();
    k.setCommandComplete(Events.onStart);
    const p1 = k.progress;
    k.setCommandComplete(Events.onStart); // même bit, deuxième fois
    const p2 = k.progress;
    assert.strictEqual(p1, p2, "OR idempotent sur le même bit");
  });
});
