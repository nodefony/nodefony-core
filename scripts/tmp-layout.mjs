#!/usr/bin/env node
/**
 * Arborescence de `tmp/` — seule implémentation : la table, les dossiers, le
 * `tmp/README.md`, la purge.
 *
 * `tmp/` est l'atelier jetable du dépôt : rapports, journaux, bancs, profils,
 * applications générées. Sans règle, chaque agent y posait ses fichiers à la
 * racine sous un nom de circonstance (`er2.log`, `516-avant.log`, `x.html`) —
 * 184 entrées et 2,1 Go en un mois, plus des `isolate-*.log` et quatre `dist-*`
 * à la racine du dépôt. Un fichier dont on ne sait plus à quoi il sert ne se
 * supprime plus : il s'accumule.
 *
 * La table {@link TMP_LAYOUT} est la règle ; le `README.md` qu'écrit ce script
 * en est la copie lisible, régénérée à chaque passage (jamais éditée à la main).
 * Tout ce qui est jetable vieillit : au-delà de {@link MAX_AGE_MS}, `--prune`
 * le supprime. Ce qui doit survivre ne vit pas ici — il se commite, ou part
 * dans un ticket.
 *
 * CLI :
 *   node scripts/tmp-layout.mjs                    # crée les dossiers + README, signale les égarés
 *   node scripts/tmp-layout.mjs --prune            # + supprime les fichiers de plus de 48 h
 *   node scripts/tmp-layout.mjs --prune --dry-run  # dit ce que --prune supprimerait
 *   node scripts/tmp-layout.mjs --check            # code 1 si tmp/ ou la racine ont des égarés
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { holder, refusal } from "./long-run-lock.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Racine de l'atelier jetable. */
export const TMP_DIR = path.join(ROOT, "tmp");

/** Au-delà, un fichier de `tmp/` est jetable : 48 heures. */
export const MAX_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Les catégories de `tmp/` — un dossier par NATURE de sortie, jamais par ticket
 * ni par session : la date et le sujet vont dans le NOM du fichier.
 *
 * @type {ReadonlyArray<{ dir: string, purpose: string, examples: string }>}
 */
export const TMP_LAYOUT = Object.freeze([
  {
    dir: "runs",
    purpose:
      "journaux capturés EN ENTIER : tests, build, typecheck, gates, campagnes",
    examples: "runs/2026-10-04-test-all.log, runs/http-integration.log",
  },
  {
    dir: "reports",
    purpose: "rapports HTML destinés à un humain (skill nodefony-html-report)",
    examples: "reports/bench-report.html, reports/api-diff/<version>/",
  },
  {
    dir: "sites",
    purpose: "rendus LOCAUX des sites publics (documentation, perf, qualité)",
    examples: "sites/docs/, sites/perf/, sites/quality/",
  },
  {
    dir: "bench",
    purpose: "bancs de charge et de perf : leurs applications, bases, archives",
    examples: "bench/multipod/, bench/archive/<horodatage>/, bench/express.db",
  },
  {
    dir: "profiles",
    purpose:
      "profils CPU, journaux V8 (`--prof --logfile=tmp/profiles/v8-%p.log`), échantillons d'attente",
    examples: "profiles/nodefony/, profiles/wait/, profiles/span/",
  },
  {
    dir: "apps",
    purpose: "applications générées pour un essai (`nodefony create app`…)",
    examples: "apps/essai-pnpm/, apps/ng-app/",
  },
  {
    dir: "browser",
    purpose:
      "captures et mesures du navigateur piloté (skill nodefony-browser)",
    examples: "browser/supervision-….png, browser/lighthouse.json",
  },
  {
    dir: "scratch",
    purpose:
      "brouillons, patchs, corps de ticket, sondes ponctuelles, espaces de travail d'outils",
    examples: "scratch/ticket-519.md, scratch/doc-work/",
  },
]);

