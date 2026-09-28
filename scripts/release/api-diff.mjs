#!/usr/bin/env node
/**
 * Mesure ce qui a changé dans la surface publique entre une version PUBLIÉE sur
 * npm et le `dist` local — par paquet publiable : sous-chemins d'`exports`,
 * exports à l'exécution, exports de types, et membre par membre.
 *
 * Usage :
 *   node scripts/release/api-diff.mjs                    # contre la dernière version publiée
 *   node scripts/release/api-diff.mjs --from 10.0.0-alpha.9
 *   node scripts/release/api-diff.mjs --details          # + le texte avant/après de chaque changement à relire
 *
 * Préalable : un `dist` complet (`npm run build`) — c'est lui qu'on compare.
 *
 * La référence est prise dans les TARBALLS npm, pas dans un tag git : c'est ce
 * que les utilisateurs ont installé. Elle est dépaquetée sous `tmp/api-diff/`,
 * DANS le dépôt, pour que ses imports se résolvent sur les `node_modules` du
 * dépôt ; chaque paquet reçoit en plus un lien vers les `node_modules` de son
 * workspace (une dépendance d'une autre version majeure vit là, pas à la racine).
 *
 * Ce que la mesure ne dit PAS : le comportement. Un code d'erreur changé, un
 * défaut inversé sont des ruptures à types identiques — ils se lisent dans les
 * commits (`!`) et le changelog, pas ici.
 *
 * Sortie : résumé sur stdout, rapport complet `tmp/api-diff/<version>/report.json`.
 * Code : 0 = mesure faite (ruptures ou non), 2 = mesure impossible.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  changedMemberTexts,
  classifyDeclaration,
  diffNames,
  exportEntries,
  listRuntimeExports,
  readTypeDeclarations,
} from "./api-diff-core.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
};
const showDetails = args.includes("--details");

const run = (command, cwd = ROOT) =>
  execSync(command, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

const workspaces = JSON.parse(run("npm query .workspace --json")).filter(
  (w) => !w.private,
);
if (workspaces.length === 0) {
  console.error("Aucun workspace publiable trouvé.");
  process.exit(2);
}

// La référence par défaut : la dernière version publiée — le `dist` local a
// avancé depuis, même quand le manifeste porte encore son numéro.
const core = workspaces.find((w) => w.name === "nodefony") ?? workspaces[0];
let from = option("--from");
if (!from) {
  const published = JSON.parse(run(`npm view ${core.name} versions --json`));
  from = published.at(-1) ?? null;
}
if (!from) {
  console.error(`Aucune version publiée de ${core.name} à comparer.`);
  process.exit(2);
}

const outDir = path.join(ROOT, "tmp", "api-diff", from);
fs.mkdirSync(outDir, { recursive: true });

/** Dépaquette le tarball publié d'un paquet ; `null` s'il n'existe pas à cette version. */
function fetchPublished(name, localLocation) {
  const target = path.join(outDir, name.replace(/[/@]/g, "_"));
  const packageDir = path.join(target, "package");
  if (!fs.existsSync(path.join(packageDir, "package.json"))) {
    try {
      run(`npm view ${name}@${from} version`);
    } catch {
      return null;
    }
    fs.mkdirSync(target, { recursive: true });
    const tarball = run(
      `npm pack ${name}@${from} --pack-destination "${target}" --silent`,
    )
      .trim()
      .split("\n")
      .pop();
    run(`tar -xzf "${tarball}" -C "${target}"`, target);
    fs.rmSync(path.join(target, tarball), { force: true });
  }
  const localModules = path.join(ROOT, localLocation, "node_modules");
  const link = path.join(packageDir, "node_modules");
  // "junction" : un lien de dossier qui ne demande aucun droit particulier sous Windows.
  if (fs.existsSync(localModules) && !fs.existsSync(link))
    fs.symlinkSync(localModules, link, "junction");
  return packageDir;
}

const report = { from, to: core.version, packages: {} };
const totals = {
  declarations: 0,
  changed: 0,
  review: 0,
  removedTypes: 0,
  removedRuntime: 0,
  removedSubpaths: 0,
};

