#!/usr/bin/env node
/**
 * scripts-audit — chaque script du dépôt est-il au bon endroit, et quelqu'un l'appelle-t-il ?
 *
 * Un script mal placé ne casse rien : il devient introuvable. Celui qui vit à la racine alors que
 * son résultat dépend d'un protocole se lance sans ce protocole — et rend un chiffre faux. Celui
 * qui vit dans un skill sans que le skill le cite est mort sans que personne le sache.
 *
 * @usage    node .claude/skills/nodefony-skill/scripts/scripts-audit.mjs
 * @usage    node .claude/skills/nodefony-skill/scripts/scripts-audit.mjs --strict
 * @option   --strict  sort en échec dès qu'un script est orphelin ou qu'un renvoi est mort
 * @output   un classement de chaque script : bien placé, à déplacer, orphelin, ou renvoi mort
 *
 * LE CRITÈRE, posé et vérifié en session :
 *   → un script rejoint un SKILL quand son résultat dépend d'un PROTOCOLE (décor à monter, ordre
 *     à respecter, interprétation à faire). Le script produit un chiffre ; le skill en fait une mesure.
 *   → un script reste à la RACINE quand il est déterministe et câblé au package.json : on le lance,
 *     il rend toujours la même chose, il n'y a rien à interpréter.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const STRICT = process.argv.includes("--strict");
const SKILLS_DIR = ".claude/skills";
const ROOT_SCRIPTS = "scripts";
const EXT = [".mjs", ".js", ".sh", ".ts", ".py"];

const isScript = (f) => EXT.some((e) => f.endsWith(e));

/** Tous les scripts du dépôt, hors dépendances et build. */
function collect(dir, out = [], depth = 0) {
  if (!existsSync(dir) || depth > 4) return out;
  for (const e of readdirSync(dir)) {
    if (["node_modules", "dist", ".git", "coverage"].includes(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) collect(p, out, depth + 1);
    else if (isScript(e)) out.push(p);
  }
  return out;
}

// Qui référence quoi : le package.json (scripts npm) et les SKILL.md.
const pkg = existsSync("package.json")
  ? readFileSync("package.json", "utf8")
  : "";
const skillTexts = new Map();
for (const name of readdirSync(SKILLS_DIR)) {
  const f = join(SKILLS_DIR, name, "SKILL.md");
  if (!existsSync(f)) continue;
  let text = readFileSync(f, "utf8");
  const refDir = join(SKILLS_DIR, name, "references");
  if (existsSync(refDir))
    for (const r of readdirSync(refDir))
      if (r.endsWith(".md")) text += readFileSync(join(refDir, r), "utf8");
  skillTexts.set(name, text);
}
const allSkillText = [...skillTexts.values()].join("\n");
const docsText = collectDocs("docs");
function collectDocs(dir, acc = "") {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) acc = collectDocs(p, acc);
    else if (e.endsWith(".md")) acc += readFileSync(p, "utf8");
  }
  return acc;
}

/** Signaux qu'un script dépend d'un protocole — donc qu'il a sa place dans un skill. */
function protocolSignals(path) {
  let src = "";
  try {
    src = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const s = [];
  // Mentionner « docker » ou « localhost » ne suffit pas : un générateur de fichier d'exemple en
  // parle sans jamais s'en servir. On exige un APPEL — lancer le conteneur, frapper le port.
  if (/(?:docker\s+(?:run|exec|compose|ps)|docker-compose)/i.test(src))
    s.push("monte un décor docker");
  if (
    /(?:fetch|request|curl|WebSocket|autocannon|got)\s*\(?["'`]?[^\n]{0,40}(?:localhost|127\.0\.0\.1)/i.test(
      src,
    )
  )
    s.push("frappe un serveur en écoute");
  if (/\b(bench|autocannon|wrk|rps|latenc|percentil|p9\d)\b/i.test(src))
    s.push("mesure une performance");
  if (/\b(median|médiane|warmup|chauff|iterations?|runs?)\b/i.test(src))
    s.push("exige plusieurs runs");
  if (
    /process\.env\.[A-Z]/.test(src) &&
    (src.match(/process\.env\.[A-Z]/g) || []).length > 3
  )
    s.push("piloté par plusieurs variables d'environnement");
  return s;
}

const rows = [];
const rootScripts = collect(ROOT_SCRIPTS);
// Un script IMPORTÉ par un autre script est appelé — même si aucun texte ne le mentionne.
// Sans ça, un fichier de configuration importé par son outil passe pour un orphelin.
const allScriptSources = rootScripts
  .concat(
    ...[...skillTexts.keys()].map((n) => collect(join(SKILLS_DIR, n))).flat(),
  )
  .map((p) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return "";
    }
  })
  .join("\n");

