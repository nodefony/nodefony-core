/**
 * Le résumé d'une page publiée : l'extrait qu'un moteur de recherche montrera
 * (`<meta name="description">`), et que le plan `llms.txt` cite à côté du lien.
 * Sans lui, le moteur en invente un — souvent le fil d'Ariane ou une ligne de
 * code, ce qui ne dit rien de la page.
 *
 * Module PUR, éprouvé par `llms-plan.test.mjs`.
 *
 * @usage import { pageSummary } from "./lib/page-summary.mjs"
 */

/**
 * Le premier paragraphe de prose de la page, nettoyé de sa syntaxe markdown.
 *
 * Un PARAGRAPHE, pas une ligne : le corpus est replié à 100 colonnes, et prendre
 * la première LIGNE assez longue faisait commencer le résumé au milieu d'une
 * phrase dès que la vraie première ligne ouvrait sur du gras ou un lien. L'intro
 * d'une page est souvent une CITATION (le résumé en tête), d'où le `>` retiré
 * plutôt que la ligne écartée.
 *
 * @param body - le markdown de la page, sans frontmatter.
 * @param declared - la description déclarée au frontmatter, qui l'emporte.
 * @param title - le titre, en dernier recours.
 * @returns le résumé, 180 caractères au plus.
 */
export function pageSummary(body, declared, title) {
  const prose = body
    .replace(/```[\s\S]*?```/g, "") // un bloc de code n'est pas une phrase
    .replace(/<!--[\s\S]*?-->/g, "") // ni un commentaire (« GÉNÉRÉ par … »)
    .replace(/^\s*>\s?\[!.*$/gm, "") // ni le marqueur d'une admonition
    .replace(/^\s*>\s?/gm, ""); // une citation, si : c'est souvent le résumé
  const text =
    declared ??
    prose
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
      .find(
        (p) =>
          p.length > 30 &&
          !/^(#|\||[-*+] |\d+[.)] |!\[)/.test(p) && // titre, tableau, liste, image
          !p.includes("›"), // fil d'Ariane
      ) ??
    title;
  return (
    text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // les liens gardent leur texte
      .replace(/[*`]/g, "")
      // L'emphase `_mot_` perd ses marques ; un identifiant (`NF_DATABASE_URL`)
      // garde les siennes — les retirer toutes en faisait `NFDATABASEURL`.
      .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=$|[\s).,;:!?])/g, "$1$2")
      .trim()
      .slice(0, 180)
  );
}
