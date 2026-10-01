import { afterAll, assert, beforeAll, describe, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { version } from "../../package.json";
import { parseCreateArgv } from "../cli/create";
import {
  PACKAGE_MANAGERS,
  needsWorkspaceProtocol,
  packageManagerCommandLines,
  packageManagerExecArgs,
} from "../cli/packageManager";
import { runScaffold, type TScaffoldAnswers } from "../cli/scaffold/engine";

// #294 — le gestionnaire de paquets choisi à `create app` décide de ce que
// l'application ÉCRIT : chaque outil ne lit que son propre fichier, et un
// réglage posé au mauvais endroit est ignoré SANS un mot (pnpm 11 ne lit plus
// le champ `pnpm` du package.json, yarn 1 ignore `overrides`).

const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;

describe("gestionnaire de paquets — commandes", () => {
  it("lancer un binaire local : la forme de CHAQUE gestionnaire", () => {
    assert.deepEqual(packageManagerExecArgs("npm", "nodefony", ["x"]), [
      "exec",
      "--",
      "nodefony",
      "x",
    ]);
    assert.deepEqual(packageManagerExecArgs("pnpm", "nodefony", ["x"]), [
      "exec",
      "nodefony",
      "x",
    ]);
    // `run`, jamais `bun x` : ce dernier TÉLÉCHARGE un binaire absent.
    assert.deepEqual(packageManagerExecArgs("bun", "nodefony"), [
      "run",
      "nodefony",
    ]);
    assert.deepEqual(packageManagerExecArgs("yarn", "nodefony"), [
      "run",
      "nodefony",
    ]);
  });

  it("ce qu'on AFFICHE sort de la même règle que ce qu'on EXÉCUTE", () => {
    for (const pm of PACKAGE_MANAGERS) {
      assert.equal(
        packageManagerCommandLines(pm).exec("nodefony"),
        [pm, ...packageManagerExecArgs(pm, "nodefony")].join(" "),
      );
    }
  });

  it("`workspace:*` seulement là où il est exigé — npm le REFUSE", () => {
    assert.isTrue(needsWorkspaceProtocol("pnpm"));
    assert.isTrue(needsWorkspaceProtocol("bun"));
    assert.isFalse(needsWorkspaceProtocol("npm"));
    assert.isFalse(needsWorkspaceProtocol("yarn"));
  });

  it("--package-manager se lit ; une valeur inconnue est refusée par la spec", () => {
    const parsed = parseCreateArgv([
      "node",
      "nodefony",
      "create",
      "app",
      "x",
      "--package-manager",
      "pnpm",
    ]);
    assert.notProperty(parsed, "error");
    assert.equal(
      (parsed as { answers: TScaffoldAnswers }).answers.packageManager,
      "pnpm",
    );
    assert.throws(
      () =>
        runScaffold(
          {
            type: "app",
            answers: { name: "x", packageManager: "cargo" },
            dir: path.join(os.tmpdir(), "nf-pm-refus"),
            force: false,
          },
          version,
          { dryRun: true },
        ),
      /packageManager invalide « cargo »/u,
    );
  });
});

describe("create app / create module — gabarit par gestionnaire", () => {
  let tmp = "";
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nf-pm-"));
  });
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** App complète sqlite (le cas qui porte `allowScripts`) + son verrou. */
  const app = (pm: string, lockfile: string): string => {
    const dest = path.join(tmp, pm);
    runScaffold(
      {
        type: "app",
        answers: {
          name: `app-${pm}`,
          preset: "complete",
          database: "sqlite",
          packageManager: pm,
        },
        dir: dest,
        force: false,
      },
      version,
    );
    // Le verrou est ce que l'installation laisse : c'est lui que `create
    // module` constate, sans dépendre de l'agent qui lance les tests.
    fs.writeFileSync(path.join(dest, lockfile), "");
    return dest;
  };

  const module = (dest: string, pm: string): Record<string, string> => {
    runScaffold(
      {
        type: "module",
        answers: { name: "blog", controller: "none" },
        dir: dest,
        force: false,
      },
      version,
    );
    const deps = readJson(path.join(dest, "package.json"))[
      "dependencies"
    ] as Record<string, string>;
    assert.isObject(deps, pm);
    return deps;
  };

  it("npm : overrides + allowScripts au package.json, aucun fichier pnpm", () => {
    const dest = app("npm", "package-lock.json");
    const pkg = readJson(path.join(dest, "package.json"));
    assert.property(pkg, "overrides");
    assert.property(pkg, "allowScripts");
    assert.notProperty(pkg, "resolutions");
    assert.isFalse(fs.existsSync(path.join(dest, "pnpm-workspace.yaml")));
    assert.notProperty(module(dest, "npm"), "@app-npm/blog");
  });

  it("pnpm : tout dans pnpm-workspace.yaml — modules, builds, overrides", () => {
    const dest = app("pnpm", "pnpm-lock.yaml");
    const pkg = readJson(path.join(dest, "package.json"));
    // Laissés au package.json, ils seraient ignorés sans un mot.
    assert.notProperty(pkg, "overrides");
    assert.notProperty(pkg, "allowScripts");
    const yaml = fs.readFileSync(
      path.join(dest, "pnpm-workspace.yaml"),
      "utf8",
    );
    assert.match(yaml, /^packages:\n {2}- "modules\/\*"$/mu);
    assert.match(
      yaml,
      /^allowBuilds:\n {2}better-sqlite3: false\n {2}esbuild: false$/mu,
    );
    assert.match(yaml, /^ {2}"@esbuild-kit\/core-utils>esbuild": "[^"]+"$/mu);
    assert.notInclude(yaml, "<%");
    assert.equal(module(dest, "pnpm")["@app-pnpm/blog"], "workspace:*");
  });

  it("bun : le module se DÉCLARE à la racine (workspace:*)", () => {
    const dest = app("bun", "bun.lock");
    assert.isFalse(fs.existsSync(path.join(dest, "pnpm-workspace.yaml")));
    assert.property(readJson(path.join(dest, "package.json")), "overrides");
    assert.equal(module(dest, "bun")["@app-bun/blog"], "workspace:*");
  });

  it("yarn : `resolutions`, son champ — et jamais workspace:*", () => {
    const dest = app("yarn", "yarn.lock");
    const pkg = readJson(path.join(dest, "package.json"));
    assert.notProperty(pkg, "overrides");
    assert.deepEqual(Object.keys(pkg["resolutions"] as object), [
      "@esbuild-kit/core-utils/esbuild",
    ]);
    assert.notProperty(module(dest, "yarn"), "@app-yarn/blog");
  });
});
