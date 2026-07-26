import assert from "node:assert";
import { resolve, dirname, sep } from "node:path";
import { pathToFileURL } from "node:url";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import Module from "../kernel/Module";
import type { PackageJson } from "../types/IModule";
import type { IModule } from "../types/IModule";
import Container from "../Container";
import Service from "../Service";
import Kernel from "../kernel/Kernel";
import Injector from "../kernel/injector/injector";
import type { DefaultOptionsService } from "../Service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Stub minimal : uniquement kernel.container est utilisé dans Module constructor.
function makeKernelStub(): Kernel {
  const container = new Container();
  return { container } as unknown as Kernel;
}

// Chemin réel du workspace nodefony (a un package.json)
const NODEFONY_DIR = resolve(process.cwd());
const NODEFONY_PKG = resolve(NODEFONY_DIR, "package.json");

// Path dont setPath() donne NODEFONY_DIR comme résultat
// setPath(NODEFONY_PKG) → dirname("/…/nodefony/package.json") = "/…/nodefony" ✓
const PATH_FOR_NODEFONY_DIR = NODEFONY_PKG;

function makeKernelReal(opts = {}): Kernel {
  return new Kernel("development", null, { log: { active: false }, ...opts });
}

// Module avec un vrai kernel → mod.kernel === kernel
function makeModuleWithKernel(
  name = "test",
  path = PATH_FOR_NODEFONY_DIR,
  options: DefaultOptionsService = {},
): { kernel: Kernel; mod: Module } {
  const kernel = makeKernelReal();
  const mod = new Module(name, kernel, path, options);
  return { kernel, mod };
}

// ─── 1. Construction (base — inchangé) ───────────────────────────────────────

describe("Module — construction", () => {
  it("crée un module avec un kernel stub", () => {
    const mod = new Module("hello", makeKernelStub(), process.cwd(), {});
    assert(mod instanceof Module);
    assert.strictEqual(mod.name, "hello");
    assert(typeof mod.path === "string");
    assert.strictEqual(mod.isApp, false);
    assert.strictEqual(mod.package, undefined);
  });

  it("hérite de Service (container, syslog)", () => {
    const mod = new Module("svc-check", makeKernelStub(), process.cwd(), {});
    assert(mod.container instanceof Container);
    assert(mod.syslog !== null);
  });

  it("kernel est null — container ne contient pas 'kernel'", () => {
    const mod = new Module("no-kernel", makeKernelStub(), process.cwd(), {});
    assert.strictEqual(mod.kernel, null);
  });

  it("mod.kernel résolu si kernel est dans le container (vrai Kernel)", () => {
    const { kernel, mod } = makeModuleWithKernel("real-kernel-mod");
    assert.strictEqual(mod.kernel, kernel);
  });

  it("path calculé par setPath() depuis l'argument path du constructeur", () => {
    const { mod } = makeModuleWithKernel("path-check");
    assert.strictEqual(mod.path, NODEFONY_DIR);
  });

  it("options propagées au Service", () => {
    const opts: DefaultOptionsService = { syslog: { maxStack: 50 } };
    const { mod } = makeModuleWithKernel(
      "opts-check",
      PATH_FOR_NODEFONY_DIR,
      opts,
    );
    assert.strictEqual(mod.options.syslog?.maxStack, 50);
  });

  it("isApp vaut false à la construction, peut être true après", () => {
    const { mod } = makeModuleWithKernel("isapp-mod");
    assert.strictEqual(mod.isApp, false);
    mod.isApp = true;
    assert.strictEqual(mod.isApp, true);
  });

  it("package est undefined à la construction", () => {
    const { mod } = makeModuleWithKernel("pkg-mod");
    assert.strictEqual(mod.package, undefined);
  });
});

// ─── 2. setPath() (base — inchangé) ──────────────────────────────────────────

describe("Module — setPath()", () => {
  let mod: Module;

  beforeAll(() => {
    mod = new Module("path-test", makeKernelStub(), process.cwd(), {});
  });

  it("chemin normal → dirname du fichier", () => {
    const result = mod.setPath("/a/b/module.ts");
    assert.strictEqual(result, "/a/b");
  });

  it("chemin avec /dist/ → remonte d'un niveau", () => {
    const result = mod.setPath("/a/b/dist/index.ts");
    assert.strictEqual(result, "/a/b");
  });

  it("chemin file:// → décodé puis dirname", () => {
    // L'URL se construit à partir d'un chemin NATIF : `file:///a/b/module.ts` n'est pas
    // une URL de fichier valide sous Windows (aucune lettre de lecteur), et la comparer
    // à un littéral POSIX éprouverait la plateforme au lieu du mécanisme — qui est le
    // décodage d'une URL réelle, celle que rend `import.meta.url`.
    const native = resolve(sep, "a", "b", "module.ts");
    const result = mod.setPath(pathToFileURL(native).href);
    assert.strictEqual(result, dirname(native));
  });

  it("chemin déjà normalisé (dossier sans extension)", () => {
    const result = mod.setPath("/a/b/mymodule");
    assert.strictEqual(result, "/a/b");
  });

  it("chemin profond avec /dist → remonte au parent de dist", () => {
    const result = mod.setPath("/x/y/z/dist/bundle.js");
    assert.strictEqual(result, "/x/y/z");
  });

  it("répertoire racine-like → ne throw pas", () => {
    assert.doesNotThrow(() => mod.setPath("/a/b/c.js"));
  });
});

// ─── 3. setEvents() ──────────────────────────────────────────────────────────

