#!/usr/bin/env node
/**
 * Construit le site « Performance » publié — une page par version, plus `latest`.
 *
 * POURQUOI CE SCRIPT EXISTE, ET CE QU'IL NE FAIT PAS.
 * Il ne MESURE rien. Mesurer sur un exécuteur d'intégration continue partagé rendrait
 * des chiffres faux — la leçon est déjà payée : aucun absolu pris derrière un chemin
 * virtualisé n'est transposable. La mesure est un geste manuel, sur une machine nommée,
 * dont le résultat est COMMITÉ dans `docs/performance/data/<version>.json`. Ce script ne
 * fait que RENDRE ces données ; il est donc déterministe, rejouable en local, et son
 * résultat ne dépend pas de la machine qui l'exécute.
 *
 * Chaque version versionnée devient `<sortie>/<version>/index.html`, la plus récente est
 * dupliquée en `<sortie>/latest/index.html`, et un sommaire liste le tout. Un chiffre
 * reste ainsi attaché à SA version, définitivement — c'est ce qui permet de comparer deux
 * releases sans croire quiconque sur parole.
 *
 * Usage :
 *   node scripts/build-perf-site.mjs [--out dist-perf-site] [--data docs/performance/data]
 *
 * Sortie 1 si AUCUNE version n'a pu être rendue (un site vide se publierait en silence).
 */
import {
  readdirSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const OUT = path.resolve(ROOT, arg("out", "dist-perf-site"));
const DATA_DIR = path.resolve(ROOT, arg("data", "docs/performance/data"));
const GENERATOR = path.join(
  ROOT,
  ".claude/skills/nodefony-load-test/scripts/prod-readiness-report.mjs",
);
// Le DOSSIER du chantier — un second objet, pour un second public. La page de
// version répond « peut-on partir en production ? » en trois minutes ; celle-ci
// raconte COMMENT on l'a su : le profilage, les lots gardés, celui qui a été
// annulé par son propre A/B, et les instruments qui ont menti. Un verdict seul se
// lit comme une plaquette ; la méthode seule, personne ne l'ouvre. Ses données
// sont déclarées dans son générateur et couvrent le chantier jusqu'au 2026-08-07 —
// il porte sa propre table de chronologie, ce qui lui permet de cohabiter avec des
// mesures plus récentes sans les contredire.
const DOSSIER = path.join(
  ROOT,
  ".claude/skills/nodefony-load-test/scripts/perf-dossier-report.mjs",
);

/** Ordre de version décroissant (numérique par segment, pré-release après la finale). */
const compareVersions = (a, b) => {
  const parse = (v) =>
    v.split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === typeof y) return x > y ? -1 : 1;
    return typeof x === "number" ? -1 : 1;
  }
  return 0;
};

