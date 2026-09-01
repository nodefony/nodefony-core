// Recale les ancres `fichier.ts:N` SUSPECT d'une page de doc, par SYMBOLE.
// Entrée : la sortie d'anchor-check.mjs (stdin). Sortie : édite les .md en place.
// Règle : on ne déplace une ancre que si UNE seule ligne de définition plausible
// est trouvée pour les symboles cités — sinon on laisse et on le signale.
import fs from "node:fs";
import path from "node:path";

const REPO = process.argv[2] ?? process.cwd();
const APPLY = process.argv.includes("--apply");
// Mode PROPOSITION : pour les suspects qu'aucune définition ne résout — un
// littéral (`NF_BOOT_TIMEOUT_MS`), une clé de config, un code d'erreur — dire OÙ
// le terme apparaît réellement dans le fichier cible, au lieu de se taire.
// Il ne modifie RIEN : c'est au relecteur de trancher, parce qu'une ancre
// plausible et fausse coûte plus cher qu'une ancre visiblement périmée.
const SUGGEST = process.argv.includes("--suggest");
// Applique le repli par OCCURRENCE, mais aux seuls termes DISCRIMINANTS (voir
// `occurrenceLine`). Sans ce garde-fou on recale sur un `Map` ou un `try`, et on
// fabrique une ancre plausible — plus coûteuse qu'une ancre visiblement périmée,
// parce que plus personne ne la rouvre.
const OCCURRENCES = process.argv.includes("--occurrences");
const report = fs.readFileSync(0, "utf8").split("\n");

const RE =
  /^\s+\[SUSPECT\] l\.(\d+) ([^ ]+):(\d+) → ([^ ]+) — symboles introuvables autour: (.+)$/;
let currentMd = null;
const jobs = [];
for (const line of report) {
  const md = line.match(/^❌ (.+\.md)$/);
  if (md) {
    currentMd = md[1];
    continue;
  }
  const m = line.match(RE);
  if (m && currentMd) {
    jobs.push({
      md: currentMd,
      mdLine: Number(m[1]),
      ref: m[2],
      oldLine: Number(m[3]),
      target: m[4],
      symbols: m[5].split(",").map((s) => s.trim()),
    });
  }
}

