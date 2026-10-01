// ─────────────────────────────────────────────────────────────────────────────
// Compose `docs/performance/data/<version>.json` depuis le dossier d'une campagne
// (`perf-campaign.sh`) — les CHIFFRES, jamais le récit.
//
// Pourquoi un composeur. Le fichier publié a toujours été assemblé à la main :
// copier deux séries par camp, recalculer une médiane, recopier un rapport lu
// dans un journal. Chaque recopie est une occasion de publier le chiffre d'une
// autre paire, d'un autre essai ou d'un autre commit — et rien ne le voit, le
// JSON reste valide. Ici, chaque nombre se lit dans le fichier brut que le banc
// a écrit, et la provenance se lit dans le journal de la campagne.
//
// Ce qu'il réécrit : `provenance` (date, commit, Node, protocole), les mesures
// de `comparison`, d'`applicative`, le bloc `applicativeNest`, `cpuThread`, et
// `soak` si `--soak` est donné. Ce qu'il NE touche PAS : les blocs de récit
// (`why`, `equite`, `cause`, `notMeasured`…), qui restent un geste d'auteur.
//
// Usage :
//   node perf-compose.mjs --campaign tmp/perf-campaign-<date> \
//     --data docs/performance/data/10.0.0.json [--version <v>] \
//     [--soak <soak.json>] [--reuse <étape>=<dossier>]… [--write]
// Sans `--write`, rend le récapitulatif SANS écrire : on montre les chiffres
// avant de les publier.
//
// `--reuse <étape>=<dossier>` : une paire mesurée HORS de la campagne (même
// code, autre séance). Le dossier porte les séries brutes ET un `meta.json`
// `{commit, measuredAt, source, camps:[A,B], rapportPct, separation}` — la
// pièce garde SA provenance dans le fichier publié, elle n'emprunte pas celle
// de la campagne.
//
// Codes : 0 composé · 1 pièce manquante ou illisible · 64 usage.
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const all = (n) =>
  argv.flatMap((a, i) => (a === `--${n}` && argv[i + 1] ? [argv[i + 1]] : []));

const CAMPAIGN = opt("campaign");
const DATA = opt("data");
if (!CAMPAIGN || !DATA) {
  console.error(
    "usage : perf-compose.mjs --campaign <dir> --data <json> [--write]",
  );
  process.exit(64);
}
const REUSE = Object.fromEntries(
  all("reuse").map((r) => {
    const [k, ...v] = r.split("=");
    return [k, v.join("=")];
  }),
);

