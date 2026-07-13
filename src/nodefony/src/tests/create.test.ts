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
        install: true,
        git: true,
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
          "--no-install",
          "--no-git",
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
        install: false,
        git: false,
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
        ".env",
        ".env.local",
        path.join("nodefony", "security", "provisionUsers.ts"),
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

    it("secrets PAR-PROJET : .env.local porte 3 clés uniques, .gitignore les exclut", () => {
      const dest = path.join(tmp, "sec");
      scaffold(dest, { name: "sec" });
      const local = readFileSync(path.join(dest, ".env.local"), "utf8");
      const keys = ["NF_TOTP_KEY", "NF_WEBHOOK_KEY", "NF_CSRF_SECRET"];
      const values: string[] = [];
      for (const k of keys) {
        const m = local.match(new RegExp(`^${k}=(.+)$`, "m"));
        assert.isNotNull(m, `clé ${k} absente de .env.local`);
        // 32 octets base64 = 44 caractères — le format AES-256-GCM attendu.
        assert.lengthOf((m as RegExpMatchArray)[1], 44);
        values.push((m as RegExpMatchArray)[1]);
      }
      assert.lengthOf(new Set(values), 3, "les 3 clés doivent être distinctes");
      // Deux apps générées ne partagent JAMAIS une clé (aléatoire par projet).
      const dest2 = path.join(tmp, "sec2");
      scaffold(dest2, { name: "sec2" });
      const local2 = readFileSync(path.join(dest2, ".env.local"), "utf8");
      assert.notInclude(local2, values[0]);
      // Le .env COMMITÉ ne porte AUCUNE valeur de secret ; le .gitignore exclut *.local.
      const dotenv = readFileSync(path.join(dest, ".env"), "utf8");
      for (const v of values) assert.notInclude(dotenv, v);
      assert.include(
        readFileSync(path.join(dest, ".gitignore"), "utf8"),
        "*.local",
      );
    });

    it("provisionUsers câblé : hook onKernelReady + seed admin + rôles Studio", () => {
      const dest = path.join(tmp, "prov");
      scaffold(dest, { name: "prov" });
      const index = readFileSync(path.join(dest, "index.ts"), "utf8");
      assert.include(index, "provisionUsers(this)");
      assert.include(index, "onKernelReady");
      const prov = readFileSync(
        path.join(dest, "nodefony", "security", "provisionUsers.ts"),
        "utf8",
      );
      assert.include(prov, "NF_ADMIN_PASSWORD");
      assert.include(prov, "ROLE_NODEFONY_ADMIN");
      const config = readFileSync(
        path.join(dest, "nodefony.config.ts"),
        "utf8",
      );
      assert.include(config, "roleHierarchy");
      assert.include(config, "NF_CSRF_SECRET");
    });
  });

  describe("moteur — preset minimal", () => {
    it("base saine : http+framework seuls, PAS d'infra docker", () => {
      const dest = path.join(tmp, "mini");
      scaffold(dest, { name: "mini", preset: "minimal" });
      assert.isFalse(existsSync(path.join(dest, "compose.yaml")));
      assert.isFalse(existsSync(path.join(dest, "docker")));
      // Pas de security en minimal → ni secrets ni provisioning utilisateurs.
      assert.isFalse(existsSync(path.join(dest, ".env.local")));
      assert.isFalse(existsSync(path.join(dest, "nodefony", "security")));
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

  describe("moteur — create controller (in-project)", () => {
    /** Scaffold controller depuis `from` (détection racine = comme le CLI). */
    const controller = (
      from: string,
      answers: Record<string, string | boolean>,
    ) =>
      runScaffold(
        { type: "controller", answers, dir: from, force: false },
        version,
      );

    it("hello (défaut) : fichier + wiring index.ts + notes GET/WS", () => {
      const dest = path.join(tmp, "capp");
      scaffold(dest, { name: "capp", preset: "minimal" });
      const r = controller(dest, { name: "blog" });
      const file = path.join(
        dest,
        "nodefony",
        "controllers",
        "BlogController.ts",
      );
      assert.isTrue(existsSync(file));
      const src = readFileSync(file, "utf8");
      assert.include(src, '@controller("/api/blog")');
      assert.include(src, 'methods: ["WEBSOCKET"]');
      const index = readFileSync(path.join(dest, "index.ts"), "utf8");
      assert.include(
        index,
        'import BlogController from "./nodefony/controllers/BlogController";',
      );
      assert.match(index, /@controllers\(\[[^\]]*BlogController\]\)/u);
      assert.include((r.notes ?? []).join("\n"), "GET  /api/blog");
      assertNoEtaResidue(dest);
    });

    it("normalisation : blog-postController → BlogPostController, route kebab", () => {
      const dest = path.join(tmp, "norm");
      scaffold(dest, { name: "norm", preset: "minimal" });
      controller(dest, { name: "blog-postController" });
      const file = path.join(
        dest,
        "nodefony",
        "controllers",
        "BlogPostController.ts",
      );
      assert.isTrue(existsSync(file));
      assert.include(
        readFileSync(file, "utf8"),
        '@controller("/api/blog-post")',
      );
    });

    it("realtime : RealtimeController + canal ticker ; minimal sans la dep → garde", () => {
      const full = path.join(tmp, "rt");
      scaffold(full, { name: "rt", preset: "complete" });
      controller(full, { name: "pulse", kind: "realtime" });
      const src = readFileSync(
        path.join(full, "nodefony", "controllers", "PulseController.ts"),
        "utf8",
      );
      assert.include(src, "extends RealtimeController");
      assert.include(src, '@RealtimeChannel("pulse:ticker")');
      assert.include(src, '"pulse:ping"');

      const mini = path.join(tmp, "rtmini");
      scaffold(mini, { name: "rtmini", preset: "minimal" });
      assert.throws(
        () => controller(mini, { name: "pulse", kind: "realtime" }),
        /@nodefony\/realtime/u,
      );
    });

    it("rest complete : vitrine décorateurs (sécu + idempotence + session)", () => {
      const dest = path.join(tmp, "rest");
      scaffold(dest, { name: "rest", preset: "complete" });
      controller(dest, { name: "item", kind: "rest", route: "/api/items" });
      const src = readFileSync(
        path.join(dest, "nodefony", "controllers", "ItemController.ts"),
        "utf8",
      );
      for (const marker of [
        '@controller("/api/items")',
        '@Get("/{id}")',
        '@Post("")',
        "@Idempotent()",
        "@HttpCode(201)",
        '@IsGranted("ROLE_ADMIN")',
        '@RequireScope("item:export")',
        "@CsrfProtect()",
        "@UseSession()",
        "@CurrentUser()",
        '@Headers("user-agent")',
        "@UploadedFile()",
        "@Redirect(",
        '@Patch("/{id}")',
        "@Body({ stream: true })",
        'import type { IUser } from "@nodefony/user";',
        "WEBSOCKET",
      ]) {
        assert.include(src, marker, `manque ${marker}`);
      }
      // Bug vécu : une action @Idempotent doit RETOURNER le payload brut —
      // renderJson (structure circulaire) casserait la mémorisation du rejeu.
      assert.include(src, "return item;");
      // La route paramétrique reste déclarée APRÈS les GET statiques (ordre de match).
      assert.isBelow(
        src.indexOf('@Get("/latest")'),
        src.indexOf('@Get("/{id}")'),
      );
    });

    it("rest minimal : vitrine DÉGRADÉE sans security (aucun import mort)", () => {
      const dest = path.join(tmp, "restmin");
      scaffold(dest, { name: "restmin", preset: "minimal" });
      controller(dest, { name: "item", kind: "rest" });
      const src = readFileSync(
        path.join(dest, "nodefony", "controllers", "ItemController.ts"),
        "utf8",
      );
      // Les NOMS restent cités dans le commentaire pédagogique (« ajoute
      // @nodefony/security pour débloquer… ») — on vérifie l'absence d'USAGE.
      assert.notInclude(src, '@IsGranted("');
      assert.notInclude(src, "@nodefony/user");
      assert.notInclude(src, "@CsrfProtect()");
      assert.notInclude(src, "  IsGranted,");
      assert.include(src, "@Idempotent()");
      assert.include(src, "@UseSession()");
      assert.include(src, "ajoute `@nodefony/security`");
    });

    it("cible --module : écrit dans modules/<x> + wiring de SON index.ts", () => {
      const dest = path.join(tmp, "mapp");
      scaffold(dest, { name: "mapp", preset: "minimal" });
      const mod = path.join(dest, "modules", "shop");
      mkdirSync(path.join(mod, "nodefony"), { recursive: true });
      writeFileSync(
        path.join(mod, "package.json"),
        JSON.stringify({ name: "@mapp/shop" }),
      );
      writeFileSync(
        path.join(mod, "index.ts"),
        'import { Module } from "nodefony";\n' +
          'import { controllers } from "@nodefony/framework";\n\n' +
          "@controllers([])\nclass Shop extends Module {}\nexport default Shop;\n",
      );
      controller(dest, { name: "cart", module: "@mapp/shop" });
      assert.isTrue(
        existsSync(
          path.join(mod, "nodefony", "controllers", "CartController.ts"),
        ),
      );
      const index = readFileSync(path.join(mod, "index.ts"), "utf8");
      assert.include(index, "@controllers([CartController])");
      // l'index de l'APP n'est pas touché
      assert.notInclude(
        readFileSync(path.join(dest, "index.ts"), "utf8"),
        "CartController",
      );
    });

    it("garde-fous : hors projet / module inconnu / nom en double", () => {
      assert.throws(
        () => controller(os.tmpdir(), { name: "x" }),
        /aucun projet Nodefony/u,
      );
      const dest = path.join(tmp, "gapp");
      scaffold(dest, { name: "gapp", preset: "minimal" });
      assert.throws(
        () => controller(dest, { name: "x", module: "ghost" }),
        /introuvable — cibles du projet/u,
      );
      controller(dest, { name: "dup" });
      assert.throws(() => controller(dest, { name: "dup" }), /déjà référencé/u);
    });

    it("parseCreateArgv : --kind --route --module", () => {
      const p = parseCreateArgv(
        argv(
          "create",
          "controller",
          "blog",
          "--kind",
          "realtime",
          "--route",
          "/api/live",
          "--module",
          "@x/shop",
        ),
      );
      assert.notProperty(p, "error");
      const req = p as Exclude<typeof p, { error: string }>;
      assert.equal(req.type, "controller");
      assert.deepInclude(req.answers, {
        name: "blog",
        kind: "realtime",
        route: "/api/live",
        module: "@x/shop",
      });
    });
  });

  describe("moteur — create front (in-project)", () => {
    const front = (from: string, answers: Record<string, string | boolean>) =>
      runScaffold({ type: "front", answers, dir: from, force: false }, version);

    it("app complete SANS front : coquille + entry + controller + double wiring", () => {
      const dest = path.join(tmp, "fapp");
      scaffold(dest, { name: "fapp", preset: "complete", frontend: "none" });
      const r = front(dest, { name: "dashboard", frontend: "react" });
      for (const f of [
        path.join("frontend", "index.html"),
        path.join("frontend", "src", "main.tsx"),
        path.join("frontend", "src", "App.tsx"),
        path.join("nodefony", "controllers", "DashboardController.ts"),
        path.join("nodefony", "frontend", "registerDashboardEntry.ts"),
      ]) {
        assert.isTrue(existsSync(path.join(dest, f)), `manque ${f}`);
      }
      const index = readFileSync(path.join(dest, "index.ts"), "utf8");
      assert.include(index, "DashboardController");
      assert.match(index, /@controllers\(\[[^\]]*DashboardController\]\)/u);
      assert.include(index, "registerDashboardEntry(this);");
      assert.include(index, "override async onKernelBoot()");
      // Deps du framework ajoutées au package.json (catalogue unique).
      const pkg = readJson(path.join(dest, "package.json"));
      assert.property(pkg["dependencies"], "react");
      assert.property(pkg["devDependencies"], "@vitejs/plugin-react");
      assert.include((r.notes ?? []).join("\n"), "npm install");
      // Le controller de page rend l'entry du BON nom.
      const ctrl = readFileSync(
        path.join(dest, "nodefony", "controllers", "DashboardController.ts"),
        "utf8",
      );
      assert.include(ctrl, 'renderDocument("dashboard"');
      assert.include(ctrl, 'path: "/dashboard"');
      assertNoEtaResidue(dest);
    });

    it("cible avec un front DÉJÀ posé → throw actionnable", () => {
      const dest = path.join(tmp, "fdup");
      scaffold(dest, { name: "fdup", preset: "complete", frontend: "react" });
      assert.throws(
        () => front(dest, { name: "extra", frontend: "react" }),
        /porte déjà un front/u,
      );
    });

    it("cible sans @nodefony/frontend (minimal none) → throw actionnable", () => {
      const dest = path.join(tmp, "fmin");
      scaffold(dest, { name: "fmin", preset: "minimal" });
      assert.throws(
        () => front(dest, { name: "page", frontend: "vue" }),
        /@nodefony\/frontend manque/u,
      );
    });

    it("vue : shim env.d.ts partagé ; angular : tsconfig.app.json partagé", () => {
      const v = path.join(tmp, "fvue");
      scaffold(v, { name: "fvue", preset: "complete", frontend: "none" });
      front(v, { name: "board", frontend: "vue" });
      assert.isTrue(existsSync(path.join(v, "frontend", "src", "env.d.ts")));
      const a = path.join(tmp, "fng");
      scaffold(a, { name: "fng", preset: "complete", frontend: "none" });
      front(a, { name: "board", frontend: "angular" });
      assert.isTrue(existsSync(path.join(a, "frontend", "tsconfig.app.json")));
    });

    it("les apps AVEC front gardent la coquille et les briques partagées", () => {
      // Non-régression du déplacement des layers (front-shell/vue-shim/ng-tsconfig).
      const rv = path.join(tmp, "regvue");
      scaffold(rv, { name: "regvue", preset: "minimal", frontend: "vue" });
      assert.isTrue(existsSync(path.join(rv, "frontend", "index.html")));
      assert.isTrue(existsSync(path.join(rv, "frontend", "src", "env.d.ts")));
      const rn = path.join(tmp, "regng");
      scaffold(rn, { name: "regng", preset: "minimal", frontend: "angular" });
      assert.isTrue(existsSync(path.join(rn, "frontend", "index.html")));
      assert.isTrue(existsSync(path.join(rn, "frontend", "tsconfig.app.json")));
      const pkg = readJson(path.join(rn, "package.json"));
      assert.property(pkg["devDependencies"], "@analogjs/vite-plugin-angular");
    });
  });

  describe("catalogue de versions (anti-dérive templates ↔ monorepo)", () => {
    it("chaque version du catalogue reste alignée (même MAJEURE) sur le repo", async () => {
      const { SCAFFOLD_VERSIONS } = await import("../cli/scaffold/versions");
      const repoRoot = path.resolve(findPackageRoot(), "..", "..");
      // Sources de vérité : là où le monorepo utilise RÉELLEMENT ces paquets.
      const sources = [
        "package.json",
        path.join("src", "nodefony", "package.json"),
        path.join("src", "packages", "@nodefony", "studio", "package.json"),
        path.join("src", "packages", "@nodefony", "frontend", "package.json"),
      ];
      const repo: Record<string, string> = {};
      for (const rel of sources) {
        const p = path.join(repoRoot, rel);
        if (!existsSync(p)) continue;
        const pkg = readJson(p);
        Object.assign(
          repo,
          pkg["devDependencies"] ?? {},
          pkg["dependencies"] ?? {},
        );
      }
      const major = (v: string) =>
        Number.parseInt(v.replace(/^[~^>=\s]*/u, ""), 10);
      const drifts: string[] = [];
      for (const [name, range] of Object.entries(SCAFFOLD_VERSIONS)) {
        const used = repo[name];
        if (!used || used.startsWith("file:")) continue; // pas comparable
        if (major(range) !== major(used)) {
          drifts.push(`${name}: scaffold ${range} vs repo ${used}`);
        }
      }
      assert.deepEqual(
        drifts,
        [],
        `catalogue scaffold (versions.ts) en dérive de MAJEURE vs le repo :\n${drifts.join("\n")}`,
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
      // --no-install/--no-git : le banc valide la GÉNÉRATION, pas npm ni git.
      const code = await runCreateCommand(
        argv(
          "create",
          "app",
          "demo-app",
          "--dir",
          dest,
          "--no-install",
          "--no-git",
        ),
      );
      assert.equal(code, SysExit.OK);
      assert.isTrue(existsSync(path.join(dest, "compose.yaml")));
      const pkg = readJson(path.join(dest, "package.json"));
      assert.equal(pkg["dependencies"]["nodefony"], `^${version}`); // pas de link implicite
    });

    it("--preset/--frontend passent au moteur ; valeur invalide → EX_USAGE", async () => {
      const dest = path.join(tmp, "mini-app");
      const code = await runCreateCommand(
        argv(
          "create",
          "app",
          "mini-app",
          "--dir",
          dest,
          "--preset",
          "minimal",
          "--no-install",
          "--no-git",
        ),
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
      execFileSync(
        "node",
        [
          bin,
          "create",
          "app",
          "e2e-app",
          "--dir",
          dest,
          "--no-install",
          "--no-git",
        ],
        { stdio: "pipe" },
      );
      assert.isTrue(existsSync(path.join(dest, "nodefony.config.ts")));
    });
  });
});