/** Lignes où `sym` est DÉFINI (déclaration), pas simplement mentionné. */
function definitionLines(lines, sym) {
  const bare = sym.replace(/^#/, "");
  const esc = bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Fortes = vraies déclarations. Faible = champ/propriété (`  #x = …`), qui
  // attrape aussi un PARAMÈTRE de type (`  publish: RealtimePublish,`) : à
  // n'utiliser que si aucune forte ne répond.
  const strong = [
    new RegExp(`^\\s*(export\\s+)?(abstract\\s+)?class\\s+${esc}\\b`),
    new RegExp(`^\\s*(export\\s+)?interface\\s+${esc}\\b`),
    new RegExp(`^\\s*(export\\s+)?(async\\s+)?function\\s+${esc}\\b`),
    new RegExp(`^\\s*(export\\s+)?(declare\\s+)?const\\s+${esc}\\b`),
    new RegExp(`^\\s*(export\\s+)?type\\s+${esc}\\b`),
    new RegExp(`^\\s*(export\\s+)?enum\\s+${esc}\\b`),
    // méthode / accesseur / champ privé d'une classe
    new RegExp(
      `^\\s{2,}(public |private |protected |static |readonly )*(async )?(get |set )?#?${esc}\\s*[(<]`,
    ),
  ];
  const weak = [new RegExp(`^\\s{2,}#?${esc}\\s*[:=]`)];
  const hit = (pats) => {
    const out = [];
    lines.forEach((l, i) => {
      if (pats.some((p) => p.test(l))) out.push(i + 1);
    });
    return out;
  };
  const s = hit(strong);
  return s.length > 0 ? s : hit(weak);
}

const cache = new Map();
function linesOf(rel) {
  if (!cache.has(rel))
    cache.set(rel, fs.readFileSync(path.join(REPO, rel), "utf8").split("\n"));
  return cache.get(rel);
}
const mdCache = new Map();
function mdLinesOf(md) {
  if (!mdCache.has(md))
    mdCache.set(md, fs.readFileSync(md, "utf8").split("\n"));
  return mdCache.get(md);
}

/**
 * Le symbole que l'ancre PROUVE = le dernier identifiant entre backticks placé
 * avant elle (ligne courante, sinon fin de la ligne précédente : prettier coupe
 * entre le symbole et son ancre). Sans ça, `RealtimeHub.publish()` et
 * `publishLocal()` retombent tous deux sur la classe — une ancre juste au sens
 * du gate, fausse au sens du lecteur.
 */
function citedSymbol(md, mdLine, ref, oldLine) {
  const lines = mdLinesOf(md);
  const cur = lines[mdLine - 1] ?? "";
  const at = cur.indexOf(`${ref}:${oldLine}`);
  const before = (at > 0 ? cur.slice(0, at) : "") || "";
  const scope = (lines[mdLine - 2] ?? "") + " " + before;
  const ticks = [...scope.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  for (let i = ticks.length - 1; i >= 0; i--) {
    const t = ticks[i];
    if (t.includes(".ts:") || t.includes("/")) continue; // c'est une autre ancre
    const name = t
      .replace(/\(.*$/, "")
      .split(".")
      .pop()
      ?.replace(/[^A-Za-z0-9_#]/g, "");
    if (name && name.length > 1) return name;
  }
  return null;
}

/**
 * Où le terme apparaît-il VRAIMENT dans le fichier cible ?
 *
 * Un littéral n'a pas de ligne de définition : `NF_BOOT_TIMEOUT_MS` se LIT
 * (`process.env.NF_BOOT_TIMEOUT_MS`), `unauthorized` se RENVOIE. Le repli
 * remonte donc les occurrences, les plus proches de l'ancre d'abord — et dit
 * explicitement quand il n'y en a AUCUNE : ce cas-là n'est pas une ancre
 * décalée, c'est une affirmation que le code ne porte plus (symbole renommé ou
 * supprimé), et elle se corrige en RÉÉCRIVANT la phrase, jamais en bougeant un
 * numéro de ligne.
 */
function occurrenceHint(lines, cited, symbols, oldLine) {
  for (const term of new Set([cited, ...symbols].filter(Boolean))) {
    const esc = term.replace(/^#/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${esc}\\b`);
    const hits = [];
    lines.forEach((l, i) => {
      if (re.test(l)) hits.push(i + 1);
    });
    if (!hits.length) continue;
    const proches = hits
      .sort((a, b) => Math.abs(a - oldLine) - Math.abs(b - oldLine))
      .slice(0, 3);
    return `→ « ${term} » apparaît l. ${proches.join(", ")}`;
  }
  return `→ AUCUN des termes n'apparaît dans le fichier : réécrire la phrase, pas l'ancre`;
}

/**
 * Ligne d'OCCURRENCE retenue pour un terme sans déclaration, ou `null`.
 *
 * Deux conditions, toutes deux nées d'un faux recalage : le terme fait au moins
 * cinq caractères (`Map`, `try`, `dev` ne désignent rien), et il apparaît au
 * plus cinq fois dans le fichier (au-delà il n'est pas discriminant — `production`
 * se lit partout dans un kernel). La ligne retenue est la plus proche de l'ancre
 * d'origine : le code a grandi autour d'elle, il n'a pas déménagé.
 */
/**
 * Termes qui passent le filtre de longueur sans rien désigner : mots-clés du
 * langage, mots de prose, et le nom du projet — qui se lit dans chaque chemin
 * d'import de chaque fichier. Recaler dessus produit une ancre parfaitement
 * plausible et parfaitement fausse.
 */
const VAGUE = new Set([
  "class",
  "const",
  "interface",
  "function",
  "return",
  "extends",
  "implements",
  "nodefony",
  "node_modules",
  "container",
  "module",
  "modules",
  "config",
  "options",
  "value",
  "result",
  "error",
  "string",
  "number",
  "boolean",
  "production",
  "development",
  "static",
  "public",
  "private",
  "default",
]);
function occurrenceLine(lines, cited, symbols, oldLine) {
  for (const term of new Set([cited, ...symbols].filter(Boolean))) {
    const bare = term.replace(/^#/, "");
    if (bare.length < 5) continue;
    if (VAGUE.has(bare.toLowerCase())) continue;
    const esc = bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${esc}\\b`);
    const hits = [];
    lines.forEach((l, i) => {
      if (re.test(l)) hits.push(i + 1);
    });
    if (!hits.length || hits.length > 5) continue;
    return {
      line: hits.sort(
        (a, b) => Math.abs(a - oldLine) - Math.abs(b - oldLine),
      )[0],
      term,
      count: hits.length,
    };
  }
  return null;
}

const occurrenceLog = [];
const edits = new Map(); // md -> [{mdLine, from, to}]
const skipped = [];
for (const j of jobs) {
  const lines = linesOf(j.target);
  // Symbole cité en premier, puis les symboles du rapport du plus spécifique au
  // moins spécifique (le nom du fichier cible est le moins informatif).
  const base = path.basename(j.target).replace(/\.(ts|mjs|tsx)$/, "");
  const cited = citedSymbol(j.md, j.mdLine, j.ref, j.oldLine);
  const ordered = [
    ...(cited ? [cited] : []),
    ...j.symbols.filter((s) => s !== base && s !== cited),
    ...j.symbols.filter((s) => s === base),
  ];
  let best = null;
  for (const s of ordered) {
    const cands = definitionLines(lines, s);
    if (cands.length === 0) continue;
    best = cands.sort(
      (a, b) => Math.abs(a - j.oldLine) - Math.abs(b - j.oldLine),
    )[0];
    break;
  }
  if (best === null && OCCURRENCES) {
    const occ = occurrenceLine(lines, cited, j.symbols, j.oldLine);
    if (occ) {
      best = occ.line;
      occurrenceLog.push(
        `${j.md}:${j.mdLine} ${j.ref}:${j.oldLine} → ${occ.line} (occurrence de « ${occ.term} », ${occ.count}×)`,
      );
    }
  }
  if (best === null) {
    let detail = `aucune définition trouvée (${j.symbols.join("/")})`;
    if (SUGGEST)
      detail += ` ${occurrenceHint(lines, cited, j.symbols, j.oldLine)}`;
    skipped.push(`${j.md}:${j.mdLine} ${j.ref}:${j.oldLine} — ${detail}`);
    continue;
  }
  if (best === j.oldLine) continue;
  if (!edits.has(j.md)) edits.set(j.md, []);
  edits.get(j.md).push({
    mdLine: j.mdLine,
    from: `${j.ref}:${j.oldLine}`,
    to: `${j.ref}:${best}`,
  });
}

let n = 0;
for (const [md, list] of edits) {
  const lines = fs.readFileSync(md, "utf8").split("\n");
  for (const e of list) {
    const idx = e.mdLine - 1;
    if (!lines[idx]?.includes(e.from)) {
      skipped.push(`${md}:${e.mdLine} — motif "${e.from}" absent de la ligne`);
      continue;
    }
    lines[idx] = lines[idx].split(e.from).join(e.to);
    n++;
  }
  if (APPLY) fs.writeFileSync(md, lines.join("\n"));
}
console.log(
  `${n} ancre(s) recalée(s)${APPLY ? "" : " (dry-run)"} sur ${jobs.length} suspectes`,
);
for (const s of occurrenceLog) console.log(`  ↪ ${s}`);
for (const s of skipped) console.log(`  ⚠ ${s}`);