for (const p of rootScripts) {
  const base = p.split("/").pop();
  const inPkg = pkg.includes(p) || pkg.includes(base);
  // Le nom du fichier apparaît tel quel dans un `import "./x.ts"` — inutile de construire une
  // expression : la première tentative l'a fait, et son échappement produisait un `\\` littéral.
  const importedByScript =
    allScriptSources.includes(`/${base}`) ||
    allScriptSources.includes(`"${base}`);
  const inSkill =
    allSkillText.includes(p) || allSkillText.includes(base) || importedByScript;
  const inDocs = docsText.includes(p);
  const signals = protocolSignals(p);
  let verdict, why;
  if (inPkg) {
    verdict = "✅ bien placé";
    why = "câblé dans package.json — outil déterministe du dépôt";
  } else if (signals.length >= 2) {
    verdict = "➡️  à déplacer vers un skill";
    why = signals.join(", ");
  } else if (!inPkg && !inSkill && !inDocs) {
    verdict = "⚠️  orphelin";
    why = "cité nulle part : ni package.json, ni skill, ni doc";
  } else {
    verdict = "✅ bien placé";
    why = inSkill ? "cité par un skill" : "cité dans la documentation";
  }
  rows.push({ zone: "racine", path: p, verdict, why });
}

// Scripts vivant DANS un skill : le skill les cite-t-il ?
const deadRefs = [];
for (const [name, text] of skillTexts) {
  const dir = join(SKILLS_DIR, name);
  for (const p of collect(dir)) {
    const rel = p.slice(dir.length + 1);
    const base = p.split("/").pop();
    const cited = text.includes(rel) || text.includes(base);
    rows.push({
      zone: name,
      path: p,
      verdict: cited ? "✅ bien placé" : "⚠️  non cité par son skill",
      why: cited
        ? "cité par le skill qui le porte"
        : "présent mais jamais mentionné — mort, ou à documenter",
    });
  }
  // Renvois vers des scripts qui n'existent pas. Deux pièges déjà payés :
  //   — `\.js` capture le `.js` de `test-map.json` : exiger une frontière de mot ;
  //   — un renvoi peut viser la RACINE ou un AUTRE skill : chercher ailleurs avant de crier au mort.
  //   — `es5.d.ts` est une DÉCLARATION de types, jamais un script : l'écarter.
  for (const m of text.matchAll(
    /(?:scripts|lib)\/[\w.-]+\.(?:mjs|js|sh|py|ts)(?![\w.])/g,
  )) {
    const ref = m[0];
    if (ref.endsWith(".d.ts")) continue;
    const candidates = [
      join(dir, ref), // dans ce skill
      ref, // à la racine du dépôt
      ...[...skillTexts.keys()].map((other) => join(SKILLS_DIR, other, ref)), // dans un skill voisin
    ];
    if (!candidates.some((c) => existsSync(c)))
      deadRefs.push({ skill: name, ref });
  }
}

// ————————————————————————————————————————————————————————— rapport
const byVerdict = (v) => rows.filter((r) => r.verdict.includes(v));
console.log(`\n=== placement des scripts (${rows.length} fichiers) ===\n`);

const move = byVerdict("à déplacer");
const orphan = rows.filter(
  (r) => r.verdict.includes("orphelin") || r.verdict.includes("non cité"),
);

console.log(`✅ bien placés          : ${byVerdict("bien placé").length}`);
console.log(`➡️  à déplacer          : ${move.length}`);
console.log(`⚠️  orphelins/non cités : ${orphan.length}`);
console.log(`❌ renvois morts        : ${deadRefs.length}`);

if (move.length) {
  console.log(
    "\n➡️  Dépendent d'un protocole — leur place est dans un skill :",
  );
  for (const r of move) console.log(`   ${r.path}\n     ${r.why}`);
}
if (orphan.length) {
  console.log("\n⚠️  Personne ne les appelle (à documenter, ou à retirer) :");
  for (const r of orphan) console.log(`   ${r.path}  [${r.zone}]`);
}
if (deadRefs.length) {
  console.log("\n❌ Renvois vers un script absent :");
  for (const d of deadRefs) console.log(`   ${d.skill} → ${d.ref}`);
}
console.log("");

process.exit(STRICT && (orphan.length || deadRefs.length) ? 1 : 0);
