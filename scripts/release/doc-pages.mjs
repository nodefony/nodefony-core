// Pages de documentation qu'une APPLICATION ne sert pas — donc qui ne partent
// pas sur npm.
//
// Une page `publish: core` parle du développement du framework, une page
// `publish: none` ne parle à personne : Studio ne les montre jamais hors du
// dépôt. Les publier quand même, c'est livrer à chaque installeur un fichier
// que rien ne lui sert, et qu'un agent lit dans `node_modules` comme s'il le
// concernait.
//
// La DÉCISION n'est pas prise ici : elle est injectée (`servie`), composée par
// l'appelant à partir de la règle du cœur (`readDocScope`/`isDocVisible`) — la
// même que Studio, le portail et le site. Ce module ne fait que parcourir.
//
// @usage import { pagesNonServies, regleDApplication } from "./doc-pages.mjs"
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

/** Le seul dossier que Studio sert comme documentation d'un module. */
export const DOCS_DIR = "docs";

/**
 * Compose la règle du cœur en un verdict sur une page BRUTE, telle qu'une
 * application la juge (`frameworkRepository: false`).
 *
 * Les deux paquets sont lus par leur surface publiée — comme le générateur du
 * site : `release:pack` exige déjà un build à jour.
 *
 * @returns {Promise<(raw: string) => boolean>} la page est-elle servie ?
 */
export async function regleDApplication() {
  const { readDocScope, isDocVisible } = await import("nodefony");
  const { parseFrontmatter } = await import("@nodefony/documentation");
  return (raw) =>
    isDocVisible(readDocScope(parseFrontmatter(raw).meta.publish), false);
}

/**
 * Liste les pages de `docs/` qu'une application ne sert pas.
 *
 * Appelée deux fois sur deux racines : le paquet du dépôt (pour poser les
 * négations de `files` avant `npm pack`) et le tarball DÉPAQUETÉ (pour
 * constater qu'aucune n'y est restée). Un seul parcours, donc un seul verdict.
 *
 * @param {string} racine - dossier du paquet (celui qui porte `docs/`).
 * @param {(raw: string) => boolean} servie - la page brute est-elle servie
 *   dans une application ?
 * @returns {string[]} chemins relatifs à `racine`, en `/` (ils voyagent dans
 *   `files`), triés.
 */
export function pagesNonServies(racine, servie) {
  const docs = path.join(racine, DOCS_DIR);
  if (!existsSync(docs)) return [];
  const out = [];
  for (const e of readdirSync(docs, { recursive: true, withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    const absolu = path.join(e.parentPath, e.name);
    if (servie(readFileSync(absolu, "utf8"))) continue;
    // Normaliser AVANT de rendre : un chemin `docs\x.md` ne mordrait pas
    // dans `files` (axiome 2).
    out.push(path.relative(racine, absolu).split(path.sep).join("/"));
  }
  return out.sort();
}