describe("Module — setEvents()", () => {
  it("prependOnceListener 'onPreBoot' toujours enregistré (kernel réel)", () => {
    const { kernel, mod } = makeModuleWithKernel("evt-pre-boot");
    void mod; // module créé → listener enregistré dans kernel
    const count = kernel.listenerCount("onPreBoot");
    assert.ok(count > 0, "listener onPreBoot doit exister");
  });

  it("onKernelRegister (méthode prototype) → listener sur 'onRegister'", () => {
    const kernel = makeKernelReal();
    const before = kernel.listenerCount("onRegister");

    class ModWithRegister extends Module {
      constructor(k: Kernel) {
        super("reg-hook", k, PATH_FOR_NODEFONY_DIR, {});
      }
      override async onKernelRegister(): Promise<this> {
        return this;
      }
    }
    new ModWithRegister(kernel);

    assert.ok(
      kernel.listenerCount("onRegister") > before,
      "listener 'onRegister' ajouté par onKernelRegister",
    );
  });

  it("onKernelBoot (méthode prototype) → listener sur 'onBoot'", () => {
    const kernel = makeKernelReal();
    const before = kernel.listenerCount("onBoot");

    class ModWithBoot extends Module {
      constructor(k: Kernel) {
        super("boot-hook", k, PATH_FOR_NODEFONY_DIR, {});
      }
      override async onKernelBoot(): Promise<this> {
        return this;
      }
    }
    new ModWithBoot(kernel);

    assert.ok(
      kernel.listenerCount("onBoot") > before,
      "listener 'onBoot' ajouté",
    );
  });

  it("onKernelReady (méthode prototype) → listener sur 'onReady'", () => {
    const kernel = makeKernelReal();
    const before = kernel.listenerCount("onReady");

    class ModWithReady extends Module {
      constructor(k: Kernel) {
        super("ready-hook", k, PATH_FOR_NODEFONY_DIR, {});
      }
      override async onKernelReady(): Promise<this> {
        return this;
      }
    }
    new ModWithReady(kernel);

    assert.ok(
      kernel.listenerCount("onReady") > before,
      "listener 'onReady' ajouté",
    );
  });

  it("hooks non définis → pas de listener onRegister/onReady supplémentaire", () => {
    const kernel = makeKernelReal();
    const regBefore = kernel.listenerCount("onRegister");
    const readyBefore = kernel.listenerCount("onReady");

    new Module("no-hooks", kernel, PATH_FOR_NODEFONY_DIR, {});

    // onRegister et onReady ne sont ajoutés que si onKernelRegister/Ready sont définis
    assert.strictEqual(kernel.listenerCount("onRegister"), regBefore);
    assert.strictEqual(kernel.listenerCount("onReady"), readyBefore);
    // Note: onBoot a +1 depuis le constructeur Module (rollup/watcher) indépendamment des hooks
  });

  it("kernel null (stub sans kernel) → setEvents() ne throw pas", () => {
    assert.doesNotThrow(
      () => new Module("stub-events", makeKernelStub(), process.cwd(), {}),
    );
  });
});

// ─── 4. readOverrideModuleConfig() ───────────────────────────────────────────

describe("Module — readOverrideModuleConfig()", () => {
  it("retourne options intact sans clé Module-*", () => {
    const mod = new Module("override-test", makeKernelStub(), process.cwd(), {
      debug: false,
    });
    const result = mod.readOverrideModuleConfig();
    assert.strictEqual(result, mod.options);
  });

  it("Module-target trouvé → fusionne les options (deep=true)", () => {
    const kernel = makeKernelReal();
    const targetMod = new Module("target", kernel, PATH_FOR_NODEFONY_DIR, {
      oldKey: "old",
      nested: { a: 1 },
    });
    kernel.modules["target"] = targetMod;

    const hostMod = new Module("host", kernel, PATH_FOR_NODEFONY_DIR, {
      "Module-target": { newKey: "new", nested: { b: 2 } },
    });
    hostMod.readOverrideModuleConfig();

    assert.strictEqual((targetMod.options as any).newKey, "new");
    assert.ok((targetMod.options as any).nested?.b === 2);
  });

  it("Module-target trouvé + deep=false → fusion shallow", () => {
    const kernel = makeKernelReal();
    const targetMod = new Module(
      "shallow-target",
      kernel,
      PATH_FOR_NODEFONY_DIR,
      {
        keep: "yes",
      },
    );
    kernel.modules["shallow-target"] = targetMod;

    const hostMod = new Module("shallow-host", kernel, PATH_FOR_NODEFONY_DIR, {
      "Module-shallow-target": { extra: "added" },
    });
    hostMod.readOverrideModuleConfig(false);

    assert.strictEqual((targetMod.options as any).extra, "added");
  });

  it("Module-target non trouvé → log WARNING, continue sans throw", () => {
    const kernel = makeKernelReal();
    const hostMod = new Module("err-host", kernel, PATH_FOR_NODEFONY_DIR, {
      "Module-ghost": { x: 1 },
    });
    assert.doesNotThrow(() => hostMod.readOverrideModuleConfig());
  });

  it("regex case : 'module-target' (m minuscule) est aussi reconnu", () => {
    const kernel = makeKernelReal();
    const targetMod = new Module(
      "lc-target",
      kernel,
      PATH_FOR_NODEFONY_DIR,
      {},
    );
    kernel.modules["lc-target"] = targetMod;

    const hostMod = new Module("lc-host", kernel, PATH_FOR_NODEFONY_DIR, {
      "module-lc-target": { injected: true },
    });
    assert.doesNotThrow(() => hostMod.readOverrideModuleConfig());
    assert.strictEqual((targetMod.options as any).injected, true);
  });
});

// ─── 5. addService() ─────────────────────────────────────────────────────────

describe("Module — addService()", () => {
  // Service minimal compatible avec Injector.instantiate(service, module, ...args)
  class SimpleService extends Service {
    constructor(module: Module) {
      // `Module.container` est `Container | null` ; `Service` attend
      // `Container | undefined` (pas de container → il en crée un).
      super("SimpleService", module.container ?? undefined, undefined, {});
    }
  }

  class InitService extends Service {
    initialized = false;
    constructor(module: Module) {
      super("InitService", module.container ?? undefined, undefined, {});
    }
    async init(_module?: Module): Promise<this> {
      this.initialized = true;
      return this;
    }
  }

  it("addService() enregistre le service dans le container", async () => {
    const { mod } = makeModuleWithKernel("add-svc-mod");
    await mod.addService(SimpleService as any);
    const found = mod.get<SimpleService>("SimpleService");
    assert.ok(found instanceof SimpleService);
  });

  it("addService() retourne l'instance du service", async () => {
    const { mod } = makeModuleWithKernel("add-svc-ret");
    const svc = await mod.addService(SimpleService as any);
    assert.ok(svc instanceof Service);
    assert.strictEqual(svc.name, "SimpleService");
  });

  it("service avec init() → init() appelé", async () => {
    const { mod } = makeModuleWithKernel("init-svc-mod");
    const svc = await mod.addService(InitService as any);
    assert.ok((svc as InitService).initialized === true);
  });

  it("addService() deux fois → WARNING log, override", async () => {
    const { mod } = makeModuleWithKernel("dup-svc-mod");
    await mod.addService(SimpleService as any);

    const pdus: import("../syslog/Pdu").default[] = [];
    mod.syslog?.on("onLog", (p: import("../syslog/Pdu").default) =>
      pdus.push(p),
    );
    await mod.addService(SimpleService as any); // second ajout
    mod.syslog?.removeAllListeners();

    const warn = pdus.some(
      (p) =>
        p.severityName === "WARNING" &&
        String(p.payload).includes("ALREADY EXIST"),
    );
    assert.ok(warn, "un WARNING doit être logué lors du double ajout");
  });
});

