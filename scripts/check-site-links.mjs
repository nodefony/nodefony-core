#!/usr/bin/env node
/**
 * Refuse un site dont un lien interne ne mène nulle part.
 *
 * POURQUOI CE GATE EXISTE. Le site est servi sous un sous-chemin
 * (`https://nodefony.github.io/nodefony-core/`), donc ses liens sont RELATIFS :
 * un `/adr/` y désignerait la racine du domaine, et 122 pages deviendraient un
 * cimetière de 404 — invisibles en local, découverts par le premier lecteur.
 * Rien dans une génération ne signale ça : le rendu réussit, les pages sont
 * belles, et seule la navigation échoue.
 *
 * Ce gate parcourt le RÉSULTAT, pas les sources : il ouvre chaque page produite,
 * résout chaque lien interne contre le disque, et sort 1 au premier orphelin. Il
 * ne demande aucun serveur — un chemin relatif se résout par un `path.resolve`,
 * exactement comme le fera le serveur de Pages.
 *
 * Ce qu'il NE vérifie pas : les cibles externes (aucune requête réseau depuis un
 * exécuteur d'intégration continue) et les ancres de section, que
 * `anchor-inpage.mjs` couvre déjà sur la source Markdown.
 *
 * Usage :
 *   node scripts/check-site-links.mjs <dossier-du-site>
 *
 * Sortie 1 si un lien interne est cassé, ou si le dossier ne contient aucune page.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] ?? "dist-site");
if (!existsSync(ROOT)) {
  console.error(`✗ dossier introuvable : ${ROOT}`);
  process.exit(1);
}

/** Toutes les pages HTML produites, chemins absolus. */
function pages(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pages(full));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

const HREF = /(?:href|src)="([^"]+)"/g;

const found = pages(ROOT);
if (found.length === 0) {
  console.error(
    `✗ aucune page dans ${ROOT} — un site vide se publierait en silence.`,
  );
  process.exit(1);
}

const broken = [];
let checked = 0;

for (const file of found) {
  // 🔴 LE CONTENU D'UN BLOC DE CODE N'EST PAS DU BALISAGE.
  //
  // Ce contrôle cherche `href="…"` et `src="…"` par expression régulière sur le
  // HTML brut : il suppose que toute occurrence est un ATTRIBUT. Un guide qui
  // montre une commande shell la dément —
  //     curl -s http://… | grep -o 'src="http[^"]*"'
  // — dont le texte contient littéralement `src="http[^"`. Les guillemets n'ont
  // pas à être échappés dans le contenu d'un élément : le HTML est valide, c'est
  // la LECTURE qui est fautive. Le défaut ne s'est déclaré qu'une fois les blocs
  // colorés, parce que le rendu précédent échappait ces guillemets ; il dormait
  // dans la méthode depuis le début.
  //
  // Les blocs de code ne portent jamais de lien à vérifier : on les retire avant
  // de lire. Retirer un faux positif vaut mieux que de relâcher le motif — un
  // contrôle qui crie faux finit par ne plus être lu.
  const html = readFileSync(file, "utf8").replace(
    /<pre\b[\s\S]*?<\/pre>/gi,
    "",
  );
  const fromDir = path.dirname(file);
  for (const m of html.matchAll(HREF)) {
    const href = m[1];
    // Hors périmètre : ressources externes, ancres, données embarquées.
    if (/^(https?:|mailto:|#|data:|\/\/)/.test(href)) continue;
    checked++;
    const target = href.split("#")[0].split("?")[0];
    if (target === "") continue; // lien d'ancre pure
    // 🔴 Un lien interne ABSOLU est un défaut EN SOI, même si le fichier existe
    // dans le dossier de sortie : le site est servi sous `/nodefony-core/`, où
    // `/adr/` désigne la racine du DOMAINE. Le résoudre contre la racine du
    // dossier le déclarerait valide — c'est précisément ainsi que ce gate a
    // laissé passer, à sa première version, le seul défaut qu'il devait voir.
    if (target.startsWith("/")) {
      broken.push({ page: path.relative(ROOT, file), href, absolu: true });
      continue;
    }
    const resolved = path.resolve(fromDir, target);
    const candidates = [resolved, path.join(resolved, "index.html")];
    if (!candidates.some((c) => existsSync(c) && statSync(c).isFile()))
      broken.push({ page: path.relative(ROOT, file), href, absolu: false });
  }
}

if (broken.length) {
  const abs = broken.filter((b) => b.absolu).length;
  console.error(
    `\n✗ ${broken.length} lien(s) interne(s) fautif(s) sur ${checked} vérifié(s)` +
      (abs
        ? ` — dont ${abs} ABSOLU(s), qui sortiraient du sous-chemin publié`
        : "") +
      " :\n",
  );
  for (const b of broken.slice(0, 30))
    console.error(
      `   ${b.page}\n     → ${b.href}${b.absolu ? "   ⚠️ lien ABSOLU : il sortira du sous-chemin publié" : ""}`,
    );
  if (broken.length > 30)
    console.error(`   … et ${broken.length - 30} autre(s)`);
  console.error("");
  process.exit(1);
}

console.log(
  `✓ ${found.length} pages, ${checked} liens internes vérifiés, 0 cassé (${path.relative(process.cwd(), ROOT)})`,
);
