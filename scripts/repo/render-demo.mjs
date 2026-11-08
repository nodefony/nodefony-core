#!/usr/bin/env node
/**
 * Rend le module de la DÉMO de l'application de développement (#747), puis le
 * bâtit et le vérifie au typecheck.
 *
 * @usage node scripts/repo/render-demo.mjs
 *
 * POURQUOI : la démo n'a qu'une source, `src/nodefony/templates/demo/` — celle
 * que reçoit `create app --demo`, publiée avec le paquet `nodefony`. L'application
 * de ce dépôt la rend par la MÊME fonction (`renderDemoModule`) dans `src/demo/`,
 * gitignoré, et la charge par son chemin (`{ name: "./src/demo" }` dans
 * `nodefony.config.ts`). Aucune copie à garder synchrone : corriger la démo, c'est
 * corriger le gabarit, puis relancer ce script (il tourne dans `npm run build`).
 *
 * Le typecheck n'est pas décoratif : un gabarit `.tpl` n'est vu par aucun
 * compilateur du dépôt. C'est ici, sur le code RENDU, qu'une faute de type de la
 * démo se voit — avant le banc, avant l'utilisateur.
 *
 * Exige le `dist` du cœur (`renderDemoModule` vient du paquet `nodefony`) : il se
 * place APRÈS le build turbo.
 *
 * Le lint aussi : la configuration de la racine, règles typées comprises.
 *
 * Sorties : 0 rendu, bâti et vérifié · 1 une étape a échoué (elle est nommée).
 */
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderDemoModule } from "nodefony";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const dest = path.join(root, "src", "demo");
const require = createRequire(path.join(root, "package.json"));

/**
 * Commande d'un binaire npm lancée par Node lui-même : un `.bin/x` est un
 * script `.cmd` sous Windows, que `spawn` sans shell ne sait pas exécuter.
 */
const nodeBin = (pkg, rel) => [
  process.execPath,
  path.join(path.dirname(require.resolve(`${pkg}/package.json`)), rel),
];

const step = (label, [file, ...args], cwd = dest) => {
  const run = spawnSync(file, args, { cwd, stdio: "inherit" });
  if (run.status !== 0) {
    console.error(
      `✗ démo : ${label} a échoué (code ${run.status ?? run.signal})`,
    );
    process.exit(1);
  }
};

const { version } = JSON.parse(
  readFileSync(path.join(root, "src", "nodefony", "package.json"), "utf8"),
);

// Rendu sur un dossier VIDE : un fichier retiré des gabarits ne doit pas
// survivre dans le module rendu (et y être chargé).
rmSync(dest, { recursive: true, force: true });
const result = renderDemoModule(
  {
    appRoot: root,
    dest,
    // Le nom que porte le realm Keycloak du dépôt (`docker/keycloak/import/`) :
    // la démo en dérive son client machine, `<app>-machine` = `nodefony-machine`.
    appName: "nodefony",
    pkgName: "@nodefony-core/demo",
  },
  version,
);
console.log(
  `✓ démo rendue : ${path.relative(root, dest)} (${result.files.length} fichiers)`,
);

step("le build (rolldown)", [
  ...nodeBin("rolldown", "bin/cli.mjs"),
  "-c",
  "rolldown.config.ts",
]);
// Les options STRICTES que le banc de vérité impose à une application générée
// (`verify-generated.mjs`) : sans elles, ce rendu reste vert sur un accès
// indexé que l'app de l'utilisateur refuse. Vécu : `ROLES[next].id`.
step("le typecheck (tsgo)", [
  ...nodeBin("@typescript/native-preview", "bin/tsgo"),
  "--noEmit",
  "--noUncheckedIndexedAccess",
  "--exactOptionalPropertyTypes",
  "-p",
  "tsconfig.json",
]);
// Le lint, depuis la racine (sa configuration, règles typées comprises) : le
// banc de vérité le joue dans une application générée, et un `.tpl` n'est vu
// par aucun linter du dépôt. Vécu : un `?.` exigé sous `noUncheckedIndexedAccess`
// et refusé sans — rouge sur huit jobs de la forge, vert ici.
step(
  "le lint (oxlint)",
  [
    ...nodeBin("oxlint", "bin/oxlint"),
    "--deny-warnings",
    // Les FICHIERS, nommés : `src/demo/` est ignoré par git, et oxlint saute un
    // dossier ignoré qu'on lui passe en entier (« No files found to lint »).
    ...readdirSync(dest, { recursive: true, encoding: "utf8" })
      .filter(
        (rel) =>
          // `.tsx` compris : le front React de la démo est du code de la démo.
          /\.tsx?$/u.test(rel) &&
          !rel
            .split(path.sep)
            .some((seg) => seg === "dist" || seg === "node_modules"),
      )
      .map((rel) => path.join(dest, rel)),
  ],
  root,
);
console.log("✓ démo bâtie et vérifiée");