// ─── 6. getPackageJson() ─────────────────────────────────────────────────────

describe("Module — getPackageJson()", () => {
  it("lit le package.json depuis mod.path", async () => {
    const { mod } = makeModuleWithKernel("pkg-json-mod");
    // mod.path = NODEFONY_DIR, qui a un package.json
    const pkg = await mod.getPackageJson();
    assert.ok(pkg && typeof pkg === "object");
    assert.ok(typeof pkg.name === "string");
    assert.ok(typeof pkg.version === "string");
  });

  it("rejette si package.json absent du path", async () => {
    const tmpDir = os.tmpdir();
    const mod = new Module(
      "no-pkg",
      makeKernelStub(),
      tmpDir + "/fake-file.js",
      {},
    );
    // mod.path = tmpDir → pas de package.json
    await assert.rejects(() => mod.getPackageJson(), { code: "ENOENT" });
  });
});

// ─── 7. loadJson() ───────────────────────────────────────────────────────────

describe("Module — loadJson()", () => {
  let mod: Module;

  beforeAll(() => {
    mod = new Module("json-test", makeKernelStub(), process.cwd(), {});
  });

  it("charge le package.json du workspace", async () => {
    const json = await mod.loadJson(NODEFONY_PKG);
    assert(typeof json === "object");
    assert(typeof (json as Record<string, unknown>).name === "string");
  });

  it("rejette si le fichier n'existe pas", async () => {
    await assert.rejects(
      () => mod.loadJson("/tmp/__non_existent_file__.json"),
      { code: "ENOENT" },
    );
  });

  it("chemin relatif + cwd → résolu correctement", async () => {
    // loadJson("package.json", NODEFONY_DIR) → NODEFONY_DIR/package.json
    const json = await mod.loadJson("package.json", NODEFONY_DIR);
    assert.ok(typeof (json as Record<string, unknown>).name === "string");
  });

  it("JSON invalide → throw SyntaxError", async () => {
    const tmpFile = resolve(os.tmpdir(), `invalid-${Date.now()}.json`);
    await fs.writeFile(tmpFile, "{ not valid json }", "utf-8");
    try {
      await assert.rejects(() => mod.loadJson(tmpFile), SyntaxError);
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  });
});

// ─── 8. install() & outdated() ───────────────────────────────────────────────

describe("Module — install() & outdated()", () => {
  it("install() sans cli → throw 'Package Manager not found'", async () => {
    const mod = new Module("install-test", makeKernelStub(), process.cwd(), {});
    await assert.rejects(() => mod.install(), /Package Manager not found/);
  });

  it("install(force=true) sans cli → throw 'Package Manager not found'", async () => {
    const mod = new Module(
      "install-force",
      makeKernelStub(),
      process.cwd(),
      {},
    );
    await assert.rejects(() => mod.install(true), /Package Manager not found/);
  });

  it("outdated() sans cli → throw 'Package Manager not found'", async () => {
    const mod = new Module(
      "outdated-test",
      makeKernelStub(),
      process.cwd(),
      {},
    );
    await assert.rejects(() => mod.outdated(), /Package Manager not found/);
  });

  it("install() avec kernel réel (sans cli) → throw 'Package Manager not found'", async () => {
    const { mod } = makeModuleWithKernel("install-real-kernel");
    await assert.rejects(() => mod.install(), /Package Manager not found/);
  });
});

// ─── 9. addCommand() ─────────────────────────────────────────────────────────

describe("Module — addCommand()", () => {
  it("kernel non défini (stub) → throw 'Kernel not ready'", () => {
    const mod = new Module("cmd-test", makeKernelStub(), process.cwd(), {});
    assert.throws(() => mod.addCommand(class {} as any), /Kernel not ready/);
  });

  it("kernel réel sans cli → throw 'Kernel not ready'", () => {
    const { mod } = makeModuleWithKernel("cmd-real-kernel");
    // kernel.cli = null → mod.kernel.cli = null → throw
    assert.throws(() => mod.addCommand(class {} as any), /Kernel not ready/);
  });
});

// ─── 10. métadonnées package (base — inchangé + expansion) ───────────────────

describe("Module — métadonnées package", () => {
  let mod: Module;

  beforeAll(() => {
    mod = new Module("meta-test", makeKernelStub(), process.cwd(), {});
  });

  it("getModuleName() retourne undefined avant chargement", () => {
    assert.strictEqual(mod.getModuleName(), undefined);
  });

  it("getModuleVersion() retourne undefined avant chargement", () => {
    assert.strictEqual(mod.getModuleVersion(), undefined);
  });

  it("getModuleName() retourne le nom après affectation", () => {
    mod.package = { name: "@nodefony/test", version: "2.0.0" };
    assert.strictEqual(mod.getModuleName(), "@nodefony/test");
  });

  it("getModuleVersion() retourne la version après affectation", () => {
    assert.strictEqual(mod.getModuleVersion(), "2.0.0");
  });

  it("getDependencies() avec dependencies et peerDependencies", () => {
    mod.package = {
      name: "test",
      version: "1.0.0",
      dependencies: { lodash: "4.0.0", express: "5.0.0" },
      peerDependencies: { typescript: "5.0.0" },
    };
    const deps = mod.getDependencies();
    assert(Array.isArray(deps));
    assert(deps.includes("lodash"));
    assert(deps.includes("express"));
    assert(deps.includes("typescript"));
    assert.strictEqual(deps.length, 3);
  });

  it("getDependencies() sans package retourne []", () => {
    const mod2 = new Module("empty-pkg", makeKernelStub(), process.cwd(), {});
    assert.deepStrictEqual(mod2.getDependencies(), []);
  });

  it("getDependencies() — devDependencies non inclus", () => {
    const mod3 = new Module("dev-deps", makeKernelStub(), process.cwd(), {});
    mod3.package = {
      name: "d",
      version: "1.0.0",
      devDependencies: { jest: "29.0.0" },
      dependencies: { axios: "1.0.0" },
    };
    const deps = mod3.getDependencies();
    assert.ok(
      !deps.includes("jest"),
      "devDependencies ne doit pas être inclus",
    );
    assert.ok(deps.includes("axios"));
  });

  it("dépendance dans dependencies ET peerDependencies → apparaît 2x (comportement documenté)", () => {
    const mod4 = new Module("dup-deps", makeKernelStub(), process.cwd(), {});
    mod4.package = {
      name: "dup",
      version: "1.0.0",
      dependencies: { react: "18.0.0" },
      peerDependencies: { react: "18.0.0" },
    };
    const deps = mod4.getDependencies();
    const reactCount = deps.filter((d) => d === "react").length;
    assert.strictEqual(
      reactCount,
      2,
      "react apparaît 2x — dédupliqué si besoin par l'appelant",
    );
  });
});

// ─── 11. getPackageDependencies() statique (base — inchangé) ─────────────────

describe("Module — getPackageDependencies() (statique)", () => {
  it("fusionne dependencies + peerDependencies", () => {
    const pkg: PackageJson = {
      name: "x",
      version: "1.0.0",
      dependencies: { a: "1.0" },
      peerDependencies: { b: "2.0", c: "3.0" },
    };
    const deps = Module.getPackageDependencies(pkg);
    assert.deepStrictEqual(deps.sort(), ["a", "b", "c"]);
  });

  it("retourne [] si aucune dépendance", () => {
    const pkg: PackageJson = { name: "bare", version: "0.0.1" };
    assert.deepStrictEqual(Module.getPackageDependencies(pkg), []);
  });

  it("retourne [] si package undefined", () => {
    assert.deepStrictEqual(
      Module.getPackageDependencies(undefined as unknown as PackageJson),
      [],
    );
  });

  it("devDependencies ignoré — seulement dependencies + peerDependencies", () => {
    const pkg: PackageJson = {
      name: "y",
      version: "1.0.0",
      devDependencies: { vitest: "1.0.0" },
      dependencies: { lodash: "4.0.0" },
    };
    const deps = Module.getPackageDependencies(pkg);
    assert.ok(!deps.includes("vitest"));
    assert.ok(deps.includes("lodash"));
  });
});

// ─── 12. getController() & controllers statiques ─────────────────────────────

describe("Module — getController()", () => {
  let mod: Module;

  beforeAll(() => {
    mod = new Module("ctrl-test", makeKernelStub(), process.cwd(), {});
  });

  it("lève une erreur pour un controller inexistant", () => {
    assert.throws(
      () => mod.getController("NonExistentController"),
      /Controller.*not exist/,
    );
  });

  it("lève une erreur si name est vide (argument manquant)", () => {
    assert.throws(() => mod.getController(""), /mandatory/);
  });

  it("getControllers() retourne un objet (record partagé)", () => {
    const ctrls = mod.getControllers();
    assert(typeof ctrls === "object");
    assert(ctrls !== null);
  });

  it("getControllers() est module-scopé (clés sans préfixe, isolé par module)", () => {
    const FakeCtrl = class FakeCtrl {};
    const key = "ctrl-test:ScopedCtrl";
    const saved = (Module as any).controllers[key];
    try {
      (Module as any).controllers[key] = FakeCtrl;
      const ctrls = mod.getControllers();
      assert.strictEqual(ctrls["ScopedCtrl"], FakeCtrl);
      // un autre module ne voit pas ce controller (registre scopé par module)
      const mod2 = new Module(
        "ctrl-test-2",
        makeKernelStub(),
        process.cwd(),
        {},
      );
      assert.strictEqual(mod2.getControllers()["ScopedCtrl"], undefined);
    } finally {
      if (saved === undefined) delete (Module as any).controllers[key];
      else (Module as any).controllers[key] = saved;
    }
  });

  it("controller injecté (clé module-scopée) → getController() le trouve", () => {
    const FakeCtrl = class FakeCtrl {};
    const key = "ctrl-test:FakeCtrl";
    const saved = (Module as any).controllers[key];
    try {
      (Module as any).controllers[key] = FakeCtrl;
      const result = mod.getController("FakeCtrl");
      assert.strictEqual(result, FakeCtrl);
    } finally {
      if (saved === undefined) delete (Module as any).controllers[key];
      else (Module as any).controllers[key] = saved;
    }
  });
});

// ─── 13. log() ───────────────────────────────────────────────────────────────

describe("Module — log()", () => {
  it("préfixe msgid avec MODULE <nom>", () => {
    const mod = new Module("log-module", makeKernelStub(), process.cwd(), {});
    const pdu = mod.log("test message", "INFO");
    assert(pdu);
    assert(String(pdu.msgid).includes("MODULE"));
    assert(String(pdu.msgid).includes("log-module"));
  });

  it("conserve un msgid fourni explicitement", () => {
    const mod = new Module("log-module2", makeKernelStub(), process.cwd(), {});
    const pdu = mod.log("test", "DEBUG", "CUSTOM_ID");
    assert.strictEqual(pdu.msgid, "CUSTOM_ID");
  });

  it("log(Error) → pdu ACCEPTED avec typePayload 'Error'", () => {
    const mod = new Module("log-err", makeKernelStub(), process.cwd(), {});
    const pdu = mod.log(new Error("test error"), "ERROR");
    assert.strictEqual(pdu.typePayload, "Error");
    assert.strictEqual(pdu.status, "ACCEPTED");
  });

  it("log avec sévérité WARNING", () => {
    const mod = new Module("log-warn", makeKernelStub(), process.cwd(), {});
    const pdu = mod.log("warn msg", "WARNING");
    assert.strictEqual(pdu.severityName, "WARNING");
  });

  it("log avec sévérité CRITIC (≠ CRITICAL)", () => {
    const mod = new Module("log-critic", makeKernelStub(), process.cwd(), {});
    const pdu = mod.log("critic msg", "CRITIC");
    assert.strictEqual(pdu.severityName, "CRITIC");
  });

  it("log avec tous les paramètres (pci, severity, msgid, msg)", () => {
    const mod = new Module("log-full", makeKernelStub(), process.cwd(), {});
    const pdu = mod.log("payload", "INFO", "MY_ID", "my extra msg");
    assert.strictEqual(pdu.msgid, "MY_ID");
    assert.strictEqual(pdu.msg, "my extra msg");
    assert.strictEqual(pdu.severityName, "INFO");
  });

  it("msgid par défaut = 'MODULE <nom>' (format exact)", () => {
    const mod = new Module("exact-name", makeKernelStub(), process.cwd(), {});
    const pdu = mod.log("check");
    assert.strictEqual(pdu.msgid, "MODULE exact-name");
  });

  it("log retourne toujours un Pdu valide", () => {
    const mod = new Module("pdu-check", makeKernelStub(), process.cwd(), {});
    const pdu = mod.log(null, "INFO");
    assert.ok(pdu, "log doit retourner un Pdu");
    assert.ok(typeof pdu.uid === "number");
  });
});

// ─── 14. readOverrideModuleConfig() (base — inchangé) ────────────────────────

describe("Module — readOverrideModuleConfig() (base)", () => {
  it("retourne options intact sans clé Module-*", () => {
    const mod = new Module("override-test", makeKernelStub(), process.cwd(), {
      debug: false,
    });
    const result = mod.readOverrideModuleConfig();
    assert.strictEqual(result, mod.options);
  });
});

// ─── 15. IModule structurel (base — inchangé) ────────────────────────────────

describe("Module — IModule structurel", () => {
  it("est assignable à IModule", () => {
    const mod = new Module("iface-test", makeKernelStub(), process.cwd(), {});
    const imod: IModule = mod;
    assert(typeof imod.path === "string");
    assert(typeof imod.getModuleName === "function");
    assert(typeof imod.getModuleVersion === "function");
    assert(typeof imod.getDependencies === "function");
    assert(typeof imod.loadJson === "function");
    assert(typeof imod.getController === "function");
    assert(typeof imod.getControllers === "function");
    assert(typeof imod.install === "function");
    assert(typeof imod.outdated === "function");
  });
});

// ─── 16. Sous-classe avec lifecycle complet ───────────────────────────────────

describe("Module — sous-classe avec lifecycle hooks", () => {
  it("onKernelRegister déclenché quand kernel fire 'onRegister'", async () => {
    const kernel = makeKernelReal();
    let called = false;

    class AppModule extends Module {
      constructor(k: Kernel) {
        super("app", k, PATH_FOR_NODEFONY_DIR, {});
      }
      override async onKernelRegister(): Promise<this> {
        called = true;
        return this;
      }
    }
    new AppModule(kernel);
    await kernel.fireAsync("onRegister", kernel);
    assert.ok(called, "onKernelRegister doit être appelé");
  });

  it("onKernelBoot déclenché quand kernel fire 'onBoot'", async () => {
    const kernel = makeKernelReal();
    let called = false;

    class BootModule extends Module {
      constructor(k: Kernel) {
        super("boot-mod", k, PATH_FOR_NODEFONY_DIR, {});
      }
      override async onKernelBoot(): Promise<this> {
        called = true;
        return this;
      }
    }
    new BootModule(kernel);
    await kernel.fireAsync("onBoot", kernel);
    assert.ok(called, "onKernelBoot doit être appelé");
  });

  it("onKernelReady déclenché quand kernel fire 'onReady'", async () => {
    const kernel = makeKernelReal();
    let called = false;

    class ReadyModule extends Module {
      constructor(k: Kernel) {
        super("ready-mod", k, PATH_FOR_NODEFONY_DIR, {});
      }
      override async onKernelReady(): Promise<this> {
        called = true;
        return this;
      }
    }
    new ReadyModule(kernel);
    await kernel.fireAsync("onReady", kernel);
    assert.ok(called, "onKernelReady doit être appelé");
  });

  it("hooks once — ne fire qu'une seule fois", async () => {
    const kernel = makeKernelReal();
    let count = 0;

    class CountModule extends Module {
      constructor(k: Kernel) {
        super("count-mod", k, PATH_FOR_NODEFONY_DIR, {});
      }
      override async onKernelRegister(): Promise<this> {
        count++;
        return this;
      }
    }
    new CountModule(kernel);
    await kernel.fireAsync("onRegister", kernel);
    await kernel.fireAsync("onRegister", kernel); // deuxième fois
    assert.strictEqual(count, 1, "once() → listener retiré après premier fire");
  });
});

// ─── 17. Performance ─────────────────────────────────────────────────────────

describe("Module — performance", () => {
  it("1 000 log() en < 200ms", () => {
    const mod = new Module("perf-log", makeKernelStub(), process.cwd(), {});
    const start = Date.now();
    for (let i = 0; i < 1_000; i++) {
      mod.log(`msg ${i}`, "INFO");
    }
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 200, `1 000 log() ont pris ${elapsed}ms`);
  });

  it("1 000 setPath() en < 100ms", () => {
    const mod = new Module("perf-path", makeKernelStub(), process.cwd(), {});
    const start = Date.now();
    for (let i = 0; i < 1_000; i++) {
      mod.setPath(`/a/b/c/${i}/index.ts`);
    }
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 100, `1 000 setPath() ont pris ${elapsed}ms`);
  });

  it("50 constructions Module sans fuite mémoire apparente", () => {
    assert.doesNotThrow(() => {
      for (let i = 0; i < 50; i++) {
        new Module(`perf-mod-${i}`, makeKernelStub(), process.cwd(), {});
      }
    });
  });
});

