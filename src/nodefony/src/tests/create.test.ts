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
import {
  parseCreateArgv,
  runCreateCommand,
  type ICreateRequest,
} from "../cli/create";
import { getScaffoldSpec } from "../cli/scaffold/spec";
import {
  findPackageRoot,
  resolveLocalWorkspaces,
  resolveAnswers,
  linkLocalDeps,
  runScaffold,
} from "../cli/scaffold/engine";
import { ScaffoldWriter, diffLines } from "../cli/scaffold/writer";
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

/**
 * Le CODE d'un fichier, commentaires ôtés.
 *
 * Ce que la règle « identité par `@CurrentUser()`, pas `RequestContext` brut »
 * veut dire : le code généré ne doit pas ENSEIGNER la mauvaise API. Elle ne dit
 * rien des commentaires — et le template en a un légitime, qui montre
 * `RequestContext.getUser()` dans `initialize()` : ce hook est appelé SANS
 * argument (`controller.initialize()`), un décorateur de paramètre n'y est donc
 * pas injectable. Une assertion posée sur le fichier entier confondait les deux
 * et tombait sur un commentaire juste.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "") // blocs
    .replace(/(^|[^:])\/\/.*$/gmu, "$1"); // lignes (hors `://` d'une URL)
}

/**
 * Empreinte COMPLÈTE d'une arborescence : chemin relatif → contenu.
 *
 * Sert les contrôles « aucun geste partiel » : comparer l'empreinte avant et
 * après un scaffold qui refuse prouve à la fois qu'aucun fichier n'a été
 * ajouté ET qu'aucun n'a été réécrit — ce qu'un `assert.throws` seul ne dit
 * pas (un moteur peut parfaitement écrire cinq fichiers puis lever).
 */
