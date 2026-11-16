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
// `soak` si `--soak` est donné, `capacity` si `--capacity` l'est (sortie de
// `capacity.mjs --json`), et les pièces « où part le temps » écrites par la
// campagne : `stages` (etages.json, budget par étage), `profile` (profil.json,
// profil comparé) et `binary` (binaire.json, débit binaire). Ce qu'il NE touche PAS : les blocs de récit
// (`why`, `equite`, `cause`, `notMeasured`…), qui restent un geste d'auteur.
//
// Usage :
//   node perf-compose.mjs --campaign tmp/perf-campaign-<date> \
//     --data docs/performance/data/10.0.0.json [--version <v>] \
//     [--soak <soak.json>] [--capacity <capacity.json>]
//     [--reuse <étape>=<dossier>]… [--from <étape>=<campagne>]…
//     [--binary <binaire.json>] [--write]
// Sans `--write`, rend le récapitulatif SANS écrire : on montre les chiffres
// avant de les publier.
//
// `--reuse <étape>=<dossier>` : une paire mesurée HORS de la campagne (même
// code, autre séance). Le dossier porte les séries brutes ET un `meta.json`
// `{commit, measuredAt, source, camps:[A,B], rapportPct, separation}` — la
// pièce garde SA provenance dans le fichier publié, elle n'emprunte pas celle
// de la campagne.
//
// `--from <étape>=<campagne>` : une pièce REJOUÉE dans une autre campagne
// (`perf-campaign.sh --only`, autre dossier). Sa provenance se lit dans le
// journal de CETTE campagne, et le même contrôle « même code » s'y applique.
// `--binary` fait de même pour le débit binaire (le fichier de la campagne
// rejouée, dont le journal porte la provenance).
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
// `--absent <étape>=<raison>` : une pièce volontairement NON publiée. Elle ne
// bloque pas `--write`, et sa raison entre dans `notMeasured` — une absence se
// déclare dans le fichier publié, elle ne s'oublie pas.
const ABSENT = Object.fromEntries(
  all("absent").map((r) => {
    const [k, ...v] = r.split("=");
    return [k, v.join("=")];
  }),
);
const FROM = Object.fromEntries(
  all("from").map((r) => {
    const [k, ...v] = r.split("=");
    return [k, v.join("=")];
  }),
);
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
const dirtyTree = log.includes("arbre NON propre");
const dateOf = (dir) =>
  path.basename(dir).match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
const measuredAt = dateOf(CAMPAIGN);

/**
 * Provenance d'une AUTRE campagne (pièce rejouée) : même Node et même code que
 * la campagne principale, sinon la pièce ne se publie pas sous son nom.
 */
function campaignProvenance(dir) {
  const txt = readFileSync(path.join(dir, "campaign.log"), "utf8");
  const lines = [...txt.matchAll(/provenance — HEAD (\S+) · node (\S+)/g)];
  if (lines.length === 0) {
    missing.push(`${dir}/campaign.log : ligne de provenance absente`);
    return null;
  }
  const bad = lines.filter(
    ([, h, n]) => n !== node || !sameCode(headCommit, h),
  );
  if (bad.length) {
    missing.push(
      `${dir} : décor différent (${bad.map(([, h, n]) => `${h}/${n}`).join(", ")}) de ${headCommit}/${node}`,
    );
    return null;
  }
  return {
    campaign: dir,
    commit: lines[0][1],
    measuredAt: dateOf(dir),
    ...(txt.includes("arbre NON propre")
      ? {
          treeNote:
            "arbre non propre au lancement — hors périmètre mesuré (git diff vide sur src, verrou, témoins)",
        }
      : {}),
  };
}

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
  const base = FROM[name] ?? CAMPAIGN;
  const from = FROM[name] ? campaignProvenance(base) : null;
  if (FROM[name] && !from) return null;
  const tries = readdirSync(base)
    .map((f) => f.match(new RegExp(`^${name}-try(\\d+)\\.log$`)))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => b - a);
  for (const t of tries) {
    const txt = readFileSync(path.join(base, `${name}-try${t}.log`), "utf8");
    const rapport = txt.match(/rapport \S+ : ([\d.]+) %/);
    const nette = txt.includes("SÉPARATION NETTE");
    const bruit = txt.includes("DANS LE BRUIT");
    const sousResolution = txt.includes("SOUS LA RÉSOLUTION");
    if (!rapport || (!nette && !bruit && !sousResolution)) continue;
    const dir = path.join(base, `${name}-try${t}`);
    const camp = (c) => {
      const files = [1, 2].map((r) =>
        path.join(dir, `nf-bench-${c}-p${r}.json`),
      );
      return files.every(existsSync) ? mergeSeries(files) : null;
    };
    return {
      name,
      rapportPct: Number(rapport[1]),
      // Le verdict « SÉPARÉ MAIS SOUS LA RÉSOLUTION » ne classe rien.
      separation: sousResolution
        ? "sous la résolution"
        : nette
          ? "nette"
          : "dans le bruit",
      tries: t,
      ...(from ? { from } : {}),
      // Test nul : les deux camps portent le MÊME nom de fichier, la seconde
      // série écrase la première — seuls le rapport et le verdict valent.
      camps:
        campA === campB ? {} : { [campA]: camp(campA), [campB]: camp(campB) },
    };
  }
  if (!(name in ABSENT))
    missing.push(`${name} (${campA} ↔ ${campB}) : aucun essai conclusif`);
  return null;
}