// ─── 19. readOverrideModuleConfig() — override complet + WARNING log ─────────
//
// Pattern réel : app module déclare "Module-http": { ... } dans ses options.
// readOverrideModuleConfig() fusionne ces options dans le module "http" déjà
// enregistré dans le kernel et logue un WARNING.
// ─────────────────────────────────────────────────────────────────────────────

import type Pdu from "../syslog/Pdu";

// Helper : capture tous les PDUs émis par le syslog d'un module pendant un bloc sync
function captureLogs(mod: Module, fn: () => void): Pdu[] {
  const pdus: Pdu[] = [];
  const listener = (p: Pdu) => pdus.push(p);
  mod.syslog?.on("onLog", listener);
  try {
    fn();
  } finally {
    mod.syslog?.removeListener("onLog", listener);
  }
  return pdus;
}

describe("Module — readOverrideModuleConfig() — override complet + log", () => {
  it("INFO 'Override Configuration Module: http' émis lors de l'override (nominal, pas WARNING)", () => {
    const kernel = makeKernelReal();
    kernel.modules["http"] = new Module("http", kernel, PATH_FOR_NODEFONY_DIR, {
      port: 80,
    });

    const appMod = new Module("test", kernel, PATH_FOR_NODEFONY_DIR, {
      "Module-http": { port: 8080 },
    });

    const pdus = captureLogs(appMod, () => appMod.readOverrideModuleConfig());

    const infoPdu = pdus.find(
      (p) =>
        p.severityName === "INFO" &&
        String(p.payload).includes("Override Configuration Module") &&
        String(p.payload).includes("http"),
    );
    assert.ok(
      infoPdu,
      "le log INFO 'Override Configuration Module: http' doit être émis " +
        "(nominal — un WARNING polluerait le journal du bilan de boot)",
    );
  });

  it("deep=true (défaut) — clés imbriquées NON overridées préservées", () => {
    const kernel = makeKernelReal();
    const httpMod = new Module("http", kernel, PATH_FOR_NODEFONY_DIR, {
      port: 80,
      ssl: { enabled: false, cert: "default.pem", key: "default.key" },
    });
    kernel.modules["http"] = httpMod;

    const appMod = new Module("app", kernel, PATH_FOR_NODEFONY_DIR, {
      "Module-http": { ssl: { enabled: true } }, // override partiel de ssl
    });
    appMod.readOverrideModuleConfig(); // deep=true par défaut

    assert.strictEqual((httpMod.options as any).port, 80); // préservé
    assert.strictEqual((httpMod.options as any).ssl.enabled, true); // overridé
    assert.strictEqual((httpMod.options as any).ssl.cert, "default.pem"); // préservé deep
    assert.strictEqual((httpMod.options as any).ssl.key, "default.key"); // préservé deep
  });

  it("deep=false — objet imbriqué entièrement remplacé (shallow)", () => {
    const kernel = makeKernelReal();
    const httpMod = new Module("http", kernel, PATH_FOR_NODEFONY_DIR, {
      port: 80,
      ssl: { enabled: false, cert: "default.pem", key: "default.key" },
    });
    kernel.modules["http"] = httpMod;

    const appMod = new Module("app", kernel, PATH_FOR_NODEFONY_DIR, {
      "Module-http": { ssl: { enabled: true } },
    });
    appMod.readOverrideModuleConfig(false); // shallow

    assert.strictEqual((httpMod.options as any).ssl.enabled, true); // overridé
    // cert et key PERDUS — shallow écrase l'objet ssl entier
    assert.strictEqual((httpMod.options as any).ssl.cert, undefined);
    assert.strictEqual((httpMod.options as any).ssl.key, undefined);
  });

  it("deep=true — propriétés à la racine non overridées préservées", () => {
    const kernel = makeKernelReal();
    const httpMod = new Module("http", kernel, PATH_FOR_NODEFONY_DIR, {
      port: 80,
      host: "localhost",
      timeout: 30,
    });
    kernel.modules["http"] = httpMod;

    const appMod = new Module("app", kernel, PATH_FOR_NODEFONY_DIR, {
      "Module-http": { port: 8080 },
    });
    appMod.readOverrideModuleConfig();

    assert.strictEqual((httpMod.options as any).port, 8080); // overridé
    assert.strictEqual((httpMod.options as any).host, "localhost"); // préservé
    assert.strictEqual((httpMod.options as any).timeout, 30); // préservé
  });

  it("extend(true, {}, ...) — la référence d'options du module cible change", () => {
    const kernel = makeKernelReal();
    const httpMod = new Module("http", kernel, PATH_FOR_NODEFONY_DIR, {
      port: 80,
    });
    kernel.modules["http"] = httpMod;
    const originalRef = httpMod.options;

    const appMod = new Module("app", kernel, PATH_FOR_NODEFONY_DIR, {
      "Module-http": { port: 8080 },
    });
    appMod.readOverrideModuleConfig();

    // extend(true, {}, ...) crée un NOUVEL objet — la référence change
    assert.notStrictEqual(
      httpMod.options,
      originalRef,
      "options du module cible doit être un nouvel objet après override",
    );
  });

  it("multiple Module-* — override plusieurs modules en une seule passe", () => {
    const kernel = makeKernelReal();
    const httpMod = new Module("http", kernel, PATH_FOR_NODEFONY_DIR, {
      port: 80,
    });
    const dbMod = new Module("drizzle", kernel, PATH_FOR_NODEFONY_DIR, {
      dialect: "sqlite",
      pool: { min: 1, max: 5 },
    });
    kernel.modules["http"] = httpMod;
    kernel.modules["drizzle"] = dbMod;

    const appMod = new Module("app", kernel, PATH_FOR_NODEFONY_DIR, {
      "Module-http": { port: 8443, ssl: true },
      "Module-drizzle": { dialect: "postgres", pool: { max: 20 } },
    });

    const pdus = captureLogs(appMod, () => appMod.readOverrideModuleConfig());

    // http overridé
    assert.strictEqual((httpMod.options as any).port, 8443);
    assert.strictEqual((httpMod.options as any).ssl, true);

    // drizzle overridé en deep
    assert.strictEqual((dbMod.options as any).dialect, "postgres");
    assert.strictEqual((dbMod.options as any).pool.max, 20);
    assert.strictEqual((dbMod.options as any).pool.min, 1); // préservé deep

    // deux INFOs émis (nominal)
    const infos = pdus.filter(
      (p) =>
        p.severityName === "INFO" &&
        String(p.payload).includes("Override Configuration Module"),
    );
    assert.strictEqual(infos.length, 2, "un INFO par module overridé");
  });

  it("WARNING log 'Override de config ignoré' quand l'APP référence un module absent", () => {
    const kernel = makeKernelReal();
    const appMod = new Module("app", kernel, PATH_FOR_NODEFONY_DIR, {
      "Module-ghost": { x: 1 },
    });
    appMod.isApp = true; // config morte de l'APP → anomalie comptée au bilan

    const pdus = captureLogs(appMod, () => appMod.readOverrideModuleConfig());

    const warnPdu = pdus.find(
      (p) =>
        p.severityName === "WARNING" &&
        String(p.payload).includes("Override de config ignoré") &&
        String(p.payload).includes("ghost"),
    );
    assert.ok(
      warnPdu,
      "log WARNING doit être émis quand l'app référence un module absent",
    );
  });

  it("INFO (pas WARNING) quand un MODULE embarque un override pour un module optionnel absent", () => {
    const kernel = makeKernelReal();
    // Cas nominal du pattern « module UI » : studio embarque `module-frontend`
    // (https Vite) mais frontend n'est pas chargé (livraison statique).
    const studioMod = new Module("studio", kernel, PATH_FOR_NODEFONY_DIR, {
      "Module-frontend": { https: true },
    });

    const pdus = captureLogs(studioMod, () =>
      studioMod.readOverrideModuleConfig(),
    );

    const pdu = pdus.find((p) =>
      String(p.payload).includes("Override de config ignoré"),
    );
    assert.ok(pdu, "le log doit être émis");
    assert.strictEqual(
      pdu!.severityName,
      "INFO",
      "un module source (pas l'app) → INFO, pas une anomalie de boot",
    );
  });

  it("WARNING log — continue sans throw (autres clés traitées)", () => {
    const kernel = makeKernelReal();
    const httpMod = new Module("http", kernel, PATH_FOR_NODEFONY_DIR, {
      port: 80,
    });
    kernel.modules["http"] = httpMod;

    const appMod = new Module("app", kernel, PATH_FOR_NODEFONY_DIR, {
      "Module-ghost": { x: 1 }, // module absent → WARNING + continue
      "Module-http": { port: 9090 }, // module existant → doit quand même être traité
    });

    assert.doesNotThrow(() => appMod.readOverrideModuleConfig());
    assert.strictEqual(
      (httpMod.options as any).port,
      9090,
      "http doit être overridé même après un WARNING précédent",
    );
  });

  it("retourne this.options (les options du module appelant, pas celles du module cible)", () => {
    const kernel = makeKernelReal();
    kernel.modules["http"] = new Module(
      "http",
      kernel,
      PATH_FOR_NODEFONY_DIR,
      {},
    );

    const appMod = new Module("app", kernel, PATH_FOR_NODEFONY_DIR, {
      "Module-http": { port: 9090 },
    });
    const result = appMod.readOverrideModuleConfig();

    assert.strictEqual(result, appMod.options);
  });

  it("les options propres du module appelant ne sont pas modifiées", () => {
    const kernel = makeKernelReal();
    kernel.modules["http"] = new Module(
      "http",
      kernel,
      PATH_FOR_NODEFONY_DIR,
      {},
    );

    const appMod = new Module("app", kernel, PATH_FOR_NODEFONY_DIR, {
      "Module-http": { port: 9090 },
      ownSetting: "preserved",
      nested: { value: 42 },
    });
    appMod.readOverrideModuleConfig();

    assert.strictEqual((appMod.options as any).ownSetting, "preserved");
    assert.strictEqual((appMod.options as any).nested.value, 42);
  });

  it("regex — 'module-http' (m minuscule) reconnu et override appliqué", () => {
    const kernel = makeKernelReal();
    const httpMod = new Module("http", kernel, PATH_FOR_NODEFONY_DIR, {
      port: 80,
    });
    kernel.modules["http"] = httpMod;

    const appMod = new Module("app", kernel, PATH_FOR_NODEFONY_DIR, {
      "module-http": { port: 7070 }, // m minuscule
    });
    appMod.readOverrideModuleConfig();

    assert.strictEqual(
      (httpMod.options as any).port,
      7070,
      "m minuscule doit fonctionner",
    );
  });

  it("regex — 'Modulehttp' (sans tiret) NON reconnu", () => {
    const kernel = makeKernelReal();
    const httpMod = new Module("http", kernel, PATH_FOR_NODEFONY_DIR, {
      port: 80,
    });
    kernel.modules["http"] = httpMod;

    const appMod = new Module("app", kernel, PATH_FOR_NODEFONY_DIR, {
      Modulehttp: { port: 9999 }, // pas de tiret après Module
    });
    appMod.readOverrideModuleConfig();

    assert.strictEqual(
      (httpMod.options as any).port,
      80,
      "sans tiret → non reconnu → port inchangé",
    );
  });

  it("regex — 'Bundle-http' NON reconnu (préfixe inconnu)", () => {
    const kernel = makeKernelReal();
    const httpMod = new Module("http", kernel, PATH_FOR_NODEFONY_DIR, {
      port: 80,
    });
    kernel.modules["http"] = httpMod;

    const appMod = new Module("app", kernel, PATH_FOR_NODEFONY_DIR, {
      "Bundle-http": { port: 9999 },
    });
    appMod.readOverrideModuleConfig();

    assert.strictEqual((httpMod.options as any).port, 80);
  });

  it("deep=true 3 niveaux — structure complète préservée", () => {
    const kernel = makeKernelReal();
    const targetMod = new Module("framework", kernel, PATH_FOR_NODEFONY_DIR, {
      router: {
        prefix: "/api",
        security: { enabled: true, strategy: "jwt", jwtSecret: "original" },
      },
    });
    kernel.modules["framework"] = targetMod;

    const appMod = new Module("app", kernel, PATH_FOR_NODEFONY_DIR, {
      "Module-framework": {
        router: { security: { strategy: "oauth" } }, // seulement strategy
      },
    });
    appMod.readOverrideModuleConfig();

    const r = (targetMod.options as any).router;
    assert.strictEqual(r.prefix, "/api"); // préservé
    assert.strictEqual(r.security.enabled, true); // préservé deep
    assert.strictEqual(r.security.strategy, "oauth"); // overridé
    assert.strictEqual(r.security.jwtSecret, "original"); // préservé deep
  });

  it("sans clé Module-* → aucun log WARNING émis", () => {
    const kernel = makeKernelReal();
    const appMod = new Module("app", kernel, PATH_FOR_NODEFONY_DIR, {
      port: 3000,
      host: "localhost",
    });

    const pdus = captureLogs(appMod, () => appMod.readOverrideModuleConfig());

    const warns = pdus.filter(
      (p) =>
        p.severityName === "WARNING" &&
        String(p.payload).includes("Override Configuration Module"),
    );
    assert.strictEqual(warns.length, 0, "aucun WARNING si aucune clé Module-*");
  });
});