for (const workspace of workspaces) {
  const localDir = path.join(ROOT, workspace.location);
  const publishedDir = fetchPublished(workspace.name, workspace.location);
  if (!publishedDir) {
    report.packages[workspace.name] = { absentFromReference: true };
    continue;
  }
  const before = exportEntries(
    readJson(path.join(publishedDir, "package.json")),
    publishedDir,
  );
  const after = exportEntries(
    readJson(path.join(localDir, "package.json")),
    localDir,
  );
  const entry = {
    subpaths: diffNames(Object.keys(before), Object.keys(after)),
    entries: {},
  };
  totals.removedSubpaths += entry.subpaths.removed.length;

  for (const subpath of Object.keys(before).filter((k) => k in after)) {
    const result = {};
    const { js: jsA, dts: dtsA } = before[subpath];
    const { js: jsB, dts: dtsB } = after[subpath];
    if (jsA && jsB) {
      const a = listRuntimeExports(jsA);
      const b = listRuntimeExports(jsB);
      result.runtime =
        Array.isArray(a) && Array.isArray(b)
          ? { count: [a.length, b.length], ...diffNames(a, b) }
          : { errorBefore: a.error, errorAfter: b.error };
      totals.removedRuntime += result.runtime.removed?.length ?? 0;
    }
    if (dtsA && dtsB) {
      const a = readTypeDeclarations(dtsA);
      const b = readTypeDeclarations(dtsB);
      const names = diffNames(Object.keys(a), Object.keys(b));
      const common = Object.keys(a).filter((k) => k in b);
      const declarations = [];
      for (const name of common) {
        if (a[name] === b[name]) continue;
        const c = classifyDeclaration(a[name], b[name]);
        if (c.category === "unchanged") continue;
        declarations.push({
          name,
          ...c,
          ...(c.category === "review" &&
          (c.kind === "class" || c.kind === "interface")
            ? { memberTexts: changedMemberTexts(a[name], b[name], c.changed) }
            : c.category === "review"
              ? { before: a[name], after: b[name] }
              : {}),
        });
      }
      result.types = {
        count: [Object.keys(a).length, Object.keys(b).length],
        ...names,
        declarations,
      };
      totals.declarations += common.length;
      totals.changed += declarations.length;
      totals.review += declarations.filter(
        (d) => d.category !== "additive",
      ).length;
      totals.removedTypes += names.removed.length;
    }
    entry.entries[subpath] = result;
  }
  report.packages[workspace.name] = entry;
}

const reportFile = path.join(outDir, "report.json");
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

console.log(
  `Surface publique : ${from} (npm) → ${core.version} (dist local)\n`,
);
for (const [name, entry] of Object.entries(report.packages)) {
  if (entry.absentFromReference) {
    console.log(`${name} : absent de ${from}, rien à comparer`);
    continue;
  }
  const lines = [];
  if (entry.subpaths.removed.length)
    lines.push(`  sous-chemins RETIRÉS : ${entry.subpaths.removed.join(", ")}`);
  for (const [subpath, r] of Object.entries(entry.entries)) {
    if (r.runtime?.errorBefore || r.runtime?.errorAfter)
      lines.push(
        `  ${subpath} exécution NON MESURÉE : ${r.runtime.errorBefore ?? r.runtime.errorAfter}`,
      );
    if (r.runtime?.removed?.length)
      lines.push(
        `  ${subpath} exports RETIRÉS : ${r.runtime.removed.join(", ")}`,
      );
    if (r.types?.removed.length)
      lines.push(`  ${subpath} types RETIRÉS : ${r.types.removed.join(", ")}`);
    for (const d of r.types?.declarations ?? []) {
      if (d.category === "additive") continue;
      const parts = [];
      if (d.removed.length)
        parts.push(`membres retirés ${d.removed.join(", ")}`);
      if (d.addedRequired.length)
        parts.push(`membres requis ajoutés ${d.addedRequired.join(", ")}`);
      if (d.changed.length)
        parts.push(`${d.changed.length} membre(s) modifié(s)`);
      if (d.headerChanged) parts.push("en-tête changé");
      if (d.category === "kind-changed")
        parts.push("genre de déclaration changé");
      lines.push(
        `  ${subpath} ${d.name} [${d.kind}] ${parts.join(" · ") || "modifié"}`,
      );
      if (showDetails) {
        for (const m of d.memberTexts ?? [])
          lines.push(`      - ${m.before}\n      + ${m.after}`);
        if (d.before) lines.push(`      - ${d.before}\n      + ${d.after}`);
      }
    }
  }
  console.log(`${name} : ${lines.length ? "" : "aucun changement à relire"}`);
  for (const l of lines) console.log(l);
}
console.log(
  `\nTotal : ${totals.changed}/${totals.declarations} déclarations de types modifiées, dont ${totals.review} à relire` +
    ` · retirés : ${totals.removedSubpaths} sous-chemin(s), ${totals.removedRuntime} export(s) d'exécution, ${totals.removedTypes} type(s)`,
);
console.log(`Rapport complet : ${path.relative(ROOT, reportFile)}`);
console.log(
  "Non mesuré ici : le comportement (codes, défauts) — lire les commits `!` et le changelog.",
);
