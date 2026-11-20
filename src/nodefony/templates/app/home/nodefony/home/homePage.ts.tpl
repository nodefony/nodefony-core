/**
 * La page d'accueil HTML de <%= it.appName %> — c'est TA page.
 *
 * Rendue par le serveur (l'application n'a pas de front) avec la MÊME feuille
 * que les accueils des fronts (`public/showcase.css`), et sans JavaScript : le
 * thème suit celui du système.
 *
 * Ce que voit tout visiteur : la marque<% if (it.complete) { %>, la session<% } %>, puis le nom de
 * l'application. En DÉVELOPPEMENT seulement : la présentation du framework, les
 * liens utiles et où personnaliser la page (`homeContent.ts`) — le serveur ne
 * les rend jamais en production.
 */
import {
  homeContent,
  type IHomeCard,
  type IHomeSection,
  type IHomeText,
} from "./homeContent";

/** Ce que la page affiche pour CETTE requête. */
export interface IHomePageView {
  readonly appName: string;
  /** `true` en développement : les sections de `homeContent.ts` sont rendues. */
  readonly development: boolean;
  /** Adresse de la démo si elle est chargée, sinon `null`. */
  readonly demo: string | null;
<% if (it.complete) { %>  /** Identifiant du compte connecté, ou `null`. */
  readonly user: string | null;
  /** La page de connexion, avec le retour vers l'accueil. */
  readonly loginHref: string;
<% } %>}

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Échappe un texte pour le HTML — contenu comme valeur d'attribut. */
function esc(value: string): string {
  return value.replace(/[&<>"']/gu, (c) => ESCAPES[c] ?? c);
}

function rich(text: readonly IHomeText[]): string {
  return text
    .map((part) =>
      part.code ? `<code>${esc(part.text)}</code>` : esc(part.text),
    )
    .join("");
}

function card(item: IHomeCard): string {
  const tag = item.href === null ? "div" : "a";
  const href = item.href === null ? "" : ` href="${esc(item.href)}"`;
  const tone = item.tone === "safe" ? " nf-safe" : "";
  const creds =
    item.creds === null
      ? ""
      : `<p class="nf-creds"><code>${esc(item.creds.user)}</code>${
          item.creds.password === null
            ? ""
            : ` / <code>${esc(item.creds.password)}</code>`
        }</p>`;
  const go =
    item.go === null ? "" : `<span class="nf-go">${esc(item.go)}</span>`;
  const picker = item.skins;
  const skins =
    picker === null
      ? ""
      : `<form class="nf-skins" action="${esc(picker.action)}" method="get">` +
        `<select name="skin" aria-label="Habillage de la page de connexion">${picker.options
          .map(
            (skin) =>
              `<option value="${esc(skin)}"${skin === picker.selected ? " selected" : ""}>${esc(skin)}</option>`,
          )
          .join("")}</select><button type="submit">Voir</button></form>`;
  return `<${tag} class="nf-card${tone}"${href}><h3>${esc(item.title)}</h3>${creds}<p>${rich(item.text)}</p>${go}${skins}</${tag}>`;
}

function section(item: IHomeSection): string {
  const band = item.band ? " nf-band" : "";
  const note =
    item.note === null ? "" : `<p class="nf-note">${esc(item.note)}</p>`;
  return (
    `<section class="nf-section${band}" aria-labelledby="${item.id}-title">` +
    `<div class="nf-sec-head"><p class="nf-kicker">${esc(item.kicker)}</p>` +
    `<h2 id="${item.id}-title">${esc(item.title)}</h2><p>${esc(item.intro)}</p></div>` +
    `<div class="nf-grid">${item.cards.map(card).join("")}</div>${note}</section>`
  );
}

/**
 * Rend la page d'accueil complète.
 *
 * @param view - ce que la page affiche pour cette requête
 * @returns le document HTML
 */
export function renderHomePage(view: IHomePageView): string {
  const name = esc(view.appName);
  const dev = view.development ? homeContent() : null;
  const tag = dev === null ? "" : `<span class="nf-tag">développement</span>`;
  const nav =
    dev === null
      ? ""
      : `<nav class="nf-topnav" aria-label="Liens de développement">${
          dev.console === null
            ? ""
            : `<a href="${esc(dev.console.href)}">${esc(dev.console.label)}</a><span class="nf-topnav-sep" aria-hidden="true"></span>`
        }${dev.external
          .map(
            (link) =>
              `<a class="nf-ext" href="${esc(link.href)}">${esc(link.label)}</a>`,
          )
          .join("")}</nav>`;
<% if (it.complete) { %>  const session =
    view.user === null
      ? `<a class="nf-login" href="${esc(view.loginHref)}">Se connecter</a>`
      : `<span class="nf-account"><span class="nf-session">${esc(view.user)}</span></span>`;
<% } else { %>  const session = "";
<% } %>  const hero =
    dev === null
      ? `<h1>${name}</h1>`
      : `<h1>${esc(dev.hero.title)}</h1><p class="nf-sub">${esc(dev.hero.sub)}</p>` +
        `<p class="nf-sig">${esc(dev.hero.sig)}</p>` +
        `<div class="nf-badges"><span class="nf-badge nf-agentic">${esc(dev.hero.lead)}</span>${dev.hero.badges
          .map((badge) => `<span class="nf-badge">${esc(badge)}</span>`)
          .join("")}</div>` +
        `<div class="nf-install" role="img" aria-label="Commande d'installation : ${esc(
          `${dev.hero.install.command} ${dev.hero.install.arg}`,
        )}"><span class="nf-p">$</span><span>${esc(dev.hero.install.command)} <b>${esc(
          dev.hero.install.arg,
        )}</b></span></div>` +
        (view.demo === null
          ? `<p class="nf-learn">${esc(dev.learn.label)} : <code>${esc(dev.learn.command)}</code> — ${esc(dev.learn.note)}</p>`
          : `<div class="nf-cta"><a class="nf-btn nf-primary" href="${esc(view.demo)}">${esc(dev.demoLabel)}</a></div>`);
  const sections = dev === null ? "" : dev.sections.map(section).join("");
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${name}</title>
    <meta name="description" content="${name} — application Nodefony." />
    <meta name="color-scheme" content="light dark" />
    <link rel="icon" href="/favicon.ico" />
    <link rel="stylesheet" href="/showcase.css" />
  </head>
  <body>
    <header class="nf-topbar">
      <a class="nf-brand" href="/"><img src="/nodefony-logo.png" alt="" width="30" height="30" /><span>${name}</span>${tag}</a>
      ${nav}
      <div class="nf-topbar-tools">${session}</div>
    </header>
    <main class="nf-main">
      <div class="nf-hero"><img class="nf-hero-logo" src="/nodefony-logo.png" alt="" width="80" height="80" fetchpriority="high" />${hero}</div>
      ${sections}
    </main>
  </body>
</html>
`;
}
