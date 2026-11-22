/**
 * Préparation de la SOURCE Markdown d'une page avant son rendu par le site.
 *
 * Hors du générateur, qui s'exécute dès qu'on l'importe : c'est ce qui rend ce
 * traitement testable seul.
 *
 * @usage import { sansCommentaires } from "./lib/markdown-source.mjs"
 */

/**
 * Retire les lignes qui ne sont qu'un commentaire HTML, hors des blocs de code.
 *
 * Le HTML brut est désactivé (`html: false`) : un `<!-- prettier-ignore -->`,
 * consigne au formateur placée devant un tableau, devenait donc du TEXTE et
 * s'affichait en clair sur la page publiée. Un commentaire montré DANS un bloc
 * de code est un exemple, il reste.
 *
 * @param {string} markdown - le corps de la page.
 * @returns {string} le corps sans ses lignes de commentaire.
 */
export function sansCommentaires(markdown) {
  let cloture = null;
  return markdown
    .split("\n")
    .filter((ligne) => {
      const f = /^\s*(`{3,}|~{3,})/.exec(ligne);
      if (f) {
        if (cloture === null) cloture = f[1][0];
        else if (f[1][0] === cloture) cloture = null;
        return true;
      }
      return cloture !== null || !commentaireSeul(ligne);
    })
    .join("\n");
}

/**
 * La ligne n'est-elle QU'UN commentaire HTML (`<!-- … -->`) ?
 *
 * Écrit en comparaisons de chaînes, pas en expression régulière : un motif
 * `<!--.*-->` est la forme que l'analyse de code signale comme filtre de balise
 * incomplet (`js/bad-tag-filter` — un commentaire se ferme aussi par `--!>`).
 * Ici l'enjeu n'est pas la sécurité — la source est le Markdown du dépôt, et le
 * rendu échappe tout HTML —, mais un motif signalé à tort reste une alerte
 * ouverte, et le dépôt refuse d'en garder une.
 */
function commentaireSeul(ligne) {
  const l = ligne.trim();
  return (
    l.startsWith("<!--") && l.endsWith("-->") && !l.slice(4, -3).includes("-->")
  );
}

/**
 * Retire le titre `# …` de tête d'une page : le chrome l'affiche déjà en `<h1>`.
 * Il est cherché AVANT la première section (`## `), et non seulement en
 * première ligne : un fil d'Ariane le précède souvent, et la page sortait alors
 * avec deux `<h1>` (vécu sur quatre pages).
 *
 * @param md - le corps markdown, sans frontmatter
 * @returns le corps sans son titre de tête
 */
export function stripLeadingTitle(md) {
  const m = /^#[ \t]+.*\r?\n?/m.exec(md);
  if (m === null) return md;
  const before = md.slice(0, m.index);
  // Un titre trouvé après une section, ou dans un bloc de code, n'est pas celui de la page.
  if (
    /^##[ \t]/m.test(before) ||
    (before.match(/^```/gm) ?? []).length % 2 === 1
  )
    return md;
  return before + md.slice(m.index + m[0].length);
}
