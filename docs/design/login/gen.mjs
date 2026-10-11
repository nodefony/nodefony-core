#!/usr/bin/env node
/**
 * Maquettes de la page de connexion (#547) — rend chaque habillage par le VRAI
 * gabarit du framework, puis la galerie.
 *
 * Lancer : `node docs/design/login/gen.mjs` (réécrit les v*.html, f*.html et
 * index.html). Exige Node ≥ 23 (le gabarit est importé depuis sa source
 * TypeScript) et un `npm install` à la racine (`eta`, `nodefony`).
 *
 * Aucun balisage n'est écrit ici : chaque page sort de `LOGIN_PAGE_TEMPLATE`
 * et de `buildLoginPageView` (`@nodefony/framework`), exactement comme
 * `/login`. Une copie du balisage avait perdu le bouton passkey ; la galerie ne
 * peut plus dériver de la page. Ce que ce script change au rendu tient en trois
 * adresses (feuilles PUBLIÉES du cœur, `mock.css`, `mock.js`) et la barre de
 * test ajoutée avant `</body>`. L'aperçu fidèle reste la vraie page :
 * `/login?skin=<skin>` en développement.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Eta } from "eta";
import {
  LOGIN_PAGE_SKINS,
  LOGIN_PAGE_SKIN_SPECS,
  loginPageSkinFile,
} from "nodefony";
import {
  buildLoginPageView,
  LOGIN_PAGE_TEMPLATE,
} from "../../../src/packages/@nodefony/framework/nodefony/src/loginPage.ts";

const OUT = path.dirname(fileURLToPath(import.meta.url));
// Les feuilles et le logo PUBLIÉS du cœur, en chemin relatif : la galerie
// s'ouvre en `file://` et n'en porte aucune copie.
const ASSETS = "../../../src/nodefony/assets/";
const LOGO_URL = `${ASSETS}nodefony-logo.svg`;

// ── Les habillages générés ────────────────────────────────────────────────────
// Ni couleur ni fond ni balisage ici : les couleurs vivent dans
// `login/skins/<skin>.css` du cœur, le balisage dans le gabarit du framework.
// Ces fiches ne disent que ce que la galerie affiche.
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

// Les fiches des propositions de fable (f*.html) : leur nom et leur usage.
const manifest = path.join(OUT, "fable-manifest.json");
const FABLE = existsSync(manifest)
  ? JSON.parse(readFileSync(manifest, "utf8")).map((f) =>
      Object.assign(f, { by: "fable" }),
    )
  : [];
const SHOWN = [...VARIANTS, ...FABLE];

// Un habillage ajouté au catalogue du cœur doit avoir sa maquette : la galerie
// prétend montrer les habillages, pas une partie d'entre eux.
const missing = LOGIN_PAGE_SKINS.filter(
  (skin) => !SHOWN.some((v) => v.skin === skin),
);
if (missing.length > 0) {
  throw new Error(
    `habillage(s) sans maquette : ${missing.join(", ")} — ajoute une entrée à VARIANTS`,
  );
}

// Même moteur et mêmes options que `LoginPageController` : tout sort échappé.
const eta = new Eta({ autoEscape: true, useWith: false });
const template = eta.compile(LOGIN_PAGE_TEMPLATE);

/** La description qu'`authFlow.describeLoginPage()` rendrait pour cet habillage. */
function describe(v) {
  return {
    path: "/login",
    title: v.app ?? "Mon application",
    logo: null,
    template: null,
    heading: null,
    subtitle: null,
    stylesheet: null,
    // Défaut de `security.loginPage.providersFirst` : ce que reçoit une application.
    providersFirst: v.providersFirst ?? true,
    hero: null,
    footer: true,
    skin: v.skin,
    layout: LOGIN_PAGE_SKIN_SPECS[v.skin].layout,
    password: true,
    passkey: true,
    previewPicker: false,
    providers: [
      { name: "keycloak", label: "Keycloak", icon: null },
      { name: "github", label: "GitHub", icon: null },
    ],
  };
}

const MOCK_BAR = `    <aside class="mock" aria-label="Barre de la maquette">
      <a href="index.html">← galerie</a>
      <button data-go="identifier">identifiant</button><button data-go="password">mot de passe</button>
      <button data-go="mfa">code</button><button data-go="authenticated">connecté</button>
      <button data-err="401">401</button><button data-err="429">429</button>
      <button data-alt-toggle>fournisseurs</button><button data-theme-toggle>thème</button>
    </aside>
  </body>`;

/** La page de l'habillage, rendue par le gabarit du framework. */
function page(v) {
  const view = buildLoginPageView(describe(v), {
    from: "/admin/users",
    theme: undefined,
    nonce: "maquette",
    projectName: "Mon application",
    assetsVersion: "galerie",
  });
  const skinFile = loginPageSkinFile(v.skin);
  const html = template.call(eta, {
    ...view,
    logo: LOGO_URL,
    logoHref: LOGO_URL,
    styleHref: `${ASSETS}login.css`,
    // `skins/<x>.css` est relatif au dossier SERVI ; dans les sources du cœur,
    // les habillages vivent sous `assets/login/`.
    skinHref: skinFile === null ? null : `${ASSETS}login/${skinFile}`,
    // La place de la feuille de l'application porte la photo et la barre.
    stylesheetHref: "mock.css",
    scriptHref: "mock.js",
    // Un fournisseur ne mène nulle part dans une maquette.
    providers: view.providers.map(({ label, caption, icon, image }) => ({
      label,
      caption,
      icon,
      image,
      href: "#",
    })),
  });
  // `file://` refuse un script de module (origine nulle) : la maquette charge
  // `mock.js` en script classique — DIFFÉRÉ, comme l'est un module, sinon il
  // s'exécute dans `<head>` avant que le corps existe.
  const out = html
    .replace(
      '<script type="module" src="mock.js"',
      '<script defer src="mock.js"',
    )
    .replace("  </body>", MOCK_BAR);
  if (
    !out.includes('<script defer src="mock.js"') ||
    !out.includes('class="mock"')
  ) {
    throw new Error(
      `${v.slug} : le gabarit a changé, la maquette ne s'y greffe plus`,
    );
  }
  return out;
}

const LAYOUT_LABEL = { card: "carte", split: "scindée", bare: "nue" };

function gallery() {
  const cards = SHOWN.map((v) => {
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

for (const v of SHOWN) {
  writeFileSync(path.join(OUT, `${v.slug}.html`), page(v), "utf8");
}
writeFileSync(path.join(OUT, "index.html"), gallery(), "utf8");
console.log("ok", SHOWN.length, "habillages");