// ─── 18. Edge cases ──────────────────────────────────────────────────────────

describe("Module — edge cases", () => {
  it("deux modules avec le même nom sur le même kernel → dernier gagne dans modules[]", async () => {
    const kernel = makeKernelReal();
    const mod1 = await kernel.addModule(
      class extends Module {
        constructor(k: Kernel) {
          super("dup-name", k, PATH_FOR_NODEFONY_DIR, {});
        }
      } as any,
    );
    const mod2 = await kernel.addModule(
      class extends Module {
        constructor(k: Kernel) {
          super("dup-name", k, PATH_FOR_NODEFONY_DIR, {});
        }
      } as any,
    );
    assert.strictEqual(kernel.getModule("dup-name"), mod2);
    assert.notStrictEqual(kernel.getModule("dup-name"), mod1);
  });

  it("options {} vides → ne throw pas", () => {
    assert.doesNotThrow(
      () => new Module("empty-opts", makeKernelStub(), process.cwd(), {}),
    );
  });

  it("nom avec tirets → valide", () => {
    const mod = new Module(
      "my-cool-module",
      makeKernelStub(),
      process.cwd(),
      {},
    );
    assert.strictEqual(mod.name, "my-cool-module");
  });

  it("getDependencies() avec package sans dependencies ni peerDependencies → []", () => {
    const mod = new Module("empty-deps", makeKernelStub(), process.cwd(), {});
    mod.package = { name: "bare", version: "1.0.0" };
    assert.deepStrictEqual(mod.getDependencies(), []);
  });

  it("log() payload=0 (falsy) → ACCEPTED", () => {
    const mod = new Module(
      "falsy-payload",
      makeKernelStub(),
      process.cwd(),
      {},
    );
    const pdu = mod.log(0, "INFO");
    assert.strictEqual(pdu.status, "ACCEPTED");
  });

  it("log() payload=null → ACCEPTED", () => {
    const mod = new Module("null-payload", makeKernelStub(), process.cwd(), {});
    const pdu = mod.log(null, "INFO");
    assert.strictEqual(pdu.status, "ACCEPTED");
  });

  it("loadJson() chemin absolu correct → pas d'erreur", async () => {
    const mod = new Module("abs-json", makeKernelStub(), process.cwd(), {});
    const json = await mod.loadJson(NODEFONY_PKG);
    assert.ok(json);
  });
});

