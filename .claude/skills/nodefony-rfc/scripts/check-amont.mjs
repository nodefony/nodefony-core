#!/usr/bin/env node
/**
 * Dit si une référence figée sous le `references/` d'un skill a dérivé de son amont.
 *
 * Le problème qu'il ferme : une RFC ne change jamais, mais une spec vivante
 * (MCP, AGENTS.md) ou une documentation (Docker, Kubernetes) bouge — et une
 * copie figée se périme EN SILENCE. On continue de la citer, on croit tenir la
 * référence, et l'écart ne se voit nulle part. Ancrer la copie rend la dérive
 * CONSTATABLE en une commande.
 *
 * Ce script ne met JAMAIS à jour le contenu : il NOMME ce qui a changé. Une
 * référence se relit avant d'être remplacée — un remplacement automatique ferait
 * entrer du texte que personne n'a lu dans ce qui fait foi.
 *
 * Décor : chaque sous-dossier d'un `references/` de `.claude/skills/*` peut
 * porter un `AMONT.json`, sous l'une des deux formes décrites dans
 * `amont-lib.mjs`. Un dossier sans `AMONT.json` est signalé — sa dérive est
 * invérifiable, et cela se DIT.
 *
 *   node check-amont.mjs                      # le contrôle
 *   node check-amont.mjs --pin <copie>...     # re-figer des copies RELUES
 *   node check-amont.mjs --pin <copie> --until 2026-09-10T23:59:59Z
 *
 * Codes de sortie : `0` tout à jour · `3` de la dérive ou une copie touchée à
 * instruire · `78` impossible de savoir (réseau, quota). Le
 * 3 n'est pas une erreur : une référence qui avance est la normale, c'est de
 * l'ignorer qui coûte.
 *
 * @module
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  anchorDrift,
  checkLocalCopies,
  copyDrift,
  createGithubApi,
  findFrozenDirs,
  isPerPage,
  pinCopy,
  readManifest,
  writeManifest,
} from "./amont-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = path.join(HERE, "..", "..");

/**
 * Le jeton GitHub : `GITHUB_TOKEN`, sinon celui de `gh` s'il est installé et connecté.
 *
 * Non requis (dépôts publics), mais le quota anonyme (60 requêtes/h) ne couvre
 * pas une passe qui compare des fichiers un par un — sans jeton, le verdict
 * risque de finir en 78. Que `gh` soit là se CONSTATE en l'appelant.
 */
function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const gh = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
  return gh.status === 0 ? gh.stdout.trim() || undefined : undefined;
}

const get = createGithubApi(fetch, githubToken());

const LOCAL_FAULTS = {
  modified: "contenu modifié depuis qu'elle a été figée — relire, puis --pin",
  unpinned: "déclarée mais jamais figée — relire, puis --pin",
  missing: "déclarée dans AMONT.json, absente du dossier",
  undeclared: "ni copie suivie ni déclarée hors amont (`untracked`)",
};

/** Re-fige les copies nommées, puis sort. */
async function pin(argv) {
  const untilAt = argv.indexOf("--until");
  const until = untilAt === -1 ? undefined : argv[untilAt + 1];
  const files = argv.filter(
    (arg, i) =>
      arg !== "--pin" &&
      (untilAt === -1 || (i !== untilAt && i !== untilAt + 1)),
  );
  for (const file of files) {
    const dir = path.dirname(path.resolve(file));
    const name = path.basename(file);
    const manifest = readManifest(dir);
    const source = manifest?.sources?.find((s) => s.copies?.[name]);
    if (!source) {
      console.error(`✗  ${file} — aucune copie de ce nom dans AMONT.json`);
      process.exit(1);
    }
    source.copies[name] = await pinCopy(
      source,
      source.copies[name],
      path.join(dir, name),
      get,
      until,
    );
    writeManifest(dir, manifest);
    const { commit, date } = source.copies[name];
    console.log(`📌 ${name} — ${source.repo}@${commit.slice(0, 8)} (${date})`);
  }
}

