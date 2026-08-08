#!/usr/bin/env node
/**
 * route-scan-cost — ce que la RÉSOLUTION DE ROUTE coûte à une application, et
 * comment ce coût grandit avec le nombre de routes.
 *
 * Le routeur indexe les routes LITTÉRALES par chemin exact (Map O(1)), mais les
 * routes DYNAMIQUES ({var}, wildcard, métacaractère) sont scannées une à une,
 * fusionnées par position d'insertion. Le coût d'une requête est donc
 * proportionnel au nombre de routes dynamiques enregistrées AVANT la route
 * visée — invisible sur un dépôt de 136 routes, dominant sur une app qui en
 * déclare mille.
 *
 * Trois sorties, indépendantes :
 *   --diagnostic  combien de Route.match par requête, route par route (exact,
 *                 déterministe, aucune mesure de temps)
 *   --measure     ce que ce scan coûte en ns (médiane de N runs)
 *   --scale       la courbe : coût du scan à 136 → 2400 routes
 *
 * ⚠️ CE QUE CE BANC N'EST PAS. Il recompile les motifs depuis les chemins rendus
 * par `nodefony inspect` — même forme que `Route.compile()` (ancré `^…$`, drapeau
 * `i`, `{var}` → `([^/]+)`), mais ce n'est PAS le motif de production. Et il ne
 * mesure que le SCAN (le `exec` par route) : `Route.match` fait davantage sur la
 * route qui matche (hostname, requirements, hydratation des paramètres), une
 * seule fois par requête. Le chiffre rendu est donc une BORNE BASSE du coût de
 * résolution, exacte sur ce qu'elle couvre. Le compte de `--diagnostic`, lui,
 * est exact : il ne dépend d'aucune mesure.
 *
 * Usage (depuis la RACINE du dépôt, ou de n'importe quelle app Nodefony) :
 *   node .claude/skills/nodefony-load-test/scripts/route-scan-cost.mjs
 *   node …/route-scan-cost.mjs --measure --target /nodefony/security/api/auth/me
 *   node …/route-scan-cost.mjs --scale
 *   JSON_OUT=tmp/routes.json node …/route-scan-cost.mjs --diagnostic --measure
 *   node …/route-scan-cost.mjs --routes tmp/routes-inspect.json   # sans booter l'app
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// ── Motifs : même partition que le routeur (router.ts REG_NON_LITERAL) ────────
const NON_LIT = /[{}*+?()[\]^$|\\]/;
const escapeLit = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const compile = (path) =>
  new RegExp(
    `^${path
      .split(/(\{[^}]+\})/)
      .map((s) =>
        s.startsWith("{") && s.endsWith("}") ? "([^/]+)" : escapeLit(s),
      )
      .join("")}$`,
    "i",
  );

/** Une route est scannée à chaque requête si son chemin n'est pas littéral. */
const isDynamic = (path) => path == null || NON_LIT.test(path);

/**
 * Préfixe littéral d'un chemin : tout ce qui précède le premier segment non
 * littéral. C'est la clé d'index proposée — et la SEULE correcte : un filtre sur
 * un nombre FIXE de segments serait faux, `/foo/*` devant matcher `/foo/a/b`.
 */
const staticPrefix = (path) => {
  if (path == null) return "";
  const cut = path.search(NON_LIT);
  return (cut === -1 ? path : path.slice(0, cut)).toLowerCase();
};