const versions = existsSync(DATA_DIR)
  ? readdirSync(DATA_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort(compareVersions)
  : [];

if (versions.length === 0) {
  console.error(`aucun jeu de mesures dans ${DATA_DIR}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const rendered = [];
const skipped = [];

for (const version of versions) {
  const dataFile = path.join(DATA_DIR, `${version}.json`);
  const dir = path.join(OUT, version);
  mkdirSync(dir, { recursive: true });
  try {
    execFileSync(
      process.execPath,
      [GENERATOR, "--data", dataFile, "--out", path.join(dir, "index.html")],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const meta = JSON.parse(readFileSync(dataFile, "utf8"));
    rendered.push({ version, measuredAt: meta.provenance?.measuredAt ?? "?" });
    console.log(`✓ ${version}`);
  } catch (err) {
    // Un jeu incomplet ne fait PAS tomber le site : il est nommé, et son absence
    // est visible sur le sommaire. Ce qui serait grave, c'est de le taire.
    const why =
      String(err.stderr ?? err.message)
        .split("\n")
        .find((l) => l.startsWith("Error:")) ?? "rendu impossible";
    skipped.push({ version, why: why.replace(/^Error:\s*/, "") });
    console.warn(`⚠ ${version} — ${why}`);
  }
}

if (rendered.length === 0) {
  console.error("aucune version rendue — rien à publier");
  process.exit(1);
}

// Le dossier se rend une fois, à part : il ne dépend d'aucune version.
let dossier = false;
try {
  const dir = path.join(OUT, "dossier");
  mkdirSync(dir, { recursive: true });
  execFileSync(process.execPath, [DOSSIER, path.join(dir, "index.html")], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  dossier = true;
  console.log("✓ dossier du chantier");
} catch (err) {
  console.warn(
    `⚠ dossier non rendu — ${String(err.stderr ?? err.message).split("\n")[0]}`,
  );
}

const latest = rendered[0];
mkdirSync(path.join(OUT, "latest"), { recursive: true });
copyFileSync(
  path.join(OUT, latest.version, "index.html"),
  path.join(OUT, "latest", "index.html"),
);

const esc = (s) =>
  String(s).replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  );
const rows = rendered
  .map(
    (r) =>
      `<li><a href="./${esc(r.version)}/">Nodefony ${esc(r.version)}</a> <span class="d">mesuré le ${esc(r.measuredAt)}</span>${r.version === latest.version ? " <em>— version courante</em>" : ""}</li>`,
  )
  .join("\n");
const missing = skipped.length
  ? `<h2>Non publiées</h2><ul>${skipped
      .map((s) => `<li><strong>${esc(s.version)}</strong> — ${esc(s.why)}</li>`)
      .join("")}</ul>`
  : "";

writeFileSync(
  path.join(OUT, "index.html"),
  `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nodefony — performance par version</title>
<style>
:root{color-scheme:light dark}
body{font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:46rem;margin:3rem auto;padding:0 1.25rem}
h1{font-size:1.6rem;margin-bottom:.25rem} h2{font-size:1.1rem;margin-top:2rem}
p.lead{color:#666;margin-top:0} ul{padding-left:1.1rem} li{margin:.4rem 0}
a{color:#0b63ce} .d{color:#777;font-size:.9em} em{color:#0a7d33;font-style:normal}
footer{margin-top:3rem;color:#777;font-size:.9em;border-top:1px solid #8883;padding-top:1rem}
p.back{margin:0 0 1.5rem;font-size:.9em}
</style></head><body>
<p class="back"><a href="../">← Documentation Nodefony</a></p>
<h1>Nodefony — performance</h1>
<p class="lead">Une page par version publiée : ce qui a été mesuré, sur quelle machine, avec quel
protocole — et ce que ces chiffres ne permettent pas de conclure.</p>
<h2>Versions</h2>
<ul>
${rows}
</ul>
${
  dossier
    ? `<h2>Le dossier du chantier</h2>
<p><a href="./dossier/">Où part le temps, et comment on l'a su</a> — le profilage, les lots
gardés, <strong>celui qui a été annulé par son propre A/B</strong>, les instruments qui ont menti
avant qu'on s'en aperçoive, et ce qu'un chemin virtualisé interdit de conclure.
<span class="d">Couvre le chantier jusqu'au 2026-08-07 ; chaque chiffre y porte l'état du code
auquel il correspond. Les mesures d'une version publiée, elles, sont ci-dessus.</span></p>`
    : ""
}
${missing}
<footer>Les chiffres sont mesurés à la main sur une machine nommée, puis versionnés dans le dépôt
(<code>docs/performance/data/</code>) ; cette page ne fait que les rendre. Le dossier complet —
méthode, instruments, ce qui a été annulé — vit dans
<a href="https://github.com/nodefony/nodefony-core/tree/main/docs/performance">docs/performance</a>.</footer>
</body></html>
`,
);

console.log(
  `\nsite : ${rendered.length} version(s) rendue(s)${skipped.length ? `, ${skipped.length} sautée(s)` : ""} → ${OUT}`,
);