if (process.argv.includes("--pin")) {
  await pin(process.argv.slice(2));
  process.exit(0);
}

let drift = 0;
let unknown = 0;
let withoutManifest = 0;

/** Contrôle d'un dossier ancré page par page. */
async function checkPerPage(label, dir, manifest) {
  for (const { file, problem } of checkLocalCopies(dir, manifest)) {
    drift += 1;
    console.log(`🔴 ${label}/${file} — ${LOCAL_FAULTS[problem]}`);
  }
  let fresh = 0;
  for (const source of manifest.sources) {
    for (const [file, copy] of Object.entries(source.copies ?? {})) {
      if (!copy.blob) continue;
      const verdict = await copyDrift(source, copy, get);
      if (verdict.state === "fresh") {
        fresh += 1;
      } else if (verdict.state === "unknown") {
        unknown += 1;
        console.log(
          `🔌 ${label}/${file} — ${source.repo} injoignable : on ne SAIT pas`,
        );
      } else if (verdict.state === "removed") {
        drift += 1;
        console.log(
          `🔴 ${label}/${file} — ${source.repo}:${copy.path} introuvable en amont (supprimé, déplacé ou ref erronée)`,
        );
      } else {
        drift += 1;
        console.log(
          `🔴 ${label}/${file} — a changé en amont le ${verdict.since ?? "?"} (figée au ${copy.date})`,
        );
        console.log(
          `      relire : https://github.com/${source.repo}/commits/${source.ref}/${copy.path}`,
        );
        console.log(
          `      puis figer : node ${path.relative(process.cwd(), fileURLToPath(import.meta.url))} --pin ${path.relative(process.cwd(), path.join(dir, file))}`,
        );
      }
    }
  }
  console.log(`✅ ${label} — ${fresh} page(s) à jour de leur amont`);
  for (const [file, reason] of Object.entries(manifest.untracked ?? {})) {
    console.log(`⚪ ${label}/${file} — hors amont : ${reason}`);
  }
}

/** Contrôle d'un dossier ancré à un SHA unique. */
async function checkAnchor(label, manifest) {
  const verdict = await anchorDrift(manifest, get);
  if (verdict.state === "unknown") {
    unknown += 1;
    console.log(`🔌 ${label} — ${manifest.repo} injoignable : on ne SAIT pas`);
  } else if (verdict.state === "fresh") {
    const ahead =
      verdict.ahead > 0
        ? `${verdict.ahead} commit(s) d'avance, aucun fichier suivi touché`
        : `à jour (${manifest.sha.slice(0, 8)})`;
    console.log(`✅ ${label} — ${ahead}`);
  } else {
    drift += 1;
    console.log(
      `🔴 ${label} — ${verdict.touched.length} fichier(s) suivi(s) ont changé depuis ${manifest.sha.slice(0, 8)} :`,
    );
    for (const f of verdict.touched) console.log(`      ${f}`);
    console.log(`      relire : ${verdict.url}`);
    console.log(
      `      puis figer : mettre à jour les fichiers ET le sha dans ${label}/AMONT.json`,
    );
  }
}

for (const { label, dir } of findFrozenDirs(SKILLS_ROOT)) {
  const manifest = readManifest(dir);
  if (manifest === null) {
    withoutManifest += 1;
    console.log(`⚠️  ${label} — aucun AMONT.json : la dérive est INVÉRIFIABLE`);
  } else if (isPerPage(manifest)) {
    await checkPerPage(label, dir, manifest);
  } else {
    await checkAnchor(label, manifest);
  }
}

if (withoutManifest > 0) {
  console.log(
    `\n${withoutManifest} référence(s) sans AMONT.json — leur dérive ne sera jamais vue.`,
  );
}

if (unknown > 0) {
  console.log("\n⚠️  Verdict PARTIEL : au moins une source n'a pas répondu.");
  process.exit(78);
}
process.exit(drift > 0 ? 3 : 0);
