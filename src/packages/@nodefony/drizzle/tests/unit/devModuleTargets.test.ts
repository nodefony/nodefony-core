/**
 * Quelles cibles de génération appartiennent à un module de DÉVELOPPEMENT
 * (#687) — la moitié « fichiers » de la règle qui garde les tables d'un tel
 * module hors des migrations. L'autre moitié, la politique lue au manifeste,
 * est éprouvée au cœur (`devModulesLoaded.test.ts`).
 */
import path from "node:path";
import {
  devModuleTargets,
  splitDevModuleTables,
} from "../../nodefony/src/migrator/appSchema";

describe("splitDevModuleTables — aucune table de module de dev dans une migration", () => {
  const appTable = {
    file: "/app/nodefony/entity/Article.ts",
    tableName: "article",
  };
  const devOnDefault = {
    file: "/app/src/modules/bench/nodefony/entity/a.ts",
    tableName: "bench_a",
  };
  const devOwnConnector = {
    file: "/app/src/modules/media/nodefony/entity/r.ts",
    tableName: "Room",
  };
  const devNotLoaded = {
    file: "/app/src/modules/off/nodefony/entity/o.ts",
    tableName: "off_t",
  };
  const devModuleOf = new Map([
    [devOnDefault.file, "@app/bench"],
    [devOwnConnector.file, "@app/media"],
    [devNotLoaded.file, "@app/off"],
  ]);
  const owners = new Map([
    ["article", new Set(["default"])],
    ["bench_a", new Set(["default"])],
    ["Room", new Set(["media"])],
    // `off_t` : module non chargé, le registre ne le connaît pas.
  ]);
  const all = [appTable, devOnDefault, devOwnConnector, devNotLoaded];

  it("module chargé, tables liées au connecteur généré : REFUS, qui nomme le module", () => {
    const { kept, refused } = splitDevModuleTables(
      all,
      devModuleOf,
      "default",
      owners,
    );
    assert.deepEqual(kept, [appTable]);
    assert.deepEqual(refused, [{ table: devOnDefault, module: "@app/bench" }]);
  });

  it("module sur SON connecteur, ou non chargé : écarté sans un mot", () => {
    const { kept, refused } = splitDevModuleTables(
      [appTable, devOwnConnector, devNotLoaded],
      devModuleOf,
      "default",
      owners,
    );
    assert.deepEqual(kept, [appTable]);
    assert.deepEqual(refused, []);
  });

  it("générer le connecteur PROPRE d'un module de dev refuse aussi : aucune migration ne le porte", () => {
    const { kept, refused } = splitDevModuleTables(
      all,
      devModuleOf,
      "media",
      owners,
    );
    assert.deepEqual(kept, [appTable]);
    assert.deepEqual(refused, [
      { table: devOwnConnector, module: "@app/media" },
    ]);
  });
});

describe("devModuleTargets — un module de dev se reconnaît par son nom OU son chemin", () => {
  const root = path.join(path.sep, "app");
  const targets = [
    { name: "app", dir: root },
    { name: "@nodefony/test", dir: path.join(root, "src", "modules", "test") },
    { name: "demo", dir: path.join(root, "src", "demo") },
    { name: "@app/blog", dir: path.join(root, "modules", "blog") },
  ];

  it("par le nom de paquet déclaré au manifeste", () => {
    const found = devModuleTargets(targets, ["@nodefony/test"], root);
    assert.deepEqual(
      found.map((t) => t.name),
      ["@nodefony/test"],
    );
  });

  it("par un chemin relatif à la racine, comme le Kernel le résout", () => {
    const found = devModuleTargets(targets, ["./src/demo"], root);
    assert.deepEqual(
      found.map((t) => t.name),
      ["demo"],
    );
  });

  it("aucun module de dev : aucune cible, l'application n'est jamais visée", () => {
    assert.deepEqual(devModuleTargets(targets, [], root), []);
    assert.deepEqual(devModuleTargets(targets, ["@ailleurs/absent"], root), []);
  });

  it("sous la grammaire Windows, un chemin écrit avec l'un ou l'autre séparateur", () => {
    const win = path.win32;
    const winRoot = "C:\\app";
    const winTargets = [
      { name: "app", dir: winRoot },
      { name: "demo", dir: win.join(winRoot, "src", "demo") },
    ];
    for (const entry of ["./src/demo", ".\\src\\demo"]) {
      assert.deepEqual(
        devModuleTargets(winTargets, [entry], winRoot, win).map((t) => t.name),
        ["demo"],
        entry,
      );
    }
  });
});
