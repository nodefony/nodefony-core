#!/usr/bin/env node
/**
 * Formate les gabarits de scaffold **sans casser leurs balises eta**.
 *
 * Le problème : prettier ne connaît pas l'extension `.tpl`, donc le formateur du
 * dépôt ne les voit pas — c'est ainsi qu'une application générée arrivait avec
 * sept fichiers que son propre `npm run format` réécrivait. Mais lui donner le
 * gabarit tel quel ne marche pas non plus : `<% if (…) { %>` n'est ni du
 * TypeScript ni du markdown valide, et sur un markdown il lit `<% … %>|` comme
 * une cellule de tableau — il INJECTE alors des `|` et corrompt le gabarit.
 *
 * La méthode : masquer chaque balise eta derrière un jeton **neutre pour le
 * langage cible** (un commentaire), formater, puis restaurer. Le fichier soumis
 * à prettier est alors syntaxiquement valide dès lors que chaque bloc
 * conditionnel entoure du code complet — ce qui est le cas quand un `<% if %>`
 * encadre des déclarations entières, et faux quand il coupe une expression au
 * milieu. Le script le CONSTATE (il reparse) au lieu de le supposer, et laisse
 * intact tout gabarit dont il ne peut pas garantir la restauration.
 *
 * Ce qu'il ne peut pas faire, et qu'il faut savoir : la forme canonique d'une
 * ligne dépend parfois d'une valeur INTERPOLÉE (le nom de l'application dans un
 * attribut). Un gabarit rend une seule forme ; aucun formatage de la source ne
 * la rendra juste pour tous les noms. `npm run format:scaffold` nomme ces
 * fichiers-là.
 *
 * Usage :
 *   node scripts/format-templates.mjs           # écrit
 *   node scripts/format-templates.mjs --check   # sort 1 si un gabarit changerait
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRETTIER = path.join(ROOT, "node_modules", ".bin", "prettier");
const CHECK = process.argv.includes("--check");

/** Parser prettier + forme de commentaire qui masque une balise, par extension. */
const LANG = {
  ".ts": ["typescript", (i) => `/*__ETA${i}__*/`],
  ".tsx": ["typescript", (i) => `/*__ETA${i}__*/`],
  ".mts": ["typescript", (i) => `/*__ETA${i}__*/`],
  ".js": ["babel", (i) => `/*__ETA${i}__*/`],
  ".mjs": ["babel", (i) => `/*__ETA${i}__*/`],
  ".css": ["css", (i) => `/*__ETA${i}__*/`],
  ".scss": ["scss", (i) => `/*__ETA${i}__*/`],
  // json : aucun commentaire n'est légal → jamais masqué, seuls les gabarits
  // SANS balise sont traités.
  ".json": ["json", null],
  ".yml": ["yaml", null],
  ".yaml": ["yaml", null],
  // markdown et html : un commentaire HTML est neutre… mais prettier RÉÉCRIT le
  // markdown autour, et un `<!-- -->` en début de ligne ne protège pas d'une
  // ligne de tableau. Ces deux-là restent manuels — c'est là que la corruption
  // a été observée.
};

const files = globSync("src/nodefony/templates/**/*.tpl", { cwd: ROOT }).sort();
let changed = 0;
let skipped = 0;

for (const rel of files) {
  const abs = path.join(ROOT, rel);
  const src = readFileSync(abs, "utf8");
  const ext = path.extname(rel.slice(0, -4));
  const entry = LANG[ext];
  if (!entry) {
    skipped++;
    continue;
  }
  const [parser, mask] = entry;
  const tags = [];
  let masked = src;
  if (src.includes("<%")) {
    if (!mask) {
      skipped++;
      continue;
    }
    masked = src.replace(/<%[\s\S]*?%>/g, (m) => {
      tags.push(m);
      return mask(tags.length - 1);
    });
  }

  const run = spawnSync(PRETTIER, ["--parser", parser], {
    input: masked,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    skipped++;
    continue; // le masquage ne suffit pas (balise au milieu d'une expression)
  }

  // Restauration — et VÉRIFICATION que chaque jeton est revenu. Un jeton perdu
  // (prettier a déplacé ou fusionné un commentaire) rendrait un gabarit amputé :
  // on préfère ne rien écrire.
  let out = run.stdout;
  let intact = true;
  tags.forEach((tag, i) => {
    const token = mask(i);
    if (!out.includes(token)) {
      intact = false;
      return;
    }
    out = out.replace(token, tag);
  });
  if (!intact || out.includes("__ETA")) {
    console.error(`  ⚠ ${rel} — jeton eta perdu au formatage, laissé intact`);
    skipped++;
    continue;
  }

  if (out !== src) {
    changed++;
    if (CHECK) console.error(`  ✗ ${rel}`);
    else {
      writeFileSync(abs, out);
      console.log(`  ✓ ${rel}`);
    }
  }
}

console.log(
  `${files.length} gabarits · ${changed} ${CHECK ? "à reformater" : "reformatés"} · ${skipped} non traitables (markdown, html, json avec balises, ou masquage insuffisant)`,
);
if (CHECK && changed > 0) process.exit(1);
