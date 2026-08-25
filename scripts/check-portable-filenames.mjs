#!/usr/bin/env node
/**
 * check-portable-filenames — un nom de fichier que Windows REFUSE ne doit pas entrer.
 *
 * Windows est un impératif produit, et le nom d'un fichier en fait partie : il
 * n'y existe pas de fichier nommé `a:b`, `x?`, ni `--format=%h\x1f%B\x1e`. Le
 * dépôt qui en porte un devient INCLONABLE là-bas — `git checkout` sort en 128
 * sur `invalid path`, AVANT le moindre test. Sept jobs Windows sont tombés ainsi,
 * pendant que linux et macOS restaient verts : ces noms y sont parfaitement
 * légaux, aucun lint ne les regarde, aucun test ne les exécute.
 *
 * L'origine du cas vécu dit pourquoi une garde vaut mieux qu'une vigilance : un
 * test d'attaque légitime a fait exécuter un `touch` par un shell, et le `touch`
 * de BSD — qui ne connaît pas les options longues — a pris ses arguments pour
 * des noms de fichiers. Deux fichiers créés à la racine, `git add -A` les
 * emporte, et rien ne parle avant la forge.
 *
 * @usage    node scripts/check-portable-filenames.mjs           # tous les fichiers SUIVIS
 * @usage    node scripts/check-portable-filenames.mjs --staged  # ceux de l'index (pre-commit)
 * @output   la liste des noms refusés, avec la raison exacte ; sortie 1 si un seul l'est
 *
 * Les règles viennent de la documentation Microsoft « Naming Files, Paths, and
 * Namespaces », pas d'une intuition : caractères réservés, caractères de
 * contrôle, noms de PÉRIPHÉRIQUES hérités du DOS, et segments qui se terminent
 * par un point ou une espace (Windows les tronque en silence — deux fichiers du
 * dépôt s'y confondraient).
 */
import { execFileSync } from "node:child_process";

const STAGED = process.argv.includes("--staged");

/** `< > : " | ? *` et tout caractère de contrôle : illégaux dans un nom NTFS. */
const CARACTERES_REFUSES = /[<>:"|?*\x00-\x1f]/;

/**
 * Noms de périphériques DOS, encore réservés aujourd'hui — extension comprise :
 * `NUL.txt` est le périphérique nul, pas un fichier.
 */
const PERIPHERIQUES = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;

/**
 * Ce qui rend un segment de chemin inutilisable sous Windows, ou rien.
 *
 * @param {string} segment - un composant du chemin (entre deux `/`).
 * @returns {string|null} la raison du refus, ou `null` si le segment est portable.
 */
function refus(segment) {
  const mauvais = segment.match(CARACTERES_REFUSES);
  if (mauvais) {
    const c = mauvais[0];
    const lisible =
      c.charCodeAt(0) < 32
        ? `caractère de contrôle 0x${c.charCodeAt(0).toString(16).padStart(2, "0")}`
        : `caractère réservé « ${c} »`;
    return lisible;
  }
  if (PERIPHERIQUES.test(segment))
    return `nom de périphérique DOS réservé (${segment.split(".")[0]})`;
  if (/[. ]$/.test(segment))
    return "se termine par un point ou une espace (Windows le tronque en silence)";
  return null;
}

const args = STAGED
  ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]
  : ["ls-files"];

// `-z` : les noms « exotiques » sont précisément ceux que git échapperait en
// citation C (`"--format=%h\037%B\036"`). Les lire échappés reviendrait à
// contrôler une TRANSCRIPTION du nom, pas le nom.
const sortie = execFileSync("git", [...args, "-z"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const fichiers = sortie.split("\0").filter(Boolean);

const refuses = [];
for (const f of fichiers) {
  for (const segment of f.split("/")) {
    const raison = refus(segment);
    if (raison) {
      refuses.push({ fichier: f, segment, raison });
      break;
    }
  }
}

if (refuses.length === 0) {
  process.stdout.write(
    `✓ ${fichiers.length} noms de fichiers portables (linux · macOS · Windows).\n`,
  );
  process.exit(0);
}

process.stderr.write(
  `\n❌ ${refuses.length} nom(s) de fichier que Windows REFUSE — le dépôt y serait inclonable :\n\n`,
);
for (const r of refuses) {
  // `JSON.stringify` rend visibles les caractères de contrôle, que le terminal
  // avalerait : un nom fautif qu'on ne VOIT pas ne se corrige pas.
  process.stderr.write(`   ${JSON.stringify(r.fichier)}\n`);
  process.stderr.write(`     → ${r.raison}\n`);
}
process.stderr.write(
  "\n   Retirer ces fichiers (`git rm --cached -- <nom>` puis `rm`), ou les renommer.\n" +
    "   Un checkout Windows échoue en `invalid path`, AVANT le moindre test.\n",
);
process.exit(1);
