/**
 * Ce qu'un ADR doit porter pour être PUBLIÉ sur le site.
 *
 * Les décisions d'architecture restent internes par défaut (règle du dossier
 * `adr/` dans `build-docs-site.mjs`) ; une à une, celles qui éclairent une
 * capacité publique sont marquées `publish: true`. Marquée, une décision doit
 * dire où elle en est (`status` — un lecteur ne doit pas prendre une décision
 * remplacée pour la règle en vigueur) et renvoyer au GUIDE du même sujet : le
 * guide porte le « comment », l'ADR le « pourquoi », et sans ce lien les deux
 * se disputent la même recherche.
 *
 * @usage import { adrPublicationDefects } from "./lib/adr-publication.mjs"
 */
import path from "node:path";

/** Statuts qu'un ADR publié peut afficher. */
export const ADR_STATUSES = new Set([
  "proposed",
  "accepted",
  "deprecated",
  "superseded",
]);

/**
 * Les défauts de publication d'un ADR marqué publiable.
 *
 * @param page.relPath - chemin sous `docs/` (`adr/0026-….md`), séparateur `/`
 * @param page.meta - frontmatter lu
 * @param page.body - markdown, sans frontmatter
 * @returns un message par défaut ; vide si la page n'est pas un ADR ou s'il est complet
 */
export function adrPublicationDefects({ relPath, meta, body }) {
  if (!relPath.startsWith("adr/") || !/^adr\/\d{4}-/.test(relPath)) return [];
  const out = [];
  const status = typeof meta?.status === "string" ? meta.status.trim() : "";
  if (status === "") out.push("sans statut (`status` au frontmatter)");
  else if (!ADR_STATUSES.has(status))
    out.push(
      `statut inconnu « ${status} » (attendu : ${[...ADR_STATUSES].join(", ")})`,
    );
  if (status === "superseded" && !/remplacé par|superseded by/i.test(body))
    out.push("remplacé sans dire par quel ADR");
  const dir = path.posix.dirname(relPath);
  const guide = [...body.matchAll(/\]\(([^)\s#]+\.md)(?:#[^)]*)?\)/g)]
    .map((m) => m[1])
    .filter((t) => !/^[a-z]+:/i.test(t))
    .some(
      (t) => !path.posix.normalize(path.posix.join(dir, t)).startsWith("adr/"),
    );
  if (!guide)
    out.push(
      "sans lien vers un guide hors de `adr/` (le « comment » du même sujet)",
    );
  return out;
}
