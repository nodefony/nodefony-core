#!/usr/bin/env node
/**
 * Écrit `src/nodefony/man/nodefony.1` depuis le CLI RÉEL.
 *
 * La page n'est pas rédigée à la main : elle est rendue depuis le manifest
 * extrait de commander, c'est-à-dire la même source que `nodefony --help` et
 * que la complétion. Une page écrite à part diverge du CLI au premier ajout de
 * commande, et rien ne le signale.
 *
 *   node scripts/generate-man.mjs           # écrit la page
 *   node scripts/generate-man.mjs --check   # échoue si la page est PÉRIMÉE
 *
 * Le mode `--check` est le gate : il ne réécrit rien, il constate. Sortie 1 si
 * la page committée ne correspond plus au CLI, avec la commande qui répare.
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE = path.join(ROOT, "src", "nodefony");
const DIST = path.join(CORE, "dist", "node", "index.js");
const PAGE = path.join(CORE, "man", "nodefony.1");

if (!existsSync(DIST)) {
  console.error(
    `dist absent (${path.relative(ROOT, DIST)}) — \`npm run build\` d'abord :\n` +
      "  la page est rendue depuis le CLI CONSTRUIT, jamais depuis les sources.",
  );
  process.exit(69); // EX_UNAVAILABLE
}

/**
 * 🔴 Un `dist` PÉRIMÉ est pire qu'un dist absent : il rend une page.
 *
 * Vécu — trente-neuf descriptions réécrites, ce script lancé, « ✓ écrite »
 * affiché… et la page inchangée, parce que le `dist` datait d'avant. On croit
 * alors avoir régénéré, on commite, et c'est le gate qui le découvre bien plus
 * tard. L'absence était gardée ; la PÉREMPTION, qui est le cas fréquent, ne
 * l'était pas.
 *
 * On compare donc le `dist` au source le plus récent du CLI. Pas de tolérance :
 * un source plus récent d'une seconde suffit à rendre la sortie douteuse, et le
 * remède coûte six secondes.
 */
function sourceLaPlusRecente(dossier) {
  let recent = 0;
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    if (entree.name === "dist" || entree.name === "node_modules") continue;
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory())
      recent = Math.max(recent, sourceLaPlusRecente(chemin));
    else if (entree.name.endsWith(".ts")) {
      recent = Math.max(recent, statSync(chemin).mtimeMs);
    }
  }
  return recent;
}

const distDate = statSync(DIST).mtimeMs;
const sourceDate = sourceLaPlusRecente(path.join(CORE, "src"));
if (sourceDate > distDate) {
  console.error(
    `dist PÉRIMÉ (${path.relative(ROOT, DIST)}) — une source du cœur est plus\n` +
      "  récente que lui. La page serait rendue depuis l'ANCIEN CLI, et ce script\n" +
      "  annoncerait pourtant l'avoir écrite.\n" +
      "  Réparer : npx turbo run build --force --filter=nodefony",
  );
  process.exit(69); // EX_UNAVAILABLE
}

const { CliKernel } = await import(pathToFileURL(DIST).href);
const { renderManPage } = await import(
  pathToFileURL(path.join(CORE, "dist", "node", "cli", "manPage.js")).href
);

const version = JSON.parse(
  readFileSync(path.join(CORE, "package.json"), "utf8"),
).version;

// `buildBuiltinManifest()` enregistre les commandes intégrées dans commander et
// rend leur manifest — SANS booter (aucun module chargé, donc aucune commande
// de module : c'est exactement le périmètre que la page doit couvrir).
const cli = new CliKernel("development");
const page = renderManPage(cli.buildBuiltinManifest(), version);

const check = process.argv.includes("--check");
// Lire DIRECTEMENT : `existsSync` puis `readFileSync` teste un état qui peut
// changer entre les deux appels, et confond « absent » avec « illisible ».
// `null` reste réservé à l'ABSENCE — c'est lui qui distingue « MANQUE » de
// « est PÉRIMÉE » dans le message.
const actuel = (() => {
  try {
    return readFileSync(PAGE, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
})();

if (check) {
  if (actuel === page) {
    console.log(`✓ ${path.relative(ROOT, PAGE)} à jour (man nodefony).`);
    process.exit(0);
  }
  console.error(
    `✗ ${path.relative(ROOT, PAGE)} ${actuel === null ? "MANQUE" : "est PÉRIMÉE"} — ` +
      "le CLI a changé depuis sa génération.\n" +
      "  Réparer : node scripts/generate-man.mjs",
  );
  process.exit(1);
}

mkdirSync(path.dirname(PAGE), { recursive: true });
writeFileSync(PAGE, page, "utf8");
console.log(
  `✓ ${path.relative(ROOT, PAGE)} écrite (${page.split("\n").length} lignes, ` +
    `${cli.buildBuiltinManifest().commands.length} commandes).`,
);
