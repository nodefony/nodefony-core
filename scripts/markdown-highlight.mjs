/**
 * markdown-highlight.mjs — coloration syntaxique des blocs de code du site publié.
 *
 * ## Pourquoi à la GÉNÉRATION, et pas dans le navigateur
 *
 * Un colorateur côté client coûte un script à télécharger, à parser et à
 * exécuter sur CHAQUE page, pour un résultat qui ne change jamais : le code
 * d'une page publiée est figé au moment où on la bâtit. Shiki colore donc ici,
 * une fois, et la page part avec ses couleurs déjà dedans — **aucun octet de
 * JavaScript n'est servi au lecteur pour ça**, ce qui est aussi la seule façon
 * de tenir la règle « pas de CDN, pas de dépendance à un tiers » du dossier.
 *
 * ## Les deux thèmes, sans dupliquer la feuille de style
 *
 * Shiki émet `--shiki-light` et `--shiki-dark` sur chaque fragment
 * (`defaultColor: false`). La feuille ci-dessous choisit l'une ou l'autre selon
 * le thème de la page. Écrire deux feuilles de style à la main — une par thème —
 * était l'autre voie : elles auraient divergé au premier ajout de langage.
 *
 * ## Ce qui n'est PAS coloré, et pourquoi
 *
 * - `mermaid` : ce n'est pas du code à lire, c'est un diagramme à RENDRE. Le
 *   colorer le transformerait en texte et ferait disparaître la figure.
 * - `nodefony` : ce n'est pas un langage, c'est une transcription de session
 *   CLI. Elle est colorée comme du shell, qui en est la grammaire la plus proche.
 * - Un langage inconnu rend une chaîne vide, ce que markdown-it interprète comme
 *   « rends ce bloc toi-même ». Un bloc non colorié reste lisible ; un bloc dont
 *   le colorateur a levé ne s'affiche pas du tout.
 */
import { createHighlighter } from "shiki";

/** Les langages présents dans le corpus, relevés sur les blocs réels. */
const LANGS = [
  "bash",
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "json",
  "jsonc",
  "yaml",
  "markdown",
  "html",
  "css",
  "sql",
  "dockerfile",
  "ini",
  "diff",
];

/** Alias du corpus vers une grammaire réelle. */
const ALIAS = {
  ts: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  yml: "yaml",
  md: "markdown",
  sh: "bash",
  shell: "bash",
  console: "bash",
  // Transcriptions de session CLI : la grammaire shell est la plus proche.
  nodefony: "bash",
};

/** Ce qu'on laisse passer tel quel — une figure, pas du code. */
const JAMAIS = new Set(["mermaid"]);

const highlighter = await createHighlighter({
  themes: ["github-light", "github-dark"],
  langs: LANGS,
});

/**
 * La fonction `highlight` de markdown-it — SYNCHRONE, d'où le chargement du
 * colorateur au niveau du module.
 *
 * @param code - le contenu brut du bloc.
 * @param lang - le langage déclaré après les trois accents graves.
 * @returns du HTML complet (`<pre>` compris), ou `""` pour laisser markdown-it faire.
 */
export function highlight(code, lang) {
  const nom = ALIAS[lang] ?? lang;
  if (!nom || JAMAIS.has(nom) || !LANGS.includes(nom)) return "";
  try {
    return highlighter.codeToHtml(code, {
      lang: nom,
      themes: { light: "github-light", dark: "github-dark" },
      // Pas de couleur « par défaut » : chaque fragment porte les DEUX, et la
      // feuille de style tranche. Sans ça, une page en sombre afficherait les
      // couleurs du thème clair jusqu'au premier repaint.
      defaultColor: false,
    });
  } catch {
    // Un bloc mal formé ne doit pas faire tomber la génération d'un site.
    return "";
  }
}

/**
 * La feuille de style qui accompagne le HTML rendu. À inclure UNE fois par page.
 */
export const STYLE_CODE = `
.shiki, .shiki span { color: var(--shiki-light); background-color: var(--shiki-light-bg); }
:root[data-theme="dark"] .shiki,
:root[data-theme="dark"] .shiki span { color: var(--shiki-dark); background-color: var(--shiki-dark-bg); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .shiki,
  :root:not([data-theme="light"]) .shiki span { color: var(--shiki-dark); background-color: var(--shiki-dark-bg); }
}
/* Le bloc lui-même : c'est la page qui décide de sa boîte, pas le thème Shiki —
   sinon deux blocs voisins, l'un colorié l'autre non, n'auraient pas la même. */
pre.shiki {
  padding: 14px 16px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 13.5px;
  line-height: 1.6;
  border: 1px solid rgba(128,128,128,.28);
  max-width: none;
}
pre.shiki code { background: none; padding: 0; font-size: inherit; }
@media print { pre.shiki { white-space: pre-wrap; word-break: break-word; } }`;
