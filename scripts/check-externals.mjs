#!/usr/bin/env node
/**
 * Audit de la dérive `external` ⇄ manifeste, sur TOUT le dépôt — core, packages ET modules.
 *
 * Deux mesures, volontairement distinctes, parce qu'elles échouent pour des raisons
 * différentes :
 *
 *  1. LA PREUVE — ce qui est RÉELLEMENT bundlé, lu dans les `dist/`
 *     (`dist/**∕node_modules/<paquet>`). Elle ne suppose rien du format des configs,
 *     donc elle survit à leur refonte. C'est elle qui a trouvé `zod` avalé par le
 *     module `test` alors que l'audit textuel était mort depuis la migration rolldown.
 *     ⚠️ Elle ne vaut que sur un `dist/` FRAIS : un dist absent ou périmé ne prouve rien,
 *     et le rapport le dit au lieu de laisser croire à un vert.
 *
 *  2. LA DÉRIVE — manifeste vs liste `external`, qui anticipe avant le prochain build.
 *     Un manque n'est un défaut QUE si le paquet est importé par du code serveur bundlé
 *     (`index.ts` + `nodefony/**`, hors tests) : le `vite` ou le `react` d'un module à
 *     frontend n'est jamais atteint par rolldown côté serveur.
 *
 * Pourquoi ce script existe plutôt qu'un bloc de commandes dans un skill : la version
 * précédente vivait dans le skill et supposait `const external: string[] = [...]`. La
 * migration rolldown a fait passer 20 configs sur 21 à `defineNodefonyRolldownConfig({
 * external: [...] })` — l'audit ne lisait plus RIEN, sans jamais le dire. Un contrôle
 * qui appartient au dépôt est lancé, testé et corrigé avec lui.
 *
 * Usage : `npm run externals:check` (ou `node scripts/check-externals.mjs [--json]`).
 * Sort 1 dès qu'un défaut ⛔ est constaté.
 */