// ─── Durcissement C3 (2026-05-29) : contrats du registre de services ──────────
//
// Couvre les fonctions du module consommées par un module métier (P6 security :
// enregistrer des authenticators/voters). Étaient non couvertes (Funcs Module 70 %).

describe("Module — registre de services (contrats DI)", () => {
  it("getServiceNames() — module neuf → [] (lazy, aucune allocation)", () => {
    const mod = new Module(
      "svc-names-empty",
      makeKernelStub(),
      process.cwd(),
      {},
    );
    assert.deepStrictEqual(mod.getServiceNames(), []);
  });

  it("getServiceNames() — retourne une COPIE défensive (mutation externe sans effet)", () => {
    const mod = new Module(
      "svc-names-copy",
      makeKernelStub(),
      process.cwd(),
      {},
    );
    const names = mod.getServiceNames();
    names.push("intrus");
    assert.deepStrictEqual(
      mod.getServiceNames(),
      [],
      "l'état interne ne doit pas être muté par le retour",
    );
  });

  it("registerService(Ctor, name) — enregistre le constructeur dans l'Injector sous `name`", () => {
    const mod = new Module("svc-register", makeKernelStub(), process.cwd(), {});
    class RegDemoService extends Service {
      constructor(c?: Container) {
        super("RegDemoService", c ?? new Container());
      }
    }
    const ret = mod.registerService(RegDemoService as never, "regDemoService");
    assert.strictEqual(Injector.isRegistered("regDemoService"), true);
    assert.strictEqual(Injector.get("regDemoService"), RegDemoService);
    assert.strictEqual(
      ret,
      RegDemoService,
      "registerService retourne le constructeur enregistré",
    );
  });
});

