/**
 * L'accueil généré ne livre JAMAIS son contenu de développement en production
 * (#797) : ni le mot de passe admin du poste, ni le lien vers la console, ni
 * la présentation du framework.
 *
 * La garde est portée par les DONNÉES (`devHome.ts` : `DEV_HOME =
 * import.meta.env.DEV ? {…} : null`), parce que Vue et Angular compilent les
 * textes de leurs gabarits dans le bundle, affichés ou non. Ce test rejoue ce
 * que fait le build de production de Vite — `import.meta.env.DEV` remplacé par
 * `false`, puis minification — sur le `devHome.ts` RENDU de chaque front, et
 * cherche ce qui ne doit pas sortir.
 */
import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { rolldown } from "rolldown";
import { afterAll, beforeAll, describe, it } from "vitest";
import { version } from "../../package.json";
import { runScaffold } from "../cli/scaffold/engine";

/** Bundle de production du module, comme Vite le bâtit. */
async function productionBundle(entry: string): Promise<string> {
  const bundle = await rolldown({
    input: entry,
    // Le moteur front et ses sous-chemins ne sont pas l'objet du test.
    external: (id) => !id.startsWith(".") && !path.isAbsolute(id),
    transform: { define: { "import.meta.env.DEV": "false" } },
  });
  try {
    const { output } = await bundle.generate({ minify: true, format: "es" });
    return output
      .map((chunk) => ("code" in chunk ? chunk.code : ""))
      .join("\n");
  } finally {
    await bundle.close();
  }
}

describe("accueil généré — le contenu de développement ne part pas en production", () => {
  let tmp = "";
  beforeAll(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "nf-home-guard-"));
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  for (const frontend of ["react", "vue", "angular", "svelte"] as const) {
    it(`${frontend} : ni mot de passe, ni console, ni présentation`, async () => {
      const dest = path.join(tmp, frontend);
      const { devAdminPassword } = runScaffold(
        {
          type: "app",
          answers: { name: "guard", preset: "complete", frontend },
          dir: dest,
          force: false,
        },
        version,
      );
      assert.ok(devAdminPassword, "mot de passe non tiré");
      const src = path.join(dest, "frontend", "src");
      // Les textes vivent dans `homeContent.ts`, la garde dans `devHome.ts`.
      const content = readFileSync(path.join(src, "homeContent.ts"), "utf8");
      // Témoin : le développement porte bien ce que la production doit perdre
      // — sans lui, un rendu vide passerait pour une garde qui tient.
      for (const witness of [
        devAdminPassword,
        '"/nodefony"',
        "Pour commencer",
      ]) {
        assert.ok(
          content.includes(witness),
          `témoin absent du rendu : ${witness}`,
        );
      }
      // L'entrée garde `DEV_HOME` vivant : seule la garde peut le retirer.
      const entry = path.join(src, "guardEntry.ts");
      writeFileSync(
        entry,
        'import { DEV_HOME } from "./devHome";\nexport { DEV_HOME };\n',
      );
      const code = await productionBundle(entry);
      for (const leak of [
        devAdminPassword,
        "/nodefony",
        "Pour commencer",
        "provisionUsers",
      ]) {
        assert.ok(
          !code.includes(leak),
          `${frontend} : « ${leak} » dans le bundle de production`,
        );
      }
    });
  }

  // Sans front, la page est rendue par le SERVEUR : la garde est le drapeau
  // `development` que lui passe `HomeController`. On appelle la page rendue
  // telle quelle, en production puis en développement.
  it("sans front : la page de production ne rend que le nom", async () => {
    const dest = path.join(tmp, "none");
    const { devAdminPassword } = runScaffold(
      {
        type: "app",
        answers: { name: "guard", preset: "complete", frontend: "none" },
        dir: dest,
        force: false,
      },
      version,
    );
    assert.ok(devAdminPassword, "mot de passe non tiré");
    const page = path.join(dest, "nodefony", "home", "homePage.ts");
    const mod: unknown = await import(pathToFileURL(page).href);
    assert.ok(
      typeof mod === "object" && mod !== null && "renderHomePage" in mod,
    );
    const { renderHomePage } = mod;
    assert.ok(typeof renderHomePage === "function");
    const view = (development: boolean) => ({
      appName: "guard",
      development,
      demo: null,
      user: null,
      loginHref: "/login",
    });
    const dev: unknown = renderHomePage(view(true));
    const prod: unknown = renderHomePage(view(false));
    assert.ok(typeof dev === "string" && typeof prod === "string");
    // Témoin : le développement porte bien ce que la production doit perdre.
    for (const witness of [
      devAdminPassword,
      'href="/nodefony"',
      "Pour commencer",
    ]) {
      assert.ok(
        dev.includes(witness),
        `témoin absent en développement : ${witness}`,
      );
      assert.ok(!prod.includes(witness), `« ${witness} » rendu en production`);
    }
    assert.ok(prod.includes("<h1>guard</h1>"), "le nom de l'application");
  });
});
