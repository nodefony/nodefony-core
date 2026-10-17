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
