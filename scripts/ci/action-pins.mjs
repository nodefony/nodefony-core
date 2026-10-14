#!/usr/bin/env node
/**
 * Épingles des actions GitHub — une seule implémentation pour le gate
 * (`actions-pinned.test.mjs`) et pour l'humain qui doit les tenir à jour.
 *
 * Une action tierce s'écrit `owner/repo[/chemin]@<sha 40> # vX.Y.Z`. Dependabot
 * monte les workflows de la forge (`.github/`), mais ne voit ni les gabarits
 * d'application (`*.yml.tpl`) ni `packageManager.ts` : ce script recopie la
 * forge dans ce qui voyage chez l'utilisateur, et trouve le SHA d'une version.
 *
 *   node scripts/ci/action-pins.mjs                      écarts gabarits ↔ forge
 *   node scripts/ci/action-pins.mjs --write              les recopier depuis la forge
 *   node scripts/ci/action-pins.mjs --resolve actions/setup-node@v7.1.0
 *                                                        la ligne `uses:` prête à coller
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(import.meta.dirname, "../..");

/** Forme exigée — le commentaire est ce que Dependabot relit pour proposer la montée. */
export const PIN = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+(\.\d+){0,2}$/;

/** Ce qu'exécute le dépôt — la seule surface que Dependabot tient à jour. */
const FORGE_DIRS = [".github/workflows", ".github/actions"];
/** Ce qui voyage dans chaque application générée. */
const TEMPLATE_DIR = "src/nodefony/templates";
const PACKAGE_MANAGER = "src/nodefony/src/cli/packageManager.ts";

/** Fichiers YAML (et gabarits YAML) sous `dir`, récursivement, en chemins absolus. */
export function yamlUnder(dir) {
  return readdirSync(path.join(ROOT, dir), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((e) => e.isFile() && /\.ya?ml(\.tpl)?$/.test(e.name))
    .map((e) => path.join(e.parentPath, e.name));
}

/** Chaque référence `uses:` d'un fichier YAML, avec son ancre `fichier:ligne`. */
export function references(file) {
  const out = [];
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      const m = /^\s*-?\s*uses:\s*(.+?)\s*$/.exec(line);
      if (m)
        out.push({
          file,
          at: `${path.relative(ROOT, file).split(path.sep).join("/")}:${i + 1}`,
          ref: m[1],
        });
    });
  return out;
}

/** Les références `uses: "…"` que `packageManager.ts` rend dans l'application. */
export function packageManagerReferences() {
  const file = path.join(ROOT, PACKAGE_MANAGER);
  return [...readFileSync(file, "utf8").matchAll(/uses:\s*"([^"]+)"/g)].map(
    (m) => ({ file, at: PACKAGE_MANAGER, ref: m[1] }),
  );
}

/** `owner/repo/chemin@sha # vX` → `{ action: "owner/repo", sha, version }`. */
export function parsePin(ref) {
  const [left, right] = ref.split("@");
  const [sha, version] = right.split(" # ");
  return { action: left.split("/").slice(0, 2).join("/"), sha, version };
}

/**
 * Les épingles de la forge, indexées par `owner/repo`. Une action épinglée à
 * deux SHA différents dans la forge est rendue dans `conflicts` : recopier l'un
 * plutôt que l'autre serait un choix arbitraire.
 */
export function forgePins() {
  const pins = new Map();
  const conflicts = [];
  for (const r of FORGE_DIRS.flatMap(yamlUnder).flatMap(references)) {
    if (!PIN.test(r.ref)) continue;
    const p = parsePin(r.ref);
    const seen = pins.get(p.action);
    if (seen && seen.sha !== p.sha)
      conflicts.push(
        `${r.at} → ${p.action} ${p.version} (ailleurs : ${seen.version})`,
      );
    else pins.set(p.action, p);
  }
  return { pins, conflicts };
}

/** Les épingles livrées (gabarits + `packageManager.ts`) qui divergent de la forge. */
export function deliveredDrifts(pins = forgePins().pins) {
  return [
    ...yamlUnder(TEMPLATE_DIR).flatMap(references),
    ...packageManagerReferences(),
  ]
    .filter((r) => PIN.test(r.ref))
    .map((r) => {
      r.pin = parsePin(r.ref);
      r.forge = pins.get(r.pin.action);
      return r;
    })
    .filter((r) => r.forge && r.forge.sha !== r.pin.sha);
}

/** Recopie la forge dans chaque épingle livrée divergente ; rend les fichiers réécrits. */
export function writeDrifts(drifts) {
  const byFile = Map.groupBy(drifts, (d) => d.file);
  for (const [file, list] of byFile) {
    let text = readFileSync(file, "utf8");
    for (const d of list)
      text = text.replace(
        `@${d.pin.sha} # ${d.pin.version}`,
        `@${d.forge.sha} # ${d.forge.version}`,
      );
    writeFileSync(file, text);
  }
  return [...byFile.keys()];
}

/**
 * SHA de COMMIT d'une version publiée : `gh api …/commits/<tag>` déréférence un
 * tag annoté, ce que `git ls-remote` ne fait pas sans `^{}`.
 */
export function resolvePin(spec) {
  const m = /^([\w.-]+\/[\w.-]+)(\/[\w./-]+)?@(v\d+(\.\d+){0,2})$/.exec(spec);
  if (!m)
    throw new Error(
      `forme attendue : owner/repo[/chemin]@vX.Y.Z — reçu « ${spec} »`,
    );
  const [, repo, sub = "", tag] = m;
  const sha = execFileSync(
    "gh",
    ["api", `repos/${repo}/commits/${tag}`, "--jq", ".sha"],
    {
      encoding: "utf8",
    },
  ).trim();
  return `${repo}${sub}@${sha} # ${tag}`;
}

function main(argv) {
  const resolveAt = argv.indexOf("--resolve");
  if (resolveAt !== -1) {
    console.log(`uses: ${resolvePin(argv[resolveAt + 1] ?? "")}`);
    return 0;
  }
  const { pins, conflicts } = forgePins();
  if (conflicts.length) {
    console.error(
      "La forge épingle une même action à deux SHA — à trancher d'abord :",
    );
    for (const c of conflicts) console.error(`  ${c}`);
    return 1;
  }
  const drifts = deliveredDrifts(pins);
  if (!drifts.length) {
    console.log("Gabarits alignés sur la forge.");
    return 0;
  }
  for (const d of drifts)
    console.log(
      `${d.at}  ${d.pin.action} ${d.pin.version} → ${d.forge.version}`,
    );
  if (!argv.includes("--write")) {
    console.log("\nRecopier : node scripts/ci/action-pins.mjs --write");
    return 1;
  }
  const files = writeDrifts(drifts);
  console.log(
    `\n${drifts.length} épingle(s) recopiée(s) dans ${files.length} fichier(s).`,
  );
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = main(process.argv.slice(2));
