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
 *   node scripts/scaffold/format-templates.mjs           # écrit
 *   node scripts/scaffold/format-templates.mjs --check   # sort 1 si un gabarit changerait
 *   node scripts/scaffold/format-templates.mjs --check <fichier…>   # ces gabarits seuls
 *
 * Des fichiers nommés restreignent le passage à eux : c'est ce que fait le
 * hook de commit (les gabarits INDEXÉS), la CI juge le tout.
 *
 * @usage npm run format:templates
 * @usage npm run format:templates -- --check
 */
import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";
import { format, getFileInfo, resolveConfig } from "prettier";
import { REPO_ROOT as ROOT } from "../lib/repo-root.mjs";

const IGNORE_FILE = path.join(ROOT, ".prettierignore");
const CHECK = process.argv.includes("--check");
/**
 * Les gabarits nommés en argument, chemins RELATIFS à la racine en `/` —
 * normalisés AVANT d'être comparés à la liste du glob (un `\` de Windows ne
 * correspondrait à rien). Vide = tous.
 */
const ONLY = new Set(
  process.argv
    .slice(2)
    .filter((arg) => !arg.startsWith("--"))
    .map((arg) =>
      path.relative(ROOT, path.resolve(ROOT, arg)).split(path.sep).join("/"),
    ),
);
/**
 * La configuration que lirait la CLI lancée à la racine (`.prettierrc.json`,
 * `.editorconfig`), résolue UNE fois. prettier tourne en mémoire : un
 * processus par gabarit coûtait 48 s pour 186 fichiers, l'API 3 s, sortie
 * identique octet pour octet (mesuré).
 */
const PRETTIER_CONFIG =
  (await resolveConfig(path.join(ROOT, "package.json"), {
    editorconfig: true,
  })) ?? {};

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

const files = globSync("src/nodefony/templates/**/*.tpl", { cwd: ROOT })
  .map((rel) => rel.split(path.sep).join("/"))
  .filter((rel) => ONLY.size === 0 || ONLY.has(rel))
  .sort();
let changed = 0;
let skipped = 0;
// Ce qui est écarté se COMPTE par motif : un total unique ne dit pas si un
// gabarit est jugé ailleurs ou par personne, et c'est cette confusion qui laisse
// une dette grossir. Les gabarits à balises sont jugés sur leur RENDU — mais
// seulement là où un gate les rend, et `format:scaffold` n'exerce que
// `create app`. Ceux des autres générateurs ne sont vérifiés par personne.
const ecartes = { extension: [], balises: [], refus: [], ignores: [] };

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
  // Ce que `.prettierignore` écarte pour le fichier RENDU l'est aussi pour son
  // gabarit — la règle se lit là, jamais recopiée ici. Vécu : le code protobuf
  // GÉNÉRÉ (`*_pb.ts`) que la démo livre ; reformaté, il ne serait plus ce que
  // `buf generate` produit, et le gate `check-generated-protobuf` le refuserait.
  const info = await getFileInfo(path.join(ROOT, rel.slice(0, -4)), {
    ignorePath: IGNORE_FILE,
  });
  if (info.ignored) {
    skipped++;
    ecartes.ignores.push(rel);
    continue;
  }
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

  let out;
  try {
    out = await format(src, { ...PRETTIER_CONFIG, parser });
  } catch {
    skipped++;
    ecartes.refus.push(rel);
    continue; // prettier refuse la source telle quelle
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
  `\n${files.length} gabarits · ${changed} ${CHECK ? "à reformater" : "reformatés"} · ${skipped} écartés`,
);
console.log(
  `  ${ecartes.balises.length} à balises — leur forme se juge sur le RENDU` +
    `, jamais sur la source (voir l'en-tête) : \`npm run format:scaffold -- --diff\``,
);
console.log(
  `  ${ecartes.extension.length} d'une extension que CE script ne traite pas (markdown, html…)` +
    ` · ${ecartes.refus.length} refusés par prettier` +
    ` · ${ecartes.ignores.length} écartés par .prettierignore (code généré)`,
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
