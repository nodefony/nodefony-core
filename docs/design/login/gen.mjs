#!/usr/bin/env node
/**
 * Maquettes de la page de connexion (#547) — génère les habillages d'UN même
 * balisage et la galerie.
 *
 * Lancer : `node docs/design/login/gen.mjs` (réécrit les v*.html et index.html ;
 * les f*.html, propositions de fable, sont écrites à la main et lues par
 * fable-manifest.json). Les habillages écartés par l'auteur (04, 05, 06, 09,
 * 10, 12) ne sont plus générés : ils vivent dans l'historique git.
 *
 * Chaque page charge les feuilles PUBLIÉES du framework — `login.css` puis
 * `login/skins/<skin>.css` — et `mock.css` (photo + barre de test) : la
 * galerie montre ce que l'application recevra, elle n'en porte aucune copie.
 * L'aperçu fidèle reste la vraie page : `/login?skin=<skin>` en développement.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.dirname(fileURLToPath(import.meta.url));
// Le logo vient de SA source, jamais recopié (garde `brandAssets.test.ts` du
// cœur) : les pages le chargent par `<img>`.
const LOGO_URL = "../../../src/nodefony/assets/nodefony-logo.svg";

/** Le logo en `<img>` ; une couleur unique (blanc, `currentColor`) devient un filtre CSS. */
function logo(colors = null, cls = "nf-logo") {
  let tone = "";
  if (colors && new Set(colors).size === 1) {
    tone = ["#fff", "#ffffff"].includes(colors[0].toLowerCase())
      ? " nf-logo-white"
      : " nf-logo-mono";
  }
  return `<img class="${cls}${tone}" src="${LOGO_URL}" alt="">`;
}

// Les feuilles PUBLIÉES du framework : la galerie n'en porte aucune copie.
const ASSETS = "../../../src/nodefony/assets/";

// ── Les habillages générés ────────────────────────────────────────────────────
// Ni couleur ni fond ici : ils vivent dans `login/skins/<skin>.css` du cœur.
// Ces fiches ne disent que ce que la galerie affiche et le balisage d'exemple.
const VARIANTS = [
  {
    slug: "v01-console",
    skin: "console",
    name: "Console",
    layout: "card",
    usage:
      "Outils, back-offices, consoles : la signature de la barre de debug.",
    backdrop: "aucun",
  },
  {
    slug: "v02-blueprint",
    skin: "blueprint",
    name: "Plan technique",
    layout: "card",
    usage:
      "Produits techniques, API, plateformes de données : grille de plan, fond bleu nuit.",
    backdrop: "grille de plan",
  },
  {
    slug: "v03-points",
    skin: "dots",
    name: "Trame de points",
    layout: "card",
    usage:
      "SaaS grand public, applications métier : discret, clair d'abord, ombre légère.",
    backdrop: "trame de points",
  },
  {
    slug: "v07-epure",
    skin: "minimal",
    name: "Épuré",
    layout: "bare",
    usage:
      "Produit qui veut s'effacer : pas de carte, beaucoup d'air, titre plus grand.",
    backdrop: "aucun",
  },
  {
    slug: "v08-entreprise-sso",
    skin: "enterprise",
    name: "Entreprise — SSO d'abord",
    layout: "card",
    ssoFirst: true,
    usage:
      "Intranet derrière Keycloak : le fournisseur de l'entreprise passe AVANT le compte local (`providersFirst: true`). Palette sarcelle.",
    backdrop: "courbes de niveau",
    app: "Acme Intranet",
  },
  {
    slug: "v11-photo-carte",
    skin: "photo-card",
    name: "Photo — carte console",
    layout: "card",
    usage:
      "La photo de l'application en fond de page, voilée ; la carte console reste pleine et lisible au-dessus.",
    backdrop: "photo de l'application + voile",
  },
];

