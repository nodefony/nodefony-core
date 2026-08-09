#!/usr/bin/env node
/**
 * Inventaire EXHAUSTIF des dépendances en retard — remplaçant de `npm outdated`.
 *
 * Pourquoi un automate maison plutôt qu'un drapeau de npm : `npm outdated`
 * SOUS-COMPTE, constaté trois fois sur ce dépôt. Il a rendu 5 paquets là où
 * Dependabot en voyait 9 ; puis `--workspaces --include-workspace-root` a
 * manqué les dépendances de la RACINE (`turbo`, `typescript`,
 * `@angular/compiler-cli`) — dont une incohérence CRÉÉE par une montée
 * précédente (`@angular/core` en 22.1.1 face à un compilateur resté en 22.1.0)
 * qu'aucun outil ne signalait.
 *
 * La méthode est bête et complète : lire les pins de TOUS les `package.json`
 * VERSIONNÉS (`git ls-files`, donc jamais `node_modules`), puis demander au
 * registre la version courante de chacun. Exhaustif, reproductible, gratuit.
 *
 * Ce que le rapport distingue, parce que la conduite à tenir diffère :
 *  - `EXACT`  — pin littéral (`"8.2.0"`) : `npm update` n'y touche PAS, il faut
 *    réécrire le manifeste. C'est le gros du dépôt.
 *  - `RANGE`  — plage (`^`, `~`) satisfaite par la dernière version : elle
 *    montera seule au prochain `npm install`, rien à faire.
 *  - `RANGE!` — plage QUE la dernière version ne satisfait plus (typiquement
 *    une majeure) : invisible à l'install, c'est une décision à prendre.
 *
 * ⚠️ Un pin n'est pas ce qui est INSTALLÉ. Une plage `^19.2.7` reste écrite
 * telle quelle alors que le verrou porte déjà 19.2.8 : la signaler comme un
 * retard est un faux positif, et un rapport bruyant finit par ne plus être lu.
 * La colonne `LOCK` rend donc la ou les versions réellement résolues dans
 * `package-lock.json` ; `--strict` seul remonte les plages déjà satisfaites.
 *
 * Sont ignorés : `workspace:`/`file:`/`link:` (locaux), `*`/`latest` (sans
 * opinion), et le paquet `nodefony` lui-même — le registre publie un v7 public
 * quand ce monorepo EST nodefony 10 en développement.
 *
 * Usage :
 *   node scripts/check-deps-latest.mjs            # écarts RÉELS (lock à l'appui)
 *   node scripts/check-deps-latest.mjs --strict   # + plages déjà satisfaites
 *   node scripts/check-deps-latest.mjs --all      # + les pins déjà à jour
 *   node scripts/check-deps-latest.mjs --json     # sortie machine
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = new Set(process.argv.slice(2));
const SHOW_ALL = ARGS.has("--all");
const STRICT = ARGS.has("--strict") || SHOW_ALL;
const AS_JSON = ARGS.has("--json");

/** Paquets dont la version du registre ne dit rien d'utile ici. */
const IGNORED = new Set(["nodefony"]);

const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/** Un spécificateur qu'on ne sait pas comparer à une version publiée. */
const isLocal = (spec) =>
  /^(workspace:|file:|link:|git|https?:|npm:.*@(workspace|file))/.test(spec);
const isOpen = (spec) => spec === "*" || spec === "latest" || spec === "";

/** `^8.2.0` → `8.2.0` ; `8.2.0` → `8.2.0` ; `>=1 <3` → null (non comparable). */
function baseVersion(spec) {
  const m = /^[\^~]?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(spec.trim());
  return m ? m[1] : null;
}

const isExactPin = (spec) =>
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(spec.trim());

