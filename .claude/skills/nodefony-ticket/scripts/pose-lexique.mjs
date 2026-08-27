#!/usr/bin/env node
/**
 * Pose le bloc `Lexique` en tête du corps des tickets GitHub ouverts.
 *
 * Source unique des définitions : `../references/lexique.md`. Le script ne définit RIEN
 * lui-même — ajouter un terme se fait là-bas, jamais ici.
 *
 * Idempotent : un bloc déjà posé est remplacé, pas empilé.
 *
 *   node scripts/pose-lexique.mjs            # rapport seul, n'écrit rien
 *   node scripts/pose-lexique.mjs --write    # applique via `gh issue edit`
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX = 6; // au-delà, c'est le corps qu'il faut réécrire — cf SKILL.md §1

/** Lit le glossaire : `- **terme** (detect: motif) — définition`. */
const readLexicon = () => {
  const src = fs.readFileSync(
    path.join(HERE, "..", "references", "lexique.md"),
    "utf8",
  );
  const entries = [];
  for (const line of src.slice(src.indexOf("## Entrées")).split("\n")) {
    const m = line.match(/^- \*\*(.+?)\*\* \(detect: (.+?)\) — (.+)$/);
    // Frontières de lettre OBLIGATOIRES : sans elles « cadre » déclenche `ADR` et
    // « restore » déclenche `store` — un lexique hors sujet est pire que pas de lexique.
    if (m)
      entries.push({
        term: m[1],
        detect: new RegExp(`(?<!\\p{L})(?:${m[2]})(?!\\p{L})`, "iu"),
        def: m[3],
      });
  }
  if (!entries.length)
    throw new Error("references/lexique.md : aucune entrée lisible");
  return entries;
};

/**
 * La zone qui décide : titre + bloc « Le problème », citations et blocs de code RETIRÉS.
 * Un mot cité dans un exemple n'est pas le vocabulaire du ticket — le lire poserait un
 * lexique hors sujet, pire que pas de lexique.
 */
const comprehensionZone = (title, body) => {
  const cut = body.search(
    /^\*\*(Preuve au terrain|La solution|Portée|Mesuré|Fini quand|Estimation)|^## |^\*\*Ce qu/m,
  );
  return `${title}\n${cut > 0 ? body.slice(0, cut) : body}`
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^>.*$/gm, " ");
};

const entries = readLexicon();
const write = process.argv.includes("--write");
const gh = (args) =>
  execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 << 20 });
const issues = JSON.parse(
  gh([
    "issue",
    "list",
    "--limit",
    "200",
    "--state",
    "open",
    "--json",
    "number,title,body",
  ]),
);

for (const { number, title, body } of issues) {
  const stripped = body.replace(/^\*\*Lexique\*\*\n\n(?:- .+\n)+\n/, "");
  const hit = entries.filter((e) =>
    e.detect.test(comprehensionZone(title, stripped)),
  );
  const kept = hit.slice(0, MAX);
  const next = kept.length
    ? `**Lexique**\n\n${kept.map((e) => `- **${e.term}** — ${e.def}`).join("\n")}\n\n${stripped}`
    : stripped;
  const over =
    hit.length > MAX
      ? `  ⚠️ ${hit.length} termes détectés — réécrire le corps`
      : "";
  if (next === body) {
    console.log(`#${number}  à jour${over}`);
    continue;
  }
  console.log(
    `#${number}  ${kept.length ? kept.map((e) => e.term).join(", ") : "(retrait du lexique)"}${over}`,
  );
  if (write) {
    const tmp = path.join(fs.mkdtempSync("/tmp/ticket-lex-"), `${number}.md`);
    fs.writeFileSync(tmp, next);
    gh(["issue", "edit", String(number), "--body-file", tmp]);
  }
}
if (!write)
  console.log("\n(rapport seul — relancer avec --write pour appliquer)");
