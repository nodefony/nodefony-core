#!/usr/bin/env node
/**
 * Qui PORTE chaque leçon durable — le chaînon manquant du cycle des retex.
 *
 * 🔴 Pourquoi ce script existe. Le cycle avait DEUX sorties (friction → sas →
 * mémoire `feedback_*`) et il en manquait une troisième : **le porteur**. Une
 * leçon qui ne finit ni dans un automate, ni dans le code du produit, ni dans un
 * gabarit ne protège que l'agent qui la relit — et elle ne sort JAMAIS du dépôt,
 * donc aucune application générée n'en profite.
 *
 * Mesuré à la main le 2026-09-08, question du user (« un retex a-t-il un jour
 * amélioré le produit avec du code ? ») : **115 mémoires, 48 citées uniquement
 * dans des retex archivés, 12 citées nulle part**. La réponse était oui — mais
 * elle a demandé six commandes ad hoc, elle n'était écrite nulle part, et elle
 * serait morte au `/clear` suivant. Ce script la rend REPRODUCTIBLE.
 *
 * Ce qu'il fait : pour chaque mémoire, il extrait les chemins et les commandes
 * npm qu'elle CITE, vérifie qu'ils existent ENCORE, et en déduit sa classe :
 *
 *   PRODUIT   du code livré porte la leçon → une app générée en profite
 *   DÉPÔT     un gate, un script ou un flux de forge la porte → protège le dev
 *   CONTEXTE  citée dans un artefact relu (CLAUDE.md, skill, MEMORY de module),
 *             mais aucun automate ne l'applique → elle ne tient que si on y pense
 *   INERTE    rien ne la cite → le trou
 *
 * Ce qu'il NE fait PAS : juger. Une leçon peut légitimement rester en CONTEXTE
 * (« décider et expliquer plutôt que poser un QCM » n'a pas d'automate possible).
 * Le script dit où regarder ; c'est à la graduation de répondre « quel porteur,
 * ou pourquoi aucun ».
 *
 *   npm run lessons:carriers            # le tableau + les compteurs
 *   npm run lessons:carriers -- --write # + l'empreinte .ai/LESSONS.md
 *   npm run lessons:carriers -- --strict # sortie 1 si une ancre citée est MORTE
 *
 * Sortie : 0 par défaut — c'est un indicateur, pas encore un gate. `--strict` le
 * durcit une fois la base assainie ; l'armer avant fabriquerait un rouge permanent,
 * qu'on apprend à ignorer. [[feedback_gate_must_run]]
 *
 * @module
 */
import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Extensions qui font d'un chemin cité du CODE, et non de la prose. */
const CODE_EXT = new Set([
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".js",
  ".yml",
  ".yaml",
  ".json",
]);

/** Dossiers jamais parcourus quand on cherche qui cite une leçon. */
const SKIPPED_DIRS = new Set([
  "node_modules",
  "dist",
  "dist-site",
  ".git",
  "coverage",
  "var",
  "tmp",
  "session-retros",
]);

/**
 * Le dossier des mémoires, dérivé du répertoire courant.
 *
 * Aucun chemin en dur : Claude Code range les mémoires sous un nom formé du
 * chemin absolu du projet dont les `/` sont devenus des `-`. Le dériver plutôt
 * que l'écrire rend le script utilisable depuis un autre clone.
 *
 * @param {string} cwd - la racine du dépôt.
 * @returns {string} le chemin du dossier des mémoires (existant ou non).
 */
export function memoryDir(cwd) {
  return path.join(
    homedir(),
    ".claude",
    "projects",
    cwd.replace(/\//g, "-"),
    "memory",
  );
}

/**
 * Les chemins de fichiers du dépôt cités dans un texte.
 *
 * Écarte les motifs à joker (`src/**`), qui décrivent une famille et ne peuvent
 * pas se vérifier par une existence, et les fragments trop courts pour être un
 * chemin. Ne rend jamais de doublon.
 *
 * @param {string} text - le corps d'une mémoire.
 * @returns {string[]} les chemins cités, relatifs à la racine du dépôt.
 */
export function citedPaths(text) {
  const found = new Set();
  const re = /(?:src|scripts|docs|\.claude|\.github)\/[A-Za-z0-9_@./-]+/g;
  for (const raw of text.match(re) ?? []) {
    const clean = raw.replace(/[.,:;)]+$/, "");
    // Un gabarit d'exemple n'est pas une ancre : `src/.../`, `docs/adr/NNNN-titre.md`,
    // ou un chemin de DOSSIER ne se vérifient pas par l'existence d'un fichier — les
    // compter ferait crier l'instrument au loup, et on apprendrait à l'ignorer.
    if (clean.includes("*") || clean.includes("...") || clean.includes("NNNN"))
      continue;
    if (clean.endsWith("/") || clean.length < 8) continue;
    found.add(clean);
  }
  return [...found];
}

