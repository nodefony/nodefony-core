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
import semver from "semver";

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
  // `replaceAll` et non `replace` : ce dernier ne remplace que la PREMIERE
  // occurrence. Un nom scopé n'en porte qu'une, mais un encodage partiel
  // reste un encodage faux — et rien ne le dirait.
  const url = `https://registry.npmjs.org/${name.replaceAll("/", "%2F")}/latest`;
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

// ── 3bis. Majeures BLOQUÉES EN AMONT — par qui, et depuis quand ────────────
//
// Une montée majeure impossible ne se voit qu'au moment où elle échoue : une
// pull request rouge de bout en bout, où `npm ci` casse AVANT le moindre test,
// pour une raison qui n'est pas la nôtre. Elle revient à chaque cycle, et un
// rouge permanent cesse d'être lu — c'est ainsi qu'un vrai rouge passe
// inaperçu.
//
// Le blocage est pourtant CONSTATABLE sans rien installer : un paquet du
// dépôt déclare une plage de pair qui exclut la version visée. On le NOMME
// ici, avec sa contrainte — et surtout, on dit quand le blocage TOMBE, ce
// qu'aucune pull request rouge ne saura jamais annoncer.
//
// Le champ est borné aux écarts MAJEURS : eux seuls justifient de parcourir
// l'arbre installé, et ce sont les seuls que le dépôt refuse de grouper.
const majeurs = rows.filter((r) => r.kind === "major");
const blocages = new Map();
if (majeurs.length) {
  const cibles = new Set(majeurs.map((r) => r.name));
  const racines = [path.join(ROOT, "node_modules")];
  for (const racine of racines) {
    let entrees = [];
    try {
      entrees = fs.readdirSync(racine, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entrees) {
      if (!e.isDirectory()) continue;
      const dossiers = e.name.startsWith("@")
        ? fs
            .readdirSync(path.join(racine, e.name), { withFileTypes: true })
            .filter((x) => x.isDirectory())
            .map((x) => path.join(e.name, x.name))
        : [e.name];
      for (const d of dossiers) {
        let pkg;
        try {
          pkg = JSON.parse(
            fs.readFileSync(path.join(racine, d, "package.json"), "utf8"),
          );
        } catch {
          continue;
        }
        const peers = pkg.peerDependencies ?? {};
        for (const cible of cibles) {
          const plage = peers[cible];
          if (!plage) continue;
          const visee = majeurs.find((r) => r.name === cible)?.latest;
          if (!visee || semver.satisfies(visee, plage)) continue;
          if (!blocages.has(cible)) blocages.set(cible, []);
          blocages.get(cible).push({
            par: `${pkg.name}@${pkg.version}`,
            plage,
          });
        }
      }
    }
  }
}
for (const r of majeurs) {
  const qui = blocages.get(r.name);
  if (!qui || qui.length === 0) {
    process.stdout.write(
      `\n✅ ${r.name} ${r.latest} : AUCUN pair installé ne s'y oppose — la montée majeure est jouable.\n`,
    );
    continue;
  }
  const uniques = [...new Map(qui.map((q) => [q.par, q])).values()];
  process.stdout.write(
    `\n⛔ ${r.name} ${r.latest} est BLOQUÉ EN AMONT — \`npm ci\` échouerait avant tout test :\n`,
  );
  for (const q of uniques.slice(0, 8)) {
    process.stdout.write(`     ${q.par} exige ${r.name} ${q.plage}\n`);
  }
  if (uniques.length > 8) {
    process.stdout.write(`     … et ${uniques.length - 8} autres\n`);
  }
  process.stdout.write(
    "     Rien à faire ici : la levée viendra de l'amont. Ce rapport le dira.\n",
  );
}

// ── 4. Pins DIVERGENTS — un même paquet déclaré différemment selon le site ──
//
// `wanted` porte déjà la matière (nom → spec → sites) : ce qui manquait était
// de la LIRE. Aucun `npm outdated` ne rend cette vue, et c'est pourtant elle qui
// nomme les deux pannes qu'on ne voit pas venir :
//
//  - un peer EXACT (`"8.2.1"` et non `">=8.2.0"`) fige la version chez le
//    consommateur : la moindre montée ailleurs fait échouer `npm install` par
//    ERESOLVE, ou pire, npm « override » le peer et l'arbre part en silence.
//    Vécu : 5 modules déclaraient `vite: "8.2.1"` en peer, la montée en 8.2.2
//    a bloqué net l'installation du dépôt entier.
//  - deux pins POSSÉDÉS qui divergent (`19.2.7` ici, `19.2.8` là) : npm
//    installera les deux, et rien ne le dira. C'est ainsi qu'un `@angular/core`
//    s'est retrouvé face à un compilateur d'une autre version.
//
// Une divergence peer-plancher vs dev-exact (`>=6.0.0` / `^6.1.0`) est en
// revanche le pattern JUSTE : elle n'est signalée qu'en `--strict`.
const PEER = "#peerDependencies";
const divergent = [];
for (const [name, specs] of wanted) {
  if (specs.size < 2) continue;
  const entries = [...specs.entries()].map(([spec, sites]) => ({
    spec,
    sites,
  }));
  const owned = entries.filter((e) => e.sites.some((s) => !s.endsWith(PEER)));
  const exactPeer = entries.filter(
    (e) => e.sites.every((s) => s.endsWith(PEER)) && isExactPin(e.spec),
  );
  // Comparer les VERSIONS, pas les chaînes : `2.7.0` et `^2.7.0` désignent la
  // même version, les signaler serait le bruit qui fait cesser de lire le
  // rapport. Seule une base différente est une divergence.
  const ownedSpecs = new Set(owned.map((e) => baseVersion(e.spec) ?? e.spec));
  let severity = null;
  if (exactPeer.length) severity = "PEER-EXACT";
  else if (ownedSpecs.size > 1) severity = "DIVERGENT";
  else if (STRICT) severity = "peer/dev";
  if (severity) divergent.push({ name, severity, entries });
}

if (divergent.length) {
  const bad = divergent.filter((d) => d.severity !== "peer/dev");
  process.stdout.write(
    `\n${bad.length ? "⚠️  " : ""}${divergent.length} paquet(s) déclaré(s) de plusieurs façons :\n`,
  );
  for (const d of divergent) {
    process.stdout.write(`\n  [${d.severity}] ${d.name}\n`);
    for (const e of d.entries) {
      for (const site of e.sites) {
        process.stdout.write(`      ${String(e.spec).padEnd(14)} ${site}\n`);
      }
    }
  }
  if (bad.some((d) => d.severity === "PEER-EXACT")) {
    process.stdout.write(
      "\n  PEER-EXACT : un peerDependency exprime un PLANCHER (`>=x.y.z`).\n" +
        "  Figé à une version, il casse l'installation dès qu'un autre site monte.\n",
    );
  }
  if (!STRICT) {
    process.stdout.write(
      "\n  Les couples peer-plancher / dev-exact (le pattern juste) sont masqués — `--strict` pour les voir.\n",
    );
  }
}

if (failed.length) {
  process.stderr.write(
    `\n⚠️ ${failed.length} paquets non résolus (privés, retirés, ou réseau) :\n  ${failed.join("\n  ")}\n`,
  );
}
