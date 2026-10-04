#!/usr/bin/env node
/**
 * Mesure ce qui a changé dans la surface publique entre une version PUBLIÉE sur
 * npm et le `dist` local — par paquet publiable : sous-chemins d'`exports`,
 * exports à l'exécution, exports de types, et membre par membre.
 *
 * Usage :
 *   npm run release:api-diff                              # contre la dernière version publiée
 *   npm run release:api-diff -- --from 10.0.0-alpha.9
 *   npm run release:api-diff -- --details                 # + le texte avant/après de chaque changement à relire
 *
 * `npm run release` appelle la même mesure (`measureApiDiff`) pour écrire les
 * retraits dans le brouillon du CHANGELOG.
 *
 * Préalable : un `dist` complet (`npm run build`) — c'est lui qu'on compare.
 *
 * La référence est prise dans les TARBALLS npm, pas dans un tag git : c'est ce
 * que les utilisateurs ont installé. Elle est dépaquetée sous `tmp/reports/api-diff/`,
 * DANS le dépôt, pour que ses imports se résolvent sur les `node_modules` du
 * dépôt ; chaque paquet reçoit en plus un lien vers les `node_modules` de son
 * workspace (une dépendance d'une autre version majeure vit là, pas à la racine).
 *
 * Ce que la mesure ne dit PAS : le comportement. Un code d'erreur changé, un
 * défaut inversé sont des ruptures à types identiques — ils se lisent dans les
 * commits (`!`) et le changelog, pas ici.
 *
 * Sortie : résumé sur stdout, rapport complet `tmp/reports/api-diff/<version>/report.json`.
 * Code : 0 = mesure faite (ruptures ou non), 2 = mesure impossible.
 *
 * @usage npm run release:api-diff
 * @usage npm run release:api-diff -- --from <version> [--details]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  changedMemberTexts,
  classifyDeclaration,
  diffNames,
  exportEntries,
  listRuntimeExports,
  readTypeDeclarations,
} from "./api-diff-core.mjs";
import { publishableWorkspaces as listPublishable } from "../lib/workspaces.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

// Les arguments viennent de la ligne de commande (`--from`, `--peers`) : ils ne
// passent JAMAIS par un shell. `portableSpawn` (cœur) lance la commande telle
// quelle, et sous Windows quote chaque argument pour `cmd.exe` — ou le refuse.
let portableSpawn;
try {
  ({ portableSpawn } = await import("nodefony"));
} catch {
  throw new Error(
    "impossible de charger `nodefony` — le cœur n'est pas bâti. → npm run build",
  );
}

/**
 * Lance `command args…` sans shell et rend sa sortie standard.
 *
 * @param command - l'exécutable (`npm`, `tar`).
 * @param args - ses arguments, un par élément — jamais concaténés.
 * @param cwd - dossier d'exécution.
 * @returns la sortie standard, en texte.
 */
export function runPortable(command, args, cwd = ROOT) {
  const spawn = portableSpawn(command, args);
  return execFileSync(spawn.file, spawn.args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsVerbatimArguments: spawn.windowsVerbatimArguments,
  });
}
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

/** Workspaces publiables — résolus par npm, comme `pack-all.mjs`. */
export function publishableWorkspaces(root = ROOT) {
  return listPublishable(root);
}

/** Dernière version publiée d'un paquet, ou `null`. */
export function latestPublished(name, root = ROOT) {
  return (
    JSON.parse(
      runPortable("npm", ["view", name, "versions", "--json"], root),
    ).at(-1) ?? null
  );
}

/** Dépaquette le tarball publié d'un paquet ; `null` s'il n'existe pas à cette version. */
function fetchPublished({ name, location, from, outDir, root }) {
  const target = path.join(outDir, name.replace(/[/@]/g, "_"));
  const packageDir = path.join(target, "package");
  if (!fs.existsSync(path.join(packageDir, "package.json"))) {
    try {
      runPortable("npm", ["view", `${name}@${from}`, "version"], root);
    } catch {
      return null;
    }
    fs.mkdirSync(target, { recursive: true });
    const tarball = runPortable(
      "npm",
      ["pack", `${name}@${from}`, "--pack-destination", target, "--silent"],
      root,
    )
      .trim()
      .split("\n")
      .pop();
    runPortable("tar", ["-xzf", tarball, "-C", target], target);
    fs.rmSync(path.join(target, tarball), { force: true });
  }
  const localModules = path.join(root, location, "node_modules");
  const link = path.join(packageDir, "node_modules");
  // "junction" : un lien de dossier qui ne demande aucun droit particulier sous Windows.
  if (fs.existsSync(localModules) && !fs.existsSync(link))
    fs.symlinkSync(localModules, link, "junction");
  return packageDir;
}

