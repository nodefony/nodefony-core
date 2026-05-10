import assert from "node:assert";
import { resolve } from "node:path";
import "mocha";
import Module from "../kernel/Module";
import type { PackageJson } from "../types/IModule";
import type { IModule } from "../types/IModule";
import Container from "../Container";
import type Kernel from "../kernel/Kernel";

// Stub minimal : seul kernel.container est utilisé dans le constructeur de Module.
// this.kernel est résolu depuis container.get("kernel") → null si absent.
function makeKernelStub(): Kernel {
  const container = new Container();
  return { container } as unknown as Kernel;
}

// Chemin réel du package nodefony (pour loadJson)
const NODEFONY_PKG = resolve(process.cwd(), "package.json");

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
});

describe("Module — setPath()", () => {
  let mod: Module;

  before(() => {
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
    const result = mod.setPath("file:///a/b/module.ts");
    assert.strictEqual(result, "/a/b");
  });

  it("chemin déjà normalisé (dossier sans extension)", () => {
    const result = mod.setPath("/a/b/mymodule");
    assert.strictEqual(result, "/a/b");
  });
});

describe("Module — métadonnées package", () => {
  let mod: Module;

  before(() => {
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
});

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
      []
    );
  });
});

describe("Module — getController()", () => {
  let mod: Module;

  before(() => {
    mod = new Module("ctrl-test", makeKernelStub(), process.cwd(), {});
  });

  it("lève une erreur pour un controller inexistant", () => {
    assert.throws(
      () => mod.getController("NonExistentController"),
      /Controller.*not exist/
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
});

describe("Module — loadJson()", () => {
  let mod: Module;

  before(() => {
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
      { code: "ENOENT" }
    );
  });
});

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
});

describe("Module — readOverrideModuleConfig()", () => {
  it("retourne options intact sans clé Module-*", () => {
    const mod = new Module("override-test", makeKernelStub(), process.cwd(), {
      debug: false,
    });
    const result = mod.readOverrideModuleConfig();
    assert.strictEqual(result, mod.options);
  });
});

describe("Module — IModule structurel", () => {
  it("est assignable à IModule", () => {
    const mod = new Module("iface-test", makeKernelStub(), process.cwd(), {});
    // Vérification structurelle au niveau TypeScript (compile-time)
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
