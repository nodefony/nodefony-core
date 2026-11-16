/**
 * Les encarts GitHub (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`,
 * `[!CAUTION]`) rendus en HTML, et leur style.
 *
 * UNE règle pour tout le site : la documentation et l'accueil rendent le même
 * Markdown, et un encart écrit dans le README doit se lire sur la page publiée
 * comme sur GitHub. Deux copies divergeraient — l'accueil n'en avait aucune, et
 * affichait `[!IMPORTANT]` en clair dans une citation ordinaire.
 *
 * @usage import { ADMONITION_CSS, decorateAdmonitions } from "./lib/admonitions.mjs"
 * @module
 */

/** Type d'encart → [suffixe de classe, titre affiché]. */
export const ADMONITIONS = {
  NOTE: ["note", "ℹ️ Note"],
  TIP: ["tip", "💡 Astuce"],
  IMPORTANT: ["important", "❗ Important"],
  WARNING: ["warning", "⚠️ Attention"],
  CAUTION: ["caution", "🛑 Prudence"],
};

/**
 * Transforme les citations ouvertes par `[!TYPE]` (sortie de markdown-it) en
 * encarts typés.
 *
 * @param html - HTML rendu par markdown-it.
 * @returns le même HTML, encarts décorés.
 */
export function decorateAdmonitions(html) {
  return html.replace(
    /<blockquote>\s*<p>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/g,
    (_, t) =>
      `<blockquote class="adm adm-${ADMONITIONS[t][0]}"><p class="adm-title">${ADMONITIONS[t][1]}</p><p>`,
  );
}

/** Le style des encarts, couleurs comprises, pour les deux thèmes. */
export const ADMONITION_CSS = `/* Admonitions. Les couleurs sont des VARIABLES parce qu'elles doivent tenir
   4,5:1 dans les DEUX thèmes : la teinte qui porte un titre sur blanc est trop
   sombre sur fond noir, et l'inverse. Chaque valeur ci-dessous a été mesurée par
   axe-core, jamais choisie à l'œil. */
:root { --adm-note:#1c62c4; --adm-tip:#1a7040; --adm-important:#6a3bbf;
  --adm-warning:#7a5800; --adm-caution:#c0322a; }
:root[data-theme="dark"] { --adm-note:#78b6ff; --adm-tip:#4fc07d; --adm-important:#c7a4ff;
  --adm-warning:#e0ab3a; --adm-caution:#ff8a80; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --adm-note:#78b6ff; --adm-tip:#4fc07d;
    --adm-important:#c7a4ff; --adm-warning:#e0ab3a; --adm-caution:#ff8a80; }
}
/* Une couleur par type (\`--adm-c\`), qui porte le liseré, le titre et une
   TEINTE légère du fond et du filet : un encart se distingue d'une citation
   ordinaire au premier coup d'œil, sans boîte dans la boîte. Repli sans
   color-mix : le fond plein et le filet neutre d'avant. */
.adm { --adm-c:var(--line); border:1px solid var(--line); border-left:4px solid var(--adm-c);
  background:var(--card); border-radius:0 10px 10px 0; padding:10px 16px; margin:16px 0; }
@supports (color:color-mix(in oklab, red, blue)) {
  .adm { background:color-mix(in oklab, var(--adm-c) 7%, var(--card));
    border-color:color-mix(in oklab, var(--adm-c) 22%, var(--line)); border-left-color:var(--adm-c); }
}
.adm .adm-title { margin:0 0 4px; font-weight:700; font-size:12px; text-transform:uppercase;
  letter-spacing:.04em; color:var(--adm-c); }
.adm-note { --adm-c:var(--adm-note); }
.adm-tip { --adm-c:var(--adm-tip); }
.adm-important { --adm-c:var(--adm-important); }
.adm-warning { --adm-c:var(--adm-warning); }
.adm-caution { --adm-c:var(--adm-caution); }`;