/**
 * Mesure la surface publique d'une version publiée contre le `dist` local.
 *
 * @param options.from - version publiée de référence.
 * @param options.root - racine du dépôt.
 * @param options.workspaces - workspaces publiables (`npm query .workspace`).
 * @returns `{ report, totals, reportFile }` — le rapport est aussi écrit sur disque.
 */
export function measureApiDiff({
  from,
  root = ROOT,
  workspaces = publishableWorkspaces(root),
}) {
  const outDir = path.join(root, "tmp", "reports", "api-diff", from);
  fs.mkdirSync(outDir, { recursive: true });
  const core = workspaces.find((w) => w.name === "nodefony") ?? workspaces[0];
  const report = { from, to: core?.version ?? null, packages: {} };
  const totals = {
    declarations: 0,
    changed: 0,
    review: 0,
    removedTypes: 0,
    removedRuntime: 0,
    removedSubpaths: 0,
    unmeasured: 0,
  };

  for (const workspace of workspaces) {
    const localDir = path.join(root, workspace.location);
    const publishedDir = fetchPublished({
      name: workspace.name,
      location: workspace.location,
      from,
      outDir,
      root,
    });
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
        if (Array.isArray(a) && Array.isArray(b)) {
          result.runtime = { count: [a.length, b.length], ...diffNames(a, b) };
          totals.removedRuntime += result.runtime.removed.length;
        } else {
          result.runtime = { errorBefore: a.error, errorAfter: b.error };
          totals.unmeasured++;
        }
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
          const isShape = c.kind === "class" || c.kind === "interface";
          declarations.push({
            name,
            ...c,
            ...(c.category !== "review"
              ? {}
              : isShape
                ? {
                    memberTexts: changedMemberTexts(
                      a[name],
                      b[name],
                      c.changed,
                    ),
                  }
                : { before: a[name], after: b[name] }),
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
  return { report, totals, reportFile };
}

function printReport({ report, totals, reportFile }, showDetails) {
  console.log(
    `Surface publique : ${report.from} (npm) → ${report.to} (dist local)\n`,
  );
  for (const [name, entry] of Object.entries(report.packages)) {
    if (entry.absentFromReference) {
      console.log(`${name} : absent de ${report.from}, rien à comparer`);
      continue;
    }
    const lines = [];
    if (entry.subpaths.removed.length)
      lines.push(
        `  sous-chemins RETIRÉS : ${entry.subpaths.removed.join(", ")}`,
      );
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
        lines.push(
          `  ${subpath} types RETIRÉS : ${r.types.removed.join(", ")}`,
        );
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
      ` · retirés : ${totals.removedSubpaths} sous-chemin(s), ${totals.removedRuntime} export(s) d'exécution, ${totals.removedTypes} type(s)` +
      (totals.unmeasured
        ? ` · ${totals.unmeasured} entrée(s) NON MESURÉE(S) à l'exécution`
        : ""),
  );
  console.log(`Rapport complet : ${path.relative(ROOT, reportFile)}`);
  console.log(
    "Non mesuré ici : le comportement (codes, défauts) — lire les commits `!` et le changelog.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--from");
  const workspaces = publishableWorkspaces();
  if (workspaces.length === 0) {
    console.error("Aucun workspace publiable trouvé.");
    process.exit(2);
  }
  // La référence par défaut : la dernière version publiée — le `dist` local a
  // avancé depuis, même quand le manifeste porte encore son numéro.
  const core = workspaces.find((w) => w.name === "nodefony") ?? workspaces[0];
  const from = (i === -1 ? null : args[i + 1]) ?? latestPublished(core.name);
  if (!from) {
    console.error(`Aucune version publiée de ${core.name} à comparer.`);
    process.exit(2);
  }
  printReport(measureApiDiff({ from, workspaces }), args.includes("--details"));
}