// ─── 20. config getter (accès uniforme typé à la config du module) ───────────
//
// `this.config` = vue typée en LECTURE sur `this.options` (le stockage de
// Service). Un module se type via `extends Module<IXConfig>`. Remplace le double
// idiome historique (this.options brut / container key `<module>Config`).

describe("Module — config getter", () => {
  it("this.config renvoie this.options (MÊME référence, pas une copie)", () => {
    const opts = { foo: "bar", nested: { a: 1 } };
    const mod = new Module(
      "cfg-same-ref",
      makeKernelStub(),
      process.cwd(),
      opts,
    );
    assert.strictEqual(
      mod.config,
      mod.options,
      "config et options doivent être le même objet",
    );
    assert.strictEqual((mod.config as Record<string, unknown>).foo, "bar");
  });

  it("this.config reflète la réassignation de this.options (validation au boot)", () => {
    const mod = new Module("cfg-reassign", makeKernelStub(), process.cwd(), {});
    const validated = { enabled: true, store: "drizzle" };
    mod.options = validated as unknown as DefaultOptionsService;
    assert.strictEqual(
      mod.config,
      validated,
      "après this.options = validated, this.config renvoie la config validée",
    );
    assert.strictEqual((mod.config as Record<string, unknown>).enabled, true);
  });

  it("sous-classe typée Module<TConfig> → this.config typé sans cast", () => {
    interface MyCfg {
      host: string;
      port: number;
    }
    class TypedModule extends Module<MyCfg> {
      constructor(k: Kernel) {
        super("typed-cfg", k, process.cwd(), {
          host: "h",
          port: 1,
        } as unknown as DefaultOptionsService);
      }
      // Accès typé : this.config.host compile sans cast (TConfig = MyCfg).
      readHost(): string {
        return this.config.host;
      }
    }
    const t = new TypedModule(makeKernelStub());
    assert.strictEqual(t.readHost(), "h");
    assert.strictEqual(t.config.port, 1);
  });

  it("Module non typé → this.config = Record<string, unknown> (défaut générique)", () => {
    const mod = new Module("cfg-untyped", makeKernelStub(), process.cwd(), {
      any: "value",
    });
    const cfg: Record<string, unknown> = mod.config;
    assert.strictEqual(cfg.any, "value");
  });
});
