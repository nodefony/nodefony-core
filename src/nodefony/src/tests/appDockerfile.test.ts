import { afterAll, assert, describe, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { version } from "../../package.json";
import {
  contributionFingerprint,
  createAppContributionContext,
} from "../cli/contributions";
import { installedPackageRoots } from "../cli/installedPackages";
import {
  PACKAGE_MANAGERS,
  packageManagerFromField,
  packageManagerToolchain,
} from "../cli/packageManager";
import {
  APP_DOCKERFILE_PATH,
  appPackageManager,
  contribute,
} from "../cli/scaffold/contribute";
import { renderAppDockerfile, runScaffold } from "../cli/scaffold/engine";
import type { PackageManagerName } from "../Cli";

/**
 * #780 — le `Dockerfile` d'une application est une COPIE SUIVIE du paquet
 * `nodefony` : `scaffold:sync --update` (donc `nodefony upgrade`) la remplace
 * tant que l'application n'y a pas touché. Décor : une application RÉELLEMENT
 * générée par gestionnaire, et la contribution jouée sur sa source.
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nf-dockerfile-"));
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const coreRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Génère une application, verrou du gestionnaire compris (comme après l'install). */
let generated = 0;
const generate = (pm: PackageManagerName, preset = "complete"): string => {
  generated += 1;
  const dest = path.join(tmp, `${pm}-${preset}-${String(generated)}`);
  runScaffold(
    {
      type: "app",
      answers: {
        name: `docker-${pm}`,
        preset,
        database: "sqlite",
        packageManager: pm,
      },
      dir: dest,
      force: false,
    },
    version,
  );
  fs.writeFileSync(path.join(dest, packageManagerToolchain(pm).lockfile), "");
  return dest;
};

const readDockerfile = (app: string): string =>
  fs.readFileSync(path.join(app, APP_DOCKERFILE_PATH), "utf8");

describe("Dockerfile d'application — une règle de rendu", () => {
  for (const pm of PACKAGE_MANAGERS) {
    it(`${pm} : create app et la contribution rendent le MÊME fichier`, () => {
      const app = generate(pm);
      assert.equal(
        readDockerfile(app),
        renderAppDockerfile(`docker-${pm}`, pm),
      );
      // La contribution relit le gestionnaire dans l'application, puis adopte
      // la copie — identique à la livraison, elle entre au registre sans être
      // réécrite.
      assert.equal(
        appPackageManager({ appRoot: app, read: (r) => readText(app, r) }),
        pm,
      );
      const run = createAppContributionContext(app);
      contribute(run.context);
      assert.deepEqual(run.written, []);
      assert.deepEqual(run.modified, []);
      assert.deepEqual(run.kept, [APP_DOCKERFILE_PATH]);
      assert.equal(
        run.files[APP_DOCKERFILE_PATH],
        contributionFingerprint(readDockerfile(app)),
      );
    });
  }

  it("le préréglage ne change rien au rendu (le gabarit ne lit pas plus que la contribution)", () => {
    const app = generate("npm", "minimal");
    assert.equal(readDockerfile(app), renderAppDockerfile("docker-npm", "npm"));
  });
});

/** Lecture d'un fichier de l'application, `null` s'il manque. */
const readText = (app: string, relative: string): string | null => {
  try {
    return fs.readFileSync(path.join(app, relative), "utf8");
  } catch {
    return null;
  }
};

describe("Dockerfile d'application — copie suivie", () => {
  const OLD = "FROM node:old\n";

  it("une copie INTACTE d'une livraison précédente est remplacée par --update", () => {
    const app = generate("npm");
    fs.writeFileSync(path.join(app, APP_DOCKERFILE_PATH), OLD);
    const run = createAppContributionContext(app, {
      update: true,
      recorded: { [APP_DOCKERFILE_PATH]: contributionFingerprint(OLD) },
    });
    contribute(run.context);
    assert.deepEqual(run.updated, [APP_DOCKERFILE_PATH]);
    assert.equal(readDockerfile(app), renderAppDockerfile("docker-npm", "npm"));
  });

  it("sans --update, la copie en retard est signalée, pas remplacée", () => {
    const app = generate("npm");
    fs.writeFileSync(path.join(app, APP_DOCKERFILE_PATH), OLD);
    const run = createAppContributionContext(app, {
      recorded: { [APP_DOCKERFILE_PATH]: contributionFingerprint(OLD) },
    });
    contribute(run.context);
    assert.deepEqual(run.outdated, [APP_DOCKERFILE_PATH]);
    assert.equal(readDockerfile(app), OLD);
  });

  it("une copie RETOUCHÉE est épargnée et rapportée modified, même avec --update", () => {
    const app = generate("npm");
    const touched = `${OLD}RUN apt-get install -y ffmpeg\n`;
    fs.writeFileSync(path.join(app, APP_DOCKERFILE_PATH), touched);
    const run = createAppContributionContext(app, {
      update: true,
      recorded: { [APP_DOCKERFILE_PATH]: contributionFingerprint(OLD) },
    });
    contribute(run.context);
    assert.deepEqual(run.modified, [APP_DOCKERFILE_PATH]);
    assert.deepEqual(run.updated, []);
    assert.equal(readDockerfile(app), touched);
  });

  it("gestionnaire introuvable (ni champ, ni verrou) : rien n'est posé", () => {
    const app = generate("npm");
    fs.rmSync(path.join(app, "package-lock.json"));
    fs.rmSync(path.join(app, APP_DOCKERFILE_PATH));
    const run = createAppContributionContext(app);
    contribute(run.context);
    assert.deepEqual(run.written, []);
    assert.isFalse(fs.existsSync(path.join(app, APP_DOCKERFILE_PATH)));
  });
});

describe("Dockerfile d'application — gestionnaire et découverte", () => {
  it("le champ packageManager se lit au format Corepack", () => {
    assert.equal(packageManagerFromField("pnpm@12.18.0+sha512.abc"), "pnpm");
    assert.equal(packageManagerFromField("yarn@4.5.0"), "yarn");
    assert.equal(packageManagerFromField("bun"), "bun");
    assert.isNull(packageManagerFromField("deno@2.0.0"));
    assert.isNull(packageManagerFromField(42));
    assert.isNull(packageManagerFromField(undefined));
  });

  it("le champ l'emporte sur le verrou ; l'agent de l'invocation ne compte jamais", () => {
    const app = path.join(tmp, "pm-order");
    fs.mkdirSync(app, { recursive: true });
    const read = (r: string): string | null => readText(app, r);
    fs.writeFileSync(
      path.join(app, "package.json"),
      JSON.stringify({ name: "x", packageManager: "pnpm@12.18.0" }),
    );
    fs.writeFileSync(path.join(app, "bun.lock"), "");
    assert.equal(appPackageManager({ appRoot: app, read }), "pnpm");
    fs.writeFileSync(
      path.join(app, "package.json"),
      JSON.stringify({ name: "x" }),
    );
    assert.equal(appPackageManager({ appRoot: app, read }), "bun");
    fs.rmSync(path.join(app, "bun.lock"));
    const agent = process.env["npm_config_user_agent"];
    process.env["npm_config_user_agent"] = "yarn/4.5.0 npm/? node/v26";
    try {
      assert.isNull(appPackageManager({ appRoot: app, read }));
    } finally {
      if (agent === undefined) delete process.env["npm_config_user_agent"];
      else process.env["npm_config_user_agent"] = agent;
    }
  });

  it("le paquet nodefony installé est découvert, en premier", () => {
    const app = path.join(tmp, "discover");
    const core = path.join(app, "node_modules", "nodefony");
    fs.mkdirSync(core, { recursive: true });
    fs.mkdirSync(path.join(app, "node_modules", "@nodefony", "security"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(app, "package.json"),
      JSON.stringify({ name: "a" }),
    );
    fs.writeFileSync(
      path.join(core, "package.json"),
      JSON.stringify({ name: "nodefony" }),
    );
    const roots = installedPackageRoots(app);
    assert.deepEqual(roots[0], { dir: core, name: "nodefony" });
    assert.deepEqual(
      roots.map((r) => r.name),
      ["nodefony", "@nodefony/security"],
    );
  });

  it("un dépôt qui PRODUIT nodefony (espace de travail) ne se le livre pas", () => {
    const repo = path.join(tmp, "monorepo");
    fs.mkdirSync(path.join(repo, "node_modules", "nodefony"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repo, "src", "nodefony"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "package.json"),
      JSON.stringify({ name: "repo", workspaces: ["src/nodefony"] }),
    );
    for (const dir of ["node_modules/nodefony", "src/nodefony"]) {
      fs.writeFileSync(
        path.join(repo, dir, "package.json"),
        JSON.stringify({ name: "nodefony" }),
      );
    }
    assert.deepEqual(installedPackageRoots(repo), []);
  });

  it("le module déclaré au package.json est une entrée du build (sinon le treeshake le retire)", () => {
    const manifest: unknown = JSON.parse(
      fs.readFileSync(path.join(coreRoot, "package.json"), "utf8"),
    );
    assert.nestedPropertyVal(
      manifest,
      "nodefony.contribute",
      "./dist/node/cli/scaffold/contribute.js",
    );
    const config = fs.readFileSync(
      path.join(coreRoot, "rolldown.config.ts"),
      "utf8",
    );
    assert.include(config, '"src/cli/scaffold/contribute.ts"');
  });
});
