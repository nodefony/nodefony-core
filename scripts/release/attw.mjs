#!/usr/bin/env node
// Types publiés — « Are The Types Wrong? » sur CHAQUE tarball de release/tarballs/.
//
// Le dépôt lit ses paquets en SOURCE (condition `nodefony-source`) : il ne passe
// jamais par les `.d.ts` publiés. Un import qu'un `.d.ts` porte et que node16 ne
// résout pas compile donc ici, et retire les types de toute une entrée chez
// l'utilisateur. Vécu : `nodefony/angular` en 10.0.0-beta.6, `import("..")`
// émis par tsgo — vu par le smoke de release, APRÈS le tag. Ce contrôle tourne
// aussi dans la CI de branche, pour qu'il se voie AVANT.
//
// Profil `esm-only` : node10 et require() ignorés (framework ESM uniquement).
// Les exports d'ASSET (bundle pour <script src>, logo, feuille de style) n'ont
// pas de types par nature : ils sont DÉDUITS des `exports` du tarball — une
// cible en chaîne nue, sans condition `types` — jamais listés à la main.
//
// Usage : node scripts/release/attw.mjs   (après `npm run release:pack`)
// Sortie : 0 tout vert · 1 au moins un tarball refusé (rapport COMPLET imprimé)
//          · 2 rien à juger (aucun tarball).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const DIR = path.join(ROOT, "release", "tarballs");
const ATTW = "@arethetypeswrong/cli@0.18.5";

/**
 * Lit le `package.json` EMBARQUÉ dans le tarball — l'artefact reçu, pas le dépôt.
 *
 * @param tgz - chemin du tarball
 * @returns le manifeste publié
 */
function readPackedManifest(tgz) {
  const r = spawnSync("tar", ["-xOzf", tgz, "package/package.json"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(
      `tar n'a pas lu ${path.basename(tgz)} : ${r.stderr || r.error}`,
    );
  }
  return JSON.parse(r.stdout);
}

/**
 * Les entrées d'asset d'un manifeste : une cible en chaîne nue, hors JSON.
 *
 * @param manifest - le `package.json` publié
 * @returns les sous-chemins à exclure du contrôle des types
 */
export function assetEntrypoints(manifest) {
  const exp = manifest.exports ?? {};
  if (typeof exp !== "object" || exp === null) return [];
  return Object.keys(exp).filter(
    (k) => typeof exp[k] === "string" && !/\.json$/iu.test(k),
  );
}

function runAttw(tgz, exclude) {
  const args = ["--yes", ATTW, tgz, "--profile", "esm-only"];
  if (exclude.length > 0) args.push("--exclude-entrypoints", ...exclude);
  // `npx` est un `.cmd` sous Windows : Node exige alors un shell pour le lancer.
  return spawnSync("npx", args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const tarballs = fs.existsSync(DIR)
    ? fs
        .readdirSync(DIR)
        .filter((f) => f.endsWith(".tgz"))
        .sort()
    : [];
  if (tarballs.length === 0) {
    console.error(
      `attw : aucun tarball sous ${path.relative(ROOT, DIR)} — lancer d'abord \`npm run release:pack\`.`,
    );
    process.exit(2);
  }
  const refused = [];
  for (const name of tarballs) {
    const tgz = path.join(DIR, name);
    const r = runAttw(tgz, assetEntrypoints(readPackedManifest(tgz)));
    if (r.status === 0) {
      console.log(`✓ ${name}`);
      continue;
    }
    refused.push(name);
    // Le rapport ENTIER : la ligne fautive est rarement à la fin.
    console.log(`✗ ${name}\n${r.stdout}${r.stderr}`);
  }
  if (refused.length > 0) {
    console.error(
      `\nattw : ${refused.length}/${tarballs.length} tarball(s) aux types publiés cassés — ${refused.join(", ")}`,
    );
    process.exit(1);
  }
  console.log(
    `\nattw : ${tarballs.length}/${tarballs.length} tarballs, types publiés résolus (node16-ESM + bundler).`,
  );
}
