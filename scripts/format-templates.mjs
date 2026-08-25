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
 * Ce script ne traite donc QUE les gabarits SANS balise : pour ceux-là, la
 * source et le rendu sont le même texte, et les formater est exact. Un gabarit
 * À BALISES est délibérément laissé de côté — le formater peut DÉGRADER son
 * rendu, ce qui a été constaté au premier usage (voir le refus commenté dans le
 * corps). Ceux-là se corrigent à la main, en lisant le rendu par
 * `npm run format:scaffold -- --diff`.
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

/**
 * Le parser prettier, par extension. RIEN d'autre.
 *
 * 🔴 Ce champ portait aussi une fonction de MASQUAGE des balises eta
 * — un commentaire de la forme `__ETA0__` — avec sa restauration et sa
 * vérification jeton par jeton.
 * Ce mécanisme n'a JAMAIS été exécuté : le refus délibéré ci-dessous rend la
 * main avant, si bien que le tableau de balises n'était rempli par personne et
 * que la restauration tournait à vide. Il a été retiré parce qu'un code mort
 * qu'on LIT vaut promesse — deux lecteurs (l'auteur du dépôt et un agent) ont
 * cru le dépôt capable de formater un gabarit à balises, et l'ont cherché.
 * La capacité n'était pas cassée : elle était inatteignable.
 *
 * Les extensions absentes ne sont pas traitées. Markdown et HTML en font
 * partie : un commentaire HTML est neutre, mais prettier RÉÉCRIT le markdown
 * autour, et un un commentaire HTML en début de ligne ne protège pas d'une ligne de
 * tableau — c'est là que la corruption a été observée.
 */
const LANG = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".js": "babel",
  ".mjs": "babel",
  ".css": "css",
  ".scss": "scss",
  ".json": "json",
  ".yml": "yaml",
  ".yaml": "yaml",
};

const files = globSync("src/nodefony/templates/**/*.tpl", { cwd: ROOT }).sort();
let changed = 0;
let skipped = 0;
// Ce qui est écarté se COMPTE par motif : un total unique ne dit pas si un
// gabarit est jugé ailleurs ou par personne, et c'est cette confusion qui laisse
// une dette grossir. Les gabarits à balises sont jugés sur leur RENDU — mais
// seulement là où un gate les rend, et `format:scaffold` n'exerce que
// `create app`. Ceux des autres générateurs ne sont vérifiés par personne.
const ecartes = { extension: [], balises: [], refus: [] };

for (const rel of files) {
  const abs = path.join(ROOT, rel);
  const src = readFileSync(abs, "utf8");
  const ext = path.extname(rel.slice(0, -4));
  const entry = LANG[ext];
  if (!entry) {
    skipped++;
    ecartes.extension.push(rel);
    continue;
  }
  const parser = entry;
  if (src.includes("<%")) {
    // 🔴 REFUS DÉLIBÉRÉ, payé une fois : formater un gabarit À BALISES ne rend
    // pas son RENDU conforme, et peut le DÉGRADER. Constaté au premier usage —
    // deux fichiers de test que le gate acceptait sont ressortis refusés après
    // que ce script eut « amélioré » leur source. La raison est structurelle :
    // prettier formate le texte qu'il voit, balises masquées comprises ; une
    // fois les balises remplacées par leur valeur, les lignes changent de
    // longueur et la forme canonique n'est plus la même. Un gabarit à balises
    // se corrige donc à la main, en regardant le RENDU (`--diff`), jamais en
    // formatant la source.
    skipped++;
    ecartes.balises.push(rel);
    continue;
  }

  const run = spawnSync(PRETTIER, ["--parser", parser], {
    input: src,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    skipped++;
    ecartes.refus.push(rel);
    continue; // prettier refuse la source telle quelle
  }

  const out = run.stdout;

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
  `\n${files.length} gabarits · ${changed} ${CHECK ? "à reformater" : "reformatés"} · ${skipped} écartés`,
);
console.log(
  `  ${ecartes.balises.length} à balises — leur forme se juge sur le RENDU` +
    `, jamais sur la source (voir l'en-tête) : \`npm run format:scaffold -- --diff\``,
);
console.log(
  `  ${ecartes.extension.length} d'une extension que CE script ne traite pas (markdown, html…)` +
    ` · ${ecartes.refus.length} refusés par prettier`,
);
// 🔴 Ce que RIEN ne vérifie, dit à voix haute. `format:scaffold` ne rend que
// `create app` : un gabarit à balises appartenant à un AUTRE générateur n'est
// donc formaté ni ici (refus) ni là-bas (jamais rendu). Le taire ferait lire
// « 0 à reformater » comme « tout est propre ».
const RACINE_TPL = "src/nodefony/templates/";
const HORS_CREATE_APP = ecartes.balises
  .map((f) => (f.startsWith(RACINE_TPL) ? f.slice(RACINE_TPL.length) : f))
  .filter((f) => !f.startsWith("app/") && !f.startsWith("shared/"));
if (HORS_CREATE_APP.length) {
  console.log(
    `\n⚠ ${HORS_CREATE_APP.length} gabarit(s) à balises hors \`create app\` : aucun gate ne` +
      ` juge leur forme — ni ici, ni \`format:scaffold\`, qui ne rend que l'app.`,
  );
  const familles = {};
  for (const f of HORS_CREATE_APP) {
    const g = f.split("/")[0];
    familles[g] = (familles[g] ?? 0) + 1;
  }
  for (const [g, n] of Object.entries(familles).sort((a, b) => b[1] - a[1]))
    console.log(`    ${String(n).padStart(2)} × create ${g}`);
}
if (CHECK && changed > 0) process.exit(1);
