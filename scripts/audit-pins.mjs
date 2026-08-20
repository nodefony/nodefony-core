#!/usr/bin/env node
/**
 * Audit des versions déclarées, tous `package.json` VERSIONNÉS du dépôt.
 *
 * Pourquoi un script plutôt que `npm outdated` : `npm outdated --workspaces
 * --include-workspace-root` ne montre PAS les dépendances de la RACINE (vécu :
 * « 0 périmé » pendant que `turbo` et `typescript` attendaient). Tant qu'on
 * cherche le bon drapeau, on reste tributaire de ce que l'outil choisit de
 * montrer. Ici la matière est lue au source — les pins écrits dans les fichiers
 * — et confrontée au registre, paquet par paquet.
 *
 * Rend aussi ce qu'aucune commande npm ne rend : les paquets déclarés à
 * PLUSIEURS endroits avec des pins DIVERGENTS (monter l'un sans les autres crée
 * une incohérence qu'aucun outil ne signale).
 *
 * Usage : node scripts/audit-pins.mjs [--json] [--only-major] [--include-prerelease]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const args = new Set(process.argv.slice(2));
const AS_JSON = args.has("--json");
const ONLY_MAJOR = args.has("--only-major");
const WITH_PRERELEASE = args.has("--include-prerelease");

const FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/** Fichiers `package.json` suivis par git, hors `node_modules` et gabarits. */
function manifests() {
  const out = execFileSync("git", ["ls-files", "*package.json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split("\n")
    .filter(Boolean)
    .filter((p) => !p.includes("node_modules/"))
    .filter((p) => !p.includes("/templates/") && !p.includes("/scaffold/"));
}

/** Le pin déclaré, ramené à une version comparable (`^1.2.3` → `1.2.3`). */
function baseVersion(range) {
  const m = /^[\^~>=<\s]*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(range ?? "");
  return m ? m[1] : null;
}

function cmp(a, b) {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  // égalité de noyau : une préversion est ANTÉRIEURE à la version stable
  const ra = a.includes("-"),
    rb = b.includes("-");
  if (ra !== rb) return ra ? -1 : 1;
  return 0;
}

function jump(from, to) {
  const [aM, am] = from.split("-")[0].split(".").map(Number);
  const [bM, bm] = to.split("-")[0].split(".").map(Number);
  if (bM !== aM) return "major";
  if (bm !== am) return "minor";
  return "patch";
}

// ── Collecte des pins déclarés ───────────────────────────────────────────────
const declared = new Map(); // nom -> [{ range, base, site, field }]
for (const rel of manifests()) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  } catch {
    console.error(`illisible, ignoré : ${rel}`);
    continue;
  }
  for (const field of FIELDS) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (typeof range !== "string") continue;
      if (name.startsWith("@nodefony/")) continue; // versions internes
      if (/^(workspace|file|link|git|https?):/.test(range)) continue;
      if (range === "*" || range === "latest") continue;
      const base = baseVersion(range);
      if (!base) continue;
      if (!declared.has(name)) declared.set(name, []);
      declared.get(name).push({ range, base, site: rel, field });
    }
  }
}

// ── Interrogation du registre (concurrence bornée) ───────────────────────────
async function distTags(name) {
  const url = `https://registry.npmjs.org/-/package/${name.replace("/", "%2f")}/dist-tags`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        try {
          out[k] = await fn(items[k]);
        } catch (e) {
          out[k] = { error: String(e.message ?? e) };
        }
      }
    }),
  );
  return out;
}

const names = [...declared.keys()].sort();
process.stderr.write(
  `${names.length} paquets déclarés dans ${manifests().length} manifestes — interrogation du registre…\n`,
);
const tags = await mapLimit(names, 12, async (n) => ({
  name: n,
  ...(await distTags(n)),
}));

// ── Verdict ──────────────────────────────────────────────────────────────────
const rows = [];
const divergent = [];
const failed = [];
for (const t of tags) {
  if (t.error) {
    failed.push({ name: t.name, error: t.error });
    continue;
  }
  const sites = declared.get(t.name);
  // Les `peerDependencies` sont des PLANCHERS volontaires (« au moins cette
  // version »), pas des pins en retard : les monter est une rupture pour le
  // consommateur, pas une mise à jour. Elles ne portent donc pas le verdict —
  // mais restent dans la détection de divergence, où elles disent quelque chose.
  const owned = sites.filter((s) => s.field !== "peerDependencies");
  const bases = [...new Set(owned.map((s) => s.base))];
  const allBases = [...new Set(sites.map((s) => s.base))];
  if (allBases.length > 1) divergent.push({ name: t.name, sites });
  const latest = t.latest;
  if (!latest || bases.length === 0) continue;
  if (!WITH_PRERELEASE && latest.includes("-")) continue;
  // le site le PLUS EN RETARD porte le verdict
  const oldest = bases.slice().sort(cmp)[0];
  if (cmp(oldest, latest) >= 0) continue;
  rows.push({
    name: t.name,
    declared: oldest,
    latest,
    jump: jump(oldest, latest),
    sites: owned.map((s) => ({ site: s.site, field: s.field, range: s.range })),
  });
}

const order = { major: 0, minor: 1, patch: 2 };
rows.sort(
  (a, b) => order[a.jump] - order[b.jump] || a.name.localeCompare(b.name),
);
const shown = ONLY_MAJOR ? rows.filter((r) => r.jump === "major") : rows;

if (AS_JSON) {
  console.log(JSON.stringify({ outdated: shown, divergent, failed }, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  const w = Math.max(12, ...shown.map((r) => r.name.length));
  console.log(
    `\n${pad("PAQUET", w)}  ${pad("DÉCLARÉ", 12)} ${pad("REGISTRE", 12)} SAUT   SITES`,
  );
  console.log("-".repeat(w + 46));
  for (const r of shown) {
    console.log(
      `${pad(r.name, w)}  ${pad(r.declared, 12)} ${pad(r.latest, 12)} ${pad(r.jump, 6)} ${r.sites.length}`,
    );
  }
  const n = (k) => rows.filter((r) => r.jump === k).length;
  console.log(
    `\n${rows.length} périmés — ${n("major")} major · ${n("minor")} minor · ${n("patch")} patch` +
      `  (sur ${names.length} paquets, ${manifests().length} manifestes)`,
  );
  if (divergent.length) {
    console.log(
      `\n⚠️  ${divergent.length} paquets déclarés avec des pins DIVERGENTS :`,
    );
    for (const d of divergent) {
      console.log(`  ${d.name}`);
      for (const s of d.sites)
        console.log(`      ${s.range.padEnd(14)} ${s.site} (${s.field})`);
    }
  }
  if (failed.length) {
    console.log(`\n❌ ${failed.length} non résolus au registre :`);
    for (const f of failed) console.log(`  ${f.name} — ${f.error}`);
  }
}
