#!/usr/bin/env node
/**
 * Banc — éprouve le gate de langue sur du corpus RÉEL, pas sur des cas choisis.
 *
 * `check-identifier-language.mjs` porte 57 cas unitaires, tous verts. Ils
 * prouvent que chaque brique répond comme son auteur l'attendait — ce qui est
 * exactement le reproche qu'on peut leur faire : l'auteur du gate est aussi
 * l'auteur des cas. Un dictionnaire trop maigre les passerait tous.
 *
 * Ce banc pose les deux questions qu'aucun cas unitaire ne pose :
 *
 *  - **A — FAUX POSITIFS.** Le gate crie-t-il sur du code écrit par des
 *    anglophones ? Corpus : les sources TypeScript des dépendances installées.
 *    Il n'a pas été choisi, il ne peut pas être arrangé, et il pèse des
 *    milliers de fichiers. C'est le risque n°1, écrit dans l'en-tête du gate
 *    lui-même : « un gate qui crie faux apprend à passer outre ».
 *  - **B — SENSIBILITÉ.** Le gate mord-il encore ? Des identifiants français
 *    RÉELS, relevés dans ce dépôt, sont injectés dans du code anglais propre :
 *    tous doivent sortir. Sans cette épreuve, un dictionnaire vidé rendrait
 *    lui aussi « 0 faux positif », et le banc le déclarerait excellent.
 *
 * A et B se contredisent par construction — élargir le dictionnaire fait
 * monter A, le rétrécir fait tomber B. C'est voulu : un seul chiffre ne dit
 * rien, le couple dit où se trouve le réglage.
 *
 * Une épreuve **C — VÉRITÉ TERRAIN** rend un échantillon des constats du
 * dépôt pour lecture humaine : ni A ni B ne peuvent juger si `#cablerAgents`
 * méritait de sortir, seul un humain le peut.
 *
 * 🔴 **Garde de corpus.** `node_modules/nodefony`, `node_modules/create-nodefony`
 * et `node_modules/@nodefony/*` sont des LIENS vers les sources de ce dépôt.
 * Les traverser ferait mesurer mon propre français et conclure « le gate crie
 * faux » sur 797 constats parfaitement justes. Le banc refuse donc tout lien
 * symbolique — garde générale, qui couvre aussi les liens non énumérés ici.
 *
 * @usage   node scripts/bench-identifier-language.mjs
 * @usage   node scripts/bench-identifier-language.mjs --limit 4000 --json
 * @output  taux de faux positifs par paquet, sensibilité, échantillon terrain ;
 *          sortie 1 si un seuil est franchi, 0 sinon, 2 sur erreur d'usage.
 */
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  analyzeSource,
  extractDeclaredIdentifiers,
  scanRepo,
  stripProse,
} from "./check-identifier-language.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ═══════════════════════════════════════════════════════════════════════════
// 1. CORPUS — collecte bornée, qui REFUSE les liens symboliques.
// ═══════════════════════════════════════════════════════════════════════════

/** Dossiers de `node_modules` qui ne portent pas de source utile. */
const SKIPPED_DIRS = new Set([
  ".bin",
  ".cache",
  ".package-lock.json",
  "dist",
  "build",
  "coverage",
  "test",
  "tests",
  "__tests__",
  "fixtures",
]);

/**
 * Collecte les sources TypeScript tierces installées sous `node_modules`.
 *
 * Ne suit AUCUN lien symbolique (`lstatSync`) : c'est ce qui tient les paquets
 * du dépôt hors du corpus « tiers ». Écarte aussi les `.d.ts`, qui sont
 * souvent générés et pauvres en identifiants déclarés.
 *
 * @param limit - nombre maximum de fichiers à retenir
 * @returns `[{ file, pkg }]`, chemins relatifs à la racine du dépôt
 */