const ICONS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
<symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></symbol>
<symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/></symbol>
<symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></symbol>
<symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>
<symbol id="i-finger" viewBox="0 0 24 24"><path d="M12 11v2.5c0 2.8.9 4.8 2 6.5M8.5 13c0 2.8.5 4.8 1.6 7M6 9.5a6.5 6.5 0 0 1 12.3 1.4c.4 2 .4 4.8 0 7.6M9.2 9.2A3.5 3.5 0 0 1 15.5 11v2.2"/></symbol>
<symbol id="i-key" viewBox="0 0 24 24"><circle cx="8" cy="15" r="3.8"/><path d="M10.8 12.2 19.5 3.5M16.5 6.5l2.5 2.5M14 9l2 2"/></symbol>
<symbol id="i-building" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></symbol>
<symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6z"/></symbol>
<symbol id="m-github" viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></symbol>
</svg>`;

function page(v) {
  const app = v.app ?? "Mon application";
  const lg = logo();
  const sso = v.ssoFirst === true;
  const altHtml = sso
    ? `<div data-alt>
            <div class="nf-alt">
              <a class="nf-btn primary span" href="#"><svg class="nf-icon" aria-hidden="true"><use href="#i-building"/></svg>Continuer avec ${app.split(" ")[0]} SSO</a>
            </div>
            <div class="nf-or">ou avec un compte local</div>
          </div>`
    : `<div data-alt>
            <div class="nf-or">ou</div>
            <div class="nf-alt">
              <button type="button" class="nf-btn span"><svg class="nf-icon" aria-hidden="true"><use href="#i-finger"/></svg>Se connecter avec une passkey</button>
              <a class="nf-btn" href="#"><svg class="nf-icon" aria-hidden="true"><use href="#i-key"/></svg>Keycloak</a>
              <a class="nf-btn" href="#"><svg class="nf-mark" aria-hidden="true"><use href="#m-github"/></svg>GitHub</a>
            </div>
          </div>`;
  const primaryCls = sso ? "nf-btn" : "nf-btn primary";
  // Mêmes attributs que la vraie page (gabarit du framework).
  let attrs = `data-skin="${v.skin}" data-layout="${v.layout}"`;
  if (v.backdrop !== "aucun") attrs += " data-backdrop";
  if (sso) attrs += " data-sso-first";
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <title>Se connecter — ${app}</title>
    <link rel="stylesheet" href="${ASSETS}login.css" />
    <link rel="stylesheet" href="${ASSETS}login/skins/${v.skin}.css" />
    <link rel="stylesheet" href="mock.css" />
  </head>
  <body ${attrs}>
    ${ICONS}
    <header class="nf-strip">
      <div class="nf-strip-brand">${lg}${app}</div>
      <span class="nf-sep hide-sm" aria-hidden="true"></span>
      <span class="nf-chip env hide-sm">développement</span>
      <span class="nf-spacer"></span>
      <span class="nf-chip"><span class="nf-dot" aria-hidden="true"></span>serveur joignable</span>
    </header>
    <div class="nf-layout">

      <main class="nf-stage">
        <section class="nf-card" aria-labelledby="nf-title">
          <div class="nf-head">
            <div class="nf-brand">${lg}${app}</div>
            <h1 id="nf-title">Se connecter</h1>
            <p class="nf-sub" id="nf-sub">à ${app}</p>
          </div>
          <ol class="nf-steps" aria-label="Étapes">
            <li data-tab="identifier" aria-current="step">Identifiant</li>
            <li data-tab="password">Mot de passe</li>
            <li data-tab="mfa" hidden>Vérification</li>
          </ol>
          <div class="nf-body">
          ${sso ? altHtml : ""}
          <form data-step="identifier">
            <div class="nf-field">
              <label for="nf-username">Identifiant ou adresse e-mail</label>
              <div class="nf-input"><svg class="nf-icon" aria-hidden="true"><use href="#i-user"/></svg>
                <input id="nf-username" name="username" autocomplete="username webauthn" autocapitalize="none" spellcheck="false" required /></div>
            </div>
            <button class="${primaryCls}" type="submit">Continuer <svg class="nf-icon" aria-hidden="true"><use href="#i-arrow"/></svg></button>
          </form>
          <form data-step="password" hidden>
            <div class="nf-account"><span class="nf-avatar" aria-hidden="true">A</span><span class="who">admin</span>
              <button type="button" class="nf-link" data-go="identifier">Changer</button></div>
            <div class="nf-field">
              <div class="nf-label-row"><label for="nf-password">Mot de passe</label><a class="nf-link" href="#">Mot de passe oublié ?</a></div>
              <div class="nf-input"><svg class="nf-icon" aria-hidden="true"><use href="#i-lock"/></svg>
                <input id="nf-password" name="password" type="password" autocomplete="current-password" required />
                <button type="button" class="nf-reveal" data-reveal aria-label="Afficher le mot de passe" aria-pressed="false"><svg class="nf-icon"><use href="#i-eye"/></svg></button></div>
            </div>
            <button class="${primaryCls}" type="submit">Se connecter <svg class="nf-icon" aria-hidden="true"><use href="#i-arrow"/></svg></button>
          </form>
          <form data-step="mfa" hidden>
            <div class="nf-field">
              <label id="nf-otp-label">Code à 6 chiffres</label>
              <div class="nf-otp" role="group" aria-labelledby="nf-otp-label">
                <input inputmode="numeric" maxlength="1" autocomplete="one-time-code" aria-label="Chiffre 1" /><input inputmode="numeric" maxlength="1" aria-label="Chiffre 2" /><input inputmode="numeric" maxlength="1" aria-label="Chiffre 3" /><input inputmode="numeric" maxlength="1" aria-label="Chiffre 4" /><input inputmode="numeric" maxlength="1" aria-label="Chiffre 5" /><input inputmode="numeric" maxlength="1" aria-label="Chiffre 6" />
              </div>
            </div>
            <p class="nf-hint">Le code affiché par votre application d'authentification.</p>
            <button class="nf-btn primary" type="submit">Vérifier</button>
            <button type="button" class="nf-link nf-center">Utiliser un code de récupération</button>
          </form>
          <div data-step="authenticated" hidden>
            <div class="nf-done" role="status"><span class="ring" aria-hidden="true"><svg class="nf-icon"><use href="#i-check"/></svg></span>
              <strong>Session ouverte</strong><span class="dest">→ /admin/users</span><span class="nf-progress" aria-hidden="true"><span></span></span></div>
          </div>
          ${sso ? "" : altHtml}
          <div class="nf-message" aria-live="polite" data-message></div>
          <noscript><p class="nf-hint">Cette page a besoin de JavaScript pour vous connecter.</p></noscript>
          </div>
        </section>
        <div class="nf-foot">
          <ul class="nf-facts" aria-label="Protection de la session">
            <li><svg class="nf-icon" aria-hidden="true"><use href="#i-shield"/></svg>cookie HttpOnly</li>
            <li><svg class="nf-icon" aria-hidden="true"><use href="#i-shield"/></svg>anti-CSRF</li>
            <li><svg class="nf-icon" aria-hidden="true"><use href="#i-shield"/></svg>CSP stricte</li>
          </ul>
          <a class="nf-powered" href="https://github.com/nodefony/nodefony-core" rel="noopener noreferrer">${logo(["currentColor", "currentColor", "currentColor"])}Propulsé par Nodefony</a>
        </div>
      </main>
    </div>
    <div class="mock" role="toolbar" aria-label="Maquette">
      <a href="index.html">← galerie</a>
      <button data-go="identifier">identifiant</button><button data-go="password">mot de passe</button>
      <button data-go="mfa">code</button><button data-go="authenticated">connecté</button>
      <button data-err="401">401</button><button data-err="429">429</button>
      <button data-alt-toggle>fournisseurs</button><button data-theme-toggle>thème</button>
    </div>
    <script src="mock.js"></script>
  </body>
</html>
`;
}

