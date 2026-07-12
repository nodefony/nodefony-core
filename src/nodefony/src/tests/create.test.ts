import { assert } from "chai";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { version } from "../../package.json";
import {
  parseCreateArgv,
  findPackageRoot,
  renderTemplates,
  resolveLocalWorkspaces,
  linkLocalDeps,
  runCreateCommand,
} from "../cli/create";
import { SysExit } from "../cli/sysexits";

const argv = (...words: string[]): string[] => ["node", "nodefony", ...words];

describe("nodefony create — scaffold standalone", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "nf-create-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe("parseCreateArgv", () => {
    it("parse type/name + défauts", () => {
      const req = parseCreateArgv(argv("create", "app", "mon-app"));
      assert.deepEqual(req, {
        type: "app",
        name: "mon-app",
        dir: "mon-app",
        force: false,
        link: false,
      });
    });

    it("--dir, --force et --link", () => {
      const req = parseCreateArgv(
        argv("create", "app", "mon-app", "--dir", "x/y", "--force", "--link"),
      );
      assert.deepEqual(req, {
        type: "app",
        name: "mon-app",
        dir: "x/y",
        force: true,
        link: true,
      });
    });

    it("type inconnu / nom manquant / nom invalide / option inconnue", () => {
      assert.property(parseCreateArgv(argv("create", "plugin", "x")), "error");
      assert.property(parseCreateArgv(argv("create", "app")), "error");
      assert.property(
        parseCreateArgv(argv("create", "app", "Mon_App")),
        "error",
      );
      assert.property(
        parseCreateArgv(argv("create", "app", "ok", "--nope")),
        "error",
      );
    });
  });

  describe("findPackageRoot", () => {
    it("remonte jusqu'au package nodefony (templates présents)", () => {
      const root = findPackageRoot();
      assert.isTrue(existsSync(path.join(root, "templates", "app")));
    });
  });

  describe("renderTemplates", () => {
    it("substitue les tokens, strip .tpl, applique les renames", () => {
      const src = path.join(tmp, "tpl");
      mkdirSync(path.join(src, "sub"), { recursive: true });
      writeFileSync(path.join(src, "gitignore.tpl"), "dist/\n");
      writeFileSync(
        path.join(src, "sub", "a.ts.tpl"),
        'export const n = "{{appName}}";\n',
      );
      writeFileSync(path.join(src, "ignore.txt"), "pas un template\n");
      const dest = path.join(tmp, "out");
      const written = renderTemplates(src, dest, { appName: "demo" });
      assert.deepEqual(written, [".gitignore", path.join("sub", "a.ts")]);
      assert.equal(
        readFileSync(path.join(dest, "sub", "a.ts"), "utf8"),
        'export const n = "demo";\n',
      );
      assert.isFalse(existsSync(path.join(dest, "ignore.txt")));
    });

    it("token inconnu → throw (zéro {{ résiduel garanti)", () => {
      const src = path.join(tmp, "tpl");
      mkdirSync(src, { recursive: true });
      writeFileSync(path.join(src, "a.tpl"), "{{mystere}}");
      assert.throws(
        () => renderTemplates(src, path.join(tmp, "out"), {}),
        /token inconnu/,
      );
    });
  });

  describe("runCreateCommand (app)", () => {
    it("génère l'arbre complet, tokens résolus", () => {
      const dest = path.join(tmp, "demo-app");
      const code = runCreateCommand(
        argv("create", "app", "demo-app", "--dir", dest),
      );
      assert.equal(code, SysExit.OK);
      for (const f of [
        "package.json",
        "tsconfig.json",
        "rolldown.config.ts",
        "env.ts",
        "nodefony.config.ts",
        "index.ts",
        ".gitignore",
        "README.md",
        "compose.yaml",
        "eslint.config.mjs",
        "vitest.config.ts",
        path.join("nodefony", "controllers", "HelloController.ts"),
        path.join("tests", "config.test.ts"),
        path.join("tests", "e2e.test.ts"),
        path.join(
          "docker",
          "grafana",
          "provisioning",
          "datasources",
          "loki.yaml",
        ),
      ]) {
        assert.isTrue(existsSync(path.join(dest, f)), `manque ${f}`);
      }
      const pkg = JSON.parse(
        readFileSync(path.join(dest, "package.json"), "utf8"),
      ) as { name: string; dependencies: Record<string, string> };
      assert.equal(pkg.name, "demo-app");
      assert.equal(pkg.dependencies["nodefony"], `^${version}`);
      // Zéro token résiduel dans TOUT le rendu.
      for (const entry of readdirSync(dest, {
        recursive: true,
        withFileTypes: true,
      })) {
        if (entry.isFile()) {
          const content = readFileSync(
            path.join(entry.parentPath, entry.name),
            "utf8",
          );
          assert.notInclude(content, "{{", `token résiduel dans ${entry.name}`);
        }
      }
    });

    it("refuse un dossier non vide sans --force", () => {
      const dest = path.join(tmp, "occupied");
      mkdirSync(dest, { recursive: true });
      writeFileSync(path.join(dest, "x.txt"), "occupé");
      const code = runCreateCommand(
        argv("create", "app", "occupied", "--dir", dest),
      );
      assert.equal(code, SysExit.CANTCREAT);
      const forced = runCreateCommand(
        argv("create", "app", "occupied", "--dir", dest, "--force"),
      );
      assert.equal(forced, SysExit.OK);
    });

    it("usage invalide → EX_USAGE", () => {
      assert.equal(runCreateCommand(argv("create")), SysExit.USAGE);
      assert.equal(
        runCreateCommand(argv("create", "app", "Bad_Name")),
        SysExit.USAGE,
      );
    });
  });

  describe("--link (deps file: vers le checkout local)", () => {
    it("resolveLocalWorkspaces : checkout → map complète, hors checkout → null", () => {
      const workspaces = resolveLocalWorkspaces(findPackageRoot());
      assert.isNotNull(workspaces);
      assert.equal(workspaces!["nodefony"], findPackageRoot());
      assert.isTrue(existsSync(workspaces!["@nodefony/http"]));
      // Un dossier sans voisinage src/packages/@nodefony = paquet installé.
      assert.isNull(resolveLocalWorkspaces(tmp));
    });

    it("linkLocalDeps : réécrit le scope nodefony en file:, laisse le public", () => {
      const dest = path.join(tmp, "linked");
      mkdirSync(dest, { recursive: true });
      writeFileSync(
        path.join(dest, "package.json"),
        JSON.stringify({
          dependencies: { nodefony: "^10.0.0", zod: "^4.4.3" },
          devDependencies: { "@nodefony/http": "^10.0.0", rolldown: "^1.1.5" },
        }),
      );
      const linked = linkLocalDeps(dest, {
        nodefony: "/repo/src/nodefony",
        "@nodefony/http": "/repo/src/packages/@nodefony/http",
      });
      assert.deepEqual(linked, ["@nodefony/http", "nodefony"]);
      const pkg = JSON.parse(
        readFileSync(path.join(dest, "package.json"), "utf8"),
      ) as Record<string, Record<string, string>>;
      assert.equal(pkg["dependencies"]["nodefony"], "file:/repo/src/nodefony");
      assert.equal(pkg["dependencies"]["zod"], "^4.4.3");
      assert.equal(
        pkg["devDependencies"]["@nodefony/http"],
        "file:/repo/src/packages/@nodefony/http",
      );
      assert.equal(pkg["devDependencies"]["rolldown"], "^1.1.5");
    });

    it("linkLocalDeps : dep nodefony hors checkout → throw", () => {
      const dest = path.join(tmp, "orphan");
      mkdirSync(dest, { recursive: true });
      writeFileSync(
        path.join(dest, "package.json"),
        JSON.stringify({ dependencies: { "@nodefony/fantome": "^10.0.0" } }),
      );
      assert.throws(() => linkLocalDeps(dest, {}), /workspace introuvable/);
    });

    it("runCreateCommand --link : app générée câblée sur le checkout", () => {
      const dest = path.join(tmp, "linked-app");
      const code = runCreateCommand(
        argv("create", "app", "linked-app", "--dir", dest, "--link"),
      );
      assert.equal(code, SysExit.OK);
      const pkg = JSON.parse(
        readFileSync(path.join(dest, "package.json"), "utf8"),
      ) as { dependencies: Record<string, string> };
      assert.match(pkg.dependencies["nodefony"], /^file:.*src\/nodefony$/);
      assert.match(pkg.dependencies["@nodefony/http"], /^file:/);
      assert.equal(pkg.dependencies["zod"], "^4.4.3");
    });
  });

  // E2E binaire réel (gate RUN_CLI_BOOT — exige un `npm run build` PRÉALABLE :
  // un spawn valide le DIST, pas le source).
  const describeBoot = process.env["RUN_CLI_BOOT"] ? describe : describe.skip;
  describeBoot("e2e bin/nodefony create (dist)", () => {
    it("spawn → exit 0 + arbre généré", () => {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const bin = path.resolve(here, "../../bin/nodefony");
      const dest = path.join(tmp, "e2e-app");
      execFileSync("node", [bin, "create", "app", "e2e-app", "--dir", dest], {
        stdio: "pipe",
      });
      assert.isTrue(existsSync(path.join(dest, "nodefony.config.ts")));
    });
  });
});
