/**
 * Assemble le site en ligne à partir de rendus DÉJÀ faits : la version publiée
 * à la racine, `dev` sous `/next/`, chaque release archivée sous `/<version>/`.
 *
 * GitHub Pages ne connaît qu'UN artefact, et chaque déploiement remplace tout le
 * site : garder les versions passées, c'est donc les remettre à chaque fois. Ce
 * script ne REBÂTIT rien de l'ancien — une archive est recopiée telle qu'elle a
 * été rendue le jour de sa release. Rebâtir un vieux tag passerait par le
 * générateur d'aujourd'hui, qui a changé depuis : la page ne serait plus celle
 * qu'on a publiée.
 *
 * Chaque dossier de version reçoit son manifeste `versions.json`, aux liens
 * relatifs à lui, que le sélecteur de l'en-tête lit (`lib/site-versions.mjs`).
 *
 * @usage node scripts/site/assemble-site.mjs --published <dossier> --out <dossier> [--next <dossier>] [--archives <dossier>] [--version <x.y.z>]
 */
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { REPO_ROOT as ROOT } from "../lib/repo-root.mjs";
import { prepareOutDir } from "./lib/out-dir.mjs";
import {
  MANIFEST_NAME,
  NEXT_DIR,
  isVersionDir,
  manifestFor,
  planVersions,
} from "./lib/site-versions.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
if (args.includes("--help")) {
  console.log(
    "usage : node scripts/site/assemble-site.mjs --published <dossier> --out <dossier> " +
      "[--next <dossier>] [--archives <dossier>] [--version <x.y.z>]",
  );
  process.exit(0);
}
const known = new Set([
  "--published",
  "--out",
  "--next",
  "--archives",
  "--version",
]);
for (let i = 0; i < args.length; i += 2)
  if (!known.has(args[i])) {
    console.error(`✗ option inconnue : ${args[i]} (--help)`);
    process.exit(2);
  }

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const abs = (p) => (p === undefined ? undefined : path.resolve(ROOT, p));
const PUBLISHED_DIR = abs(flag("published"));
const OUT = abs(flag("out"));
const NEXT = abs(flag("next"));
const ARCHIVES = abs(flag("archives"));
if (!PUBLISHED_DIR || !OUT) fail("--published et --out sont requis (--help)");
// La version que la racine décrit : celle du paquet publié, lue dans la copie
// du dépôt qui l'a rendue — jamais la racine du dépôt, figée à 10.0.0.
const VERSION =
  flag("version") ??
  JSON.parse(
    readFileSync(path.join(ROOT, "src", "nodefony", "package.json"), "utf8"),
  ).version;
if (!isVersionDir(VERSION)) fail(`version publiée invalide : ${VERSION}`);

// Un rendu sans page d'accueil se publierait vide, en silence.
for (const [what, dir] of [
  ["publié", PUBLISHED_DIR],
  ["next", NEXT],
]) {
  if (dir !== undefined && !existsSync(path.join(dir, "index.html")))
    fail(`rendu ${what} sans index.html : ${dir}`);
}

const archives = [];
if (ARCHIVES !== undefined && existsSync(ARCHIVES))
  for (const e of readdirSync(ARCHIVES, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    // Le nom devient un dossier du site : refusé s'il n'est pas une version.
    if (!isVersionDir(e.name)) fail(`archive au nom invalide : ${e.name}`);
    if (!existsSync(path.join(ARCHIVES, e.name, "index.html")))
      fail(`archive ${e.name} sans index.html — tarball mal formé ?`);
    archives.push(e.name);
  }

const entries = planVersions({
  published: VERSION,
  archives,
  hasNext: NEXT !== undefined,
});

try {
  prepareOutDir(OUT, MANIFEST_NAME, { protect: ROOT });
} catch (e) {
  fail(e.message);
}
cpSync(PUBLISHED_DIR, OUT, { recursive: true });
if (NEXT !== undefined)
  cpSync(NEXT, path.join(OUT, NEXT_DIR), { recursive: true });
for (const a of archives)
  cpSync(path.join(ARCHIVES, a), path.join(OUT, a), { recursive: true });

// Un manifeste par dossier servi — l'archive de la version publiée comprise,
// absente du sélecteur mais servie à son adresse permanente.
const dirs = ["", ...(NEXT !== undefined ? [NEXT_DIR] : []), ...archives];
for (const dir of dirs)
  writeFileSync(
    path.join(OUT, dir, MANIFEST_NAME),
    `${JSON.stringify(manifestFor(entries, dir), null, 2)}\n`,
  );

console.log(`✓ site assemblé dans ${path.relative(ROOT, OUT) || "."}`);
console.log(`   racine   : ${VERSION} (publiée)`);
console.log(`   next/    : ${NEXT !== undefined ? "dev" : "absent"}`);
console.log(
  `   archives : ${archives.length ? archives.sort().join(", ") : "aucune"}`,
);