/** Comparaison semver suffisante ici : le registre ne rend que du semver valide. */
function cmp(a, b) {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  // Une préversion est ANTÉRIEURE à la version finale du même numéro.
  const qa = a.includes("-");
  const qb = b.includes("-");
  if (qa !== qb) return qa ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

/** major / minor / patch — l'ampleur décide de la conduite à tenir. */
function bumpKind(from, to) {
  const [fa, fb] = from.split("-")[0].split(".").map(Number);
  const [ta, tb] = to.split("-")[0].split(".").map(Number);
  if (fa !== ta) return "major";
  if (fb !== tb) return "minor";
  return "patch";
}

/** `^8.2.0` accepte-t-il `to` ? `~` et exact traités de même. */
function rangeAccepts(spec, to) {
  const s = spec.trim();
  const base = baseVersion(s);
  if (!base) return null; // plage complexe : on ne tranche pas
  if (cmp(to, base) < 0) return true;
  const [ba, bb] = base.split("-")[0].split(".").map(Number);
  const [ta, tb] = to.split("-")[0].split(".").map(Number);
  if (s.startsWith("^")) {
    // ^0.x.y verrouille la mineure (règle semver des versions 0).
    if (ba === 0) return ta === 0 && tb === bb;
    return ta === ba;
  }
  if (s.startsWith("~")) return ta === ba && tb === bb;
  return cmp(to, base) === 0;
}

// ── 1. Récolter les pins de tous les manifestes VERSIONNÉS ──────────────────

const manifests = execFileSync("git", ["ls-files", "*package.json"], {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\n")
  .filter((f) => f && !f.includes("node_modules/"));

/** pkg → { specs: Map<spec, sites[]> } */
const wanted = new Map();

for (const rel of manifests) {
  let json;
  try {
    json = JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  } catch {
    continue; // un gabarit de scaffold peut porter des jetons non-JSON
  }
  for (const field of DEP_FIELDS) {
    for (const [name, spec] of Object.entries(json[field] ?? {})) {
      if (typeof spec !== "string") continue;
      if (IGNORED.has(name) || isLocal(spec) || isOpen(spec)) continue;
      if (!wanted.has(name)) wanted.set(name, new Map());
      const specs = wanted.get(name);
      if (!specs.has(spec)) specs.set(spec, []);
      specs.get(spec).push(`${rel}#${field}`);
    }
  }
}

// ── 1 bis. Ce que le VERROU a réellement résolu ─────────────────────────────
// `packages` indexe par chemin d'installation ; un même paquet peut y figurer
// plusieurs fois (copies imbriquées, conflits de plages) — on les garde TOUTES,
// une seule copie en retard suffit à faire mentir « c'est à jour ».

/** pkg → { hoisted: version|null, all: Set<version> } */
const installed = new Map();
try {
  const lock = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"),
  );
  for (const [where, entry] of Object.entries(lock.packages ?? {})) {
    if (!where.includes("node_modules/") || !entry?.version) continue;
    if (entry.link) continue; // lien vers un workspace : version locale
    const name = where.slice(where.lastIndexOf("node_modules/") + 13);
    if (!installed.has(name))
      installed.set(name, { hoisted: null, all: new Set() });
    const rec = installed.get(name);
    rec.all.add(entry.version);
    // La copie REMONTÉE en tête d'arbre est celle que résout un `import` du
    // dépôt ; les copies imbriquées appartiennent à d'autres dépendances et
    // les confondre fait accuser un paquet du retard d'un tiers.
    if (where === `node_modules/${name}`) rec.hoisted = entry.version;
  }
} catch {
  // pas de verrou lisible : la colonne restera vide, le reste tient debout
}

/** Ce que le dépôt résout réellement, et le signe qu'il en existe plusieurs. */
function resolvedInstall(name) {
  const rec = installed.get(name);
  if (!rec || rec.all.size === 0) return null;
  const v = rec.hoisted ?? [...rec.all].sort(cmp).at(-1);
  return rec.all.size > 1 ? `${v} (+${rec.all.size - 1})` : v;
}

// ── 2. Demander au registre la version courante de chacun ───────────────────

const names = [...wanted.keys()].sort();
if (!AS_JSON) {
  process.stderr.write(
    `${names.length} paquets distincts dans ${manifests.length} manifestes versionnés — interrogation du registre…\n`,
  );
}

const latest = new Map();
const failed = [];
const CONCURRENCY = 16;

async function fetchOne(name) {
  const url = `https://registry.npmjs.org/${name.replace("/", "%2F")}/latest`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      failed.push(`${name}: HTTP ${res.status}`);
      return;
    }
    const body = await res.json();
    if (body?.version) latest.set(name, body.version);
  } catch (e) {
    failed.push(`${name}: ${e.message}`);
  }
}