const P = {
  paire1: pair("paire1", "express-fair", "nodefony"),
  paire2: pair("paire2", "bare", "express-fair"),
  paire3: pair("paire3", "express", "express-fair"),
  nestFair: pair("nest-fair", "nest-fair", "nodefony"),
  nestFairNode: pair("nest-fair-node", "nest-fair-node", "nodefony"),
  nul: pair("nul", "nodefony", "nodefony"),
  applicatif: pair("applicatif", "express-fair-sqlite", "nodefony-orm"),
  postExpress: pair("post-express", "express-fair-sqlite", "nodefony-orm"),
  errExpress: pair("err-express", "express-fair-sqlite", "nodefony-orm"),
  nulOrm: pair("nul-orm", "nodefony-orm", "nodefony-orm"),
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

// ── où part le temps : écrits par la campagne, lus tels quels ─────────────
const piece = (file, label) => {
  if (existsSync(file)) return readJson(file);
  missing.push(`${label} : ${file} absent`);
  return null;
};
const stages = piece(path.join(CAMPAIGN, "etages.json"), "étages");
const profile = piece(path.join(CAMPAIGN, "profil.json"), "profil");
const binaryFile = opt("binary") ?? path.join(CAMPAIGN, "binaire.json");
const binaryFrom =
  path.resolve(path.dirname(binaryFile)) === path.resolve(CAMPAIGN)
    ? null
    : campaignProvenance(path.dirname(binaryFile));
const binary = piece(binaryFile, "binaire");

const soakFile = opt("soak");
const soak = soakFile ? readJson(soakFile) : null;

// Constantes d'un pod : le relevé garde SA provenance (date, commit, mode),
// comme le soak — il n'emprunte pas celle de la campagne. Le commit de
// l'INSTRUMENT est relevé à part : un instrument corrigé après la mesure
// rendrait sinon un chiffre qu'il ne sait plus produire.
const capacityFile = opt("capacity");
let capacity = null;
if (capacityFile) {
  const raw = readJson(capacityFile);
  if (raw.env?.env !== "production")
    missing.push(
      `capacité : relevé en « ${raw.env?.env} » — seule la production dimensionne un pod`,
    );
  let instrumentCommit = null;
  try {
    instrumentCommit =
      execFileSync(
        "git",
        [
          "log",
          "-1",
          "--format=%h",
          "--",
          ".claude/skills/nodefony-load-test/scripts/capacity.mjs",
        ],
        { encoding: "utf8" },
      ).trim() || null;
  } catch {
    /* hors dépôt : l'instrument reste non daté, le champ le dit (null) */
  }
  capacity = {
    measuredAt: raw.measuredAt,
    headCommit: raw.headCommit,
    instrumentCommit,
    mode: raw.env?.env ?? null,
    node: raw.env?.node ?? null,
    cores: raw.env?.cores ?? null,
    route: raw.route ?? null,
    repeat: raw.repeat,
    params: raw.params,
    rssIdleMb: raw.env?.rssIdleMB ?? null,
    ram: raw.ram,
    ws: raw.ws,
    fanout: raw.fanout,
    http: raw.http,
  };
}

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
    ...(p.from ? { from: p.from } : {}),
    ...extra,
  };

// Les versions des TÉMOINS : une page qui nomme Express ou NestJS doit dire
// lesquels. Lues dans ce que le dossier des témoins SERT (la garde « installé
// == déclaré » de bench-pairs refuse de mesurer autre chose que le déclaré).
const WITNESS_PKGS = [
  "express",
  "@nestjs/core",
  "@nestjs/platform-fastify",
  "@nestjs/platform-node",
  "fastify",
  "drizzle-orm",
  "better-sqlite3",
];
const benchDir = path.join(HERE, "..", "bench-frameworks");
const witnesses = Object.fromEntries(
  WITNESS_PKGS.map((p) => {
    const f = path.join(benchDir, "node_modules", p, "package.json");
    if (!existsSync(f))
      missing.push(`témoin ${p} : non installé dans ${benchDir}`);
    return [p, existsSync(f) ? readJson(f).version : null];
  }),
);

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
  witnesses,
  ...(dirtyTree
    ? {
        treeNote:
          "arbre non propre au lancement — relire `git status` du commit noté",
      }
    : {}),
};
// Chaque camp vient de SA paire ; un camp présent dans plusieurs paires prend
// la première conclusive dans cet ordre. Une paire1 absente (déclarée par
// `--absent`) ne vide donc pas le tableau : Express équipé est aussi mesuré face
// au serveur nu et à Express nu, Nodefony face à NestJS.
const campFrom = (camp, ...ps) =>
  ps.find((p) => p?.camps?.[camp])?.camps[camp] ?? null;
