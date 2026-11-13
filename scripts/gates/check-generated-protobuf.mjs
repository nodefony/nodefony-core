#!/usr/bin/env node
/**
 * Gate — le code protobuf VERSIONNÉ est-il celui que ses contrats produisent ?
 *
 * Le code généré par `buf generate` se commite (ADR-0026 D2 point 3) : Nodefony ne
 * génère rien au build ni au démarrage. Il dérive donc en silence — un contrat
 * modifié sans régénérer, ou un générateur monté de version (le POC portait
 * `protoc-gen-es v2.16.0` quand la 2.17.0 était installée). Ce gate régénère
 * chaque gabarit `buf.gen.yaml` VERSIONNÉ dans un dossier jetable, et compare
 * fichier par fichier aux sorties commitées : manquant, en trop, différent.
 *
 * Aucun chemin n'est écrit en dur : les gabarits viennent de `git ls-files`,
 * les dossiers de sortie de leurs `plugins[].out`. Un gabarit du SCAFFOLD
 * (`buf.gen.yaml.tpl`, la démo de `create app --demo`) se régénère aussi : son
 * dossier est recopié sans le suffixe `.tpl` que le moteur retire au rendu
 * (`engine.ts#renderLayer`), et la sortie se compare aux `*.tpl` commités. `buf` et ses greffons sont ceux
 * du dépôt (`node_modules/.bin`), lancés par `process.execPath` — un script Node,
 * donc pareil sur les trois plateformes.
 *
 * @usage node scripts/gates/check-generated-protobuf.mjs
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/**
 * Dossiers de sortie d'un gabarit `buf.gen.yaml` (POSIX, relatifs au gabarit).
 *
 * @param {string} source - contenu du gabarit.
 * @returns {string[]}
 */
export function generatedOutputs(source) {
  const template = parse(source);
  const plugins = Array.isArray(template?.plugins) ? template.plugins : [];
  const outs = plugins
    .map((plugin) => plugin?.out)
    .filter((out) => typeof out === "string")
    .map((out) => out.replace(/\\/gu, "/").replace(/\/+$/u, ""));
  return [...new Set(outs)];
}

/** Suffixe des gabarits du scaffold, retiré au rendu (`engine.ts#renderLayer`). */
export const TEMPLATE_SUFFIX = ".tpl";

/** Fichiers d'un dossier, chemins POSIX relatifs ; vide s'il n'existe pas. */
function listFiles(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return out;
}

/**
 * Écarts entre l'arbre régénéré et l'arbre commité.
 *
 * @param {string} expectedDir - sortie régénérée.
 * @param {string} actualDir - sortie commitée.
 * @param {string} [suffix] - suffixe que portent les fichiers commités
 *   (`.tpl` pour un gabarit du scaffold) ; un fichier qui ne le porte pas est
 *   en trop sous son nom réel.
 * @returns {{ missing: string[], extra: string[], changed: string[] }}
 */
export function compareTrees(expectedDir, actualDir, suffix = "") {
  const expected = new Set(listFiles(expectedDir));
  // Nom attendu → fichier commité.
  const actual = new Map(
    listFiles(actualDir).map((f) => [
      suffix !== "" && f.endsWith(suffix)
        ? f.slice(0, -suffix.length)
        : `${f}${suffix === "" ? "" : " (sans .tpl)"}`,
      f,
    ]),
  );
  const missing = [...expected].filter((f) => !actual.has(f)).sort();
  const extra = [...actual.keys()].filter((f) => !expected.has(f)).sort();
  const changed = [...expected]
    .filter((f) => actual.has(f))
    .filter(
      (f) =>
        !fs
          .readFileSync(path.join(expectedDir, ...f.split("/")))
          .equals(
            fs.readFileSync(
              path.join(actualDir, ...String(actual.get(f)).split("/")),
            ),
          ),
    )
    .sort();
  return { missing, extra, changed };
}