import { readFileSync, existsSync, globSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Les trois familles de paquets bâtis du dépôt — le core INCLUS, les modules aussi. */
export function findConfigs(root) {
  return [
    ...globSync("src/nodefony/rolldown.config.ts", { cwd: root }),
    ...globSync("src/packages/@nodefony/*/rolldown.config.ts", { cwd: root }),
    ...globSync("src/modules/*/rolldown.config.ts", { cwd: root }),
  ].sort();
}

/**
 * Extrait la liste `external` quelle que soit son ÉCRITURE : la forme historique
 * `const external: string[] = [...]` et la forme courante, inline dans
 * `defineNodefonyRolldownConfig({ external: [...] })`. Ne reconnaître qu'une seule
 * des deux rend « tout est manquant » partout — du bruit que personne ne lit.
 */
export function readExternals(src) {
  const out = new Set();
  for (const re of [
    /const\s+external[^=]*=\s*\[([\s\S]*?)\]/,
    /external\s*:\s*\[([\s\S]*?)\]/,
  ]) {
    const m = src.match(re);
    if (m) for (const s of m[1].matchAll(/"([^"]+)"/g)) out.add(s[1]);
  }
  return out;
}

/** `externalDeps: true` externalise tout le manifeste → l'audit de dérive est sans objet. */
export function usesAutoExternals(src) {
  return /externalDeps\s*:\s*true/.test(src);
}

/**
 * Le paquet est-il importé par une source que le bundler VA suivre ?
 *
 * `from "x"` ne suffit pas : `reflect-metadata` s'importe pour son seul effet de bord
 * (`import "reflect-metadata";`), la forme la plus susceptible d'être avalée puisqu'elle
 * n'a aucune liaison. `require()` et l'import dynamique comptent aussi.
 *
 * @returns le chemin du premier fichier importateur, ou `null`.
 */
export function importedByServerCode(root, dir, dep) {
  const files = globSync(["index.ts", "nodefony/**/*.ts"], {
    cwd: path.join(root, dir),
  }).filter(
    (f) => !/(^|[/\\])tests?[/\\]/.test(f) && !/\.(test|spec|d)\.ts$/.test(f),
  );
  const q = dep.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");
  const re = new RegExp(
    `(?:from|import|require)\\s*\\(?\\s*["']${q}(/[^"']*)?["']`,
  );
  for (const f of files) {
    try {
      if (re.test(readFileSync(path.join(root, dir, f), "utf8"))) return f;
    } catch {
      /* fichier illisible : ne peut pas prouver l'import, on continue */
    }
  }
  return null;
}

/** Paquets tiers réellement recopiés dans un `dist/` — la preuve, sans hypothèse. */
export function bundledThirdParties(root, dir) {
  const dist = path.join(root, dir, "dist");
  const found = [];
  const walk = (p, depth = 0) => {
    if (depth > 6 || !existsSync(p)) return;
    for (const e of readdirSync(p, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const full = path.join(p, e.name);
      if (e.name === "node_modules") {
        for (const m of readdirSync(full, { withFileTypes: true })) {
          if (!m.isDirectory()) continue;
          if (m.name.startsWith("@")) {
            for (const sub of readdirSync(path.join(full, m.name)))
              found.push(`${m.name}/${sub}`);
          } else found.push(m.name);
        }
      } else walk(full, depth + 1);
    }
  };
  walk(dist);
  return [...new Set(found)].sort();
}

/** Audite un dépôt entier et rend le relevé brut (aucun affichage). */
export function auditRepo(root) {
  const report = [];
  for (const cfg of findConfigs(root)) {
    const dir = path.dirname(cfg);
    const pkgPath = path.join(root, dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const src = readFileSync(path.join(root, cfg), "utf8");
    const auto = usesAutoExternals(src);
    const ext = readExternals(src);
    const manifest = { ...pkg.dependencies, ...pkg.peerDependencies };
    const drift = [];
    if (!auto) {
      for (const dep of Object.keys(manifest).sort()) {
        if (ext.has(dep)) continue;
        const importedAt = importedByServerCode(root, dir, dep);
        drift.push({
          dep,
          importedAt,
          severity: importedAt ? "fault" : "info",
        });
      }
    }
    report.push({
      name: pkg.name,
      config: cfg,
      auto,
      drift,
      bundled: bundledThirdParties(root, dir),
      distExists: existsSync(path.join(root, dir, "dist")),
    });
  }
  const faults = report.reduce(
    (n, r) =>
      n +
      r.drift.filter((d) => d.severity === "fault").length +
      r.bundled.length,
    0,
  );
  return { faults, report };
}

/** Rend le rapport lisible. Séparé de la mesure pour rester testable. */
export function formatReport({ report }) {
  const out = [
    `configs auditées : ${report.length} (core + packages + modules)`,
    "",
  ];
  out.push("── 1. PREUVE — paquets tiers présents dans un dist ──");
  const bundled = report.filter((r) => r.bundled.length);
  if (bundled.length) {
    for (const r of bundled)
      out.push(`  ⛔ ${r.name} → ${r.bundled.join(", ")}`);
  } else out.push("  (aucun)");
  const noDist = report.filter((r) => !r.distExists).map((r) => r.name);
  if (noDist.length)
    out.push(`  ⚠️ sans dist, donc NON prouvés : ${noDist.join(", ")}`);

  out.push("", "── 2. DÉRIVE — manifeste hors `external` ──");
  let any = false;
  for (const r of report) {
    if (r.auto) continue;
    const bad = r.drift.filter((d) => d.severity === "fault");
    const info = r.drift.filter((d) => d.severity === "info");
    if (!bad.length && !info.length) continue;
    any = true;
    out.push(`  ${r.name}`);
    for (const d of bad)
      out.push(`     ⛔ ${d.dep} — importé par ${d.importedAt}`);
    if (info.length)
      out.push(
        `     ⚠️  jamais importé côté serveur : ${info.map((d) => d.dep).join(", ")}`,
      );
  }
  if (!any) out.push("  (aucune)");
  const autos = report.filter((r) => r.auto).map((r) => r.name);
  if (autos.length)
    out.push(
      "",
      `  (audit sans objet — externalDeps:true : ${autos.join(", ")})`,
    );
  return out.join("\n");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = auditRepo(process.cwd());
  console.log(
    process.argv.includes("--json")
      ? JSON.stringify(result, null, 2)
      : formatReport(result),
  );
  process.exit(result.faults ? 1 : 0);
}
