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
 * Retire les commentaires HTML (« GÉNÉRÉ par … » n'est pas un résumé) jusqu'au
 * point fixe : un seul passage laisse `<!--` dans `<!-<!---->-`, qui se recompose
 * une fois le commentaire intérieur retiré.
 *
 * @param text - le markdown.
 * @returns le markdown sans aucun commentaire, ni ouverture orpheline.
 */
function withoutHtmlComments(text) {
  let current = text;
  let previous;
  do {
    previous = current;
    current = current.replace(/<!--[\s\S]*?-->/g, "");
  } while (current !== previous);
  return current.replaceAll("<!--", "");
}

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
 * @returns le résumé, coupé en fin de phrase ou de mot ({@link clipSummary}).
 */
export function pageSummary(body, declared, title) {
  const prose = withoutHtmlComments(
    body.replace(/```[\s\S]*?```/g, ""), // un bloc de code n'est pas une phrase
  )
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
  return clipSummary(
    text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // les liens gardent leur texte
      .replace(/[*`]/g, "")
      // L'emphase `_mot_` perd ses marques ; un identifiant (`NF_DATABASE_URL`)
      // garde les siennes — les retirer toutes en faisait `NFDATABASEURL`.
      .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=$|[\s).,;:!?])/g, "$1$2")
      .trim(),
  );
}

/** Longueur au-delà de laquelle un moteur de recherche coupe une description. */
export const SUMMARY_MAX = 160;

/**
 * Coupe un résumé trop long à la dernière fin de PHRASE qui tient, sinon au
 * dernier mot entier, suivi de « … ».
 *
 * Une coupe au caractère près laissait des descriptions finir en plein mot
 * (« …les ports qu'il ouvre dé ») : c'est ce que l'aperçu d'un résultat de
 * recherche affiche tel quel.
 *
 * @param text - le résumé complet, sur une ligne
 * @param max - longueur maximale, {@link SUMMARY_MAX} par défaut
 * @returns le résumé, `max` caractères au plus
 */
export function clipSummary(text, max = SUMMARY_MAX) {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  // Une phrase entière d'au moins la moitié de la place vaut mieux qu'une coupe.
  const sentence = Math.max(
    head.lastIndexOf(". "),
    head.lastIndexOf("! "),
    head.lastIndexOf("? "),
  );
  if (sentence >= max / 2) return head.slice(0, sentence + 1);
  const word = text.slice(0, max - 1).lastIndexOf(" ");
  return `${text.slice(0, word > 0 ? word : max - 1).replace(/[\s,;:—-]+$/, "")}…`;
}
