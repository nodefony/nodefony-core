/**
 * Le mot de passe admin de DÉVELOPPEMENT n'a qu'une source : la valeur que
 * `drawDevAdminPassword` tire pour CHAQUE application, à `create app`.
 *
 * Il était recopié en dur dans quinze gabarits, et seul `create.ts` était gardé.
 * La valeur a déjà changé une fois (`admin` → `nodefony-dev-42`, la politique de
 * mots de passe refusant un mot de passe qui contient l'identifiant) : le semis
 * suivait, l'annonce de `create app` non, et le premier geste de l'utilisateur,
 * se connecter à la console d'administration, échouait sur un 401 sans
 * explication. Ce test lit les gabarits ET leur RENDU : un gabarit qui
 * écrirait une valeur à la main, ou un générateur qui ne passerait pas la
 * valeur tirée, rougit ici.
 *
 * La valeur était FIXE (`nodefony-dev-42`), donc publiée : un serveur démarré
 * sans `NODE_ENV` tourne en développement et créait un compte administrateur
 * connu de tous. Elle est désormais tirée par application (#797).
 */
import assert from "node:assert";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, it } from "vitest";
import { version } from "../../package.json";
import { packageManagerCommandLines } from "../cli/packageManager";
import { drawDevAdminPassword, runScaffold } from "../cli/scaffold/engine";
import { renderStartPanel } from "../cli/startPanel";

/** L'ancienne valeur publiée : elle ne doit plus apparaître nulle part. */
const PUBLISHED_PASSWORD = "nodefony-dev-42";

const here = path.dirname(fileURLToPath(import.meta.url));
const core = path.resolve(here, "..", "..");
const templates = path.join(core, "templates");

/** Tous les gabarits livrés, chemin relatif en `/`. */
const templateFiles = readdirSync(templates, {
  withFileTypes: true,
  recursive: true,
})
  .filter((e) => e.isFile() && e.name.endsWith(".tpl"))
  .map((e) => path.join(e.parentPath, e.name));