for (let i = 0; i < names.length; i += CONCURRENCY) {
  await Promise.all(names.slice(i, i + CONCURRENCY).map(fetchOne));
}

// ── 3. Comparer ─────────────────────────────────────────────────────────────

const rows = [];
for (const name of names) {
  const cur = latest.get(name);
  if (!cur) continue;
  for (const [spec, sites] of wanted.get(name)) {
    const base = baseVersion(spec);
    if (!base) {
      rows.push({
        name,
        spec,
        latest: cur,
        lock: resolvedInstall(name) ?? "—",
        kind: "?",
        mode: "COMPLEX",
        sites,
      });
      continue;
    }
    const behind = cmp(base, cur) < 0;
    if (!behind && !SHOW_ALL) continue;
    const exact = isExactPin(spec);
    const accepts = rangeAccepts(spec, cur);
    const mode = !behind
      ? "OK"
      : exact
        ? "EXACT"
        : accepts
          ? "RANGE"
          : "RANGE!";
    const lock = resolvedInstall(name);
    // Une plage que le verrou a DÉJÀ hissée à la dernière version n'est pas un
    // retard : le manifeste dit un plancher, pas une version.
    const settled = mode === "RANGE" && lock != null && cmp(lock, cur) >= 0;
    if (settled && !STRICT) continue;
    rows.push({
      name,
      spec,
      latest: cur,
      lock: lock ?? "—",
      kind: behind ? bumpKind(base, cur) : "—",
      mode: settled ? "RANGE✓" : mode,
      sites,
    });
  }
}

/** Le dénominateur honnête : chaque couple (paquet, spécificateur) déclaré. */
const totalPins = [...wanted.values()].reduce((n, specs) => n + specs.size, 0);

const ORDER = { major: 0, minor: 1, patch: 2, "?": 3, "—": 4 };
rows.sort(
  (a, b) => ORDER[a.kind] - ORDER[b.kind] || a.name.localeCompare(b.name),
);

if (AS_JSON) {
  process.stdout.write(
    `${JSON.stringify({ rows, failed, scanned: names.length }, null, 2)}\n`,
  );
  process.exit(0);
}

const behindRows = rows.filter((r) => r.mode !== "OK");
if (behindRows.length === 0) {
  process.stdout.write("Tous les pins sont à jour.\n");
} else {
  const w = (s, n) => String(s).padEnd(n);
  process.stdout.write(
    `\n${w("KIND", 6)}${w("MODE", 8)}${w("PAQUET", 38)}${w("PIN", 14)}${w("LOCK", 14)}${w("LATEST", 14)}SITES\n`,
  );
  process.stdout.write(`${"─".repeat(118)}\n`);
  for (const r of behindRows) {
    const sites = r.sites.length === 1 ? r.sites[0] : `${r.sites.length} sites`;
    process.stdout.write(
      `${w(r.kind, 6)}${w(r.mode, 8)}${w(r.name, 38)}${w(r.spec, 14)}${w(r.lock, 14)}${w(r.latest, 14)}${sites}\n`,
    );
  }
  const by = (k) => behindRows.filter((r) => r.kind === k).length;
  process.stdout.write(
    `\n${behindRows.length} écarts à décider sur ${totalPins} pins déclarés — ${by("major")} major, ${by("minor")} minor, ${by("patch")} patch.\n`,
  );
  if (!STRICT) {
    process.stdout.write(
      "Les plages déjà hissées par le verrou sont masquées — `--strict` pour les voir.\n",
    );
  }
}

if (failed.length) {
  process.stderr.write(
    `\n⚠️ ${failed.length} paquets non résolus (privés, retirés, ou réseau) :\n  ${failed.join("\n  ")}\n`,
  );
}
