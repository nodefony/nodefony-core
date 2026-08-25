#!/usr/bin/env node
/**
 * anchor-inpage.mjs — les ancres INTRA-PAGE mènent-elles quelque part ?
 *
 * Usage : node anchor-inpage.mjs <page.md ...>
 * Sortie : 0 si toutes les ancres résolvent, 1 sinon (gate bloquante).
 *
 * ── Pourquoi ce gate ────────────────────────────────────────────────────────
 * `doc-lint` vérifie les liens vers d'AUTRES fichiers ; `anchor-check` vérifie les
 * ancres `fichier:ligne` vers le CODE. Personne ne vérifiait `](#section)`, le lien
 * d'une page vers ses propres titres. Le trou est resté invisible jusqu'à ce que les
 * pages à catalogue interne (hubs qui pointent vers leurs sections) en accumulent 77
 * d'un coup : elles fonctionnaient sur GitHub et étaient mortes dans le portail.
 *
 * ── La règle ────────────────────────────────────────────────────────────────
 * `slugify()` ci-dessous DOIT rester identique à `slugifyHeading()`
 * (`@nodefony/studio/frontend/src/components/ui/DocToc.tsx`), qui pose les `id` des
 * titres rendus. Deux implémentations qui divergent = sommaires morts en silence,
 * exactement ce que ce gate existe pour empêcher. Toucher l'une = toucher l'autre.
 */
import { readFileSync } from "node:fs";
import { slugifyHeading } from "../lib/slug-heading.mjs";

/**
 * Convention GitHub : accents CONSERVÉS, ponctuation/symboles/emoji retirés.
 *
 * Les sélecteurs de variante (U+FE00–U+FE0F) sont retirés À PART : ils suivent les
 * emoji « texte » (⚙️ 🏗️ ⚠️ 🗂️ …), sont INVISIBLES, et survivraient à la regex
 * suivante en tant que marques (\p{M}). Les garder rendait l'ancre intapable — un
 * rédacteur ne peut pas écrire un caractère qu'il ne voit pas.
 */
const slugify = slugifyHeading;

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage : node anchor-inpage.mjs <page.md ...>");
  process.exit(2);
}

console.log("\n=== anchor-inpage — ancres internes d'une page ===\n");

let totalDead = 0;
let okPages = 0;

for (const file of files) {
  let md;
  try {
    md = readFileSync(file, "utf8");
  } catch {
    console.log(`❌ ${file}\n     illisible`);
    totalDead += 1;
    continue;
  }

  // Titres de la page, hors blocs de code (une ```fence``` peut contenir des #).
  const slugs = new Set();
  let inFence = false;
  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = /^(#{2,6})\s+(.+?)\s*$/.exec(line);
    if (heading) slugs.add(slugify(heading[2]));
  }

  // Liens intra-page. On ignore les ancres d'un AUTRE fichier (`page.md#slug`).
  const dead = new Set();
  for (const m of md.matchAll(/\]\(#([^)\s]+)\)/g)) {
    const target = decodeURIComponent(m[1]);
    if (!slugs.has(target)) dead.add(m[1]);
  }

  if (dead.size > 0) {
    totalDead += dead.size;
    console.log(`❌ ${file}`);
    for (const d of dead)
      console.log(`     #${d} — aucun titre ne produit ce slug`);
  } else {
    okPages += 1;
    console.log(`✅ ${file}`);
  }
}

console.log(
  totalDead === 0
    ? `\n${okPages}/${files.length} pages conformes. 0 ancre interne morte.\n`
    : `\n${okPages}/${files.length} pages conformes. ${totalDead} ancre(s) interne(s) morte(s).\n`,
);

process.exit(totalDead === 0 ? 0 : 1);