data.comparison.frameworks = {
  bare: campFrom("bare", P.paire2),
  express: campFrom("express", P.paire3),
  "express-fair": campFrom("express-fair", P.paire1, P.paire3, P.paire2),
  "nest-fair": campFrom("nest-fair", P.nestFair),
  "nest-fair-node": campFrom("nest-fair-node", P.nestFairNode),
  nodefony: campFrom("nodefony", P.paire1, P.nestFair, P.nestFairNode),
};
data.comparison.pairs = [
  pairEntry(P.paire1, ["express-fair", "nodefony"]),
  pairEntry(P.paire2, ["bare", "express-fair"]),
  pairEntry(P.paire3, ["express", "express-fair"]),
  pairEntry(P.nestFair, ["nest-fair", "nodefony"]),
  pairEntry(P.nestFairNode, ["nest-fair-node", "nodefony"]),
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

const ormCase = (ref) => (id, p, route, method, status) =>
  p && {
    id,
    route,
    method,
    status,
    rapportPct: ratio(p.camps["nodefony-orm"].med, p.camps[ref].med),
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
const nestCase = ormCase("nest-fair-sqlite");
const expressCase = ormCase("express-fair-sqlite");
// Face à Express : la lecture+écriture reste au premier niveau (publiée ainsi
// depuis toujours) ; le POST validé et son chemin d'erreur s'y ajoutent en cas.
if (P.postExpress || P.errExpress)
  data.applicative.cases = [
    expressCase(
      "post-valid",
      P.postExpress,
      "/nodefony/test/bench-orm/read-write-valid",
      "POST",
      200,
    ),
    expressCase(
      "post-422",
      P.errExpress,
      "/nodefony/test/bench-orm/read-write-valid",
      "POST",
      422,
    ),
  ].filter(Boolean);
if (P.nulOrm)
  data.applicative.nul = {
    paire: "nodefony-orm ↔ nodefony-orm",
    rapportPct: P.nulOrm.rapportPct,
    separation: P.nulOrm.separation,
    role: "test nul",
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
if (stages)
  data.stages = {
    commit: headCommit,
    measuredAt,
    ...stages,
  };
if (profile) data.profile = { commit: headCommit, measuredAt, ...profile };
if (binary)
  data.binary = {
    ...(binaryFrom
      ? {
          commit: binaryFrom.commit,
          measuredAt: binaryFrom.measuredAt,
          from: binaryFrom,
        }
      : { commit: headCommit, measuredAt }),
    ...binary,
  };
if (capacity) data.capacity = capacity;
data.notMeasured = [
  // Une absence déclarée hier se RETIRE quand la pièce est mesurée aujourd'hui :
  // sinon le fichier publié affirme « non mesuré » à côté du chiffre qui le dément.
  ...(data.notMeasured ?? []).filter(
    (n) =>
      !(n.quoi in ABSENT) && !Object.values(P).some((p) => p?.name === n.quoi),
  ),
  ...Object.entries(ABSENT).map(([quoi, pourquoi]) => ({ quoi, pourquoi })),
];

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
for (const c of data.applicative.cases ?? [])
  console.log(
    `  ORM Express ${c.id.padEnd(17)} ${nb(c.rapportPct).padStart(6)} %  ${c.separation}`,
  );
if (data.applicative.nul)
  console.log(
    `  ORM nul                        ${nb(data.applicative.nul.rapportPct).padStart(6)} %  ${data.applicative.nul.separation}`,
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
if (stages)
  console.log(
    `  étages (${stages.witness})       écart ${nb(stages.gapUs, 2)} µs/req · ratio ${nb(stages.ratio, 3)}${stages.indicative ? " · INDICATIF" : ""}`,
  );
if (profile)
  console.log(
    `  profil                         ${Object.entries(profile.totalUs)
      .map(([k, v]) => `${k} ${nb(v)} µs`)
      .join(" · ")}`,
  );
if (binary) {
  const worst = Math.max(...binary.results.map((r) => r.spreadPct));
  console.log(
    `  binaire                        ${binary.results.length} mesures · dispersion max ${nb(worst)} %${binaryFrom ? ` [${binaryFrom.campaign}]` : ""}`,
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
