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
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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
const actuel = existsSync(PAGE) ? readFileSync(PAGE, "utf8") : null;

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
