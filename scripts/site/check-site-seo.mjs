/**
 * Refuse un site RENDU dont une page n'a pas son référencement propre : titre,
 * description, adresse canonique, aperçu de partage, données structurées — et
 * aucun titre ni description partagé par deux pages.
 *
 * Il lit l'artefact, jamais les sources : c'est ce que le moteur de recherche
 * reçoit. Il tourne à la fin de `build-site.mjs`, sur UN site (la racine, ou
 * `/next/`) — pas sur le site assemblé, dont les versions archivées sont
 * remises telles qu'elles ont été publiées.
 *
 * @usage node scripts/site/check-site-seo.mjs <dossier-rendu> [--json]
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { siteDefects } from "./lib/seo-check.mjs";

const args = process.argv.slice(2);
if (args.includes("--help") || args.length === 0) {
  console.log(
    "usage : node scripts/site/check-site-seo.mjs <dossier-rendu> [--json]",
  );
  process.exit(args.length === 0 ? 2 : 0);
}
const ROOT = path.resolve(args[0]);

/** Toutes les pages HTML du dossier, en chemins de site (`/` en séparateur). */
function htmlPages(dir) {
  const out = [];
  for (const entry of readdirSync(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
    const abs = path.join(entry.parentPath, entry.name);
    out.push({
      path: path.relative(ROOT, abs).split(path.sep).join("/"),
      html: readFileSync(abs, "utf8"),
    });
  }
  return out;
}

const pages = htmlPages(ROOT);
const defects = siteDefects(pages);
if (args.includes("--json")) {
  console.log(JSON.stringify({ pages: pages.length, defects }, null, 2));
} else if (defects.length === 0) {
  console.log(
    `✓ référencement : ${pages.length} page(s), chacune complète et propre`,
  );
} else {
  const pagesKo = new Set(defects.map((d) => d.path)).size;
  for (const d of defects) console.error(`✗ ${d.path} — ${d.defect}`);
  console.error(
    `\n✗ référencement : ${defects.length} défaut(s) sur ${pagesKo} page(s) / ${pages.length}`,
  );
}
process.exit(defects.length === 0 ? 0 : 1);