function collectThirdPartySources(limit) {
  const out = [];
  const base = path.join(ROOT, "node_modules");
  let root;
  try {
    root = readdirSync(base).sort();
  } catch {
    return out;
  }
  for (const entry of root) {
    if (out.length >= limit) break;
    if (entry.startsWith(".")) continue;
    const abs = path.join(base, entry);
    // Un lien = un paquet du dépôt (workspace) : hors corpus tiers.
    if (!isRealDirectory(abs)) continue;
    if (entry.startsWith("@")) {
      for (const scoped of readdirSync(abs).sort()) {
        if (out.length >= limit) break;
        const scopedAbs = path.join(abs, scoped);
        if (!isRealDirectory(scopedAbs)) continue;
        walkPackage(scopedAbs, `${entry}/${scoped}`, out, limit);
      }
    } else walkPackage(abs, entry, out, limit);
  }
  return out;
}

/** `true` si le chemin est un dossier RÉEL — un lien symbolique rend `false`. */
function isRealDirectory(abs) {
  try {
    return lstatSync(abs).isDirectory();
  } catch {
    return false;
  }
}

/** Marche récursive dans un paquet, liens refusés, dossiers stériles sautés. */
function walkPackage(abs, pkg, out, limit) {
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= limit) return;
    if (e.isSymbolicLink()) continue;
    const child = path.join(abs, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || SKIPPED_DIRS.has(e.name)) continue;
      walkPackage(child, pkg, out, limit);
    } else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) {
      out.push({ file: path.relative(ROOT, child), pkg });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. ÉPREUVE A — FAUX POSITIFS sur du code écrit par des anglophones.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Passe le gate sur le corpus tiers et rend ce qu'il a crié.
 *
 * Un cri est un FAUX POSITIF présumé : le corpus n'a pas été choisi, et les
 * paquets installés ici sont écrits en anglais. Un mot qui revient chez
 * plusieurs éditeurs indépendants accuse le dictionnaire, pas les auteurs.
 *
 * 🔴 **Le dénominateur est compté, et il est le seul qui compte.** « 3 cris sur
 * 1 400 fichiers » ne dit rien : un corpus de fichiers vides rendrait le même
 * chiffre. Le taux qui vaut quelque chose est celui rapporté aux identifiants
 * effectivement JUGÉS. Il est obtenu en rejouant `stripProse` +
 * `extractDeclaredIdentifiers` — les fonctions mêmes du gate, jamais une copie
 * qui divergerait — au prix d'un second blanchiment par fichier.
 *
 * @param limit - borne du corpus
 * @returns `{ scanned, judged, distinct, findings, byWord, byPackage, rate }`
 */
function proveNoFalsePositives(limit) {
  const corpus = collectThirdPartySources(limit);
  const findings = [];
  const byWord = new Map();
  const byPackage = new Map();
  const distinct = new Set();
  let judged = 0;
  for (const { file, pkg } of corpus) {
    let source;
    try {
      source = readFileSync(path.join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    for (const { name } of extractDeclaredIdentifiers(stripProse(source))) {
      judged++;
      distinct.add(name);
    }
    for (const finding of analyzeSource(source, file)) {
      findings.push({ ...finding, pkg });
      byPackage.set(pkg, (byPackage.get(pkg) ?? 0) + 1);
      for (const w of finding.words) {
        let stat = byWord.get(w.french);
        if (stat === undefined) {
          stat = { word: w.french, hits: 0, packages: new Set(), samples: [] };
          byWord.set(w.french, stat);
        }
        stat.hits++;
        stat.packages.add(pkg);
        if (stat.samples.length < 4) stat.samples.push(finding.identifier);
      }
    }
  }
  return {
    scanned: corpus.length,
    judged,
    distinct: distinct.size,
    findings,
    rate: judged ? findings.length / judged : 0,
    byWord: [...byWord.values()]
      .map(({ word, hits, packages, samples }) => ({
        word,
        hits,
        samples,
        packages: [...packages].sort(),
      }))
      .sort((a, b) => b.packages.length - a.packages.length || b.hits - a.hits),
    byPackage: [...byPackage.entries()]
      .map(([pkg, hits]) => ({ pkg, hits }))
      .sort((a, b) => b.hits - a.hits),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. ÉPREUVE B — SENSIBILITÉ : le gate mord-il encore ?
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gabarit de code ANGLAIS où l'on vient greffer un identifiant à juger.
 *
 * Écrit pour traverser toute la chaîne — collecte, blanchiment de la prose,
 * extraction des déclarations, jugement —, pas seulement `judgeIdentifier` :
 * une brique éprouvée seule ne prouve pas la chaîne.
 */
function frenchSpecimen(identifier) {
  return `/**
 * Un commentaire en français, parfaitement légitime : la prose reste française.
 * Il parle de contrôles sautés, de données rendues, de fenêtres ouvertes.
 */
export function ${identifier}(input: string): string {
  const label = "un libellé français dans une chaîne, tout aussi légitime";
  return label + input;
}
`;
}

/**
 * Identifiants français RELEVÉS DANS CE DÉPÔT, un par convention et par
 * famille de mots. Ils viennent du terrain — pas d'un cas construit qui
 * arrangerait le dictionnaire.
 */
const REAL_FRENCH_IDENTIFIERS = [
  "rendreRapport",
  "controlesSautes",
  "largeurUtile",
  "monterDecor",
  "grouperCommandes",
  "cablerAgents",
  "LIMITE_MS",
  "FenetreOuverte",
  "donneesChargees",
  "verifierEmpreinte",
  "jetonAbsent",
  "cheminNormalise",
  "seuilDepasse",
  "nombreDeTentatives",
];

/** Identifiants anglais irréprochables — aucun ne doit sortir. */
const CONTROL_ENGLISH_IDENTIFIERS = [
  "renderReport",
  "skippedChecks",
  "usableWidth",
  "setUpFixture",
  "groupCommands",
  "wireAgents",
  "TIMEOUT_MS",
  "OpenWindow",
  "loadedData",
  "verifyFingerprint",
  "missingToken",
  "normalizedPath",
  "thresholdExceeded",
  "retryCount",
];

/**
 * Injecte chaque identifiant dans un fichier de code et vérifie le verdict.
 *
 * C'est le débranchement du banc : si le dictionnaire était vidé, l'épreuve A
 * rendrait un score parfait et celle-ci s'effondrerait. Les deux ensemble
 * bornent le réglage.
 *
 * @returns `{ caught, missed, falseAlarms, sensitivity }`
 */
function proveGateStillBites() {
  const missed = [];
  const falseAlarms = [];
  for (const identifier of REAL_FRENCH_IDENTIFIERS) {
    const findings = analyzeSource(frenchSpecimen(identifier), "specimen.ts");
    if (!findings.some((f) => f.identifier === identifier))
      missed.push(identifier);
  }
  for (const identifier of CONTROL_ENGLISH_IDENTIFIERS) {
    const findings = analyzeSource(frenchSpecimen(identifier), "specimen.ts");
    const hit = findings.find((f) => f.identifier === identifier);
    if (hit) falseAlarms.push({ identifier, words: hit.words });
  }
  const total = REAL_FRENCH_IDENTIFIERS.length;
  return {
    caught: total - missed.length,
    total,
    missed,
    falseAlarms,
    sensitivity: total ? (total - missed.length) / total : 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. ÉPREUVE C — VÉRITÉ TERRAIN : ce que seul un humain peut trancher.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rend un échantillon DÉTERMINISTE des constats du dépôt, pour lecture.
 *
 * L'échantillon est pris à pas régulier sur la liste triée : deux exécutions
 * rendent le même échantillon, et l'on peut donc comparer un avant/après sans
 * qu'un tirage au sort brouille la mesure.
 *
 * @param sampleSize - nombre de constats à rendre
 */
function sampleRepositoryFindings(sampleSize) {
  const result = scanRepo({ root: ROOT });
  const all = [...result.findings].sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1,
  );
  if (all.length === 0) return { total: 0, sample: [] };
  const step = Math.max(1, Math.floor(all.length / sampleSize));
  const sample = [];
  for (let i = 0; i < all.length && sample.length < sampleSize; i += step)
    sample.push(all[i]);
  return { total: all.length, scanned: result.scanned, sample };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. RAPPORT — un verdict, puis les chiffres qui le fondent.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Seuils au-delà desquels le banc rend un échec.
 *
 * Le critère de l'épreuve A n'est PAS un taux — un taux se règle en changeant
 * la taille du corpus, et il ne dit pas si le mot fautif est une exception
 * locale ou un défaut du dictionnaire. Le critère est la CONVERGENCE : un mot
 * que plusieurs éditeurs indépendants emploient dans leurs identifiants est un
 * mot anglais, quoi qu'en dise le dictionnaire. Un cri isolé chez un seul
 * paquet peut, lui, être du vrai français chez un tiers francophone.
 */
const THRESHOLDS = {
  /** Nombre d'éditeurs distincts à partir duquel un mot accuse le dictionnaire. */
  convergentPackages: 2,
  /** Part des identifiants français réels que le gate doit attraper. */
  sensitivity: 1,
  /**
   * Identifiants tiers à juger EN DESSOUS DESQUELS le banc refuse de conclure.
   *
   * 🔴 Sans cette borne, un corpus absent — `node_modules` pas encore installé,
   * une forge fraîche, un `--limit` mal posé — rendrait « 0 faux positif » et le
   * banc se déclarerait vert SANS AVOIR RIEN MESURÉ. C'est le mode de panne le
   * plus coûteux d'un instrument : il ne tombe pas, il rassure. Le banc doit
   * dire « je n'ai pas pu mesurer », jamais « tout va bien ».
   */
  minimumJudged: 10_000,
};

/** Mots du dictionnaire mis en cause par plusieurs éditeurs indépendants. */
function convergentWords(falsePositives) {
  return falsePositives.byWord.filter(
    (w) => w.packages.length >= THRESHOLDS.convergentPackages,
  );
}

function formatReport(bench) {
  const { falsePositives: fp, sensitivity: sens, terrain } = bench;
  const out = [];
  const convergent = convergentWords(fp);
  const perTenThousand = fp.judged
    ? (fp.findings.length / fp.judged) * 10000
    : 0;
  const measured = fp.judged >= THRESHOLDS.minimumJudged;
  const fpOk = measured && convergent.length === 0;
  const sensOk =
    sens.sensitivity >= THRESHOLDS.sensitivity && sens.falseAlarms.length === 0;

  out.push("═══ Banc du gate de langue ═══", "");
  if (!measured)
    out.push(
      `⚠️  CORPUS INSUFFISANT — ${fp.judged} identifiants tiers jugés, il en faut ` +
        `${THRESHOLDS.minimumJudged}. Le banc N'A PAS MESURÉ l'épreuve A : ` +
        `installer les dépendances (\`npm ci\`) puis relancer.`,
      "  Un corpus vide rendrait « 0 faux positif » — un vert qui ne prouve rien.",
      "",
    );
  out.push(
    `A — FAUX POSITIFS   ${fpOk ? "✓" : "✗"}  ${fp.findings.length} cri(s) pour ` +
      `${fp.judged} identifiants jugés (${fp.distinct} distincts) dans ${fp.scanned} fichiers tiers` +
      `  — ${perTenThousand.toFixed(2)} pour 10 000`,
    `                       ${convergent.length} mot(s) mis en cause par ` +
      `≥ ${THRESHOLDS.convergentPackages} éditeurs indépendants (seuil : 0)`,
  );
  out.push(
    `B — SENSIBILITÉ     ${sensOk ? "✓" : "✗"}  ${sens.caught}/${sens.total} identifiants français réels attrapés` +
      `, ${sens.falseAlarms.length} fausse(s) alarme(s) sur les témoins anglais`,
  );
  out.push("");

  if (fp.byWord.length) {
    out.push(
      "  Mots du dictionnaire qui ont crié sur du code tiers",
      "  (plusieurs éditeurs indépendants ⇒ le dictionnaire est en cause, pas eux) :",
    );
    for (const w of fp.byWord.slice(0, 25))
      out.push(
        `    ${w.packages.length >= THRESHOLDS.convergentPackages ? "✗" : "·"} ` +
          `${w.word.padEnd(16)} ${String(w.hits).padStart(4)} fois, ` +
          `${w.packages.length} paquet(s) [${w.packages.slice(0, 3).join(", ")}]` +
          `  ex. ${w.samples.slice(0, 3).join(", ")}`,
      );
    if (fp.byWord.length > 25)
      out.push(`    … et ${fp.byWord.length - 25} autre(s) mot(s).`);
    out.push("");
  }

  if (sens.missed.length) {
    out.push(
      "  ✗ NON ATTRAPÉS — le gate laisse passer du français réel du dépôt :",
      ...sens.missed.map((m) => `    ${m}`),
      "",
    );
  }
  if (sens.falseAlarms.length) {
    out.push(
      "  ✗ FAUSSES ALARMES — le gate crie sur des identifiants anglais témoins :",
      ...sens.falseAlarms.map(
        (a) =>
          `    ${a.identifier}  ← ${a.words.map((w) => `${w.word}→${w.french}`).join(", ")}`,
      ),
      "",
    );
  }

  out.push(
    `C — VÉRITÉ TERRAIN     ${terrain.total} constat(s) sur ${terrain.scanned} fichiers du dépôt.`,
    "  Échantillon à pas régulier (déterministe — comparable d'un run à l'autre) :",
  );
  for (const f of terrain.sample)
    out.push(
      `    ${f.file}:${f.line}  ${f.identifier}  ← ` +
        f.words.map((w) => `${w.word}→${w.french}`).join(", "),
    );
  out.push("");
  out.push(
    fpOk && sensOk
      ? "✓ Le gate tient : il ne crie pas sur du code anglais, et il mord toujours."
      : "✗ Le gate est DÉRÉGLÉ — voir les mots ci-dessus avant de lui faire confiance.",
  );
  return out.join("\n");
}

const HELP = `bench-identifier-language — éprouve le gate de langue sur du corpus réel.

Usage : node scripts/bench-identifier-language.mjs [options]

  --limit <n>   borne du corpus tiers (défaut : 1500 fichiers)
  --sample <n>  taille de l'échantillon terrain (défaut : 12)
  --json        rapport JSON sur la sortie standard
  --help        cette aide

Sortie : 0 si le gate tient, 1 si un seuil est franchi, 2 sur erreur d'usage.`;

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }
  let limit = 1500;
  let sampleSize = 12;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--limit" || a === "--sample") {
      const raw = argv[++i];
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        console.error(`${a} attend un entier positif`);
        process.exit(2);
      }
      if (a === "--limit") limit = n;
      else sampleSize = n;
    } else {
      console.error(`option inconnue : ${a}\n\n${HELP}`);
      process.exit(2);
    }
  }

  const bench = {
    falsePositives: proveNoFalsePositives(limit),
    sensitivity: proveGateStillBites(),
    terrain: sampleRepositoryFindings(sampleSize),
  };
  if (json) console.log(JSON.stringify(bench, null, 2));
  else console.log(formatReport(bench));

  const ok =
    bench.falsePositives.judged >= THRESHOLDS.minimumJudged &&
    convergentWords(bench.falsePositives).length === 0 &&
    bench.sensitivity.sensitivity >= THRESHOLDS.sensitivity &&
    bench.sensitivity.falseAlarms.length === 0;
  // `exitCode`, pas `exit()` — voir la note du gate : vers un pipe, `exit()`
  // tronque la sortie JSON avant son vidage.
  process.exitCode = ok ? 0 : 1;
}

export {
  collectThirdPartySources,
  proveNoFalsePositives,
  proveGateStillBites,
  sampleRepositoryFindings,
  THRESHOLDS,
};
