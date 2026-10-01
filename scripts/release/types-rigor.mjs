#!/usr/bin/env node
/**
 * Mesure la rigueur des TYPES PUBLIÉS : densité de `any`, rapport
 * `unknown`/`any`, part des déclarations qui contiennent un `any` — pour le
 * `dist` local, et pour tout paquet npm donné en comparaison.
 *
 * Usage :
 *   node scripts/release/types-rigor.mjs                                  # dist local + NestJS + Fastify
 *   node scripts/release/types-rigor.mjs --from 10.0.0-alpha.9            # + une version publiée de Nodefony
 *   node scripts/release/types-rigor.mjs --peers @nestjs/core,fastify@5   # autres témoins
 *
 * Ce qu'on compte est ce que l'utilisateur REÇOIT : les `.d.ts` publiés. Les
 * options du compilateur et les assertions (`as unknown as`) vivent dans les
 * sources, que npm ne transporte pas — hors de portée ici.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { countTypeLooseness } from "./api-diff-core.mjs";
import { runPortable } from "./api-diff.mjs";

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
const peers = (option("--peers") ?? "@nestjs/common,@nestjs/core,fastify")
  .split(",")
  .filter(Boolean);
const from = option("--from");
const outDir = path.join(ROOT, "tmp", "types-rigor");

function declarationFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!["node_modules", "test", "tests"].includes(e.name))
        declarationFiles(p, acc);
    } else if (/\.d\.[mc]?ts$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** Dépaquette un paquet npm (`nom` ou `nom@version`) et rend son dossier. */
function fetchPackage(spec) {
  const target = path.join(outDir, spec.replace(/[/@]/g, "_"));
  const packageDir = path.join(target, "package");
  if (!fs.existsSync(packageDir)) {
    fs.mkdirSync(target, { recursive: true });
    const tarball = runPortable("npm", [
      "pack",
      spec,
      "--pack-destination",
      target,
      "--silent",
    ])
      .trim()
      .split("\n")
      .pop();
    runPortable("tar", ["-xzf", tarball, "-C", target], target);
    fs.rmSync(path.join(target, tarball), { force: true });
  }
  return packageDir;
}

function measure(label, dirs) {
  const total = {
    files: 0,
    any: 0,
    unknown: 0,
    declarations: 0,
    declarationsWithAny: 0,
    lines: 0,
  };
  for (const dir of dirs) {
    for (const file of declarationFiles(dir)) {
      total.files++;
      const c = countTypeLooseness(fs.readFileSync(file, "utf8"));
      for (const k of [
        "any",
        "unknown",
        "declarations",
        "declarationsWithAny",
        "lines",
      ])
        total[k] += c[k];
    }
  }
  return { label, ...total };
}

const workspaces = JSON.parse(
  runPortable("npm", ["query", ".workspace", "--json"]),
).filter((w) => !w.private);
const rows = [];
if (from)
  rows.push(
    measure(
      `Nodefony ${from}`,
      workspaces.map((w) =>
        path.join(fetchPackage(`${w.name}@${from}`), "dist"),
      ),
    ),
  );
rows.push(
  measure(
    "Nodefony (dist local)",
    workspaces.map((w) => path.join(ROOT, w.location, "dist")),
  ),
);
for (const spec of peers) {
  const dir = fetchPackage(spec.includes("@", 1) ? spec : `${spec}@latest`);
  const version = JSON.parse(
    fs.readFileSync(path.join(dir, "package.json"), "utf8"),
  ).version;
  rows.push(measure(`${spec.replace(/@[^@/]+$/, "")} ${version}`, [dir]));
}

const fmt = (n, d = 1) => n.toFixed(d);
console.log(
  "paquet                      fichiers   lignes   any  any/1000l  unknown/any  décl. avec any",
);
for (const r of rows) {
  if (r.files === 0) {
    console.log(`${r.label.padEnd(26)} AUCUN .d.ts trouvé — dist absent ?`);
    continue;
  }
  console.log(
    `${r.label.padEnd(26)} ${String(r.files).padStart(8)} ${String(r.lines).padStart(8)} ${String(r.any).padStart(5)}` +
      ` ${fmt((r.any / r.lines) * 1000).padStart(10)} ${fmt(r.unknown / Math.max(r.any, 1), 2).padStart(12)}` +
      `  ${r.declarationsWithAny}/${r.declarations} (${fmt((r.declarationsWithAny / r.declarations) * 100)} %)`,
  );
}