const LAYOUT_LABEL = { card: "carte", split: "scindée", bare: "nue" };

function gallery() {
  const shown = [...VARIANTS];
  const manifest = path.join(OUT, "fable-manifest.json");
  if (existsSync(manifest)) {
    for (const f of JSON.parse(readFileSync(manifest, "utf8"))) {
      shown.push({ ...f, by: "fable" });
    }
  }
  const cards = shown.map((v) => {
    const num = v.slug.split("-")[0].toUpperCase().replace(/V/g, "");
    const by = v.by === "fable" ? '<span class="g-by">fable</span>' : "";
    return `      <article class="g-card">
        <a class="g-shot" href="${v.slug}.html" aria-label="Ouvrir « ${v.name} »">
          <span class="g-badge">${num}</span>${by}
          <iframe data-src="${v.slug}.html" tabindex="-1" loading="lazy" title="Aperçu ${v.name}"></iframe>
        </a>
        <div class="g-meta">
          <div class="g-title"><span class="g-num">${num}</span><a href="${v.slug}.html">${v.name}</a></div>
          <p>${v.usage}</p>
          <div class="g-tags"><span>skin: ${v.skin}</span><span>${LAYOUT_LABEL[v.layout] ?? v.layout}</span><span>fond : ${v.backdrop}</span></div>
        </div>
      </article>`;
  });
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <title>Page de connexion — propositions</title>
    <style>
      :root { --bg:#14161a; --card:#1c1f26; --raised:#22262e; --line:#2a2e36; --h:#f1f3f5; --t:#cfd3d8; --m:#8a9099; --a:#3aa0ff; color-scheme: dark; }
      @media (prefers-color-scheme: light) { :root { --bg:#f5f6f8; --card:#fff; --raised:#f0f2f5; --line:#e3e6ea; --h:#111317; --t:#343a40; --m:#5d646d; --a:#0067ba; color-scheme: light; } }
      * { box-sizing: border-box; }
      body { margin:0; background:var(--bg); color:var(--t); font:14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; }
      header { position:sticky; top:0; z-index:2; display:flex; flex-wrap:wrap; align-items:center; gap:12px 20px; padding:14px 24px; border-bottom:1px solid var(--line); background:var(--card); }
      h1 { margin:0; font-size:17px; color:var(--h); }
      h1 small { margin-left:8px; font:700 10px/1 ui-monospace, monospace; letter-spacing:.6px; text-transform:uppercase; color:var(--m); }
      .ctl { display:flex; align-items:center; gap:6px; }
      .ctl > span { font:700 10px/1 ui-monospace, monospace; letter-spacing:.6px; text-transform:uppercase; color:var(--m); }
      .ctl button { min-height:30px; padding:0 10px; border:1px solid var(--line); border-radius:6px; background:var(--raised); color:var(--t); font:600 12px/1 inherit; cursor:pointer; }
      .ctl button[aria-pressed="true"] { border-color:var(--a); color:var(--h); box-shadow: inset 0 -2px 0 var(--a); }
      .spacer { flex:1; }
      .audit { color:var(--a); font-weight:600; text-decoration:none; } .audit:hover { text-decoration:underline; }
      .audit-pick { padding:3px 9px; border:1px solid var(--a); border-radius:10px; font:700 10px/1.4 ui-monospace, monospace; letter-spacing:.5px; text-transform:uppercase; color:var(--h); }
      main { display:grid; grid-template-columns:repeat(auto-fill, minmax(380px, 1fr)); gap:20px; padding:24px; }
      .g-card { overflow:hidden; border:1px solid var(--line); border-radius:12px; background:var(--card); }
      .g-shot { position:relative; display:block; aspect-ratio:16/10; overflow:hidden; border-bottom:1px solid var(--line); background:var(--raised); }
      .g-shot iframe { position:absolute; top:0; left:0; width:1280px; height:800px; border:0; transform-origin:0 0; pointer-events:none; }
      .g-shot:hover { outline:2px solid var(--a); outline-offset:-2px; }
      .g-badge { position:absolute; top:10px; left:10px; z-index:1; display:grid; place-items:center; min-width:34px; height:34px; padding:0 8px; border:1px solid var(--line); border-radius:8px; background:var(--card); color:var(--h); font:800 15px/1 ui-monospace, monospace; }
      .g-by { position:absolute; top:10px; right:10px; z-index:1; padding:5px 8px; border:1px solid var(--a); border-radius:6px; background:var(--card); color:var(--h); font:700 10px/1 ui-monospace, monospace; letter-spacing:.6px; text-transform:uppercase; }
      body.mobile .g-shot { aspect-ratio: 16/10; background: var(--raised); }
      body.mobile .g-shot iframe { left:50%; width:390px; height:844px; }
      .g-meta { padding:14px 16px 16px; }
      .g-title { display:flex; align-items:center; gap:10px; }
      .g-title a { color:var(--h); font-weight:650; font-size:15px; text-decoration:none; }
      .g-title a:hover { text-decoration:underline; }
      .g-num { font:700 11px/1 ui-monospace, monospace; color:var(--a); }
      .g-meta p { margin:6px 0 10px; color:var(--m); font-size:13px; }
      .g-tags { display:flex; flex-wrap:wrap; gap:6px; }
      .g-tags span { padding:3px 8px; border:1px solid var(--line); border-radius:10px; background:var(--raised); font:700 10px/1.2 ui-monospace, monospace; letter-spacing:.4px; text-transform:uppercase; color:var(--m); }
    </style>
  </head>
  <body>
    <header>
      <h1>Page de connexion<small>#547 · propositions · un seul balisage</small></h1>
      <a class="audit" href="audit.html">Audit et décisions (ADR-0015)</a>
      <span class="audit-pick">beta 3 : F03</span>
      <span class="spacer"></span>
      <div class="ctl" data-group="step"><span>étape</span>
        <button data-v="identifier" aria-pressed="true">identifiant</button><button data-v="password">mot de passe</button>
        <button data-v="mfa">code</button><button data-v="error">erreur</button><button data-v="authenticated">connecté</button></div>
      <div class="ctl" data-group="theme"><span>thème</span>
        <button data-v="" aria-pressed="true">système</button><button data-v="light">clair</button><button data-v="dark">sombre</button></div>
      <div class="ctl" data-group="format"><span>format</span>
        <button data-v="desktop" aria-pressed="true">bureau</button><button data-v="mobile">mobile</button></div>
    </header>
    <main>
${cards.join("\n")}
    </main>
    <script>
      const state = { step: "identifier", theme: "", format: "desktop" };
      const frames = [...document.querySelectorAll("iframe[data-src]")];
      function fit() {
        for (const f of frames) {
          const box = f.parentElement.getBoundingClientRect();
          if (state.format === "mobile") {
            const s = box.height / 844;
            f.style.transform = \`translateX(-50%) scale(\${s})\`;
            f.style.transformOrigin = "50% 0";
          } else {
            f.style.transform = \`scale(\${box.width / 1280})\`;
            f.style.transformOrigin = "0 0";
          }
        }
      }
      function load() {
        const q = new URLSearchParams({ embed: "1", step: state.step });
        if (state.theme) q.set("theme", state.theme);
        for (const f of frames) {
          f.src = \`\${f.dataset.src}?\${q}\`;
          const a = f.closest("article").querySelectorAll("a[href]");
          const open = new URLSearchParams({ step: state.step });
          if (state.theme) open.set("theme", state.theme);
          a.forEach((el) => (el.href = \`\${f.dataset.src}?\${open}\`));
        }
        document.body.classList.toggle("mobile", state.format === "mobile");
        fit();
      }
      document.querySelectorAll(".ctl").forEach((g) =>
        g.addEventListener("click", (e) => {
          const b = e.target.closest("button");
          if (!b) return;
          state[g.dataset.group] = b.dataset.v;
          g.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          load();
        }),
      );
      addEventListener("resize", fit);
      load();
    </script>
  </body>
</html>
`;
}

for (const v of VARIANTS) {
  writeFileSync(path.join(OUT, `${v.slug}.html`), page(v), "utf8");
}
writeFileSync(path.join(OUT, "index.html"), gallery(), "utf8");
console.log("ok", VARIANTS.length, "habillages");