/**
 * Entrées de `tmp/` qui appartiennent au RUNTIME, pas à l'atelier : jamais
 * purgées, jamais signalées comme égarées.
 *
 * - `upload` : dossier d'upload de l'application de dev (`nodefony.config.ts`),
 *   relu par les bancs de résidus d'upload ;
 * - `long-run.lock` : le verrou d'un run long (`scripts/long-run-lock.mjs`).
 */
export const RUNTIME_ENTRIES = Object.freeze(["upload", "long-run.lock"]);

/** Le README régénéré : présent dans `tmp/`, donc jamais égaré ni purgé. */
const README = "README.md";

/**
 * Ce qui a le droit d'exister NON versionné à la racine du dépôt : le runtime
 * de l'application de dev, les dépendances, les caches d'outils et les réglages
 * personnels. Tout autre artefact généré y est un égaré — sa place est sous
 * `tmp/<catégorie>/`.
 *
 * `release/` y figure tant que la chaîne de publication y empaquette : la
 * déplacer touche une chaîne dont une erreur brûle une version.
 */
export const ROOT_UNTRACKED_ALLOWED = Object.freeze([
  "dist",
  "var",
  "logs",
  "node_modules",
  "tmp",
  "release",
  ".turbo",
  ".vscode",
  ".idea",
  ".env.local",
  ".DS_Store",
]);

/**
 * Les égarés de la racine du dépôt, parmi les chemins non versionnés qu'en
 * donne `git status --ignored --porcelain`.
 *
 * Fonction PURE : la liste vient de l'appelant, ce qui la rend éprouvable sans
 * dépôt. Seules les entrées de PREMIER niveau comptent — un chemin profond
 * appartient à un dossier qui, lui, est jugé.
 *
 * @param {string[]} porcelainLines - lignes `!! chemin` et `?? chemin`
 * @returns {string[]}
 */
export function rootStrays(porcelainLines) {
  const allowed = new Set(ROOT_UNTRACKED_ALLOWED);
  const strays = new Set();
  for (const line of porcelainLines) {
    if (!line.startsWith("!! ") && !line.startsWith("?? ")) continue;
    const top = line.slice(3).replace(/\/$/u, "");
    if (top.includes("/")) continue;
    if (!allowed.has(top)) strays.add(top);
  }
  return [...strays].sort();
}

/**
 * Rend le `tmp/README.md` depuis la table — sa seule source.
 *
 * @returns {string}
 */
