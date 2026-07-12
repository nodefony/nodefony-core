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
import { PassThrough } from "node:stream";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { version } from "../../package.json";
import { parseCreateArgv, runCreateCommand } from "../cli/create";
import { getScaffoldSpec } from "../cli/scaffold/spec";
import {
  findPackageRoot,
  resolveLocalWorkspaces,
  resolveAnswers,
  linkLocalDeps,
  runScaffold,
} from "../cli/scaffold/engine";
import { askMissing } from "../cli/scaffold/interactive";
import { SysExit } from "../cli/sysexits";

const argv = (...words: string[]): string[] => ["node", "nodefony", ...words];

/** Rend le scaffold app dans un dossier de test avec réponses explicites. */
const scaffold = (
  dir: string,
  answers: Record<string, string | boolean>,
  force = false,
) => runScaffold({ type: "app", answers, dir, force }, version);

const readJson = (p: string): Record<string, Record<string, string>> =>
  JSON.parse(readFileSync(p, "utf8")) as Record<string, Record<string, string>>;

/** Aucun résidu de template dans le rendu (tag eta oublié = projet corrompu). */
function assertNoEtaResidue(dest: string): void {
  for (const entry of readdirSync(dest, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isFile()) {
      const content = readFileSync(
        path.join(entry.parentPath, entry.name),
        "utf8",
      );
      assert.notInclude(content, "<%", `tag eta résiduel dans ${entry.name}`);
    }
  }
}

