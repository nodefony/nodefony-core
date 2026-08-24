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
import { NODEFONY_BRAND } from "../.claude/skills/nodefony-html-report/lib/brand.mjs";
import {
  doc,
  section,
  cards,
  table,
  note,
  esc,
} from "../.claude/skills/nodefony-html-report/lib/report.mjs";

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

const rows = rendered.map((r) => [
  `<a href="./${esc(r.version)}/">Nodefony ${esc(r.version)}</a>${
    r.version === latest.version
      ? ' <span class="badge-latest">version courante</span>'
      : ""
  }`,
  esc(r.measuredAt),
]);

const sections = [
  section(
    "Une page par version publiée",
    `<p class="lead">Ce qui a été mesuré, sur quelle machine, avec quel protocole — et ce que ces
chiffres ne permettent PAS de conclure.</p>` +
      table([{ label: "Version" }, { label: "Mesuré le" }], rows, {
        sortable: true,
        id: "versions",
      }),
  ),
];

if (dossier)
  sections.push(
    section(
      "Le dossier du chantier",
      `<p><a href="./dossier/"><strong>Où part le temps, et comment on l'a su</strong></a> — le
profilage, les lots gardés, <strong>celui qui a été annulé par son propre A/B</strong>, les
instruments qui ont menti avant qu'on s'en aperçoive, et ce qu'un chemin virtualisé interdit de
conclure.</p>` +
        note(
          `Ce dossier couvre le chantier jusqu'au 2026-08-07 ; chaque chiffre y porte l'état du code
auquel il correspond. Les mesures d'une version publiée, elles, sont dans le tableau ci-dessus.`,
        ),
    ),
  );

if (skipped.length)
  sections.push(
    section(
      "Non publiées",
      `<p>Un jeu de mesures incomplet ne fait pas tomber le site — il est nommé ici. Ce qui serait
grave, ce serait de le taire.</p><ul>${skipped
        .map(
          (x) => `<li><strong>${esc(x.version)}</strong> — ${esc(x.why)}</li>`,
        )
        .join("")}</ul>`,
    ),
  );

writeFileSync(
  path.join(OUT, "index.html"),
  doc({
    title: "Performance de Nodefony",
    subtitle:
      "Les chiffres sont mesurés à la main, sur une machine nommée, puis versionnés dans le dépôt — cette page ne fait que les rendre.",
    // La marque ramène à l'accueil du site, comme partout ailleurs : cette page
    // est publiée à côté de la documentation, pas toute seule.
    brand: { ...NODEFONY_BRAND, href: "../" },
    head: `<link rel="icon" href="../favicon.png">`,
    style: `
.wrap { max-width:none; padding:26px 34px 80px; }
@media (max-width:820px) { .wrap { padding:20px 18px 60px; } }
.badge-latest { font-size:11.5px; padding:2px 9px; border-radius:20px; margin-left:8px;
  border:1px solid var(--accent); color:var(--accent); }`,
    sections,
    footer:
      `<a href="../">← Documentation Nodefony</a> — les données brutes sont versionnées dans ` +
      `<a href="https://github.com/nodefony/nodefony-core/tree/main/docs/performance"><code>docs/performance/</code></a>, ` +
      `cette page les rend.`,
  }),
);

console.log(
  `\nsite : ${rendered.length} version(s) rendue(s)${skipped.length ? `, ${skipped.length} sautée(s)` : ""} → ${OUT}`,
);