export function renderReadme() {
  const rows = TMP_LAYOUT.map(
    (c) => `| \`${c.dir}/\` | ${c.purpose} | ${c.examples} |`,
  ).join("\n");
  return `# tmp/ — atelier jetable

> Fichier RÉGÉNÉRÉ par \`node scripts/tmp-layout.mjs\` depuis la table
> \`TMP_LAYOUT\` : ne pas l'éditer, éditer la table.

Tout fichier se range dans UNE catégorie. **Rien à la racine de \`tmp/\`** : la
date et le sujet vont dans le nom du fichier, jamais dans un dossier neuf.
Au-delà de 48 h, tout est jetable (\`node scripts/tmp-layout.mjs --prune\`) : ce
qui doit survivre se commite ou part dans un ticket.

| Dossier | Contenu | Exemples |
| --- | --- | --- |
${rows}

Hors atelier, jamais touchés : ${RUNTIME_ENTRIES.map((e) => `\`${e}\``).join(", ")}.
`;
}

/**
 * Crée les dossiers de la table et régénère le README.
 *
 * @param {string} [tmp] - racine (les tests en passent une temporaire).
 */
export function ensureLayout(tmp = TMP_DIR) {
  for (const c of TMP_LAYOUT)
    mkdirSync(path.join(tmp, c.dir), { recursive: true });
  writeFileSync(path.join(tmp, README), renderReadme());
}

/**
 * Les entrées de la racine de `tmp/` qui ne sont ni une catégorie, ni le
 * runtime, ni le README : ce qu'un outil ou un agent a posé à côté.
 *
 * @param {string} [tmp]
 * @returns {string[]}
 */
export function strayEntries(tmp = TMP_DIR) {
  if (!existsSync(tmp)) return [];
  const known = new Set([
    ...TMP_LAYOUT.map((c) => c.dir),
    ...RUNTIME_ENTRIES,
    README,
  ]);
  return readdirSync(tmp)
    .filter((e) => !known.has(e) && e !== ".DS_Store")
    .sort();
}

/**
 * Les fichiers jetables : plus vieux que `maxAgeMs`, hors runtime et README.
 *
 * @param {string} [tmp]
 * @param {number} [now] - horloge injectable (tests).
 * @param {number} [maxAgeMs]
 * @returns {string[]} chemins absolus
 */
export function expiredFiles(
  tmp = TMP_DIR,
  now = Date.now(),
  maxAgeMs = MAX_AGE_MS,
) {
  if (!existsSync(tmp)) return [];
  const skip = new Set([...RUNTIME_ENTRIES, README]);
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (now - statSync(full).mtimeMs > maxAgeMs) out.push(full);
    }
  };
  for (const entry of readdirSync(tmp, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(tmp, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (now - statSync(full).mtimeMs > maxAgeMs) out.push(full);
  }
  return out;
}

/**
 * Supprime les dossiers devenus vides, sauf les catégories et le runtime.
 *
 * @param {string} [tmp]
 */
function removeEmptyDirs(tmp = TMP_DIR) {
  const keep = new Set([...TMP_LAYOUT.map((c) => c.dir), ...RUNTIME_ENTRIES]);
  /**
   * @param {string} dir
   * @returns {boolean} vide après nettoyage
   */
  const sweep = (dir) => {
    let empty = true;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && sweep(full)) rmdirSync(full);
      else empty = false;
    }
    return empty;
  };
  for (const entry of readdirSync(tmp, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(tmp, entry.name);
    if (sweep(full) && !keep.has(entry.name)) rmdirSync(full);
  }
}

/**
 * Purge les fichiers expirés et les dossiers qu'ils laissent vides.
 *
 * @param {string} [tmp]
 * @param {number} [now]
 * @returns {string[]} les fichiers supprimés
 */
export function prune(tmp = TMP_DIR, now = Date.now()) {
  const files = expiredFiles(tmp, now);
  for (const f of files) rmSync(f, { force: true });
  removeEmptyDirs(tmp);
  return files;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = new Set(process.argv.slice(2));
  ensureLayout();
  if (args.has("--prune")) {
    // Un run long lit des fichiers récents, jamais des fichiers de deux jours :
    // la purge ne le menace pas. Mais elle reste un geste destructeur pendant
    // qu'il juge l'arbre — on attend, comme pour une édition.
    const lock = holder();
    if (lock && !args.has("--dry-run")) {
      console.error(refusal(lock));
      process.exit(1);
    }
    const files = args.has("--dry-run") ? expiredFiles() : prune();
    const verb = args.has("--dry-run") ? "à supprimer" : "supprimés";
    console.log(`tmp/ — ${files.length} fichier(s) de plus de 48 h ${verb}`);
  }
  const strays = strayEntries();
  if (strays.length) {
    console.log(
      `tmp/ — ${strays.length} entrée(s) hors catégorie (voir tmp/README.md) :\n` +
        strays.map((s) => `  ${s}`).join("\n"),
    );
  } else {
    console.log("tmp/ — rangé : chaque entrée est dans une catégorie");
  }
  const status = spawnSync("git", ["status", "--ignored", "--porcelain"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const roots = rootStrays(status.stdout.split("\n"));
  if (roots.length) {
    console.log(
      `racine du dépôt — ${roots.length} artefact(s) généré(s) hors place (→ tmp/<catégorie>/) :\n` +
        roots.map((s) => `  ${s}`).join("\n"),
    );
  } else {
    console.log("racine du dépôt — propre : rien de généré hors runtime");
  }
  if (args.has("--check") && (strays.length || roots.length)) process.exit(1);
}
