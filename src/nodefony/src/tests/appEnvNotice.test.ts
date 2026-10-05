/**
 * **La notice `.env.example` d'une application générée EST celle que produit
 * le moteur depuis son `env.ts` — jamais un second texte écrit à la main.**
 *
 * Le générateur est synchrone (`runScaffold`, appelé par des centaines de cas)
 * et lire un catalogue demande un `import()` : la notice vit donc dans un
 * gabarit (`templates/app/complete/env.example.tpl`). Cette copie est gardée
 * ICI : le cas rend une application, charge SON `env.ts`, génère la notice par
 * `renderEnvExample` — le moteur de `nodefony env --example` — et exige
 * l'égalité au caractère près.
 *
 * Régénérer le gabarit après avoir touché `env.ts.tpl` :
 *
 *   NF_WRITE_NOTICE=1 npx vitest run src/tests/appEnvNotice.test.ts
 */
import { assert } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { version } from "../../package.json";
import { runScaffold } from "../cli/scaffold/engine";
import { composeEnvExample, readManifestModules } from "../cli/env";
import { getEnvCatalog } from "../config/defineEnv";

const here = path.dirname(fileURLToPath(import.meta.url));
/**
 * Un gabarit de notice PAR PRESET : `base` sert le preset minimal, `complete`
 * le remplace (même chemin rendu, `.env.example`) par le sien — chaque
 * application reçoit la notice de SON catalogue, jamais celle d'un autre.
 */
const TEMPLATES = {
  minimal: path.join(
    here,
    "..",
    "..",
    "templates",
    "app",
    "base",
    "env.example.tpl",
  ),
  complete: path.join(
    here,
    "..",
    "..",
    "templates",
    "app",
    "complete",
    "env.example.tpl",
  ),
} as const;
/** Nom d'application improbable : remplacé par la balise eta à l'écriture. */
const APP_NAME = "zqnoticeapp";

/** La notice que le MOTEUR rend pour l'`env.ts` de cette application. */
async function noticeFromCatalog(app: string): Promise<string> {
  const source = readFileSync(path.join(app, "env.ts"), "utf8").replace(
    /from "nodefony";/u,
    `from ${JSON.stringify(pathToFileURL(path.join(here, "..", "index.ts")).href)};`,
  );
  const probe = path.join(app, "env.notice-probe.ts");
  writeFileSync(probe, source);
  const mod = (await import(pathToFileURL(probe).href)) as { env: unknown };
  return composeEnvExample(
    getEnvCatalog(mod.env),
    null,
    readManifestModules(app),
  );
}

describe("notice .env.example de l'application générée", () => {
  let dir = "";

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "nf-env-notice-"));
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  for (const preset of ["complete", "minimal"] as const) {
    it(`🔴 ${preset} : EXACTEMENT celle que le moteur produit depuis son env.ts`, async () => {
      const app = path.join(dir, `${APP_NAME}-${preset}`);
      runScaffold(
        {
          type: "app" as const,
          answers: { name: APP_NAME, preset },
          dir: app,
          force: false,
        },
        version,
      );
      const expected = await noticeFromCatalog(app);

      if (process.env.NF_WRITE_NOTICE === "1") {
        writeFileSync(
          TEMPLATES[preset],
          expected.replaceAll(APP_NAME, "<%= it.appName %>"),
        );
      }

      const rendered = readFileSync(path.join(app, ".env.example"), "utf8");
      assert.strictEqual(
        rendered,
        expected,
        `la notice du preset ${preset} diverge de env.ts.tpl — régénérer : ` +
          "NF_WRITE_NOTICE=1 npx vitest run src/tests/appEnvNotice.test.ts",
      );
      // Chaque variable a son titre (sans titre, le bandeau porterait son nom).
      assert.notMatch(
        rendered,
        /^# ─── (NF_|PORT )/mu,
        "une variable sans titre",
      );
    });
  }
});
