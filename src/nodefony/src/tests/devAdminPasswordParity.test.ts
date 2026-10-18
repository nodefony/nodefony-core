/**
 * Le mot de passe admin de DÉVELOPPEMENT n'a qu'une source : `DEV_ADMIN_PASSWORD`
 * du moteur de scaffold.
 *
 * Il était recopié en dur dans quinze gabarits, et seul `create.ts` était gardé.
 * La valeur a déjà changé une fois (`admin` → `nodefony-dev-42`, la politique de
 * mots de passe refusant un mot de passe qui contient l'identifiant) : le semis
 * suivait, l'annonce de `create app` non, et le premier geste de l'utilisateur,
 * se connecter à la console d'administration, échouait sur un 401 sans
 * explication. Ce test lit les gabarits ET leur RENDU : un gabarit qui
 * écrirait la valeur à la main, ou un générateur qui ne passerait pas la
 * constante, rougit ici.
 */
import assert from "node:assert";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, it } from "vitest";
import { version } from "../../package.json";
import { DEV_ADMIN_PASSWORD, runScaffold } from "../cli/scaffold/engine";

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
  it("la constante n'est pas « admin » (refusé par la politique)", () => {
    assert.ok(!DEV_ADMIN_PASSWORD.includes("admin"));
  });

  it("aucun gabarit ne recopie la valeur : il rend `it.devAdminPassword`", () => {
    const copies = templateFiles
      .filter((f) => readFileSync(f, "utf8").includes(DEV_ADMIN_PASSWORD))
      .map((f) => path.relative(templates, f));
    assert.deepStrictEqual(copies, []);
  });

  it("create app annonce la constante, jamais une copie", () => {
    const createSource = readFileSync(
      path.join(core, "src", "cli", "create.ts"),
      "utf8",
    );
    assert.ok(!createSource.includes("admin/admin"));
    assert.ok(!createSource.includes(DEV_ADMIN_PASSWORD));
    assert.ok(createSource.includes("admin / ${DEV_ADMIN_PASSWORD}"));
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

    it("app complete : semis, env, README, .env.example", () => {
      const dest = path.join(tmp, "app");
      runScaffold(
        {
          type: "app",
          answers: { name: "app", preset: "complete", frontend: "none" },
          dir: dest,
          force: false,
        },
        version,
      );
      assert.ok(
        read(dest, "nodefony", "security", "provisionUsers.ts").includes(
          `export const DEV_ADMIN_PASSWORD = "${DEV_ADMIN_PASSWORD}";`,
        ),
      );
      for (const rel of ["env.ts", "README.md", ".env", ".env.example"]) {
        const src = read(dest, rel);
        assert.ok(src.includes(DEV_ADMIN_PASSWORD), `${rel} : valeur absente`);
        assert.ok(!src.includes("undefined"), `${rel} : constante non passée`);
      }
    });

    for (const [frontend, rel] of [
      ["react", ["frontend", "src", "App.tsx"]],
      ["vue", ["frontend", "src", "App.vue"]],
      ["svelte", ["frontend", "src", "App.svelte"]],
      ["angular", ["frontend", "src", "app", "app.component.ts"]],
    ] as const) {
      it(`vitrine ${frontend}`, () => {
        const dest = path.join(tmp, `front-${frontend}`);
        runScaffold(
          {
            type: "app",
            answers: { name: "front", preset: "complete", frontend },
            dir: dest,
            force: false,
          },
          version,
        );
        assert.ok(read(dest, ...rel).includes(DEV_ADMIN_PASSWORD));
      });
    }

    it("controllers rest/realtime/duplex et controller d'entité", () => {
      const dest = path.join(tmp, "gen");
      runScaffold(
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
        assert.ok(
          read(dest, "nodefony", "controllers", file).includes(
            DEV_ADMIN_PASSWORD,
          ),
          `controller ${kind} : valeur absente`,
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
      assert.ok(
        read(dest, "nodefony", "controllers", "ArticleController.ts").includes(
          DEV_ADMIN_PASSWORD,
        ),
      );
    });
  });
});