/**
 * Recopie ce que `buf` lit d'un gabarit du scaffold — `buf.yaml`,
 * `buf.gen.yaml` et les contrats `.proto` — sans le suffixe `.tpl`.
 *
 * @param {string} dir - dossier du gabarit.
 * @param {string} into - dossier jetable de destination.
 */
function copyScaffoldInputs(dir, into) {
  for (const file of listFiles(dir)) {
    const name = file.slice(0, -TEMPLATE_SUFFIX.length);
    if (
      !file.endsWith(TEMPLATE_SUFFIX) ||
      !(
        name === "buf.yaml" ||
        name === "buf.gen.yaml" ||
        name.endsWith(".proto")
      )
    ) {
      continue;
    }
    const target = path.join(into, ...name.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(dir, ...file.split("/")), target);
  }
}

/** Gabarits `buf.gen.yaml` versionnés (scaffold compris), chemins POSIX relatifs au dépôt. */
function templates() {
  return execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--",
      "*buf.gen.yaml",
      `*buf.gen.yaml${TEMPLATE_SUFFIX}`,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean);
}

function main() {
  const found = templates();
  if (found.length === 0) {
    console.log("✓ protobuf : aucun gabarit buf.gen.yaml versionné");
    return 0;
  }
  const require = createRequire(import.meta.url);
  const buf = path.join(
    path.dirname(require.resolve("@bufbuild/buf/package.json")),
    "bin",
    "buf",
  );
  const env = {
    ...process.env,
    PATH: `${path.join(ROOT, "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}`,
  };
  let failures = 0;
  for (const template of found) {
    const dir = path.join(ROOT, ...path.posix.dirname(template).split("/"));
    const outs = generatedOutputs(
      fs.readFileSync(path.join(ROOT, ...template.split("/")), "utf8"),
    );
    const scaffold = template.endsWith(TEMPLATE_SUFFIX);
    const suffix = scaffold ? TEMPLATE_SUFFIX : "";
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "nf-protobuf-"));
    const inputs = scaffold
      ? fs.mkdtempSync(path.join(os.tmpdir(), "nf-protobuf-in-"))
      : dir;
    try {
      if (scaffold) copyScaffoldInputs(dir, inputs);
      const run = spawnSync(
        process.execPath,
        [
          buf,
          "generate",
          "--template",
          path.basename(template, suffix),
          "-o",
          scratch,
        ],
        { cwd: inputs, env, encoding: "utf8" },
      );
      if (run.status !== 0) {
        console.error(
          `✗ ${template} : buf generate a échoué (exit ${run.status})\n${run.stderr.trim()}`,
        );
        failures += 1;
        continue;
      }
      for (const out of outs) {
        const { missing, extra, changed } = compareTrees(
          path.join(scratch, ...out.split("/")),
          path.join(dir, ...out.split("/")),
          suffix,
        );
        const drift = [
          ...missing.map((f) => `manquant  ${f}`),
          ...extra.map((f) => `en trop   ${f}`),
          ...changed.map((f) => `différent ${f}`),
        ];
        if (drift.length === 0) continue;
        failures += 1;
        console.error(
          `✗ ${template} → ${out} : le code commité n'est pas celui que le contrat produit`,
        );
        for (const line of drift) console.error(`    ${line}`);
        console.error(
          scaffold
            ? `  Régénérer : buf generate sur une copie sans .tpl de ${path.posix.dirname(template)}, puis recopier ${out} en ajoutant .tpl à chaque fichier.`
            : `  Régénérer : (cd ${path.posix.dirname(template)} && npx buf generate), puis commiter.`,
        );
      }
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
      if (scaffold) fs.rmSync(inputs, { recursive: true, force: true });
    }
  }
  if (failures > 0) return 1;
  console.log(
    `✓ protobuf : ${found.length} gabarit(s), code commité identique à la régénération`,
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