describe("nodefony create — scaffold 3 fronts (spec + moteur + CLI)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "nf-create-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe("parseCreateArgv (adaptateur argv)", () => {
    it("parse type/name + défauts (answers partielles vides)", () => {
      const req = parseCreateArgv(argv("create", "app", "mon-app"));
      assert.deepEqual(req, {
        type: "app",
        answers: { name: "mon-app" },
        dir: undefined,
        force: false,
        yes: false,
      });
    });

    it("flags → answers : --preset --frontend --link/--no-link --yes --dir", () => {
      const req = parseCreateArgv(
        argv(
          "create",
          "app",
          "x",
          "--preset",
          "minimal",
          "--frontend",
          "react",
          "--no-link",
          "--yes",
          "--dir",
          "a/b",
          "--force",
        ),
      );
      assert.deepEqual(req, {
        type: "app",
        answers: {
          name: "x",
          preset: "minimal",
          frontend: "react",
          link: false,
        },
        dir: "a/b",
        force: true,
        yes: true,
      });
    });

    it("type inconnu / option inconnue → error", () => {
      assert.property(parseCreateArgv(argv("create", "plugin", "x")), "error");
      assert.property(
        parseCreateArgv(argv("create", "app", "ok", "--nope")),
        "error",
      );
    });
  });

  describe("spec déclarative (contrat des 3 fronts)", () => {
    it("JSON-able : survit à un round-trip JSON sans perte", () => {
      const spec = getScaffoldSpec();
      const round = JSON.parse(JSON.stringify(spec)) as typeof spec;
      assert.deepEqual(round, spec);
      assert.equal(spec[0].type, "app");
      assert.isAtLeast(spec[0].questions.length, 4);
    });

    it("resolveAnswers : défauts, pattern, choix, askIf", () => {
      const [spec] = getScaffoldSpec("app");
      const caps = { hasCheckout: false };
      const ok = resolveAnswers(spec, { name: "mon-app" }, caps);
      assert.equal(ok.preset, "complete");
      assert.equal(ok.frontend, "none");
      assert.equal(ok.link, false); // askIf hasCheckout=false → forcé false
      assert.throws(
        () => resolveAnswers(spec, { name: "Bad_Name" }, caps),
        /kebab-case/,
      );
      assert.throws(
        () => resolveAnswers(spec, { name: "x", preset: "big" }, caps),
        /preset invalide/,
      );
      assert.throws(
        () => resolveAnswers(spec, { name: "x", frontend: "svelte" }, caps),
        /frontend invalide/,
      );
    });
  });

  describe("moteur — preset complete", () => {
    it("vitrine complète : infra docker + toutes les briques, zéro résidu", () => {
      const dest = path.join(tmp, "full");
      const r = scaffold(dest, { name: "full" });
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
      const pkg = readJson(path.join(dest, "package.json"));
      assert.equal(pkg["dependencies"]["nodefony"], `^${version}`);
      assert.property(pkg["dependencies"], "@nodefony/drizzle");
      assert.property(pkg["scripts"], "infra:up");
      assertNoEtaResidue(dest);
      assert.isEmpty(r.linked);
    });
  });

  describe("moteur — preset minimal", () => {
    it("base saine : http+framework seuls, PAS d'infra docker", () => {
      const dest = path.join(tmp, "mini");
      scaffold(dest, { name: "mini", preset: "minimal" });
      assert.isFalse(existsSync(path.join(dest, "compose.yaml")));
      assert.isFalse(existsSync(path.join(dest, "docker")));
      const pkg = readJson(path.join(dest, "package.json"));
      assert.notProperty(pkg["dependencies"], "@nodefony/drizzle");
      assert.notProperty(pkg["dependencies"], "@nodefony/studio");
      assert.notProperty(pkg["scripts"], "infra:up");
      const config = readFileSync(
        path.join(dest, "nodefony.config.ts"),
        "utf8",
      );
      assert.notInclude(config, "@nodefony/security");
      assert.include(config, "@nodefony/http");
      assertNoEtaResidue(dest);
    });
  });

  describe("moteur — choix frontend", () => {
    it("react : entry tsx + AppController + registerEntry + deps + jsx", () => {
      const dest = path.join(tmp, "rapp");
      scaffold(dest, { name: "rapp", preset: "minimal", frontend: "react" });
      assert.isTrue(existsSync(path.join(dest, "frontend", "src", "main.tsx")));
      assert.isTrue(existsSync(path.join(dest, "frontend", "src", "App.tsx")));
      // Coquille HTML de l'app (renderDocument y injecte les tags au marqueur).
      const shell = readFileSync(
        path.join(dest, "frontend", "index.html"),
        "utf8",
      );
      assert.include(shell, "<!--nodefony:frontend-->");
      assert.include(shell, '<div id="root"></div>');
      assert.isTrue(
        existsSync(
          path.join(dest, "nodefony", "controllers", "AppController.ts"),
        ),
      );
      const pkg = readJson(path.join(dest, "package.json"));
      assert.property(pkg["dependencies"], "react");
      assert.property(pkg["dependencies"], "@nodefony/frontend");
      assert.property(pkg["devDependencies"], "@vitejs/plugin-react");
      const index = readFileSync(path.join(dest, "index.ts"), "utf8");
      assert.include(index, 'type: "react19"');
      assert.include(index, "apiProxyPaths");
      const tsconfig = readFileSync(path.join(dest, "tsconfig.json"), "utf8");
      assert.include(tsconfig, "react-jsx");
      assertNoEtaResidue(dest);
    });

    it("vue : SFC + plugin ; angular : composant + tsconfig.app.json", () => {
      const vdest = path.join(tmp, "vapp");
      scaffold(vdest, { name: "vapp", frontend: "vue" });
      assert.isTrue(existsSync(path.join(vdest, "frontend", "src", "App.vue")));
      const vpkg = readJson(path.join(vdest, "package.json"));
      assert.property(vpkg["dependencies"], "vue");
      assert.include(
        readFileSync(path.join(vdest, "index.ts"), "utf8"),
        'type: "vue3"',
      );

      const adest = path.join(tmp, "aapp");
      scaffold(adest, { name: "aapp", frontend: "angular" });
      assert.isTrue(
        existsSync(
          path.join(adest, "frontend", "src", "app", "app.component.ts"),
        ),
      );
      assert.isTrue(
        existsSync(path.join(adest, "frontend", "tsconfig.app.json")),
      );
      const apkg = readJson(path.join(adest, "package.json"));
      assert.property(apkg["devDependencies"], "@analogjs/vite-plugin-angular");
      assertNoEtaResidue(adest);
    });

    it("none : aucun fichier frontend, pas d'AppController", () => {
      const dest = path.join(tmp, "napp");
      scaffold(dest, { name: "napp" });
      assert.isFalse(existsSync(path.join(dest, "frontend")));
      assert.isFalse(
        existsSync(
          path.join(dest, "nodefony", "controllers", "AppController.ts"),
        ),
      );
    });
  });

  describe("moteur — garde-fous", () => {
    it("dossier non vide sans force → throw ; avec force → OK", () => {
      const dest = path.join(tmp, "occupied");
      mkdirSync(dest, { recursive: true });
      writeFileSync(path.join(dest, "x.txt"), "occupé");
      assert.throws(() => scaffold(dest, { name: "occupied" }), /pas vide/);
      scaffold(dest, { name: "occupied" }, true);
      assert.isTrue(existsSync(path.join(dest, "package.json")));
    });
  });

  describe("link (deps file: vers le checkout local)", () => {
    it("resolveLocalWorkspaces : checkout → map, hors checkout → null", () => {
      const workspaces = resolveLocalWorkspaces(findPackageRoot());
      assert.isNotNull(workspaces);
      assert.equal(workspaces!["nodefony"], findPackageRoot());
      assert.isTrue(existsSync(workspaces!["@nodefony/http"]));
      assert.isNull(resolveLocalWorkspaces(tmp));
    });

    it("linkLocalDeps : réécrit le scope nodefony, laisse le public", () => {
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
      const pkg = readJson(path.join(dest, "package.json"));
      assert.equal(pkg["dependencies"]["nodefony"], "file:/repo/src/nodefony");
      assert.equal(pkg["dependencies"]["zod"], "^4.4.3");
    });

    it("runScaffold link:true : app câblée sur le checkout", () => {
      const dest = path.join(tmp, "linked-app");
      const r = scaffold(dest, { name: "linked-app", link: true });
      assert.isNotEmpty(r.linked);
      const pkg = readJson(path.join(dest, "package.json"));
      assert.match(pkg["dependencies"]["nodefony"], /^file:.*src\/nodefony$/);
      assert.equal(pkg["dependencies"]["zod"], "^4.4.3");
    });
  });

  describe("front interactif (readline sur streams factices)", () => {
    /**
     * Répond AU RYTHME des prompts : readline ne met pas en file les lignes
     * arrivées entre deux `question()` — on pousse la réponse suivante quand
     * l'output affiche une invite (comme un humain).
     */
    const feedAnswers = (
      input: PassThrough,
      output: PassThrough,
      replies: string[],
    ): void => {
      const queue = [...replies];
      output.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        if (/[:\]] $/u.test(text) && queue.length > 0) {
          input.write(`${queue.shift()}\n`);
        }
      });
    };

    it("pose les questions manquantes, choix numérotés, défauts sur entrée vide", async () => {
      const [spec] = getScaffoldSpec("app");
      const input = new PassThrough();
      const output = new PassThrough();
      // name → "demo" · preset → 2 (minimal) · frontend → 2 (react) · link → o
      feedAnswers(input, output, ["demo", "2", "2", "o"]);
      const answers = await askMissing(
        spec,
        {},
        { hasCheckout: true },
        input,
        output,
      );
      assert.deepEqual(answers, {
        name: "demo",
        preset: "minimal",
        frontend: "react",
        link: true,
      });
    });

    it("ne redemande pas ce que les flags ont déjà dit ; saute link sans checkout", async () => {
      const [spec] = getScaffoldSpec("app");
      const input = new PassThrough();
      const output = new PassThrough();
      output.resume();
      input.write("\n"); // seul frontend est demandé → entrée vide = défaut none
      const answers = await askMissing(
        spec,
        { name: "demo", preset: "minimal" },
        { hasCheckout: false },
        input,
        output,
      );
      assert.equal(answers.frontend, "none");
      assert.isUndefined(answers.link); // askIf non satisfait → jamais posée
    });
  });

  describe("runCreateCommand (non-TTY : défauts stables pour CI/scripts)", () => {
    it("génère la vitrine complète par défaut, exit OK", async () => {
      const dest = path.join(tmp, "demo-app");
      const code = await runCreateCommand(
        argv("create", "app", "demo-app", "--dir", dest),
      );
      assert.equal(code, SysExit.OK);
      assert.isTrue(existsSync(path.join(dest, "compose.yaml")));
      const pkg = readJson(path.join(dest, "package.json"));
      assert.equal(pkg["dependencies"]["nodefony"], `^${version}`); // pas de link implicite
    });

    it("--preset/--frontend passent au moteur ; valeur invalide → EX_USAGE", async () => {
      const dest = path.join(tmp, "mini-app");
      const code = await runCreateCommand(
        argv("create", "app", "mini-app", "--dir", dest, "--preset", "minimal"),
      );
      assert.equal(code, SysExit.OK);
      assert.isFalse(existsSync(path.join(dest, "compose.yaml")));
      assert.equal(
        await runCreateCommand(
          argv(
            "create",
            "app",
            "x",
            "--dir",
            path.join(tmp, "x"),
            "--preset",
            "big",
          ),
        ),
        SysExit.USAGE,
      );
    });

    it("usage invalide / nom manquant hors TTY / dossier occupé", async () => {
      assert.equal(await runCreateCommand(argv("create")), SysExit.USAGE);
      assert.equal(
        await runCreateCommand(argv("create", "app", "Bad_Name")),
        SysExit.USAGE,
      );
      assert.equal(
        await runCreateCommand(argv("create", "app")),
        SysExit.USAGE,
      );
      const dest = path.join(tmp, "busy");
      mkdirSync(dest, { recursive: true });
      writeFileSync(path.join(dest, "x.txt"), "occupé");
      assert.equal(
        await runCreateCommand(argv("create", "app", "busy", "--dir", dest)),
        SysExit.CANTCREAT,
      );
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
