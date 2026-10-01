import { afterAll, assert, beforeAll, describe, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { version } from "../../package.json";
import { parseCreateArgv } from "../cli/create";
import {
  LOCKFILES,
  PACKAGE_MANAGERS,
  PACKAGE_MANAGER_TOOL_MAJOR,
  hasWorkspaceRun,
  needsWorkspaceProtocol,
  packageManagerCommandLines,
  packageManagerExecArgs,
  packageManagerToolchain,
  packageManagerWorkspaceRun,
} from "../cli/packageManager";
import {
  ensureWorkspaces,
  runScaffold,
  type TScaffoldAnswers,
} from "../cli/scaffold/engine";

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

describe("gestionnaire de paquets — parcourir les modules du workspace", () => {
  it("une forme par gestionnaire, et aucune ne passe par `npm run` chez bun", () => {
    assert.equal(
      packageManagerWorkspaceRun("npm", "build"),
      "npm run build --workspaces --if-present",
    );
    assert.equal(
      packageManagerWorkspaceRun("pnpm", "build"),
      "pnpm -r --if-present run build",
    );
    assert.equal(
      packageManagerWorkspaceRun("yarn", "build"),
      "yarn workspaces run build",
    );
    // bun réécrit `npm run` en `bun run` et ignore `--workspaces` : le
    // `build` de la racine se relançait lui-même, sans fin (constaté, bun 1.4).
    const bun = packageManagerWorkspaceRun("bun", "build");
    assert.equal(bun, "bun run --filter './modules/*' build");
    assert.notInclude(bun, "npm");
  });

  it("chaque forme se reconnaît — le câblage ne greffe jamais une 2ᵉ délégation", () => {
    for (const pm of PACKAGE_MANAGERS) {
      assert.isTrue(
        hasWorkspaceRun(`${packageManagerWorkspaceRun(pm, "test")} && x`),
        pm,
      );
    }
    assert.isFalse(hasWorkspaceRun("rolldown -c rolldown.config.ts"));
    assert.isFalse(hasWorkspaceRun("pnpm run build"));
    assert.isFalse(hasWorkspaceRun("bun run --filter '*' build"));
  });

  it("un projet passé de pnpm à npm garde sa délégation, sans en ajouter", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-pm-ws-"));
    try {
      const build = `${packageManagerWorkspaceRun("pnpm", "build")} && rolldown -c`;
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ workspaces: ["modules/*"], scripts: { build } }),
      );
      const files = new Map<string, string>();
      const writer = {
        read: (f: string) => files.get(f) ?? fs.readFileSync(f, "utf8"),
        write: (f: string, c: string) => void files.set(f, c),
      } as unknown as Parameters<typeof ensureWorkspaces>[1];
      assert.isFalse(ensureWorkspaces(dir, writer, "npm"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("l'audit des dépendances de production parle la syntaxe de chacun", () => {
    assert.equal(
      packageManagerCommandLines("npm").audit,
      "npm audit --omit=dev",
    );
    assert.equal(packageManagerCommandLines("pnpm").audit, "pnpm audit --prod");
    assert.equal(
      packageManagerCommandLines("yarn").audit,
      "yarn audit --groups dependencies",
    );
    assert.equal(packageManagerCommandLines("bun").audit, "bun audit");
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

  // Les scripts de l'app appellent d'autres scripts : sous bun, un `npm run`
  // y est réécrit, et `--workspaces` ignoré → boucle infinie au premier build.
  for (const [pm, lockfile] of [
    ["npm", "package-lock.json"],
    ["pnpm", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock"],
    ["bun", "bun.lock"],
  ] as const) {
    it(`${pm} : les scripts de l'app et leur délégation aux modules parlent ${pm}`, () => {
      const dest = path.join(tmp, `scripts-${pm}`);
      runScaffold(
        {
          type: "app",
          answers: { name: `s-${pm}`, preset: "minimal", packageManager: pm },
          dir: dest,
          force: false,
        },
        version,
      );
      fs.writeFileSync(path.join(dest, lockfile), "");
      const before = readJson(path.join(dest, "package.json"))[
        "scripts"
      ] as Record<string, string>;
      assert.equal(before["audit:deps"], packageManagerCommandLines(pm).audit);
      for (const step of ["typecheck", "lint", "test", "build", "doctor"]) {
        assert.include(before["verify"], `${pm} run ${step}`, step);
      }
      assert.match(
        before["test:e2e"]!,
        new RegExp(`^${pm} run build && `, "u"),
      );
      if (pm !== "npm") {
        assert.notMatch(JSON.stringify(before), /\bnpm (run|test|audit)\b/u);
      }
      runScaffold(
        {
          type: "module",
          answers: { name: "blog", controller: "none" },
          dir: dest,
          force: false,
        },
        version,
      );
      const after = readJson(path.join(dest, "package.json"))[
        "scripts"
      ] as Record<string, string>;
      for (const step of ["build", "typecheck", "test"]) {
        assert.include(after[step], packageManagerWorkspaceRun(pm, step), step);
      }
    });
  }
});

// #294 lot 4 — la forge et l'image parlaient npm en dur : `npm ci` sans
// `package-lock.json` échoue, et `npm prune` refuse le `workspace:*` qu'une
// application pnpm ou bun déclare. Chaque fichier rendu doit parler le
// gestionnaire choisi, et SEULEMENT lui.
describe("forge et image — rendues pour le gestionnaire choisi", () => {
  let tmp = "";
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nf-pm-ci-"));
  });
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("le verrou de la chaîne est celui que la résolution reconnaît", () => {
    for (const pm of PACKAGE_MANAGERS) {
      const lock = packageManagerToolchain(pm).lockfile;
      assert.deepInclude(LOCKFILES, [lock, pm], pm);
    }
  });

  // Le banc de publication installe l'outil sur l'exécuteur avec la MÊME
  // majeure que le gabarit — la frontière de paquets impose la copie, ce
  // test l'empêche de dériver.
  it("le banc de la forge éprouve les majeures que le gabarit suppose", () => {
    const workflow = fs.readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../../.github/workflows/release-smoke.yml",
      ),
      "utf8",
    );
    for (const pm of ["pnpm", "bun"] as const) {
      const setup = packageManagerToolchain(pm).githubSetup;
      assert.isNotNull(setup, pm);
      assert.include(workflow, `uses: ${setup!.uses}`, pm);
      assert.include(
        workflow,
        `${setup!.versionInput}: "${setup!.version}"`,
        pm,
      );
      assert.include(setup!.version, PACKAGE_MANAGER_TOOL_MAJOR[pm], pm);
    }
  });

  /** Lignes exécutées d'un fichier rendu — les commentaires expliquent npm. */
  const executed = (file: string): string[] =>
    fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !/^\s*#/u.test(line));

  for (const pm of PACKAGE_MANAGERS) {
    it(`${pm} : Dockerfile, GitHub, GitLab et exclusions parlent ${pm}`, () => {
      const dest = path.join(tmp, pm);
      runScaffold(
        {
          type: "app",
          answers: {
            name: `ci-${pm}`,
            preset: "complete",
            database: "sqlite",
            packageManager: pm,
          },
          dir: dest,
          force: false,
        },
        version,
      );
      const tc = packageManagerToolchain(pm);
      const exec = packageManagerCommandLines(pm).exec("nodefony");

      const docker = executed(path.join(dest, "Dockerfile")).join("\n");
      assert.include(docker, `--mount=type=cache,target=${tc.imageCacheDir}`);
      assert.include(docker, `if [ -f ${tc.lockfile} ]; then`);
      assert.include(docker, `${tc.imageInstall};`);
      assert.include(docker, `${tc.imageInstallUnlocked};`);
      assert.include(
        docker,
        `RUN --mount=type=cache,target=${tc.imageCacheDir} \\\n    ${pm} run build && ${tc.prune} \\\n`,
      );
      if (tc.bootstrap === null) {
        assert.notInclude(docker, "npm install -g");
      } else {
        assert.include(docker, `RUN ${tc.bootstrap}\n`);
      }

      const github = executed(path.join(dest, ".github/workflows/ci.yml"));
      const prod = executed(
        path.join(dest, ".github/workflows/production.yml"),
      );
      for (const wf of [github, prod]) {
        const text = wf.join("\n");
        assert.include(text, `      - run: ${tc.frozenInstall}\n`);
        if (tc.setupNodeCache === null) {
          assert.notMatch(text, /^ {10}cache: /mu);
        } else {
          assert.include(text, `\n          cache: ${tc.setupNodeCache}\n`);
        }
        if (tc.githubSetup === null) {
          assert.notInclude(text, "action-setup");
          assert.notInclude(text, "setup-bun");
        } else {
          // AVANT setup-node, dont le cache suppose l'outil installé.
          assert.isBelow(
            text.indexOf(`uses: ${tc.githubSetup.uses}`),
            text.indexOf("uses: actions/setup-node@"),
          );
          assert.include(
            text,
            `${tc.githubSetup.versionInput}: "${tc.githubSetup.version}"`,
          );
        }
      }
      assert.include(github.join("\n"), `run: ${pm} run verify`);
      assert.include(github.join("\n"), `run: ${exec} image:check ci-${pm}:ci`);
      assert.include(prod.join("\n"), `run: ${pm} run build`);
      assert.include(prod.join("\n"), `${exec} http:certificates`);

      const gitlab = executed(path.join(dest, ".gitlab-ci.yml"));
      const gl = gitlab.join("\n");
      assert.include(gl, `        - ${tc.lockfile}\n`);
      assert.include(gl, `      - ${tc.projectCacheDir}/\n`);
      assert.include(gl, `    - ${tc.projectCachedInstall}\n`);
      assert.include(gl, `    - ${pm} run verify\n`);
      assert.include(gl, `    - ${exec} image:check ci-${pm}:ci`);

      for (const ignore of [".dockerignore", ".gitignore"]) {
        assert.include(
          fs.readFileSync(path.join(dest, ignore), "utf8"),
          `\n${tc.projectCacheDir}/\n`,
          ignore,
        );
      }

      // Hors npm : plus une ligne EXÉCUTÉE ne parle npm, sauf celle qui
      // installe l'outil lui-même.
      if (pm !== "npm") {
        for (const line of [
          ...docker.split("\n"),
          ...github,
          ...prod,
          ...gitlab,
        ]) {
          if (tc.bootstrap !== null && line.includes(tc.bootstrap)) continue;
          assert.notMatch(line, /\b(npm|npx)\b/u, line);
        }
      }
      assert.notInclude(
        [docker, ...github, ...prod, ...gitlab].join("\n"),
        "<%",
      );
    });
  }
});