function snapshotTree(dir: string): Map<string, string> {
  const snap = new Map<string, string>();
  for (const entry of readdirSync(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    snap.set(path.relative(dir, abs), readFileSync(abs, "utf8"));
  }
  return snap;
}

/** L'arborescence est restée octet pour octet celle de `before`. */
function assertTreeUnchanged(before: Map<string, string>, dir: string): void {
  const after = snapshotTree(dir);
  const added = [...after.keys()].filter((f) => !before.has(f));
  assert.deepEqual(added, [], "fichiers écrits malgré le refus");
  const removed = [...before.keys()].filter((f) => !after.has(f));
  assert.deepEqual(removed, [], "fichiers supprimés malgré le refus");
  for (const [file, content] of before) {
    assert.equal(after.get(file), content, `${file} réécrit malgré le refus`);
  }
}

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
        dryRun: false,
        describeJson: false,
        answersJson: undefined,
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
        dryRun: false,
        describeJson: false,
        answersJson: undefined,
      });
    });

    it("--dry-run / -n : simulation demandée", () => {
      const long = parseCreateArgv(argv("create", "app", "x", "--dry-run"));
      const short = parseCreateArgv(argv("create", "app", "x", "-n"));
      assert.isTrue((long as ICreateRequest).dryRun);
      assert.isTrue((short as ICreateRequest).dryRun);
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
      // Identité par décorateur @CurrentUser (idiomatique), pas RequestContext brut.
      assert.include(src, "@CurrentUser()");
      assert.notInclude(codeOnly(src), "RequestContext");
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

    it("example complete : vitrine décorateurs (sécu + idempotence + session)", () => {
      const dest = path.join(tmp, "exfull");
      scaffold(dest, { name: "exfull", preset: "complete" });
      controller(dest, { name: "item", kind: "example", route: "/api/items" });
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
      // Identité par décorateur, jamais RequestContext brut dans la vitrine.
      assert.notInclude(codeOnly(src), "RequestContext");
      // La route paramétrique reste déclarée APRÈS les GET statiques (ordre de match).
      assert.isBelow(
        src.indexOf('@Get("/latest")'),
        src.indexOf('@Get("/{id}")'),
      );
    });

    it("example minimal : vitrine DÉGRADÉE sans security (aucun import mort)", () => {
      const dest = path.join(tmp, "exmin");
      scaffold(dest, { name: "exmin", preset: "minimal" });
      controller(dest, { name: "item", kind: "example" });
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
      // @CurrentUser vient du framework (lit l'ALS) → présent MÊME sans security.
      assert.include(src, "@CurrentUser()");
    });

    it("rest : CRUD de production HTTP pur (pas de zoo, pas de WS)", () => {
      const dest = path.join(tmp, "restpur");
      scaffold(dest, { name: "restpur", preset: "complete" });
      controller(dest, { name: "item", kind: "rest", route: "/api/items" });
      const src = readFileSync(
        path.join(dest, "nodefony", "controllers", "ItemController.ts"),
        "utf8",
      );
      for (const marker of [
        '@controller("/api/items")',
        '@Get("")',
        '@Get("/{id}")',
        '@Post("")',
        '@Put("/{id}")',
        '@Patch("/{id}")',
        '@Delete("/{id}")',
        "@HttpCode(201)",
        "@Idempotent()",
        "@CurrentUser()",
        // complete → security : delete protégée par rôle.
        '@IsGranted("ROLE_ADMIN")',
        "HttpError",
      ]) {
        assert.include(src, marker, `manque ${marker}`);
      }
      // REST pur : aucun transport WS, aucun décorateur de la vitrine.
      assert.notInclude(src, "WEBSOCKET");
      assert.notInclude(src, "@UseSession");
      assert.notInclude(src, "@UploadedFile");
      assert.notInclude(codeOnly(src), "RequestContext");
      // minimal (sans security) : delete dégradée SANS @IsGranted, zéro import mort.
      const mini = path.join(tmp, "restpurmin");
      scaffold(mini, { name: "restpurmin", preset: "minimal" });
      controller(mini, { name: "item", kind: "rest" });
      const srcMin = readFileSync(
        path.join(mini, "nodefony", "controllers", "ItemController.ts"),
        "utf8",
      );
      assert.notInclude(srcMin, "@IsGranted");
      assert.notInclude(srcMin, "@nodefony/user");
      assert.include(srcMin, '@Delete("/{id}")');
    });

    it("duplex : mêmes actions REST + socket (pont api.request) ; garde dep realtime", () => {
      const dest = path.join(tmp, "duplex");
      scaffold(dest, { name: "duplex", preset: "complete" });
      controller(dest, { name: "item", kind: "duplex", route: "/api/items" });
      const src = readFileSync(
        path.join(dest, "nodefony", "controllers", "ItemController.ts"),
        "utf8",
      );
      for (const marker of [
        "extends RealtimeController",
        // Le PONT opt-in : sans cet override, api.request n'existe pas.
        "realtimeApiRequest(): boolean",
        // Transports déclarés route par route (zéro bypass).
        'methods: ["GET", "WEBSOCKET"]',
        'methods: ["POST", "WEBSOCKET"]',
        'methods: ["DELETE", "WEBSOCKET"]',
        "@Idempotent()",
        "@CurrentUser()",
        // Le TSDoc client montre les DEUX portes.
        "socket.request(",
        "socket.mutate(",
        "idempotencyKey",
      ]) {
        assert.include(src, marker, `manque ${marker}`);
      }
      // minimal sans @nodefony/realtime → garde actionnable (comme realtime).
      const mini = path.join(tmp, "duplexmin");
      scaffold(mini, { name: "duplexmin", preset: "minimal" });
      assert.throws(
        () => controller(mini, { name: "item", kind: "duplex" }),
        /@nodefony\/realtime/u,
      );
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

    it("nom en double : refus SANS toucher au projet", () => {
      const dest = path.join(tmp, "cintact");
      scaffold(dest, { name: "cintact", preset: "minimal" });
      controller(dest, { name: "blog", kind: "rest" });
      const before = snapshotTree(dest);
      assert.throws(
        () => controller(dest, { name: "blog", kind: "hello" }),
        /déjà référencé/u,
      );
      assertTreeUnchanged(before, dest);
    });

    it("wiring impossible : refus SANS laisser un controller orphelin", () => {
      // Un `index.ts` sans `@controllers([...])` : le moteur ne SAIT pas câbler.
      // Il doit le dire avant d'écrire — un fichier posé mais jamais chargé est
      // pire qu'un refus, l'utilisateur croit avoir un controller qui répond.
      const dest = path.join(tmp, "noanchor");
      scaffold(dest, { name: "noanchor", preset: "minimal" });
      const indexPath = path.join(dest, "index.ts");
      writeFileSync(
        indexPath,
        readFileSync(indexPath, "utf8").replace(
          /@controllers\(\[[^\]]*\]\)/u,
          "",
        ),
      );
      const before = snapshotTree(dest);
      assert.throws(
        () => controller(dest, { name: "orphan" }),
        /@controllers/u,
      );
      assertTreeUnchanged(before, dest);
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

  describe("moteur — create module (in-project, workspace npm)", () => {
    /** Rend un module dans une app déjà scaffoldée. */
    const mod = (
      from: string,
      answers: Record<string, string | boolean>,
      force = false,
    ) => runScaffold({ type: "module", answers, dir: from, force }, version);

    /** App de fixture — le module se pose DEDANS (comme en usage réel). */
    const app = (name: string, preset = "complete"): string => {
      const dest = path.join(tmp, name);
      scaffold(dest, { name, preset, frontend: "none" });
      return dest;
    };

    it("pose la coquille : package npm, build, config Zod, docs, tests", () => {
      const dest = app("mapp");
      const r = mod(dest, { name: "blog", controller: "none" });
      for (const f of [
        "package.json",
        "tsconfig.json",
        "rolldown.config.ts",
        "vitest.config.ts",
        "index.ts",
        "README.md",
        path.join("docs", "index.md"),
        path.join("nodefony", "config", "config.ts"),
        path.join("nodefony", "config", "defineModuleConfig.ts"),
        path.join("nodefony", "src", "errors", "BlogError.ts"),
        path.join("tests", "blog.test.ts"),
      ]) {
        assert.isTrue(existsSync(path.join(r.dest, f)), `manque ${f}`);
      }
      assert.equal(r.dest, path.join(dest, "modules", "blog"));
      assertNoEtaResidue(r.dest);
    });

    it("nomme le paquet d'après l'app (@<app>/<module>) et le rend chargeable", () => {
      const dest = app("mapp");
      const r = mod(dest, { name: "blog", controller: "none" });
      const pkg = readJson(path.join(r.dest, "package.json"));
      assert.equal(pkg["name"] as unknown as string, "@mapp/blog");
      assert.equal(pkg["main"] as unknown as string, "dist/index.js");
      // Le Kernel importe le module PAR SON NOM → le nom du paquet et l'entrée
      // du manifeste doivent être le MÊME identifiant.
      const config = readFileSync(
        path.join(dest, "nodefony.config.ts"),
        "utf8",
      );
      assert.include(config, 'use("@mapp/blog", {})');
    });

    it("déclare le workspace npm et chaîne les scripts de l'app", () => {
      const dest = app("mapp");
      mod(dest, { name: "blog", controller: "none" });
      const pkg = JSON.parse(
        readFileSync(path.join(dest, "package.json"), "utf8"),
      ) as { workspaces: string[]; scripts: Record<string, string> };
      assert.include(pkg.workspaces, "modules/*");
      // Sans ce chaînage, le module ne serait ni construit, ni typé, ni testé.
      assert.include(pkg.scripts["build"], "--workspaces");
      assert.include(pkg.scripts["typecheck"], "--workspaces");
      assert.include(pkg.scripts["test"], "--workspaces");
      // Le build des modules passe AVANT celui de l'app.
      assert.isTrue(
        pkg.scripts["build"].indexOf("--workspaces") <
          pkg.scripts["build"].indexOf("rolldown"),
      );
    });

    it("est idempotent : un 2ᵉ module ne duplique ni workspace ni chaînage", () => {
      const dest = app("mapp");
      mod(dest, { name: "blog", controller: "none" });
      const first = JSON.parse(
        readFileSync(path.join(dest, "package.json"), "utf8"),
      ) as { scripts: Record<string, string> };
      mod(dest, { name: "shop", controller: "none" });
      const pkg = JSON.parse(
        readFileSync(path.join(dest, "package.json"), "utf8"),
      ) as { workspaces: string[]; scripts: Record<string, string> };
      assert.deepEqual(pkg.workspaces, ["modules/*"]);
      for (const script of ["build", "typecheck", "test"]) {
        assert.equal(
          (pkg.scripts[script].match(/--workspaces/gu) ?? []).length,
          1,
          `script ${script} chaîné deux fois`,
        );
        // Le 2ᵉ passage n'a PAS touché aux scripts déjà chaînés.
        assert.equal(pkg.scripts[script], first.scripts[script]);
      }
      const config = readFileSync(
        path.join(dest, "nodefony.config.ts"),
        "utf8",
      );
      assert.include(config, 'use("@mapp/blog", {})');
      assert.include(config, 'use("@mapp/shop", {})');
    });

    it("délègue le controller au scaffold controller (0 template dupliqué)", () => {
      const dest = app("mapp");
      const r = mod(dest, { name: "blog", controller: "hello" });
      const ctrl = path.join(
        r.dest,
        "nodefony",
        "controllers",
        "BlogController.ts",
      );
      assert.isTrue(existsSync(ctrl), "controller non rendu dans le module");
      // Câblé dans l'index DU MODULE (pas dans celui de l'app).
      const index = readFileSync(path.join(r.dest, "index.ts"), "utf8");
      assert.include(index, "@controllers([BlogController])");
      assert.notInclude(
        readFileSync(path.join(dest, "index.ts"), "utf8"),
        "BlogController",
      );
      assert.deepInclude(r.notes ?? [], "GET  /api/blog");
    });

    it("service et commande CLI : posés à la demande, jamais imposés", () => {
      const dest = app("mapp");
      const withAll = mod(dest, {
        name: "blog",
        controller: "none",
        service: true,
        command: true,
      });
      assert.isTrue(
        existsSync(
          path.join(withAll.dest, "nodefony", "service", "BlogService.ts"),
        ),
      );
      assert.isTrue(
        existsSync(
          path.join(withAll.dest, "nodefony", "command", "BlogCommand.ts"),
        ),
      );
      const index = readFileSync(path.join(withAll.dest, "index.ts"), "utf8");
      assert.include(index, "@services([BlogService])");
      assert.include(index, "this.addCommand(BlogCommand)");

      // Le service et la commande générés doivent porter les DEUX noms cohérents :
      // `@injectable()` nomme la CLASSE, `super("blog", …)` la clé du conteneur —
      // et la commande doit demander le service par cette CLÉ, pas par la classe.
      const svc = readFileSync(
        path.join(withAll.dest, "nodefony", "service", "BlogService.ts"),
        "utf8",
      );
      assert.include(svc, "@injectable()");
      // Vise le CODE, pas la prose. Le fichier généré DOCUMENTE les deux noms en
      // commentaire (« super("blog", …) ») : un `include('"blog"')` — et même un
      // `/super\(\s*"blog",/` — reste donc vert avec un `super()` cassé, en
      // matchant le commentaire. Constaté en tentant de mettre ce test en rouge.
      // On ancre sur ce que la prose ne contient pas : l'argument suivant.
      assert.match(
        svc,
        /super\(\s*"blog",\s*module\.container/,
        "le service doit s'enregistrer sous sa clé conteneur",
      );
      const cmd = readFileSync(
        path.join(withAll.dest, "nodefony", "command", "BlogCommand.ts"),
        "utf8",
      );
      assert.include(
        cmd,
        'get("blog")',
        "la commande doit résoudre le service par sa CLÉ conteneur",
      );

      // Aucune balise de template ne doit fuiter dans le code livré — cas réel :
      // un fichier ajouté au scaffold mais jamais passé au moteur (copié tel
      // quel) partirait chez l'utilisateur avec ses `<% %>` en clair.
      //
      // ⚠️ Portée exacte, vérifiée : ce contrôle N'ATTRAPE PAS une variable mal
      // nommée — Eta rend `<%= it.typo %>` en chaîne VIDE, sans lever. Une faute
      // de nom produit donc un trou silencieux dans le fichier généré, que rien
      // ici ne voit. (Le vrai filet contre ça = les assertions de contenu
      // ci-dessus, qui exigent les chaînes attendues.)
      for (const [file, src] of [
        ["index.ts", index],
        ["BlogService.ts", svc],
        ["BlogCommand.ts", cmd],
      ] as const) {
        assert.notMatch(
          src,
          /<%|%>/,
          `${file} contient une balise de template non rendue`,
        );
      }

      const bare = mod(dest, {
        name: "shop",
        controller: "none",
        service: false,
        command: false,
      });
      assert.isFalse(existsSync(path.join(bare.dest, "nodefony", "service")));
      assert.isFalse(existsSync(path.join(bare.dest, "nodefony", "command")));
      const bareIndex = readFileSync(path.join(bare.dest, "index.ts"), "utf8");
      assert.notInclude(bareIndex, "@services");
      assert.notInclude(bareIndex, "addCommand");
    });

    it("docs IA (CLAUDE.md/MEMORY.md) : seulement si le projet en tient", () => {
      const plain = app("plain");
      const r1 = mod(plain, { name: "blog", controller: "none" });
      assert.isFalse(existsSync(path.join(r1.dest, "CLAUDE.md")));
      assert.isFalse(existsSync(path.join(r1.dest, "MEMORY.md")));

      const piloted = app("piloted");
      writeFileSync(
        path.join(piloted, "CLAUDE.md"),
        "# projet piloté par IA\n",
      );
      const r2 = mod(piloted, { name: "blog", controller: "none" });
      assert.isTrue(existsSync(path.join(r2.dest, "CLAUDE.md")));
      assert.isTrue(existsSync(path.join(r2.dest, "MEMORY.md")));
    });

    it("config du module : le schéma Zod porte les défauts, le registre le type", () => {
      const dest = app("mapp");
      const r = mod(dest, { name: "blog", controller: "none" });
      const config = readFileSync(
        path.join(r.dest, "nodefony", "config", "config.ts"),
        "utf8",
      );
      assert.include(config, "export const blogConfigSchema");
      assert.include(config, "blogConfigSchema.parse({})");
      const builder = readFileSync(
        path.join(r.dest, "nodefony", "config", "defineModuleConfig.ts"),
        "utf8",
      );
      // Le builder VALIDE, il ne porte aucune valeur (règle d'or ADR-0006).
      assert.include(builder, "export function defineBlogConfig");
      assert.notInclude(builder, ".default(");
      const index = readFileSync(path.join(r.dest, "index.ts"), "utf8");
      assert.include(index, 'declare module "nodefony"');
      assert.include(index, '"@mapp/blog": BlogConfigInput;');
    });

    it("refuse un module qui existe déjà (sauf --force)", () => {
      const dest = app("mapp");
      mod(dest, { name: "blog", controller: "none" });
      assert.throws(
        () => mod(dest, { name: "blog", controller: "none" }),
        /existe déjà/u,
      );
    });

    it("refuse hors projet — avec le geste à faire", () => {
      assert.throws(
        () => mod(tmp, { name: "blog", controller: "none" }),
        /aucun projet Nodefony/u,
      );
    });

    it("refuse une brique absente de l'app plutôt que de générer du code mort", () => {
      // Preset minimal = ni realtime ni frontend dans l'app : un module ne peut
      // pas « ajouter » un paquet qui n'est pas installé.
      const dest = app("mini", "minimal");
      assert.throws(
        () => mod(dest, { name: "blog", controller: "realtime" }),
        /@nodefony\/realtime/u,
      );
      assert.throws(
        () => mod(dest, { name: "blog", frontend: "react" }),
        /@nodefony\/frontend/u,
      );
      // Rien n'a été écrit : la garde tombe AVANT le premier fichier.
      assert.isFalse(existsSync(path.join(dest, "modules", "blog")));
    });

    it("spec module : questions JSON-able, défauts sûrs (contrat des 3 fronts)", () => {
      const [spec] = getScaffoldSpec("module");
      assert.equal(spec.type, "module");
      const keys = spec.questions.map((q) => q.key);
      assert.deepEqual(keys, [
        "name",
        "description",
        "controller",
        "service",
        "command",
        "frontend",
      ]);
      const answers = resolveAnswers(
        spec,
        { name: "blog" },
        {
          hasCheckout: false,
        },
      );
      assert.deepEqual(answers, {
        name: "blog",
        description: "",
        controller: "hello",
        service: true,
        command: false,
        frontend: "none",
      });
      assert.throws(
        () =>
          resolveAnswers(spec, { name: "Blog Post" }, { hasCheckout: false }),
        /kebab-case/u,
      );
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

  describe("moteur — create entity (in-project)", () => {
    /** Scaffold entité depuis `from` (détection racine = comme le CLI). */
    const entity = (from: string, answers: Record<string, string | boolean>) =>
      runScaffold(
        { type: "entity", answers, dir: from, force: false },
        version,
      );

    /** App de fixture — preset `complete` : c'est lui qui embarque @nodefony/drizzle. */
    const app = (name: string, preset = "complete"): string => {
      const dest = path.join(tmp, name);
      scaffold(dest, { name, preset, frontend: "none" });
      return dest;
    };

    it("pose la chaîne complète : entité, schémas, service, controller, tests", () => {
      const dest = app("eapp");
      const r = entity(dest, {
        name: "Post",
        fields: "title:string content:text",
      });

      for (const f of [
        "nodefony/entity/Post.ts",
        "nodefony/entity/Post.schema.ts",
        "nodefony/service/PostService.ts",
        "nodefony/controllers/PostController.ts",
        "tests/post.test.ts",
      ]) {
        assert.isTrue(existsSync(path.join(dest, f)), `${f} manquant`);
      }
      assert.include((r.notes ?? []).join("\n"), "table posts (sqlite)");
      assertNoEtaResidue(dest);
    });

    it("l'entité est du Drizzle natif, avec la clé uuid7 générée côté JS", () => {
      const dest = app("eapp2");
      entity(dest, { name: "Post", fields: "title:string! views:int" });
      const src = readFileSync(
        path.join(dest, "nodefony", "entity", "Post.ts"),
        "utf8",
      );
      assert.include(src, 'from "drizzle-orm/sqlite-core"');
      assert.include(src, 'export const postTable = sqliteTable("posts"');
      assert.include(src, "Nodefony.generateSortableId()");
      assert.match(src, /title: text\("title"\)\.notNull\(\)\.unique\(\)/u);
      // Le descripteur ne fige PAS le connecteur (donnée de config, résolue au boot).
      assert.include(src, "export const PostEntity = defineEntity({");
      assert.notMatch(src, /connector:\s*["']/u);
    });

    it("le contrat d'entrée dérive la mise à jour, et exclut id/horodatages", () => {
      const dest = app("eapp3");
      entity(dest, { name: "Post", fields: "title:string" });
      const src = readFileSync(
        path.join(dest, "nodefony", "entity", "Post.schema.ts"),
        "utf8",
      );
      assert.include(src, "export const createPostSchema = z.object({");
      assert.include(src, "createPostSchema.partial()");
      assert.notInclude(src, "id:");
      assert.notInclude(src, "createdAt");
    });

    it("le controller sert REST ET la socket, avec les bons statuts", () => {
      const dest = app("eapp4");
      entity(dest, { name: "Post", fields: "title:string" });
      const src = readFileSync(
        path.join(dest, "nodefony", "controllers", "PostController.ts"),
        "utf8",
      );
      assert.include(src, '@controller("/api/posts")');
      assert.include(src, 'methods: ["GET", "WEBSOCKET"]'); // le différenciateur
      assert.include(src, "@HttpCode(201)");
      assert.include(src, "@Idempotent()");
      assert.include(src, '"Location"');
      assert.include(src, "@HttpCode(204)");
      assert.include(src, "404");
    });

    it("le service porte la validation — donc tous les transports en profitent", () => {
      const dest = app("eapp5");
      entity(dest, { name: "Post", fields: "title:string" });
      const src = readFileSync(
        path.join(dest, "nodefony", "service", "PostService.ts"),
        "utf8",
      );
      assert.include(src, "extends AbstractCrudService<PostRow>");
      assert.include(src, "beforeCreate");
      assert.include(src, "createPostSchema.parse(data)");
      // Repository résolu au PREMIER USAGE : l'ORM ne se connecte qu'à onBoot.
      assert.include(src, "export function getPostService()");
    });

    it("câble l'index : @entities créé de toutes pièces + @controllers complété", () => {
      const dest = app("eapp6");
      entity(dest, { name: "Post", fields: "title:string" });
      const index = readFileSync(path.join(dest, "index.ts"), "utf8");

      // Import NOMMÉ : un descripteur d'entité est une const exportée, pas un default
      // (contrairement à un controller). Un `import X from …` ne compilerait pas.
      assert.include(
        index,
        'import { PostEntity } from "./nodefony/entity/Post";',
      );
      assert.include(index, 'import { entities } from "@nodefony/orm-core";');
      assert.match(index, /@entities\(\[PostEntity\]\)/u);
      assert.match(index, /@controllers\(\[[^\]]*PostController\]\)/u);
    });

    it("deuxième entité : le décorateur EXISTANT est complété, pas dupliqué", () => {
      const dest = app("eapp7");
      entity(dest, { name: "Post", fields: "title:string" });
      entity(dest, { name: "Comment", fields: "body:text" });
      const index = readFileSync(path.join(dest, "index.ts"), "utf8");

      assert.match(index, /@entities\(\[PostEntity, CommentEntity\]\)/u);
      assert.strictEqual(index.match(/@entities\(/gu)?.length, 1);
      // L'import du décorateur ne doit pas être ajouté deux fois.
      assert.strictEqual(
        index.match(/import \{ entities \} from "@nodefony\/orm-core";/gu)
          ?.length,
        1,
      );
      // ⚠️ RÉGRESSION : la 2ᵉ entité passait par le wiring des CONTROLLERS, qui écrit
      // un import PAR DÉFAUT → `MISSING_EXPORT "default"` au build (vécu). Un
      // descripteur d'entité est une const NOMMÉE — les DEUX imports doivent l'être.
      assert.include(
        index,
        'import { CommentEntity } from "./nodefony/entity/Comment";',
      );
      assert.notMatch(index, /import \w+Entity from /u);
    });

    it("trois entités : chaque import reste nommé, la liste s'allonge", () => {
      const dest = app("eapp7b");
      entity(dest, { name: "Post", fields: "title:string" });
      entity(dest, { name: "Comment", fields: "body:text" });
      entity(dest, { name: "Tag", fields: "label:string" });
      const index = readFileSync(path.join(dest, "index.ts"), "utf8");

      assert.match(
        index,
        /@entities\(\[PostEntity, CommentEntity, TagEntity\]\)/u,
      );
      assert.notMatch(index, /import \w+Entity from /u);
    });

    it("--dialect postgres : pgTable et jsonb", () => {
      const dest = app("eapp8");
      entity(dest, {
        name: "Post",
        fields: "meta:json",
        dialect: "postgres",
      });
      const src = readFileSync(
        path.join(dest, "nodefony", "entity", "Post.ts"),
        "utf8",
      );
      assert.include(src, 'from "drizzle-orm/pg-core"');
      assert.include(src, "pgTable");
      assert.include(src, 'jsonb("meta")');
    });

    it("--no-controller : ni controller ni wiring de controller", () => {
      const dest = app("eapp9");
      entity(dest, { name: "Post", fields: "title:string", controller: false });
      assert.isFalse(
        existsSync(
          path.join(dest, "nodefony", "controllers", "PostController.ts"),
        ),
      );
      const index = readFileSync(path.join(dest, "index.ts"), "utf8");
      assert.match(index, /@entities\(\[PostEntity\]\)/u);
      assert.notInclude(index, "PostController");
    });

    it("nom normalisé : PostEntity → Post (le suffixe n'est jamais redoublé)", () => {
      const dest = app("eapp10");
      entity(dest, { name: "PostEntity", fields: "title:string" });
      assert.isTrue(
        existsSync(path.join(dest, "nodefony", "entity", "Post.ts")),
      );
    });

    it("--connector : l'ENTITÉ porte le connecteur, pas seulement le service", () => {
      // ⚠️ RÉGRESSION (vécue en important un schéma tiers sur une base dédiée) : seul
      // le service lisait `--connector`. Le descripteur, lui, restait sur `default` →
      // les tables étaient créées dans la base de l'APP pendant que le service les
      // cherchait dans l'autre. Les deux moitiés de la chaîne parlaient de deux bases.
      const dest = app("eapp13");
      entity(dest, {
        name: "Post",
        fields: "title:string",
        connector: "wordpress",
      });
      const src = readFileSync(
        path.join(dest, "nodefony", "entity", "Post.ts"),
        "utf8",
      );
      assert.match(src, /connector: "wordpress"/u);
      const service = readFileSync(
        path.join(dest, "nodefony", "service", "PostService.ts"),
        "utf8",
      );
      assert.include(service, 'ormRegistry.get("wordpress")');
    });

    it("connecteur par défaut : l'entité ne fige RIEN (donnée de config)", () => {
      const dest = app("eapp14");
      entity(dest, { name: "Post", fields: "title:string" });
      const src = readFileSync(
        path.join(dest, "nodefony", "entity", "Post.ts"),
        "utf8",
      );
      assert.notMatch(src, /connector:\s*["']/u);
    });

    it("une RELATION en DERNIER champ : la table se ferme proprement", () => {
      // ⚠️ RÉGRESSION (vécue en appliquant un vrai schéma) : eta supprime le saut de
      // ligne qui suit une interpolation, donc `});` remontait sur la dernière ligne
      // rendue. Tant qu'elle finissait par une virgule, `…,});` restait VALIDE —
      // invisible. Mais le commentaire de fin de ligne d'un champ `ref` avalait la
      // fermeture : `…, // → User.id …});` ne compile pas.
      const dest = app("eapp12");
      // `timestamps: false` : SANS ça, createdAt/updatedAt suivent la relation et le
      // commentaire n'est plus en dernière position — le bug ne se reproduit pas.
      entity(dest, {
        name: "Comment",
        fields: "body:text author:ref:User",
        timestamps: false,
      });
      const src = readFileSync(
        path.join(dest, "nodefony", "entity", "Comment.ts"),
        "utf8",
      );
      // Le commentaire de la relation est bien SUIVI d'un saut de ligne avant `});`.
      assert.match(src, /\/\/ → User\.id[^\n]*\n\}\);/u);
      assert.notMatch(src, /\}\);.*\/\//u);
      // Idem pour l'interface de ligne et le schéma Zod (mêmes interpolations).
      assert.match(src, /author: string;\n\}/u);
    });

    it("table au pluriel, y compris irrégulier (Story → stories)", () => {
      const dest = app("eapp11");
      entity(dest, { name: "Story", fields: "title:string" });
      const src = readFileSync(
        path.join(dest, "nodefony", "entity", "Story.ts"),
        "utf8",
      );
      assert.include(src, 'sqliteTable("stories"');
    });

    describe("gardes — aucun fichier écrit si elles tombent", () => {
      it("app SANS ORM : refus actionnable plutôt que du code mort", () => {
        const dest = app("bare", "minimal"); // minimal = pas de drizzle
        assert.throws(
          () => entity(dest, { name: "Post", fields: "title:string" }),
          /@nodefony\/drizzle absent/u,
        );
        assert.isFalse(existsSync(path.join(dest, "nodefony", "entity")));
      });

      it("hors projet : refus", () => {
        assert.throws(
          () => entity(tmp, { name: "Post", fields: "title:string" }),
          /aucun projet Nodefony/u,
        );
      });

      it("entité déjà déclarée : refus SANS toucher au projet", () => {
        const dest = app("dup");
        entity(dest, { name: "Post", fields: "title:string" });
        // L'empreinte est prise APRÈS le premier scaffold : c'est le travail de
        // l'utilisateur que le second appel ne doit pas effleurer.
        const before = snapshotTree(dest);
        assert.throws(
          () => entity(dest, { name: "Post", fields: "other:string" }),
          /déjà référencé/u,
        );
        assertTreeUnchanged(before, dest);
      });

      it("champ mal formé : refus avec le mot « invalide » (→ EX_USAGE)", () => {
        const dest = app("badfield");
        assert.throws(
          () => entity(dest, { name: "Post", fields: "title:wat" }),
          /invalide/u,
        );
      });

      it("module cible inconnu : refus, cibles listées", () => {
        const dest = app("nomod");
        assert.throws(
          () =>
            entity(dest, {
              name: "Post",
              fields: "title:string",
              module: "@x/absent",
            }),
          /introuvable/u,
        );
      });
    });
  });

  describe("mode machine (--describe-json / --answers-json)", () => {
    /** Capture stdout d'un appel de commande (le mode machine ÉCRIT du JSON). */
    const capture = async (...words: string[]): Promise<[number, string]> => {
      const chunks: string[] = [];
      const stdout = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string) => {
        chunks.push(String(chunk));
        return true;
      }) as typeof process.stdout.write;
      try {
        const code = await runCreateCommand(argv("create", ...words));
        return [code, chunks.join("")];
      } finally {
        process.stdout.write = stdout;
      }
    };

    it("--describe-json sans type : catalogue complet, JSON valide", async () => {
      const [code, out] = await capture("--describe-json");
      assert.equal(code, SysExit.OK);
      const doc = JSON.parse(out) as {
        types: { type: string; questions: { key: string }[] }[];
        caps: { hasCheckout: boolean };
        usage: Record<string, string>;
      };
      assert.sameMembers(
        doc.types.map((t) => t.type),
        ["app", "module", "controller", "front", "entity"],
      );
      // Ce que l'agent doit pouvoir apprendre sans lire une ligne de source.
      const entity = doc.types.find((t) => t.type === "entity");
      assert.includeMembers(
        (entity?.questions ?? []).map((q) => q.key),
        ["name", "fields", "id"],
      );
      assert.isBoolean(doc.caps.hasCheckout);
      assert.property(doc.usage, "answers");
    });

    it("--describe-json <type> : ce type seul", async () => {
      const [, out] = await capture("controller", "--describe-json");
      const doc = JSON.parse(out) as { types: { type: string }[] };
      assert.deepEqual(
        doc.types.map((t) => t.type),
        ["controller"],
      );
    });

    it("--answers-json : réponses lues, les flags l'emportent", async () => {
      const dest = path.join(tmp, "mj");
      const file = path.join(tmp, "answers.json");
      writeFileSync(
        file,
        JSON.stringify({ name: "mj", preset: "complete", frontend: "none" }),
      );
      const code = await runCreateCommand(
        argv(
          "create",
          "app",
          "--dir",
          dest,
          "--answers-json",
          file,
          // Le flag contredit le fichier : c'est le geste le plus explicite de
          // l'appel, il doit gagner.
          "--preset",
          "minimal",
          "--no-install",
          "--no-git",
        ),
      );
      assert.equal(code, SysExit.OK);
      assert.isTrue(existsSync(path.join(dest, "package.json")));
      assert.isFalse(
        existsSync(path.join(dest, "compose.yaml")),
        "preset complete appliqué malgré --preset minimal",
      );
    });

    it("une clé hors spec est REFUSÉE, pas avalée", async () => {
      const file = path.join(tmp, "typo.json");
      // `prest` au lieu de `preset` : `resolveAnswers` l'ignorerait et
      // générerait la vitrine complète sans un mot — indétectable pour un
      // appelant automatique.
      writeFileSync(file, JSON.stringify({ name: "typo", prest: "minimal" }));
      const code = await runCreateCommand(
        argv(
          "create",
          "app",
          "--dir",
          path.join(tmp, "typo"),
          "--answers-json",
          file,
        ),
      );
      assert.equal(code, SysExit.USAGE);
      assert.isFalse(existsSync(path.join(tmp, "typo")));
    });

    it("JSON invalide ou valeur non scalaire : refus en EX_USAGE", async () => {
      const bad = path.join(tmp, "bad.json");
      writeFileSync(bad, "{ pas du json");
      assert.equal(
        await runCreateCommand(
          argv(
            "create",
            "app",
            "--dir",
            path.join(tmp, "b1"),
            "--answers-json",
            bad,
          ),
        ),
        SysExit.USAGE,
      );
      const nested = path.join(tmp, "nested.json");
      writeFileSync(nested, JSON.stringify({ name: { deep: true } }));
      assert.equal(
        await runCreateCommand(
          argv(
            "create",
            "app",
            "--dir",
            path.join(tmp, "b2"),
            "--answers-json",
            nested,
          ),
        ),
        SysExit.USAGE,
      );
    });

    it("--answers-json sans valeur : usage, pas un crash", () => {
      const p = parseCreateArgv(argv("create", "app", "x", "--answers-json"));
      assert.property(p, "error");
    });
  });

  describe("dry-run (simulation — même exécution, sans le disque)", () => {
    it("une app simulée n'existe pas, mais son plan est complet", () => {
      const dest = path.join(tmp, "sim");
      const r = runScaffold(
        {
          type: "app",
          answers: { name: "sim", preset: "minimal", frontend: "none" },
          dir: dest,
          force: false,
        },
        version,
        { dryRun: true },
      );
      assert.isFalse(existsSync(dest), "le dry-run a écrit sur le disque");
      const changes = r.changes ?? [];
      assert.isNotEmpty(changes);
      // Le plan porte le MÊME inventaire que le résultat annoncé.
      assert.sameMembers(
        changes.map((c) => path.relative(dest, c.path)),
        r.files,
      );
      assert.isTrue(changes.every((c) => c.kind === "create"));
      // Le contenu est celui qui SERAIT écrit : il est rendu, pas promis.
      const index = changes.find((c) => c.path.endsWith("index.ts"));
      assert.include(index?.content ?? "", "@controllers([");
    });

    it("sur un projet existant, distingue création et réécriture + diff", () => {
      const dest = path.join(tmp, "simc");
      scaffold(dest, { name: "simc", preset: "minimal" });
      const before = snapshotTree(dest);
      const r = runScaffold(
        {
          type: "controller",
          answers: { name: "blog" },
          dir: dest,
          force: false,
        },
        version,
        { dryRun: true },
      );
      assertTreeUnchanged(before, dest);
      const changes = r.changes ?? [];
      const rewritten = changes.filter((c) => c.kind === "overwrite");
      // `index.ts` existe : le câblage le RÉÉCRIT — c'est le seul cas où la
      // simulation a une valeur, et le plan doit le dire.
      assert.deepEqual(
        rewritten.map((c) => path.relative(dest, c.path)),
        ["index.ts"],
      );
      const [wire] = rewritten;
      assert.include(wire.previous ?? "", "@controllers([");
      const added = diffLines(wire.previous ?? "", wire.content)
        .filter((l) => l.kind === "add")
        .map((l) => l.text);
      assert.isTrue(
        added.some((l) => l.includes("BlogController")),
        "le diff ne montre pas l'insertion du controller",
      );
    });

    it("un refus reste un refus en simulation", () => {
      const dest = path.join(tmp, "simref");
      scaffold(dest, { name: "simref", preset: "minimal" });
      runScaffold(
        {
          type: "controller",
          answers: { name: "dup" },
          dir: dest,
          force: false,
        },
        version,
      );
      assert.throws(
        () =>
          runScaffold(
            {
              type: "controller",
              answers: { name: "dup" },
              dir: dest,
              force: false,
            },
            version,
            { dryRun: true },
          ),
        /déjà référencé/u,
      );
    });

    it("diffLines : conserve l'ordre et n'invente aucune ligne", () => {
      const diff = diffLines("a\nb\nc", "a\nx\nb\nc");
      assert.deepEqual(
        diff.map((l) => `${l.kind[0]}${l.text}`),
        ["ka", "ax", "kb", "kc"],
      );
      assert.deepEqual(diffLines("a", "a"), [{ kind: "keep", text: "a" }]);
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
      const writer = new ScaffoldWriter();
      const linked = linkLocalDeps(
        dest,
        {
          nodefony: "/repo/src/nodefony",
          "@nodefony/http": "/repo/src/packages/@nodefony/http",
        },
        writer,
      );
      writer.commit();
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

    it("--dry-run : plan affiché, disque intact, ni install ni git", async () => {
      // Contrôle du CHEMIN COMPLET (argv → moteur → rendu) : le moteur sait
      // déjà simuler, ce qui reste à prouver c'est que la commande NE PASSE PAS
      // aux étapes post-génération — installer et commiter des fichiers qui
      // n'existent pas est le seul vrai danger de ce mode.
      const dest = path.join(tmp, "sim-app");
      const written: string[] = [];
      const stdout = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string) => {
        written.push(String(chunk));
        return true;
      }) as typeof process.stdout.write;
      let code: number;
      try {
        code = await runCreateCommand(
          argv("create", "app", "sim-app", "--dir", dest, "--dry-run"),
        );
      } finally {
        process.stdout.write = stdout;
      }
      const out = written.join("");
      assert.equal(code, SysExit.OK);
      assert.isFalse(existsSync(dest), "--dry-run a écrit sur le disque");
      assert.include(out, "RIEN n'a été écrit");
      assert.include(out, "package.json");
      // `--dry-run` sans `--no-install`/`--no-git` : ces étapes doivent être
      // sautées d'elles-mêmes, pas par un flag que l'utilisateur penserait à poser.
      assert.notInclude(out, "npm install");
      assert.notInclude(out, "🌱 git");
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