/**
 * Les commandes `npm run <script>` citées dans un texte.
 *
 * @param {string} text - le corps d'une mémoire.
 * @returns {string[]} les noms de scripts cités, sans doublon.
 */
export function citedScripts(text) {
  const found = new Set();
  for (const m of text.matchAll(/npm run ([a-z][\w:-]+)/g)) found.add(m[1]);
  return [...found];
}

/**
 * Un chemin de code livré porte-t-il la leçon jusqu'aux applications ?
 *
 * Le critère est la FRONTIÈRE npm, pas le dossier : ce qui part dans un paquet
 * publié atteint l'utilisateur ; un test, un banc ou le module de démonstration
 * ne sortent jamais du dépôt.
 *
 * @param {string} p - un chemin relatif à la racine.
 * @returns {boolean}
 */
export function isProductPath(p) {
  if (!CODE_EXT.has(path.extname(p))) return false;
  if (/(^|\/)(tests?|__tests__|benchs?)\//.test(p)) return false;
  if (p.startsWith("src/modules/test/")) return false;
  return (
    p.startsWith("src/nodefony/") || p.startsWith("src/packages/@nodefony/")
  );
}

/**
 * Les fichiers susceptibles de CITER une leçon, hors retex archivés.
 *
 * Les retex sont exclus délibérément : une leçon qui n'y figure QUE est
 * précisément celle qui n'agit nulle part — c'est le fait qu'on veut mesurer.
 *
 * @param {string} root - la racine du dépôt.
 * @returns {string[]} les chemins des artefacts relus (markdown et scripts).
 */
export function actingArtifacts(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name.startsWith(".") &&
        ![".claude", ".github", ".ai"].includes(entry.name)
      )
        continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (/\.(md|mjs|ts)$/.test(entry.name)) {
        out.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  return out;
}

/**
 * Classe chaque mémoire selon ce qui la porte réellement.
 *
 * @param {string} root - la racine du dépôt.
 * @param {string} dir - le dossier des mémoires.
 * @returns {{lessons: object[], dead: object[]}} les leçons classées et les ancres mortes.
 */
export function classify(root, dir) {
  const files = readdirSync(dir).filter(
    (f) => f.startsWith("feedback_") && f.endsWith(".md"),
  );
  const artifacts = actingArtifacts(root);
  const haystack = new Map();
  // L'index `MEMORY.md` du dossier des mémoires est chargé à CHAQUE session :
  // c'est l'artefact le plus relu du dispositif, et l'oublier classait « inerte »
  // une leçon effectivement portée. [[feedback_prove_the_target_not_the_verdict]]
  const index = path.join(dir, "MEMORY.md");
  if (existsSync(index))
    haystack.set("MEMORY.md (index des mémoires)", readFileSync(index, "utf8"));
  for (const f of artifacts) {
    try {
      haystack.set(f, readFileSync(path.join(root, f), "utf8"));
    } catch {
      /* fichier disparu entre le parcours et la lecture */
    }
  }

  const lessons = [];
  const dead = [];
  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const body = readFileSync(path.join(dir, file), "utf8");
    const paths = citedPaths(body);
    const scripts = citedScripts(body);

    const living = paths.filter((p) => existsSync(path.join(root, p)));
    for (const p of paths)
      if (!living.includes(p)) dead.push({ slug, target: p });

    const pkg = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    );
    const livingScripts = scripts.filter((s) => Boolean(pkg.scripts?.[s]));

    const product = living.filter(isProductPath);
    const repo = living.filter((p) => !isProductPath(p));

    const citedIn = [];
    for (const [f, text] of haystack) if (text.includes(slug)) citedIn.push(f);

    let klass = "INERTE";
    if (product.length > 0) klass = "PRODUIT";
    else if (repo.length > 0 || livingScripts.length > 0) klass = "DÉPÔT";
    else if (citedIn.length > 0) klass = "CONTEXTE";

    lessons.push({
      slug,
      klass,
      product,
      repo,
      scripts: livingScripts,
      citedIn: citedIn.length,
    });
  }
  return { lessons, dead };
}