const missing = [];
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// ── provenance : lue dans le journal, jamais dans l'arbre courant ────────────
const log = readFileSync(path.join(CAMPAIGN, "campaign.log"), "utf8");
// Une campagne reprise (`--only`) dans le même dossier ajoute une ligne de
// provenance par séance : toutes doivent désigner le même commit et le même
// Node, sinon le fichier publié mêlerait deux codes sous un seul nom.
const provLines = [...log.matchAll(/provenance — HEAD (\S+) · node (\S+)/g)];
if (provLines.length === 0) {
  console.error(`❌ ${CAMPAIGN}/campaign.log : ligne de provenance absente`);
  process.exit(1);
}
const [, headCommit, node] = provLines[0];
// Deux commits différents mesurent le MÊME code tant que ni le produit ni les
// témoins n'ont changé entre eux (un commit d'outillage ou de doc ne déplace
// rien). Le constat se fait par `git diff`, jamais par confiance.
const MEASURED = [
  "src",
  "package-lock.json",
  ".claude/skills/nodefony-load-test/bench-frameworks",
];
const sameCode = (a, b) => {
  if (a === b) return true;
  try {
    execFileSync("git", ["diff", "--quiet", a, b, "--", ...MEASURED], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};
const drift = provLines.filter(
  ([, h, n]) => n !== node || !sameCode(headCommit, h),
);
const sessionHeads = [...new Set(provLines.map(([, h]) => h))];
if (drift.length) {
  console.error(
    `❌ séances de campagne sur des décors différents : ${provLines
      .map(([, h, n]) => `${h}/${n}`)
      .join(
        ", ",
      )} — rejouer les pièces de la séance divergente, ou --reuse avec sa provenance`,
  );
  process.exit(1);
}
const endHead = log.match(/HEAD en fin de campagne : (\S+)/)?.[1];
if (endHead && endHead !== headCommit)
  console.warn(
    `⚠️ HEAD a bougé PENDANT la campagne (${headCommit} → ${endHead}) : le code mesuré n'est pas un seul commit`,
  );
const dirtyTree = log.includes("arbre NON propre");
const measuredAt = (() => {
  const m = path.basename(CAMPAIGN).match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
})();

// ── une paire : le dernier essai conclusif, ses séries brutes ───────────────
/**
 * Fusionne les deux séries d'un camp telles que `bench-pairs` les a rangées.
 * `med` = moyenne des deux médianes de série (règle du protocole publié).
 */
function mergeSeries(files) {
  const s = files.map(readJson);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const meds = s.map((x) => x.med);
  const rps = s.flatMap((x) => x.rps);
  const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
  return {
    label: s[0].label,
    ...(s[0].env ? { env: s[0].env } : {}),
    rps,
    min: Math.min(...rps),
    med: round(mean(meds)),
    max: Math.max(...rps),
    dispersionPct: Math.max(...s.map((x) => x.dispersionPct)),
    interSeriesPct: round((Math.max(...meds) / Math.min(...meds) - 1) * 100, 1),
    p50Ms: s.map((x) => x.medP50Ms),
    p99Ms: s.map((x) => x.medP99Ms),
    medP50Ms: round(mean(s.map((x) => x.medP50Ms)), 3),
    medP99Ms: round(mean(s.map((x) => x.medP99Ms)), 3),
    maxP99Ms: Math.max(...s.map((x) => x.maxP99Ms)),
    thermalBefore: s[0].thermalBefore,
    thermalAfter: s.at(-1).thermalAfter,
    indexeurPct: s[0].indexeurPct,
    cpuRegime: s[0].cpuRegime,
    hyperviseur: s[0].hyperviseur,
    warmupSec: s[0].warmupSec,
    durSec: s[0].durSec,
    conn: s[0].conn,
    threads: s[0].threads,
    url: s[0].url,
    series: s.map((x) => ({
      rps: x.rps,
      med: x.med,
      dispersionPct: x.dispersionPct,
      thermalBefore: x.thermalBefore,
      thermalAfter: x.thermalAfter,
    })),
  };
}

/**
 * Rend une paire de la campagne (ou réutilisée) : verdict, rapport A/B tel que
 * `bench-pairs` l'a imprimé, et chaque camp fusionné. `null` si absente.
 */
function pair(name, campA, campB) {
  if (REUSE[name]) {
    const dir = REUSE[name];
    const meta = readJson(path.join(dir, "meta.json"));
    const camp = (c) =>
      mergeSeries(
        [1, 2].map((r) => path.join(dir, `nf-bench-${c}-p${r}.json`)),
      );
    return {
      name,
      rapportPct: meta.rapportPct,
      separation: meta.separation,
      tries: null,
      reused: {
        commit: meta.commit,
        measuredAt: meta.measuredAt,
        source: meta.source,
      },
      camps: { [campA]: camp(campA), [campB]: camp(campB) },
    };
  }
  const tries = readdirSync(CAMPAIGN)
    .map((f) => f.match(new RegExp(`^${name}-try(\\d+)\\.log$`)))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => b - a);
  for (const t of tries) {
    const txt = readFileSync(
      path.join(CAMPAIGN, `${name}-try${t}.log`),
      "utf8",
    );
    const rapport = txt.match(/rapport \S+ : ([\d.]+) %/);
    const nette = txt.includes("SÉPARATION NETTE");
    const bruit = txt.includes("DANS LE BRUIT");
    if (!rapport || (!nette && !bruit)) continue;
    const dir = path.join(CAMPAIGN, `${name}-try${t}`);
    const camp = (c) => {
      const files = [1, 2].map((r) =>
        path.join(dir, `nf-bench-${c}-p${r}.json`),
      );
      return files.every(existsSync) ? mergeSeries(files) : null;
    };
    return {
      name,
      rapportPct: Number(rapport[1]),
      separation: nette ? "nette" : "dans le bruit",
      tries: t,
      // Test nul : les deux camps portent le MÊME nom de fichier, la seconde
      // série écrase la première — seuls le rapport et le verdict valent.
      camps:
        campA === campB ? {} : { [campA]: camp(campA), [campB]: camp(campB) },
    };
  }
  missing.push(`${name} (${campA} ↔ ${campB}) : aucun essai conclusif`);
  return null;
}

const P = {
  paire1: pair("paire1", "express-fair", "nodefony"),
  paire2: pair("paire2", "bare", "express-fair"),
  paire3: pair("paire3", "express", "express-fair"),
  nestFair: pair("nest-fair", "nest-fair", "nodefony"),
  nul: pair("nul", "nodefony", "nodefony"),
  applicatif: pair("applicatif", "express-fair-sqlite", "nodefony-orm"),
  applicatifNest: pair("applicatif-nest", "nest-fair-sqlite", "nodefony-orm"),
  postNest: pair("post-nest", "nest-fair-sqlite", "nodefony-orm"),
  errNest: pair("err-nest", "nest-fair-sqlite", "nodefony-orm"),
};

// ── CPU du fil principal : wait-analyze sur le dossier de la campagne ───────
let cpuThread = null;
const cpuDir = path.join(CAMPAIGN, "cpu-fil");
if (existsSync(cpuDir)) {
  const out = path.join(CAMPAIGN, "cpu-fil.json");
  try {
    execFileSync(
      process.execPath,
      [
        path.join(HERE, "wait-analyze.mjs"),
        cpuDir,
        "nodefony",
        "nest-fair",
        "--json",
        out,
      ],
      { stdio: "ignore" },
    );
  } catch {
    // code ≠ 0 = runs refusés : le JSON écrit dit lesquels, on le lit quand même
  }
  if (existsSync(out)) cpuThread = { witness: "nest-fair", ...readJson(out) };
  else missing.push("cpu-fil : wait-analyze n'a rien rendu");
} else missing.push("cpu-fil : dossier absent");

const soakFile = opt("soak");
const soak = soakFile ? readJson(soakFile) : null;

// ── composition ─────────────────────────────────────────────────────────────
const data = readJson(DATA);
const ratio = (s, r) => Math.round((s / r) * 1000) / 10;
const pairEntry = (p, [a, b], extra = {}) =>
  p && {
    paire: `${a} ↔ ${b}`,
    source: p.name,
    rapportPct: p.rapportPct,
    ...(p.camps[a] ? { [`${a}Med`]: p.camps[a].med } : {}),
    ...(p.camps[b] && a !== b ? { [`${b}Med`]: p.camps[b].med } : {}),
    separation: p.separation,
    ...(p.tries > 1 ? { essais: p.tries } : {}),
    ...extra,
  };

data.version = opt("version") ?? data.version;
data.provenance = {
  ...data.provenance,
  measuredAt,
  headCommit,
  runtimeCommit: headCommit,
  ...(sessionHeads.length > 1
    ? {
        sessionCommits: sessionHeads,
        sessionNote:
          "campagne en plusieurs séances ; aucun changement du produit ni des témoins entre ces commits (git diff vide)",
      }
    : {}),
  node,
  ...(dirtyTree
    ? {
        treeNote:
          "arbre non propre au lancement — relire `git status` du commit noté",
      }
    : {}),
};
if (P.paire1)
  data.comparison.frameworks = {
    bare: P.paire2?.camps.bare ?? null,
    express: P.paire3?.camps.express ?? null,
    "express-fair": P.paire1.camps["express-fair"],
    "nest-fair": P.nestFair?.camps["nest-fair"] ?? null,
    nodefony: P.paire1.camps.nodefony,
  };
data.comparison.pairs = [
  pairEntry(P.paire1, ["express-fair", "nodefony"]),
  pairEntry(P.paire2, ["bare", "express-fair"]),
  pairEntry(P.paire3, ["express", "express-fair"]),
  pairEntry(P.nestFair, ["nest-fair", "nodefony"]),
  pairEntry(P.nul, ["nodefony", "nodefony"], { role: "test nul" }),
].filter(Boolean);

if (P.applicatif) {
  const a = P.applicatif.camps;
  data.applicative.frameworks = a;
  data.applicative.rapportPct = ratio(
    a["nodefony-orm"].med,
    a["express-fair-sqlite"].med,
  );
  data.applicative.separation = P.applicatif.separation;
}

const nestCase = (id, p, route, method, status) =>
  p && {
    id,
    route,
    method,
    status,
    rapportPct: ratio(
      p.camps["nodefony-orm"].med,
      p.camps["nest-fair-sqlite"].med,
    ),
    separation: p.separation,
    ...(p.reused
      ? {
          commit: p.reused.commit,
          measuredAt: p.reused.measuredAt,
          source: p.reused.source,
        }
      : { commit: headCommit, measuredAt }),
    frameworks: p.camps,
  };
data.applicativeNest = {
  ...data.applicativeNest,
  reference: "nest-fair-sqlite",
  subject: "nodefony-orm",
  cases: [
    nestCase(
      "read-write",
      P.applicatifNest,
      "/nodefony/test/bench-orm/read-write",
      "GET",
      200,
    ),
    nestCase(
      "post-valid",
      P.postNest,
      "/nodefony/test/bench-orm/read-write-valid",
      "POST",
      200,
    ),
    nestCase(
      "post-422",
      P.errNest,
      "/nodefony/test/bench-orm/read-write-valid",
      "POST",
      422,
    ),
    // Une pièce absente du dossier ET non réutilisée garde l'entrée déjà
    // publiée — avec SA provenance, jamais celle de la campagne.
    ...(data.applicativeNest?.cases ?? []).filter(
      (c) =>
        ({
          "read-write": !P.applicatifNest,
          "post-valid": !P.postNest,
          "post-422": !P.errNest,
        })[c.id],
    ),
  ].filter(Boolean),
};
if (cpuThread)
  data.cpuThread = { ...cpuThread, commit: headCommit, measuredAt };
if (soak) data.soak = soak;

// ── récapitulatif : ce qu'on publierait ─────────────────────────────────────
const nb = (v, n = 1) =>
  v == null ? "—" : v.toLocaleString("fr-FR", { maximumFractionDigits: n });
console.log(
  `Campagne ${CAMPAIGN} · HEAD ${headCommit} · ${node} · ${measuredAt}`,
);
for (const p of data.comparison.pairs)
  console.log(
    `  ${p.paire.padEnd(28)} ${nb(p.rapportPct).padStart(6)} %  ${p.separation}${p.role ? `  (${p.role})` : ""}`,
  );
if (P.applicatif)
  console.log(
    `  ORM Express (nodefony/témoin)  ${nb(data.applicative.rapportPct).padStart(6)} %  ${data.applicative.separation}`,
  );
for (const c of data.applicativeNest.cases)
  console.log(
    `  ORM NestJS ${c.id.padEnd(18)} ${nb(c.rapportPct).padStart(6)} %  ${c.separation}  [${c.commit}${c.source ? ` · ${c.source}` : ""}]`,
  );
if (cpuThread) {
  const row = (cpuThread.rows ?? []).find((r) =>
    r.metric.startsWith("CPU fil principal"),
  );
  if (row)
    console.log(
      `  CPU fil (nodefony/nest-fair)   ${nb(row.ratio, 3)}  ${row.separated ? "séparé" : "non séparé"}`,
    );
}
if (missing.length) {
  console.log("\n❌ Pièces manquantes :");
  for (const m of missing) console.log(`   - ${m}`);
}
if (argv.includes("--write")) {
  if (missing.length && !argv.includes("--allow-missing")) {
    console.error(
      "\nRien écrit : pièces manquantes (--allow-missing pour composer quand même).",
    );
    process.exit(1);
  }
  writeFileSync(DATA, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`\n✓ écrit : ${DATA}`);
} else console.log("\n(aperçu — rien écrit ; --write pour composer)");
process.exit(missing.length ? 1 : 0);
