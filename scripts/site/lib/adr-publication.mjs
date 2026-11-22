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
 * Les cibles `.md` des liens d'un corps markdown, hors code.
 *
 * Un lien écrit DANS un bloc de code ou en code en ligne est un exemple, pas un
 * renvoi. Trois formes comptent : `[x](a.md)`, titré `[x](a.md "titre")`, et par
 * référence `[x][ref]` avec sa définition `[ref]: a.md`.
 *
 * @param body - markdown sans frontmatter
 * @returns les cibles, fragment retiré, schémas (`https:`) écartés
 */
function markdownTargets(body) {
  const text = body
    .replace(
      /^ {0,3}(`{3,}|~{3,})[\s\S]*?(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm,
      "",
    )
    .replace(/`+[^`\n]*`+/g, "");
  const out = [];
  for (const m of text.matchAll(
    /\]\(\s*<?([^)\s>#]+\.md)(?:#[^)\s>]*)?>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g,
  ))
    out.push(m[1]);
  const defs = new Map();
  for (const m of text.matchAll(
    /^ {0,3}\[([^\]]+)\]:\s*<?([^\s>#]+\.md)(?:#\S*)?>?(?:\s+.*)?$/gm,
  ))
    defs.set(m[1].trim().toLowerCase(), m[2]);
  if (defs.size > 0)
    for (const m of text.matchAll(/\[([^\]]*)\]\[([^\]]*)\]/g)) {
      const target = defs.get((m[2] === "" ? m[1] : m[2]).trim().toLowerCase());
      if (target !== undefined) out.push(target);
    }
  return out.filter((t) => !/^[a-z][a-z0-9+.-]*:/i.test(t));
}

/**
 * Les défauts de publication d'un ADR marqué publiable.
 *
 * @param page.relPath - chemin sous `docs/` (`adr/0026-….md`), séparateur `/`
 * @param page.meta - frontmatter lu
 * @param page.body - markdown, sans frontmatter
 * @param page.isPublished - `(repoRelPath) => boolean` : la page est-elle PUBLIÉE ? (chemin de dépôt, `/`) ; un « guide » doit l'être
 * @returns un message par défaut ; vide si la page n'est pas un ADR ou s'il est complet
 */
export function adrPublicationDefects({ relPath, meta, body, isPublished }) {
  if (typeof isPublished !== "function")
    throw new TypeError("adrPublicationDefects : isPublished est requis");
  if (!relPath.startsWith("adr/") || !/^adr\/\d{4}-/.test(relPath)) return [];
  const out = [];
  const status = typeof meta?.status === "string" ? meta.status.trim() : "";
  if (status === "") out.push("sans statut (`status` au frontmatter)");
  else if (!ADR_STATUSES.has(status))
    out.push(
      `statut inconnu « ${status} » (attendu : ${[...ADR_STATUSES].join(", ")})`,
    );
  const dir = path.posix.dirname(relPath);
  const resolved = markdownTargets(body).map((t) =>
    path.posix.normalize(path.posix.join(dir, t)),
  );
  if (
    status === "superseded" &&
    !resolved.some((t) => t !== relPath && /^adr\/\d{4}-[^/]*\.md$/.test(t))
  )
    out.push("remplacé sans dire par quel ADR");
  const guide = resolved.some((t) => {
    if (t.startsWith("adr/")) return false;
    const repoPath = path.posix.normalize(path.posix.join("docs", t));
    const name = path.posix.basename(repoPath);
    if (name === "CLAUDE.md" || name === "MEMORY.md") return false;
    return isPublished(repoPath);
  });
  if (!guide)
    out.push(
      "sans lien vers un guide PUBLIÉ hors de `adr/` (le « comment » du même sujet)",
    );
  return out;
}