/**
 * Rend l'empreinte markdown, versionnée dans `.ai/`.
 *
 * @param {object[]} lessons - les leçons classées.
 * @param {object[]} dead - les ancres mortes.
 * @returns {string} le corps de `.ai/LESSONS.md`.
 */
export function render(lessons, dead) {
  const by = (k) => lessons.filter((l) => l.klass === k);
  const lines = [
    "# LESSONS.md — qui PORTE chaque leçon durable",
    "",
    "> **Généré** par `npm run lessons:carriers -- --write`. Ne pas éditer à la main.",
    "> Répond à une seule question : cette leçon agit-elle sur le PRODUIT (donc sur les",
    "> applications générées), sur le DÉPÔT (donc sur le développement du framework),",
    "> ou seulement sur l'agent qui la relit ?",
    "",
    `| classe | leçons |`,
    `| --- | ---: |`,
    `| PRODUIT — du code livré la porte | ${by("PRODUIT").length} |`,
    `| DÉPÔT — un gate ou un script la porte | ${by("DÉPÔT").length} |`,
    `| CONTEXTE — relue seulement | ${by("CONTEXTE").length} |`,
    `| INERTE — rien ne la cite | ${by("INERTE").length} |`,
    "",
  ];
  for (const k of ["PRODUIT", "DÉPÔT", "CONTEXTE", "INERTE"]) {
    lines.push(`## ${k}`, "");
    for (const l of by(k).sort((a, b) => a.slug.localeCompare(b.slug))) {
      const carriers =
        [...l.product, ...l.repo].slice(0, 3).join(" · ") ||
        l.scripts.map((s) => `npm run ${s}`).join(" · ");
      lines.push(
        `- **${l.slug}** — ${carriers || `cité dans ${l.citedIn} artefact(s)`}`,
      );
    }
    lines.push("");
  }
  if (dead.length > 0) {
    lines.push("## Ancres MORTES — le porteur cité n'existe plus", "");
    for (const d of dead) lines.push(`- ${d.slug} → \`${d.target}\``);
    lines.push("");
  }
  return lines.join("\n");
}

const root = process.cwd();
const dir = memoryDir(root);
if (!existsSync(dir)) {
  console.log(
    `ℹ️  aucune mémoire sous ${dir} — rien à mesurer (clone neuf, ou forge).`,
  );
  process.exit(0);
}

const { lessons, dead } = classify(root, dir);
const count = (k) => lessons.filter((l) => l.klass === k).length;

console.log(`\nLeçons durables : ${lessons.length}\n`);
console.log(
  `  PRODUIT  ${String(count("PRODUIT")).padStart(3)}  du code livré la porte — une app générée en profite`,
);
console.log(
  `  DÉPÔT    ${String(count("DÉPÔT")).padStart(3)}  un gate, un script ou un flux de forge la porte`,
);
console.log(
  `  CONTEXTE ${String(count("CONTEXTE")).padStart(3)}  relue seulement — ne tient que si on y pense`,
);
console.log(
  `  INERTE   ${String(count("INERTE")).padStart(3)}  rien ne la cite — le trou`,
);

const inert = lessons.filter((l) => l.klass === "INERTE");
if (inert.length > 0) {
  console.log(`\n🕳️  ${inert.length} inerte(s) — \`--inert\` pour la liste.`);
  if (process.argv.includes("--inert"))
    for (const l of inert) console.log(`   ${l.slug}`);
}
if (dead.length > 0) {
  console.log(
    `\n💀 ${dead.length} ancre(s) MORTE(S) — le porteur cité n'existe plus (\`--dead\` pour la liste).`,
  );
  if (process.argv.includes("--dead"))
    for (const d of dead) console.log(`   ${d.slug} → ${d.target}`);
}

if (process.argv.includes("--write")) {
  const out = path.join(root, ".ai", "LESSONS.md");
  writeFileSync(out, render(lessons, dead), "utf8");
  console.log(`\n✍️  empreinte écrite : ${path.relative(root, out)}`);
}

process.exit(process.argv.includes("--strict") && dead.length > 0 ? 1 : 0);
