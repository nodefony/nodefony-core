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
  // Une description déclarée sur plusieurs lignes (`>` de YAML) garde ses `\n` :
  // les blancs se normalisent, une déclarée vide laisse la main au corps.
  const declaredText =
    typeof declared === "string" ? declared.replace(/\s+/g, " ").trim() : "";
  const text =
    (declaredText === "" ? undefined : declaredText) ??
    prose
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
      .find(
        (p) =>
          p.length > 30 &&
          !/^(#|\||[-*+] |\d+[.)] |!\[)/.test(p) && // titre, tableau, liste, image
          !/[:：][\s*_`]*$/.test(p) && // annonce une liste : ne résume rien
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
  // Par POINTS DE CODE : `slice` coupe en UTF-16 et scinderait la paire de
  // substitution d'un emoji, laissant un caractère orphelin dans la description.
  const cps = Array.from(text);
  if (cps.length <= max) return text;
  // Une phrase entière d'au moins la moitié de la place vaut mieux qu'une coupe.
  for (let i = max - 1; i >= Math.ceil(max / 2) - 1; i--) {
    if (!isSentenceEnd(cps, i)) continue;
    const sentence = cps.slice(0, i + 1).join("");
    if (unclosedOpener(sentence) === -1) return sentence;
  }
  const room = cps.slice(0, max - 1);
  // Si la place s'arrête pile sur une espace, les mots du début sont entiers.
  const space = cps[max - 1] === " " ? max - 1 : room.lastIndexOf(" ");
  let cut = room.slice(0, space > 0 ? space : max - 1).join("");
  // Jamais « (cf. RFC 6750 » sans sa fermeture : on recule avant l'ouvrant.
  const opener = unclosedOpener(cut);
  if (opener > 0 && cut.slice(0, opener).trim() !== "")
    cut = cut.slice(0, opener);
  return `${cut.replace(/[\s,;:—([«“-]+$/, "")}…`;
}

/** Abréviations après lesquelles un point ne finit PAS la phrase. */
const ABBREVIATIONS = new Set([
  "cf",
  "ex",
  "e.g",
  "i.e",
  "vs",
  "n°",
  "no",
  "nb",
  "fig",
  "art",
  "env",
  "approx",
  "dr",
  "mme",
  "st",
  "vol",
  "pp",
]);

/**
 * Le caractère à l'index `i` finit-il une phrase ? `.`, `!` ou `?`, puis une
 * espace, puis une MAJUSCULE (accentuée comprise) ; et le mot qui précède n'est
 * ni une abréviation courante ni une initiale (« p. ex. », « cf. »).
 *
 * @param cps - le texte, en points de code
 * @param i - l'index du signe de ponctuation candidat
 * @returns vrai si la phrase s'arrête là
 */
function isSentenceEnd(cps, i) {
  const c = cps[i];
  if (c !== "." && c !== "!" && c !== "?") return false;
  // Majuscule (accentuée comprise), ou une ouverture de citation / un `@décorateur`.
  if (cps[i + 1] !== " " || !/^[\p{Lu}@«“"]$/u.test(cps[i + 2] ?? ""))
    return false;
  if (c !== ".") return true;
  let start = i;
  while (start > 0 && cps[start - 1] !== " ") start--;
  const word = cps
    .slice(start, i)
    .join("")
    .replace(/^[("«“[]+/, "")
    .toLowerCase();
  return !(ABBREVIATIONS.has(word) || [...word].length === 1);
}

/**
 * Index du premier ouvrant `(`, `[`, `«`, `“` ou guillemet droit resté sans
 * fermeture dans `text`, ou -1.
 *
 * @param text - le texte coupé
 * @returns l'index UTF-16 de l'ouvrant, ou -1
 */
function unclosedOpener(text) {
  const closing = { "(": ")", "[": "]", "«": "»", "“": "”" };
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (stack.length > 0 && stack[stack.length - 1].ch === '"') stack.pop();
      else stack.push({ ch, i });
    } else if (ch in closing) stack.push({ ch, i });
    else if (ch === ")" || ch === "]" || ch === "»" || ch === "”") {
      const top = stack[stack.length - 1];
      if (top !== undefined && closing[top.ch] === ch) stack.pop();
    }
  }
  return stack.length === 0 ? -1 : stack[0].i;
}