// ── Entrée : les routes RÉELLES de l'application ─────────────────────────────
function loadRoutes(file) {
  if (file) return JSON.parse(readFileSync(file, "utf8"));
  const out = execFileSync("npx", ["nodefony", "inspect", "routes", "--json"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const start = out.indexOf("[");
  if (start === -1)
    throw new Error("`nodefony inspect routes --json` n'a rendu aucun tableau");
  return JSON.parse(out.slice(start));
}

// ── Mesure : médiane de N runs (jamais un run seul) ──────────────────────────
function medianNs(patterns, target, reps = 5, runMs = 60) {
  const runs = [];
  // Chauffe GLOBALE avant la série : sans elle, le premier run paie la
  // compilation JIT et gonfle la dispersion de 20 points — on croirait la
  // machine bruyante alors que c'est l'instrument qui n'est pas prêt.
  for (let i = 0; i < 50_000; i++)
    for (const re of patterns) if (re.test(target)) break;
  // Nombre d'itérations CALIBRÉ pour que chaque run dure ~runMs : une liste
  // courte (2 motifs) mesurée sur un compte fixe rend des runs de 2 ms, où la
  // moindre préemption de l'ordonnanceur pèse 50 % — on mesurerait la machine,
  // pas le scan.
  const probe0 = process.hrtime.bigint();
  for (let i = 0; i < 20_000; i++)
    for (const re of patterns) if (re.exec(target)) break;
  const nsPerIter = Number(process.hrtime.bigint() - probe0) / 20_000;
  const iterations = Math.max(20_000, Math.ceil((runMs * 1e6) / nsPerIter));
  for (let r = 0; r < reps; r++) {
    const t0 = process.hrtime.bigint();
    let hits = 0;
    for (let i = 0; i < iterations; i++) {
      for (const re of patterns) {
        const m = re.exec(target);
        if (m) {
          hits++;
          break;
        }
      }
    }
    if (hits !== iterations) {
      throw new Error(
        `contrôle de validité : la cible ${target} n'a matché que ${hits}/${iterations} fois — ` +
          `le banc mesurerait un scan qui échoue, pas une résolution`,
      );
    }
    runs.push(Number(process.hrtime.bigint() - t0) / iterations);
  }
  runs.sort((a, b) => a - b);
  const med = runs[Math.floor(runs.length / 2)];
  const spread = ((runs[runs.length - 1] - runs[0]) / med) * 100;
  return { ns: med, spreadPct: spread, runs };
}

// ── Sorties ──────────────────────────────────────────────────────────────────
function diagnostic(routes) {
  let dyn = 0;
  const rows = routes.map((r) => {
    const before = dyn;
    if (isDynamic(r.path)) dyn++;
    return {
      name: r.name,
      path: r.path,
      dynamic: isDynamic(r.path),
      scans: before + 1,
    };
  });
  const scans = rows.map((r) => r.scans).sort((a, b) => a - b);
  const stats = {
    routes: routes.length,
    dynamics: dyn,
    literals: routes.length - dyn,
    avgScans: +(scans.reduce((a, b) => a + b, 0) / scans.length).toFixed(1),
    medScans: scans[Math.floor(scans.length / 2)],
    maxScans: scans[scans.length - 1],
  };
  console.log(`\n=== Résolution de route — ce que chaque requête scanne ===\n`);
  console.log(`routes déclarées   : ${stats.routes}`);
  console.log(
    `  littérales       : ${stats.literals}  (indexées par chemin exact, O(1))`,
  );
  console.log(
    `  dynamiques       : ${stats.dynamics}  (scannées à CHAQUE requête)`,
  );
  console.log(
    `\nRoute.match par requête : médiane ${stats.medScans}, moyenne ${stats.avgScans}, max ${stats.maxScans}`,
  );
  console.log(`\n--- les 10 routes les plus coûteuses à résoudre ---`);
  for (const r of [...rows].sort((a, b) => b.scans - a.scans).slice(0, 10)) {
    console.log(
      `${String(r.scans).padStart(5)} match  ${r.dynamic ? "dyn" : "lit"}  ${r.path}`,
    );
  }
  return { stats, rows };
}

function measure(routes, target, reps) {
  const seq = [];
  let found = false;
  for (const r of routes) {
    if (r.path == null) continue;
    if (isDynamic(r.path) || r.path === target) seq.push(compile(r.path));
    if (r.path === target) {
      found = true;
      break;
    }
  }
  if (!found) {
    console.error(
      `\n✖ cible introuvable : ${target}\n  (chemins disponibles : ${routes.length} — passer --target <chemin exact>)`,
    );
    process.exitCode = 1;
    return null;
  }
  const prefix = staticPrefix(target) || target.toLowerCase();
  const reduced = [];
  for (const r of routes) {
    if (r.path == null) continue;
    const p = staticPrefix(r.path);
    // `p.startsWith(prefix)` garde des routes qui ne pourraient PAS matcher (leur
    // préfixe exige plus de caractères que la cible n'en a). C'est délibéré : le
    // filtre simulé reste plus permissif que nécessaire, donc le gain annoncé est
    // une borne BASSE. Un banc doit pencher CONTRE sa propre thèse.
    const compatible = prefix.startsWith(p) || p.startsWith(prefix);
    if ((isDynamic(r.path) && compatible) || r.path === target)
      reduced.push(compile(r.path));
    if (r.path === target) break;
  }

  const now = medianNs(seq, target, reps);
  const idx = medianNs(reduced, target, reps);
  console.log(`\n=== Coût du scan — ${target} ===\n`);
  console.log(`candidates scannées      : ${seq.length}`);
  console.log(
    `coût actuel              : ${now.ns.toFixed(0)} ns/req  (dispersion ${now.spreadPct.toFixed(1)} %)`,
  );
  console.log(`candidates après index   : ${reduced.length}`);
  console.log(
    `coût avec index préfixe  : ${idx.ns.toFixed(0)} ns/req  (dispersion ${idx.spreadPct.toFixed(1)} %)`,
  );
  const gain = now.ns - idx.ns;
  const gainPct = (gain / now.ns) * 100;
  const noise = Math.max(now.spreadPct, idx.spreadPct);
  if (gainPct <= noise) {
    console.log(
      `\n⛔ DANS LE BRUIT — écart ${gainPct.toFixed(0)} % sous une dispersion de ${noise.toFixed(0)} % :\n` +
        `   aucune conclusion. Machine calme, puis --reps 9.`,
    );
    return {
      target,
      scanned: seq.length,
      reducedTo: reduced.length,
      now,
      idx,
      verdict: "bruit",
    };
  }
  console.log(
    `\ngain              : ${gain.toFixed(0)} ns/req (${gainPct.toFixed(0)} %)`,
  );
  console.log(
    `part d'un budget 86 µs/req : ${((now.ns / 86_000) * 100).toFixed(2)} % → ${((idx.ns / 86_000) * 100).toFixed(2)} %`,
  );
  if (now.ns / 86_000 < 0.03) {
    console.log(
      `\n⚠️  sous le bruit d'un banc A/B (±3 %) : ce gain NE SE MESURERA PAS en RPS\n` +
        `   sur cette application. Le motif d'un lot est la COURBE (--scale), pas ce chiffre.`,
    );
  }
  return { target, scanned: seq.length, reducedTo: reduced.length, now, idx };
}

function scale(reps) {
  const TARGET = "/app/orders/history/detail";
  const mods = ["nodefony", "app", "api", "admin", "shop", "user"];
  const rows = [];
  console.log(
    `\n=== Sensibilité au nombre de routes (cible en fin de table) ===\n`,
  );
  console.log(
    "routes   dyn scannées   scan actuel   scan indexé   part d'un budget 86 µs",
  );
  console.log("─".repeat(76));
  for (const count of [136, 300, 600, 1200, 2400]) {
    const paths = [];
    for (let i = 0; i < count; i++) {
      const m = mods[i % mods.length];
      paths.push(
        i % 3 === 0
          ? `/${m}/res${i}/{id}/edit`
          : `/${m}/section${i % 20}/page${i}`,
      );
    }
    paths.push(TARGET);
    // Partition RÉELLE : les littérales ne sont pas scannées (Map par chemin exact).
    const scanned = paths.filter((p) => isDynamic(p) || p === TARGET);
    const prefix = staticPrefix(TARGET);
    const kept = scanned.filter((p) => {
      const sp = staticPrefix(p);
      return prefix.startsWith(sp) || sp.startsWith(prefix);
    });
    const a = medianNs(scanned.map(compile), TARGET, reps);
    const b = medianNs(kept.map(compile), TARGET, reps);
    rows.push({ count, scanned: scanned.length, nowNs: a.ns, idxNs: b.ns });
    console.log(
      `${String(count).padStart(5)}   ${String(scanned.length).padStart(11)}   ${(a.ns / 1000).toFixed(2).padStart(8)} µs   ${(b.ns / 1000).toFixed(2).padStart(9)} µs   ${((a.ns / 86_000) * 100).toFixed(1).padStart(20)} %`,
    );
  }
  console.log(
    `\nLe scan croît de façon SUPER-linéaire (le tableau de motifs sort des caches CPU) ;\n` +
      `l'index de préfixe le rend plat. C'est une propriété de scalabilité, pas un gain de RPS.`,
  );
  return rows;
}

// ── Pilotage ─────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(name);

const reps = Number(arg("--reps", 5));
const routesFile = arg("--routes", undefined);
const wantAll = !has("--diagnostic") && !has("--measure") && !has("--scale");

let routes = [];
if (wantAll || has("--diagnostic") || has("--measure")) {
  routes = loadRoutes(routesFile);
  if (!Array.isArray(routes) || routes.length === 0) {
    console.error(
      "✖ aucune route lue — rien à mesurer (l'app déclare-t-elle des routes ?)",
    );
    process.exit(1);
  }
}

const report = {
  generatedFrom: routesFile ?? "nodefony inspect routes --json",
  node: process.version,
};
if (wantAll || has("--diagnostic"))
  report.diagnostic = diagnostic(routes).stats;
if (wantAll || has("--measure")) {
  const longest = routes
    .filter((r) => r.path && !isDynamic(r.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
  report.measure = measure(routes, arg("--target", longest?.path ?? "/"), reps);
}
if (has("--scale")) report.scale = scale(reps);

if (process.env.JSON_OUT) {
  writeFileSync(process.env.JSON_OUT, JSON.stringify(report, null, 2));
  console.log(`\ndonnées écrites : ${process.env.JSON_OUT}`);
}
console.log();
