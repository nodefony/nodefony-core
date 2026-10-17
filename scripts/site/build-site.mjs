/**
 * Rend UN site complet — accueil, documentation, mesures, qualité, plan — dans
 * un dossier, pour une version donnée.
 *
 * Le site en ligne en porte plusieurs (la version publiée à la racine, `dev`
 * sous `/next/`, chaque release archivée sous `/<version>/`) : chacun se bâtit
 * par CETTE séquence, depuis sa propre copie du dépôt. Elle vivait en étapes
 * dans `pages.yml` ; la rendre deux fois (racine et `next`), plus une fois à la
 * release, l'aurait recopiée trois fois.
 *
 * `--channel published` : ce que npm sert — la racine, et l'archive d'une
 * release. `--channel next` : la branche `dev`, avec bandeau, non indexée, sans
 * `llms.txt` ni `sitemap.xml` (le plan décrit la version installable, pas
 * l'autre).
 *
 * Le dossier est vidé s'il porte un rendu précédent, refusé s'il porte autre
 * chose (`lib/out-dir.mjs`).
 *
 * @usage node scripts/site/build-site.mjs --out dist-site [--channel published|next] [--site-url <url>]
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { REPO_ROOT as ROOT } from "../lib/repo-root.mjs";
import { prepareOutDir } from "./lib/out-dir.mjs";
import { NEXT_DIR } from "./lib/site-versions.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
if (args.includes("--help")) {
  console.log(
    "usage : node scripts/site/build-site.mjs --out <dossier> [--channel published|next] [--site-url <url>]",
  );
  process.exit(0);
}
const known = new Set(["--out", "--channel", "--site-url"]);
for (let i = 0; i < args.length; i += 2)
  if (!known.has(args[i])) {
    console.error(`✗ option inconnue : ${args[i]} (--help)`);
    process.exit(2);
  }

const OUT = path.resolve(ROOT, flag("out", "tmp/sites/site"));
const CHANNEL = flag("channel", "published");
if (CHANNEL !== "published" && CHANNEL !== "next") {
  console.error(`✗ --channel ${CHANNEL} : attendu « published » ou « next ».`);
  process.exit(2);
}
const BASE = "https://nodefony.github.io/nodefony-core";
const SITE_URL = flag(
  "site-url",
  CHANNEL === "next" ? `${BASE}/${NEXT_DIR}` : BASE,
).replace(/\/+$/, "");

try {
  prepareOutDir(OUT, path.join("docs", "search-index.json"), { protect: ROOT });
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}

/** Une étape du rendu : un script du dossier, qui hérite de la sortie. */
const run = (script, ...a) =>
  execFileSync(process.execPath, [path.join("scripts", "site", script), ...a], {
    cwd: ROOT,
    stdio: "inherit",
  });

// La RACINE est la page de présentation, tirée du README : c'est ce que voit
// quelqu'un qui découvre le projet. La documentation vit sous `/docs/`, les
// mesures sous `/performance/` — trois objets, trois publics.
run("readme-html.mjs", path.join(OUT, "index.html"), "--channel", CHANNEL);
run(
  "build-docs-site.mjs",
  "--out",
  OUT,
  "--mount",
  "/docs",
  "--channel",
  CHANNEL,
  "--site-url",
  SITE_URL,
);
// Les mesures gardent leur place, sous `/performance/`. Une URL publiée ne se
// change plus sans casser les liens de ceux qui l'ont citée.
run("build-perf-site.mjs", "--out", path.join(OUT, "performance"));
// Le verdict d'une CAMPAGNE DE TEST par version, sous `/qualite/`. Même contrat
// que la performance : le script ne teste rien, il rend des données commitées.
run("build-qualite-site.mjs", "--out", path.join(OUT, "qualite"));
// Le PLAN du site, écrit sur ce qui vient d'être rendu — jamais sur les
// sources, donc APRÈS les trois rendus. Il décrit ce qu'une application
// installe : sur `next`, il mentirait.
if (CHANNEL === "published") run("build-site-plan.mjs", "--out", OUT);

console.log(
  `\n✓ site ${CHANNEL} rendu dans ${path.relative(ROOT, OUT) || "."}`,
);