describe("mot de passe admin de développement — une seule source", () => {
  it("le tirage : lisible, assez long pour la politique, jamais « admin », jamais deux fois le même", () => {
    const draws = Array.from({ length: 200 }, drawDevAdminPassword);
    for (const pw of draws) {
      assert.match(
        pw,
        /^[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}$/u,
      );
      // Chaque groupe mêle lettres et UN chiffre : aucune suite de touches
      // refusée par la politique n'est mixte (preuve par la vraie politique :
      // `seedFailure.test.ts` de @nodefony/user).
      for (const group of pw.split("-")) {
        assert.strictEqual(group.replace(/[^2-9]/gu, "").length, 1, group);
      }
      assert.ok(pw.length >= 10, "minLength de la politique");
      assert.ok(!pw.includes("admin"));
    }
    assert.strictEqual(new Set(draws).size, draws.length);
  });

  it("aucun gabarit n'écrit l'ancienne valeur publiée : il rend `it.devAdminPassword`", () => {
    const copies = templateFiles
      .filter((f) => readFileSync(f, "utf8").includes(PUBLISHED_PASSWORD))
      .map((f) => path.relative(templates, f));
    assert.deepStrictEqual(copies, []);
  });

  it("create app annonce la valeur tirée pour l'application, jamais une copie", () => {
    const createSource = readFileSync(
      path.join(core, "src", "cli", "create.ts"),
      "utf8",
    );
    assert.ok(!createSource.includes("admin/admin"));
    assert.ok(!createSource.includes(PUBLISHED_PASSWORD));
    // La valeur tirée part au bloc « Pour commencer », qui l'affiche telle quelle.
    assert.ok(createSource.includes("password: result.devAdminPassword"));
    const drawn = drawDevAdminPassword();
    const panel = renderStartPanel({
      relDest: "app",
      commands: packageManagerCommandLines("npm"),
      installed: true,
      built: true,
      infra: null,
      migrationPending: false,
      admin: { user: "admin", password: drawn },
      addFrontend: null,
      agent: { kind: "to-wire" },
      demo: { installed: true },
    });
    assert.ok(panel.includes(`admin / ${drawn}`));
  });

  describe("le RENDU porte la valeur, partout où un gabarit la cite", () => {
    let tmp = "";
    beforeAll(() => {
      tmp = mkdtempSync(path.join(os.tmpdir(), "nf-dev-admin-"));
    });
    afterAll(() => {
      rmSync(tmp, { recursive: true, force: true });
    });

    const read = (dest: string, ...rel: string[]): string =>
      readFileSync(path.join(dest, ...rel), "utf8");

    it("app complete : semis, .env, README — et jamais le catalogue env.ts ni .env.example", () => {
      const dest = path.join(tmp, "app");
      const { devAdminPassword: pw } = runScaffold(
        {
          type: "app",
          answers: { name: "app", preset: "complete", frontend: "none" },
          dir: dest,
          force: false,
        },
        version,
      );
      assert.ok(pw, "valeur tirée absente du résultat");
      assert.ok(
        read(dest, "nodefony", "security", "provisionUsers.ts").includes(
          `export const DEV_ADMIN_PASSWORD = "${pw}";`,
        ),
      );
      for (const rel of ["README.md", ".env"]) {
        const src = read(dest, rel);
        assert.ok(src.includes(pw), `${rel} : valeur absente`);
        assert.ok(!src.includes("undefined"), `${rel} : constante non passée`);
      }
      // Le catalogue nourrit une notice COMMUNE (`.env.example`, guide des
      // variables) : une valeur propre à l'application y changerait à chaque
      // rendu.
      for (const rel of ["env.ts", ".env.example"]) {
        assert.ok(!read(dest, rel).includes(pw), `${rel} : valeur recopiée`);
      }
    });

    for (const [frontend, rel] of [
      ["react", ["frontend", "src", "App.tsx"]],
      ["vue", ["frontend", "src", "App.vue"]],
      ["svelte", ["frontend", "src", "App.svelte"]],
      ["angular", ["frontend", "src", "app", "app.component.ts"]],
    ] as const) {
      // INVERSÉ (#746) : la page d'accueil part dans le bundle de PRODUCTION,
      // servi à n'importe qui. Elle ne doit JAMAIS porter le mot de passe de
      // développement — ni lien vers la console d'administration.
      it(`page d'accueil ${frontend} : jamais le mot de passe ni /nodefony`, () => {
        const dest = path.join(tmp, `front-${frontend}`);
        const { devAdminPassword: pw } = runScaffold(
          {
            type: "app",
            answers: { name: "front", preset: "complete", frontend },
            dir: dest,
            force: false,
          },
          version,
        );
        const page = read(dest, ...rel);
        assert.ok(pw && !page.includes(pw), "mot de passe dans la page");
        assert.ok(!page.includes('"/nodefony'), "lien vers la console");
      });
    }

    it("deux applications ne partagent jamais le même mot de passe", () => {
      const draw = (name: string): string | undefined =>
        runScaffold(
          {
            type: "app",
            answers: { name, preset: "complete", frontend: "none" },
            dir: path.join(tmp, name),
            force: false,
          },
          version,
        ).devAdminPassword;
      const a = draw("twin-a");
      const b = draw("twin-b");
      assert.ok(a && b);
      assert.notStrictEqual(a, b);
    });

    // Générés APRÈS la création, ils ne connaissent pas la valeur tirée : ils
    // renvoient au fichier qui la porte, sans jamais rendre `undefined`.
    it("controllers rest/realtime/duplex et controller d'entité", () => {
      const dest = path.join(tmp, "gen");
      const { devAdminPassword: pw } = runScaffold(
        {
          type: "app",
          answers: { name: "gen", preset: "complete", frontend: "none" },
          dir: dest,
          force: false,
        },
        version,
      );
      for (const kind of ["rest", "realtime", "duplex"]) {
        const name = `${kind}demo`;
        runScaffold(
          {
            type: "controller",
            answers: { name, kind },
            dir: dest,
            force: false,
          },
          version,
        );
        const files = readdirSync(path.join(dest, "nodefony", "controllers"));
        const file = files.find((f) => f.toLowerCase().startsWith(name));
        assert.ok(file, `controller ${kind} non rendu`);
        const src = read(dest, "nodefony", "controllers", file);
        assert.ok(
          src.includes("provisionUsers.ts"),
          `controller ${kind} : renvoi absent`,
        );
        assert.ok(
          !src.includes("admin/undefined"),
          `controller ${kind} : valeur non passée`,
        );
        assert.ok(
          pw && !src.includes(pw),
          `controller ${kind} : valeur recopiée`,
        );
      }
      runScaffold(
        {
          type: "entity",
          answers: { name: "Article", fields: "title:string" },
          dir: dest,
          force: false,
        },
        version,
      );
      const entity = read(
        dest,
        "nodefony",
        "controllers",
        "ArticleController.ts",
      );
      assert.ok(entity.includes("provisionUsers.ts"));
      assert.ok(!entity.includes("admin/undefined"));
    });
  });
});
