/*
 * Feuille de la démo — reprise de la maquette validée (#747) : mêmes jetons
 * que l’accueil du cœur. Le logo arrive par `--demo-logo`, posé par la page
 * depuis le paquet (`brand.ts`) : jamais une copie embarquée ici.
 */
/* Mise en page : celle de l'accueil du cœur (nodefony/views/index.eta), mêmes jetons ;
   le catalogue des démos remplace les quatre fronts et Studio. */
:root {
  --blue: #096bbf;
  --cyan: #1ea0ec;
  --green: #4a8b3e;
  --amber: #b7791f;
  --violet: #7c4dbd;
  --bg: #fafbfd;
  --bg-soft: #f1f5fa;
  --fg: #0e1726;
  --muted: #5b6b84;
  --card: #ffffff;
  --border: #e3e9f2;
  --code-bg: #0e1726;
  --code-fg: #d9e6f5;
  --shadow: 0 1px 2px rgba(14, 23, 38, 0.05), 0 8px 24px rgba(14, 23, 38, 0.06);
  --shadow-hover:
    0 2px 4px rgba(14, 23, 38, 0.06), 0 14px 34px rgba(9, 107, 191, 0.14);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0a0f1c;
    --bg-soft: #0e1524;
    --fg: #e8edf6;
    --muted: #93a1ba;
    --card: #111828;
    --border: #223046;
    --code-bg: #0b1220;
    --code-fg: #cfe0f2;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.35);
    --shadow-hover:
      0 2px 4px rgba(0, 0, 0, 0.3), 0 14px 34px rgba(30, 160, 236, 0.18);
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0a0f1c;
  --bg-soft: #0e1524;
  --fg: #e8edf6;
  --muted: #93a1ba;
  --card: #111828;
  --border: #223046;
  --code-bg: #0b1220;
  --code-fg: #cfe0f2;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.35);
  --shadow-hover:
    0 2px 4px rgba(0, 0, 0, 0.3), 0 14px 34px rgba(30, 160, 236, 0.18);
  color-scheme: dark;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  font-family:
    ui-sans-serif,
    system-ui,
    -apple-system,
    "Segoe UI",
    Roboto,
    sans-serif;
  color: var(--fg);
  background:
    radial-gradient(
      1100px 480px at 50% -14%,
      rgba(9, 107, 191, 0.07),
      transparent 60%
    ),
    var(--bg);
  line-height: 1.6;
  font-size: 15px;
}
body::before {
  content: "";
  position: fixed;
  inset: 0 0 auto;
  height: env(safe-area-inset-top, 0px);
  z-index: 30;
  background: var(--bg);
}
a {
  color: var(--blue);
}
a:focus-visible,
button:focus-visible {
  outline: 2px solid var(--cyan);
  outline-offset: 3px;
  border-radius: 4px;
}
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85em;
}

.topbar {
  position: sticky;
  top: env(safe-area-inset-top, 0px);
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  padding-block: 12px;
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: var(--fg);
  font-weight: 700;
}
.brand .tag {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 1px 9px;
}
.topnav {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.topnav a {
  text-decoration: none;
  /* La barre est translucide : sur un contenu gris, `--muted` seul tombait
     à 4,44:1. Mêlé au texte, il tient 4,5:1 quel que soit le dessous. */
  color: color-mix(in srgb, var(--muted) 80%, var(--fg));
  font-size: 0.9rem;
  font-weight: 500;
  padding: 7px 12px;
  border-radius: 8px;
}
.topnav a:hover {
  color: var(--fg);
  background: var(--bg-soft);
}
.brand .tag.ver {
  font-variant-numeric: tabular-nums;
  color: color-mix(in srgb, var(--blue) 50%, var(--fg));
  border-color: color-mix(in srgb, var(--blue) 35%, var(--border));
}
.topnav a.doc {
  color: color-mix(in srgb, var(--blue) 50%, var(--fg));
  font-weight: 600;
}
.topnav a.gh {
  color: var(--fg);
  border: 1px solid var(--border);
}
.topnav a.login {
  color: #fff;
  background: var(--blue);
  font-weight: 600;
}
/* Le compte connecté : l'identifiant, puis la déconnexion. */
.account {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-left: 6px;
}
.account-who {
  max-width: 16ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.9rem;
  font-weight: 600;
}
.account-out {
  min-height: 36px;
  padding: 6px 12px;
  font: inherit;
  font-size: 0.85rem;
  color: var(--fg);
  background: none;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
}
.account-out:hover {
  background: var(--bg-soft);
}

main {
  max-width: 1080px;
  margin: 0 auto;
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
  padding-block: 0 40px;
}
.hero {
  text-align: center;
  padding-block: clamp(44px, 8vw, 84px) clamp(28px, 5vw, 48px);
}
.hero h1 {
  margin: 0 auto 10px;
  max-width: 860px;
  font-size: clamp(2rem, 5vw, 3.2rem);
  line-height: 1.12;
  letter-spacing: -0.028em;
  text-wrap: balance;
}
.hero .sub {
  opacity: 0.82;
  font-size: clamp(1rem, 2vw, 1.18rem);
  font-weight: 500;
  margin: 0 auto 8px;
  max-width: 700px;
}
.hero .sig {
  color: var(--muted);
  max-width: 640px;
  margin: 0 auto;
}
.hero-logo {
  height: 80px;
  width: auto;
}
.hero h1 {
  margin-top: 18px;
}
.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 20px;
}
.badge {
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--muted);
  border: 1px solid var(--border);
  background: var(--card);
  border-radius: 999px;
  padding: 4px 12px;
}
.badge.agentic {
  color: color-mix(in srgb, var(--green) 50%, var(--fg));
  border-color: color-mix(in srgb, var(--green) 45%, var(--border));
}
.badges {
  align-items: center;
}
.roles {
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(0, 1fr);
}
@media (min-width: 960px) {
  .roles {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}
@media (min-width: 600px) and (max-width: 959px) {
  .roles {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .role:last-child {
    grid-column: 1 / -1;
  }
}
.role {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px;
  min-width: 0;
}
.role h3 {
  margin: 0;
  font-size: 0.98rem;
}
.role p {
  margin: 0;
  color: var(--muted);
  font-size: 0.84rem;
}
.role ol {
  margin: 0;
  padding-left: 18px;
  font-size: 0.84rem;
  display: grid;
  gap: 2px;
}
.role a,
footer a {
  color: color-mix(in srgb, var(--blue) 50%, var(--fg));
}
.role .docs {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 4px;
  font-size: 0.84rem;
}
.role .docs a {
  text-decoration: none;
}
.role .docs a:hover {
  text-decoration: underline;
}
.role .docs a::before {
  content: "\2197  ";
  color: var(--muted);
}
.role a.all {
  margin-top: auto;
  padding-top: 4px;
  font-size: 0.82rem;
  font-weight: 600;
  text-decoration: none;
}
@media (max-width: 520px) {
  .install {
    white-space: normal;
    text-align: left;
  }
}
.hero .sig {
  text-wrap: balance;
}
@media (max-width: 520px) {
  .install {
    font-size: 0.78rem;
    padding: 11px 14px;
  }
}
.install b {
  color: #8fd18a;
  font-weight: 600;
}
.install {
  display: inline-flex;
  gap: 12px;
  margin-top: 24px;
  max-width: 100%;
  overflow-x: auto;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 0.92rem;
  color: var(--code-fg);
  background: var(--code-bg);
  border-radius: 12px;
  padding: 12px 20px;
  box-shadow: var(--shadow);
  white-space: nowrap;
}
.install .p {
  color: var(--cyan);
}
.cta {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 24px;
}
.btn {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  font-weight: 600;
  font-size: 0.95rem;
  border-radius: 10px;
  padding: 11px 22px;
}
.btn.primary {
  color: #fff;
  background: var(--blue);
}
.btn.ghost {
  color: var(--fg);
  border: 1px solid var(--border);
  background: var(--card);
}

section {
  padding-block: clamp(30px, 5vw, 50px);
}
.sec-head {
  max-width: 720px;
  margin: 0 0 24px;
}
.kicker {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 0.72rem;
  font-weight: 700;
  margin: 0 0 8px;
  color: color-mix(in srgb, var(--accent, var(--blue)) 50%, var(--fg));
}
.sec-head h2 {
  margin: 0 0 8px;
  font-size: clamp(1.4rem, 2.8vw, 1.85rem);
  letter-spacing: -0.02em;
  text-wrap: balance;
}
.sec-head p {
  margin: 0;
  color: var(--muted);
}

.level {
  margin-top: 26px;
}
.level h3 {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 12px;
  font-size: 0.95rem;
}
.level h3 .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
}
.level h3 small {
  color: var(--muted);
  font-weight: 500;
}
.grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
}
.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-decoration: none;
  color: var(--fg);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 18px;
  box-shadow: var(--shadow);
  min-width: 0;
}
a.card:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow-hover);
}
.card .top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.card h4 {
  margin: 0;
  font-size: 1.05rem;
}
.card p {
  margin: 0;
  color: var(--muted);
  font-size: 0.88rem;
}
.pill {
  font-size: 0.72rem;
  font-weight: 600;
  border-radius: 999px;
  padding: 2px 9px;
  white-space: nowrap;
  color: color-mix(in srgb, var(--accent) 55%, var(--fg));
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.pill.soon {
  color: var(--muted);
  background: var(--bg-soft);
}
.live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--fg);
}
.live::before {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #2ea043;
}
.card .go {
  margin-top: auto;
  padding-top: 6px;
  font-size: 0.82rem;
  font-weight: 600;
  color: color-mix(in srgb, var(--accent) 55%, var(--fg));
}
.card.soon {
  box-shadow: none;
  background: transparent;
  border-style: dashed;
}
.card.soon .go {
  color: var(--muted);
}

.features {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
@media (max-width: 820px) {
  .features {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 520px) {
  .features {
    grid-template-columns: minmax(0, 1fr);
  }
}
.feature {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 18px;
}
.feature h3 {
  margin: 0 0 4px;
  font-size: 1rem;
}
.feature p {
  margin: 0;
  color: var(--muted);
  font-size: 0.88rem;
}

.agents-panel {
  --accent: var(--green);
  border: 1px solid color-mix(in srgb, var(--green) 34%, var(--border));
  border-radius: 18px;
  padding: clamp(20px, 4vw, 36px);
  background: var(--card);
}
.agents-panel pre {
  margin: 16px 0 0;
  /* Passe à la ligne plutôt que défiler : un bloc qui défile devrait être
     atteignable au clavier, et un `pre` n'est pas interactif. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--code-bg);
  color: var(--code-fg);
  border-radius: 10px;
  padding: 14px 16px;
  font-size: 0.82rem;
  line-height: 1.5;
}
.agents-panel ul {
  margin: 16px 0 0;
  padding-left: 18px;
  color: var(--muted);
  font-size: 0.9rem;
}

footer {
  border-top: 1px solid var(--border);
  margin-top: 24px;
  padding-block: 24px 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 22px;
  justify-content: space-between;
  color: var(--muted);
  font-size: 0.85rem;
}
footer a {
  text-decoration: none;
}
/* Barre de debug (développement) : fixée en bas, elle publie sa hauteur dans
   --nodefony-debugbar-height (0px réduite ou en haut) ; la page la réserve. */
body {
  padding-bottom: var(--nodefony-debugbar-height, 0px);
}
/* ═══ Effets — CSS natif, piloté par le défilement (aucun écouteur de scroll) ═══ */
@property --spin {
  syntax: "<angle>";
  inherits: false;
  initial-value: 0deg;
}
:root {
  --spring: linear(
    0,
    0.009,
    0.035 2.1%,
    0.141 4.4%,
    0.723 12.9%,
    0.938 16.7%,
    1.017 19.4%,
    1.067,
    1.084 26.3%,
    1.077 29.4%,
    1.006 41.1%,
    0.993 46.5%,
    1
  );
}
html {
  scroll-behavior: smooth;
  scroll-padding-top: 84px;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--muted) 45%, transparent) transparent;
}
::selection {
  background: color-mix(in srgb, var(--cyan) 30%, transparent);
}
p,
li {
  text-wrap: pretty;
}
pre {
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
}

/* Fil de lecture : la progression dans la page, sur l'horloge du défilement. */
.reading {
  position: fixed;
  top: env(safe-area-inset-top, 0px);
  left: 0;
  right: 0;
  height: 2px;
  z-index: 35;
  transform-origin: 0 50%;
  transform: scaleX(0);
  pointer-events: none;
  background: linear-gradient(90deg, var(--blue), var(--cyan), var(--green));
}

/* Fond du hero : deux halos qui dérivent lentement derrière le logo. */
.hero {
  position: relative;
  isolation: isolate;
}
.hero::before,
.hero::after {
  content: "";
  position: absolute;
  z-index: -1;
  border-radius: 50%;
  filter: blur(60px);
  opacity: 0.5;
  pointer-events: none;
}
.hero::before {
  width: 420px;
  height: 300px;
  top: 4%;
  left: calc(50% - 360px);
  background: color-mix(in srgb, var(--blue) 26%, transparent);
}
.hero::after {
  width: 360px;
  height: 280px;
  top: 10%;
  left: calc(50% - 20px);
  background: color-mix(in srgb, var(--green) 18%, transparent);
}
.hero h1 {
  background: linear-gradient(
    180deg,
    var(--fg) 55%,
    color-mix(in srgb, var(--fg) 62%, var(--blue))
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

/* Commande d'installation : bordure en dégradé conique qui tourne. */
.install {
  position: relative;
  border: 0;
}
.install::before {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: 13px;
  padding: 1px;
  pointer-events: none;
  background: conic-gradient(
    from var(--spin),
    transparent 0 55%,
    var(--cyan),
    var(--green),
    transparent 85%
  );
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}

/* Cartes : lumière qui suit le pointeur, élévation à ressort, voisines atténuées. */
.card,
.role,
.feature {
  position: relative;
  isolation: isolate;
  transition:
    transform 0.5s var(--spring),
    box-shadow 0.3s ease,
    border-color 0.3s ease,
    opacity 0.3s ease;
}
.card::before,
.role::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
  background: radial-gradient(
    320px circle at var(--mx, 50%) var(--my, 50%),
    color-mix(in srgb, var(--accent, var(--cyan)) 14%, transparent),
    transparent 70%
  );
}
.card:hover::before,
.role:hover::before {
  opacity: 1;
}
.grid:has(a.card:hover) .card:not(:hover),
.roles:has(.role:hover) .role:not(:hover) {
  opacity: 0.62;
}
.role:hover {
  border-color: color-mix(in srgb, var(--cyan) 45%, var(--border));
}
.card .go {
  transition: letter-spacing 0.3s ease;
}
a.card:hover .go {
  letter-spacing: 0.02em;
}

/* « En direct » : un anneau qui respire. */
.live::before {
  box-shadow: 0 0 0 0 rgba(46, 160, 67, 0.55);
}

/* Lien de navigation de la section en cours (posé par l'observateur). */
.topnav a[aria-current="true"] {
  color: var(--fg);
  background: var(--bg-soft);
}

@media print {
  *,
  *::before,
  *::after {
    animation: none !important;
  }
  .reading {
    display: none;
  }
}
@media (prefers-reduced-motion: no-preference) {
  @keyframes nf-read {
    to {
      transform: scaleX(1);
    }
  }
  @keyframes nf-bar {
    to {
      box-shadow: 0 6px 24px rgba(14, 23, 38, 0.08);
      background: color-mix(in srgb, var(--bg) 92%, transparent);
    }
  }
  @keyframes nf-rise {
    from {
      opacity: 0.5;
      transform: translateY(28px) scale(0.985);
    }
  }
  @keyframes nf-drift {
    50% {
      transform: translate(40px, 18px) scale(1.08);
    }
  }
  @keyframes nf-spin {
    to {
      --spin: 360deg;
    }
  }
  @keyframes nf-ping {
    70% {
      box-shadow: 0 0 0 7px rgba(46, 160, 67, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(46, 160, 67, 0);
    }
  }
  .hero::before {
    animation: nf-drift 14s ease-in-out infinite;
  }
  .hero::after {
    animation: nf-drift 17s ease-in-out infinite reverse;
  }
  .install::before {
    animation: nf-spin 6s linear infinite;
  }
  .live::before {
    animation: nf-ping 2.2s ease-out infinite;
  }
  a.card:hover,
  .role:hover {
    transform: translateY(-4px);
  }
  @supports (animation-timeline: scroll()) {
    .reading {
      animation: nf-read linear both;
      animation-timeline: scroll(root);
    }
    .topbar {
      animation: nf-bar linear both;
      animation-timeline: scroll(root);
      animation-range: 0 160px;
    }
    .sec-head,
    .level,
    .role,
    .feature,
    .agents-panel {
      animation: nf-rise linear both;
      animation-timeline: view();
      animation-range: entry 0% entry 55%;
    }
  }
}
/* Catalogue : 4 démos par niveau → 4 colonnes, sans trou. */
.grid {
  grid-template-columns: minmax(0, 1fr);
}
@media (min-width: 560px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (min-width: 1000px) {
  .grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
/* Démo à venir : grisée (pas d'opacité — le texte doit rester lisible). */
.card.soon {
  filter: grayscale(1);
  background: var(--bg-soft);
  border-style: dashed;
  box-shadow: none;
  cursor: default;
}
.card.soon h4 {
  color: var(--muted);
}
.card.soon::before {
  display: none;
}
/* Niveau de la démo : étiquette en pied de carte (D6). */
.card .foot {
  margin-top: auto;
  padding-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.card .foot .go {
  margin: 0;
  padding: 0;
}
/* Démo sans page : sa commande, sur sa propre ligne, au-dessus du pied. */
.card .cmd {
  margin-top: auto;
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}
.card .cmd + .foot {
  margin-top: 0;
}
.lvl {
  font-size: 0.72rem;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
}
.lvl::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.lvl.l1::before {
  background: var(--green);
}
.lvl.l2::before {
  background: var(--blue);
}
.lvl.l3::before {
  background: var(--violet);
}
.lvl.l3::after {
  content: "";
}
/* ═══ La marque qui reste : relais logo + titre → barre du haut ═══
   Une seule ligne de temps (--hero), celle de la marque qui SORT de l'écran ;
   timeline-scope la rend visible à la barre, qui n'est pas son ancêtre. */
body {
  timeline-scope: --hero;
}
.hero-mark {
  view-timeline: --hero block;
  display: grid;
  justify-items: center;
}
.brand-logo {
  width: 22px;
  height: 34px;
  background: var(--demo-logo) center / contain no-repeat;
  flex: none;
}
.brand-mini {
  font-weight: 600;
  font-size: 0.86rem;
  color: var(--muted);
  white-space: nowrap;
  padding-left: 10px;
  border-left: 1px solid var(--border);
}
@media (max-width: 1279px) {
  .brand-mini {
    display: none;
  }
}
.hero-logo {
  filter: drop-shadow(
    0 10px 28px color-mix(in srgb, var(--blue) 35%, transparent)
  );
}
.hero h1 {
  background-image: linear-gradient(
    100deg,
    var(--fg) 0 42%,
    color-mix(in srgb, var(--cyan) 70%, var(--fg)) 50%,
    var(--fg) 58% 100%
  );
  background-size: 260% 100%;
  background-position: 0% 0;
}
@media (prefers-reduced-motion: no-preference) {
  @keyframes nf-logo-in {
    from {
      opacity: 0;
      transform: translateY(18px) scale(0.82);
      filter: blur(8px);
    }
  }
  @keyframes nf-sheen {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: 0% 0;
    }
  }
  @keyframes nf-title-in {
    from {
      opacity: 0;
      transform: translateY(14px);
      letter-spacing: -0.05em;
    }
  }
  .hero-logo {
    animation: nf-logo-in 1.1s var(--spring) backwards;
  }
  .hero h1 {
    animation:
      nf-title-in 0.9s 0.15s cubic-bezier(0.2, 0.8, 0.2, 1) backwards,
      nf-sheen 2.2s 0.5s cubic-bezier(0.4, 0, 0.2, 1) backwards;
  }
  @supports (animation-timeline: view()) {
    @keyframes nf-mark-out {
      to {
        opacity: 0;
        transform: translateY(-36px) scale(0.55);
        filter: blur(6px);
      }
    }
    @keyframes nf-brand-in {
      from {
        opacity: 0;
        transform: translateY(12px) scale(0.4);
      }
    }
    @keyframes nf-mini-in {
      from {
        opacity: 0;
        transform: translateX(-12px);
        clip-path: inset(0 100% 0 0);
      }
    }
    .hero-mark {
      animation: nf-mark-out linear both;
      animation-timeline: --hero;
      animation-range: exit 0% exit 100%;
    }
  }
}
/* ═══ Contrôle de la barre de debug (développement seulement) ═══ */
.dbg {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--card);
}
.dbg-btn {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition:
    background 0.2s ease,
    color 0.2s ease;
}
.dbg-btn svg {
  width: 17px;
  height: 17px;
}
.dbg-btn:hover {
  background: var(--bg-soft);
  color: var(--fg);
}
.dbg-btn[aria-pressed="true"] {
  color: color-mix(in srgb, var(--blue) 55%, var(--fg));
  background: color-mix(in srgb, var(--blue) 12%, transparent);
}
.dbg-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
/* Pastille : la barre réduite dans un coin — elle ne réserve plus de hauteur. */
@media (prefers-reduced-motion: no-preference) {
  body {
    transition: padding-bottom 0.25s ease;
  }
}

/* ═══ Téléphone : la barre du haut tient sur UNE ligne, la navigation défile ═══ */
@media (max-width: 1199px) {
  .topbar {
    flex-wrap: nowrap;
    gap: 10px;
  }
  .brand {
    flex: none;
  }
  .brand .tag:not(.ver) {
    display: none;
  }
  .topnav {
    flex-wrap: nowrap;
    overflow-x: auto;
    min-width: 0;
    scrollbar-width: none;
    overscroll-behavior-x: contain;
    -webkit-mask-image: linear-gradient(90deg, #000 88%, transparent);
    mask-image: linear-gradient(90deg, #000 88%, transparent);
  }
  .topnav::-webkit-scrollbar {
    display: none;
  }
  .topnav a,
  .topnav .dbg {
    flex: none;
    white-space: nowrap;
  }
}
@media (max-width: 520px) {
  .install {
    display: flex;
    width: 100%;
    overflow: visible;
  }
  .install span:last-child {
    min-width: 0;
    overflow-wrap: anywhere;
    white-space: normal;
  }
}
/* Une option ne se coupe pas : « --demo » sur deux lignes se lirait « - » puis « -demo ». */
.install b {
  white-space: nowrap;
}
/* ═══ Identité de la barre : application ↔ Nodefony, au défilement ═══
   Les deux identités partagent UNE case de grille : la plus large fixe la
   place, aucune ne pousse la navigation quand l'autre apparaît. */
.brand {
  display: grid;
  align-items: center;
}
.brand .id {
  grid-area: 1 / 1;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  white-space: nowrap;
}
/* Opacité SEULE, jamais `visibility` : les deux identités restent dans
   l'arbre d'accessibilité, et le nom du lien contient le texte visible
   avant comme après la bascule (WCAG 2.5.3). */
.brand .id-nf {
  opacity: 0;
}
@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) {
    @keyframes nf-id-out {
      to {
        opacity: 0;
        transform: translateY(-10px);
        filter: blur(3px);
      }
    }
    @keyframes nf-id-in {
      from {
        opacity: 0;
        transform: translateY(10px);
        filter: blur(3px);
      }
      to {
        opacity: 1;
        visibility: visible;
      }
    }
    .brand .id-app {
      animation: nf-id-out linear both;
      animation-timeline: --hero;
      animation-range: exit 30% exit 65%;
    }
    .brand .id-nf {
      animation: nf-id-in linear both;
      animation-timeline: --hero;
      animation-range: exit 45% exit 100%;
    }
  }
}
/* Sans ligne de temps (Firefox) ou mouvement réduit : l'application seule. */
/* ═══ « Selon qui tu es » : onglets de métier + UN panneau paysage ═══ */
.rswitch {
  --r-accent: var(--blue);
  border: 1px solid var(--border);
  border-radius: 20px;
  background: var(--card);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.rtabs {
  display: flex;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-soft) 70%, var(--card));
  overflow-x: auto;
  scrollbar-width: none;
}
.rtab {
  flex: 1 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--muted);
  background: transparent;
  border: 0;
  border-radius: 12px;
  padding: 11px 16px;
  cursor: pointer;
  white-space: nowrap;
  transition:
    color 0.2s ease,
    background 0.2s ease,
    box-shadow 0.2s ease;
}
.rtab svg {
  width: 18px;
  height: 18px;
  flex: none;
}
.rtab:hover {
  color: var(--fg);
  background: color-mix(in srgb, var(--card) 70%, transparent);
}
.rtab[aria-selected="true"] {
  color: var(--fg);
  background: var(--card);
  box-shadow:
    0 1px 2px rgba(14, 23, 38, 0.08),
    0 0 0 1px var(--border);
}
.rtab[aria-selected="true"] svg {
  color: color-mix(in srgb, var(--blue) 70%, var(--fg));
}
.rpanel {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 22px;
  padding: clamp(20px, 3vw, 32px);
  view-transition-name: rpanel;
}
.rpanel[hidden] {
  display: none;
}
@media (min-width: 860px) {
  .rpanel {
    grid-template-columns: minmax(0, 5fr) minmax(0, 8fr);
    gap: 36px;
    min-height: 300px;
  }
}
.rpanel-side {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
}
.rpanel-ic {
  display: inline-grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  color: color-mix(in srgb, var(--blue) 75%, var(--fg));
  background: color-mix(in srgb, var(--blue) 11%, transparent);
}
.rpanel[data-kind="demo"] .rpanel-ic {
  color: color-mix(in srgb, var(--green) 75%, var(--fg));
  background: color-mix(in srgb, var(--green) 12%, transparent);
}
.rpanel-ic svg {
  width: 24px;
  height: 24px;
}
.rpanel-side h3 {
  margin: 4px 0 0;
  font-size: clamp(1.25rem, 2.2vw, 1.55rem);
  letter-spacing: -0.02em;
}
.rpanel-side p {
  margin: 0;
  color: var(--muted);
  font-size: 0.98rem;
  max-width: 36ch;
}
.rpanel-meta {
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--muted);
}
.rpanel-cta {
  margin-top: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  font-weight: 600;
  font-size: 0.92rem;
  color: #fff;
  background: var(--blue);
  border-radius: 10px;
  padding: 10px 18px;
  transition:
    transform 0.4s var(--spring),
    background 0.2s ease;
}
.rpanel-cta:hover {
  background: color-mix(in srgb, var(--blue) 86%, #000);
}
.rpanel-list {
  display: grid;
  gap: 10px;
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
}
@media (min-width: 560px) {
  .rpanel-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.ritem {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas: "t go" "d d";
  gap: 4px 10px;
  text-decoration: none;
  color: var(--fg);
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg);
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    transform 0.45s var(--spring);
}
.steps .ritem {
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-areas: "n t go" "n d d";
}
.ritem-t {
  grid-area: t;
  font-weight: 650;
  font-size: 0.95rem;
}
.ritem-d {
  grid-area: d;
  color: var(--muted);
  font-size: 0.85rem;
  line-height: 1.45;
}
.ritem-go {
  grid-area: go;
  font-size: 0.8rem;
  font-weight: 600;
  color: color-mix(in srgb, var(--blue) 55%, var(--fg));
  transition: transform 0.3s var(--spring);
}
.step {
  grid-area: n;
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 0.8rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: color-mix(in srgb, var(--green) 60%, var(--fg));
  background: color-mix(in srgb, var(--green) 13%, transparent);
}
a.ritem:hover {
  border-color: color-mix(in srgb, var(--cyan) 50%, var(--border));
  background: var(--card);
}
a.ritem:hover .ritem-go {
  transform: translate(3px, -1px);
}
.ritem.soon {
  filter: grayscale(1);
  background: var(--bg-soft);
  border-style: dashed;
}
.ritem.soon .ritem-t {
  color: var(--muted);
}
.ritem.soon .ritem-go {
  color: var(--muted);
  font-weight: 500;
}
@media (prefers-reduced-motion: no-preference) {
  a.ritem:hover,
  .rpanel-cta:hover {
    transform: translateY(-2px);
  }
  ::view-transition-old(rpanel) {
    animation: nf-vt-out 0.18s ease both;
  }
  ::view-transition-new(rpanel) {
    animation: nf-vt-in 0.32s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  @keyframes nf-vt-out {
    to {
      opacity: 0;
      transform: translateX(-12px);
    }
  }
  @keyframes nf-vt-in {
    from {
      opacity: 0;
      transform: translateX(14px);
    }
  }
}
/* Titre de carte : jamais écrasé par sa pastille — elle passe à la ligne. */
.card .top {
  flex-wrap: wrap;
  align-items: flex-start;
  row-gap: 6px;
}
.card h4 {
  flex: 1 1 auto;
}
/* Onglets : se lisent comme CLIQUABLES, sans crier. */
.rtabs {
  align-items: center;
}
.rtabs-hint {
  flex: none;
  padding: 0 6px 0 8px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}
.rtab {
  position: relative;
  border: 1px solid color-mix(in srgb, var(--border) 85%, transparent);
  background: color-mix(in srgb, var(--card) 55%, transparent);
}
.rtab:hover {
  border-color: color-mix(in srgb, var(--cyan) 45%, var(--border));
  color: var(--fg);
}
.rtab::after {
  content: "";
  position: absolute;
  left: 22%;
  right: 22%;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--blue);
  transform: scaleX(0);
  transition: transform 0.35s var(--spring);
}
.rtab[aria-selected="true"] {
  border-color: var(--border);
}
.rtab[aria-selected="true"]::after {
  transform: scaleX(1);
}
@media (prefers-reduced-motion: no-preference) {
  .rtab {
    transition:
      color 0.2s ease,
      background 0.2s ease,
      border-color 0.2s ease,
      transform 0.35s var(--spring);
  }
  .rtab:not([aria-selected="true"]):hover {
    transform: translateY(-1px);
  }
}
@media (max-width: 760px) {
  .rtabs-hint {
    display: none;
  }
}

/* ═══ Page d'apprentissage (/demo/chat…) : le gabarit commun des démos ═══ */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
.lesson {
  display: flex;
  flex-direction: column;
  gap: 32px;
  padding-top: 24px;
}
.crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  color: var(--muted);
}
.crumbs .sock {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.crumbs .sock::before {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--muted);
}
.crumbs .sock-connected::before {
  background: #2ea043;
}
/* Les sections d'une leçon se suivent de près : l'espacement est celui de
   `.lesson`, pas la marge des sections de l'accueil. */
.lesson section {
  padding-block: 0;
}
.lesson-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}
.lesson-meta .lesson-step {
  margin: 0;
}
.lesson-intro {
  max-width: 800px;
}
.lesson-intro h1 {
  margin: 8px 0 12px;
  font-size: clamp(1.6rem, 3vw, 2.1rem);
  line-height: 1.2;
}
.lesson-intro p {
  margin: 0;
  line-height: 1.6;
}
.lesson-step {
  margin: 0 0 12px;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}
.room {
  display: flex;
  flex-direction: column;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}
.room-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  font-size: 0.85rem;
}
.room-typing {
  min-height: 34px;
  padding: 0 16px 8px;
}
.typing-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 4px 10px;
  font-size: 0.82rem;
  color: var(--fg);
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 999px;
  box-shadow: var(--shadow);
}
.typing-dots {
  display: inline-flex;
  gap: 3px;
}
.typing-dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cyan);
}
@media (prefers-reduced-motion: no-preference) {
  .typing-pill {
    animation: nf-typing-in 0.18s ease-out;
  }
  .typing-dots i {
    animation: nf-typing 1.2s ease-in-out infinite;
  }
  .typing-dots i:nth-child(2) {
    animation-delay: 0.15s;
  }
  .typing-dots i:nth-child(3) {
    animation-delay: 0.3s;
  }
  @keyframes nf-typing-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  @keyframes nf-typing {
    0%,
    60%,
    100% {
      opacity: 0.35;
      transform: translateY(0);
    }
    30% {
      opacity: 1;
      transform: translateY(-3px);
    }
  }
}
.room-list {
  list-style: none;
  margin: 0;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* Pas de défilement interne : une zone qui défile devrait être atteignable
     au clavier. L'historique chargé est borné (50), la page défile. */
  min-height: 240px;
}
/* Enfant DIRECT : les listes d'un message (Markdown, archive) gardent leur flux. */
.room-list > li {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.room-meta {
  font-size: 0.78rem;
  color: var(--muted);
}
.room-meta strong {
  color: var(--fg);
}
.room-text {
  overflow-wrap: anywhere;
}
/* Les liens du salon (message, téléchargement) : le bleu mêlé au texte, lisible
   dans les deux thèmes — le bleu seul tombe à 3,3:1 sur le fond sombre. */
.room-list a {
  color: color-mix(in srgb, var(--blue) 50%, var(--fg));
}
/* Le Markdown du salon : des marges courtes, un message reste compact. */
.md p,
.md ul,
.md ol,
.md blockquote,
.md pre {
  margin: 0 0 4px;
}
.md > :last-child {
  margin-bottom: 0;
}
.md ul,
.md ol {
  padding-left: 1.4em;
}
.md blockquote {
  padding-left: 10px;
  color: var(--muted);
  border-left: 3px solid var(--border);
}
.md code {
  padding: 1px 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.88em;
  background: var(--bg-soft);
  border-radius: 4px;
}
.md pre {
  padding: 8px 10px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.md pre code {
  padding: 0;
  background: none;
}
.room-empty {
  color: var(--muted);
}
.room-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  background: var(--bg-soft);
}
.room-foot p {
  flex: 1 1 220px;
  margin: 0;
  font-size: 0.9rem;
}
.room-foot .room-error {
  flex-basis: 100%;
  margin: 0;
  color: #c62828;
}
/* La zone d'écriture : pastilles en attente au-dessus, outils, champ, envoi. */
.composer {
  flex-direction: column;
  align-items: stretch;
}
.composer.dragging {
  outline: 2px dashed var(--cyan);
  outline-offset: -6px;
}
/* L'éditeur Markdown du kit : UNE boîte — pièces, champ, puis la barre. */
.md-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
}
.md-editor:focus-within {
  border-color: var(--cyan);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cyan) 22%, transparent);
}
.md-editor textarea {
  min-height: 48px;
  max-height: 240px;
  padding: 6px 6px 2px;
  font: inherit;
  line-height: 1.45;
  color: var(--fg);
  background: none;
  border: 0;
  outline: none;
  resize: none;
  field-sizing: content;
}
.md-preview {
  min-height: 48px;
  max-height: 240px;
  overflow: auto;
  padding: 6px;
  border-radius: 8px;
  background: var(--bg-soft);
}
.md-empty {
  margin: 0;
  color: var(--muted);
}
.md-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}
.md-formats {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin-left: 4px;
  padding-left: 6px;
  border-left: 1px solid var(--border);
}
.md-tool {
  min-width: 36px;
  height: 36px;
  padding: 0 8px;
  font-size: 0.95rem;
  color: var(--fg);
  background: none;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}
.md-tool:hover:not(:disabled),
.md-tool[aria-expanded="true"] {
  background: var(--bg-soft);
}
.md-tool:disabled {
  opacity: 0.45;
  cursor: default;
}
.md-tool-b {
  font-weight: 700;
}
.md-tool-i {
  font-style: italic;
  font-family: Georgia, serif;
}
.md-tool-e {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8rem;
}
.md-spacer {
  flex: 1 1 auto;
}
.md-mode {
  min-height: 36px;
  padding: 0 12px;
  font: inherit;
  font-size: 0.85rem;
  color: var(--muted);
  background: none;
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
}
.md-mode[aria-pressed="true"] {
  color: var(--fg);
  border-color: var(--cyan);
  background: color-mix(in srgb, var(--cyan) 12%, transparent);
}
.md-send {
  margin-left: 6px;
}
.emoji-wrap {
  position: relative;
}
.emoji-grid {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 5;
  display: grid;
  grid-template-columns: repeat(6, 40px);
  gap: 2px;
  padding: 6px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
}
.emoji-grid button {
  width: 40px;
  height: 40px;
  font-size: 1.25rem;
  background: none;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
.emoji-grid button:hover,
.emoji-grid button:focus-visible {
  background: var(--bg-soft);
}
/* Les pièces en attente : les mêmes boîtes que le salon, et un retrait. */
.pending {
  list-style: none;
  margin: 0;
  padding: 0 0 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  border-bottom: 1px solid var(--border);
}
.pending-piece {
  position: relative;
  width: min(420px, 100%);
}
/* La croix de retrait a sa place : le nom et la taille ne passent pas dessous. */
.pending-piece .att-head {
  padding-right: 32px;
}
.pending-reading {
  position: absolute;
  left: 10px;
  bottom: 8px;
  font-size: 0.78rem;
  color: var(--muted);
}
.pending-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 28px;
  height: 28px;
  color: var(--muted);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 50%;
  cursor: pointer;
}
.pending-remove:hover {
  color: var(--fg);
}
.att-pre {
  margin: 4px 0 0;
  padding: 6px 8px;
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--code-fg);
  background: var(--code-bg);
  border-radius: 6px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
/* Les pièces d'un message, dans la fenêtre du salon. */
.att-list {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.att-thumb {
  padding: 0;
  background: none;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  cursor: zoom-in;
}
.att-thumb img {
  display: block;
  max-width: 220px;
  max-height: 160px;
  object-fit: cover;
}
.att-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(420px, 100%);
  padding: 10px 12px;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 0.88rem;
}
.att-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.att-head strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.att-size {
  margin-left: auto;
  flex: none;
  color: var(--muted);
  font-size: 0.78rem;
}
.att-pre {
  margin: 0;
}
.att-actions {
  display: flex;
  gap: 14px;
  font-size: 0.82rem;
}
.att-actions button {
  padding: 0;
  font: inherit;
  color: inherit;
  text-decoration: underline;
  background: none;
  border: 0;
  cursor: pointer;
}
.att-gone {
  color: var(--muted);
  font-style: italic;
}
.att-dialog {
  max-width: min(92vw, 1200px);
  padding: 12px;
  color: var(--fg);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
}
.att-dialog::backdrop {
  background: rgba(10, 15, 28, 0.7);
}
.att-dialog img {
  display: block;
  max-width: 100%;
  max-height: 80vh;
  margin: 0 auto;
}
.att-dialog p {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 8px 0 0;
  font-size: 0.85rem;
}
/* Les aperçus : PDF, archive, document, tableur. */
.att-pdf iframe {
  display: block;
  width: min(88vw, 1000px);
  height: 78vh;
  background: #fff;
  border: 0;
}
.att-note {
  margin: 0;
  color: var(--muted);
  font-size: 0.8rem;
}
.att-entries {
  margin: 0;
  padding: 0;
  list-style: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8rem;
}
.att-entries li {
  display: flex;
  gap: 8px;
  min-width: 0;
}
.att-entry-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.att-more {
  color: var(--muted);
}
.att-doc p {
  margin: 0 0 6px;
}
.att-doc p:last-child {
  margin-bottom: 0;
}
/* Pas de défilement horizontal (le clavier ne l'atteindrait pas) : les
   cellules se replient dans la largeur de la boîte. */
.att-sheet {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 0.78rem;
}
.att-sheet td {
  padding: 3px 6px;
  overflow-wrap: anywhere;
  vertical-align: top;
  border: 1px solid var(--border);
}
.lesson-traps {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
}
.lesson-traps > div {
  flex: 2 1 520px;
  min-width: 0;
}
.lesson-traps ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lesson-traps li {
  padding: 14px 16px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 10px;
  line-height: 1.5;
}
.further {
  flex: 1 1 280px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--cyan) 12%, var(--card));
  line-height: 1.5;
}
.further .lesson-step {
  margin: 0;
}
/* Le bleu brut tombe sous 3:1 sur le fond sombre : mêlé au texte, il passe
   dans les deux thèmes (même règle que le lien Documentation du haut). */
.further a,
.crumbs a {
  color: color-mix(in srgb, var(--blue) 50%, var(--fg));
}
.further code,
.lesson-traps code,
.step-summary code {
  overflow-wrap: anywhere;
}

/* Section 3 de la leçon : un onglet par étape du cookbook, le code cité. */
.lesson-code > p {
  margin: 0 0 14px;
  color: var(--muted);
}
.steps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.step-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 6px 12px;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--muted);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
}
.step-tab:hover {
  color: var(--fg);
}
.step-tab[aria-selected="true"] {
  color: var(--fg);
  background: var(--card);
  border-color: color-mix(in srgb, var(--blue) 55%, var(--border));
}
.step-tab.soon {
  border-style: dashed;
}
.step-num {
  display: inline-grid;
  place-items: center;
  width: 1.4em;
  height: 1.4em;
  border-radius: 50%;
  font-size: 0.8em;
  background: color-mix(in srgb, var(--blue) 18%, transparent);
}
.step-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
}
.step-summary,
.step-soon {
  margin: 0;
}
.step-soon {
  color: var(--muted);
  font-style: italic;
}
.excerpt {
  margin: 0;
  min-width: 0;
}
.excerpt figcaption {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 0.8rem;
  color: var(--muted);
}
.excerpt pre {
  margin: 0;
  /* Passe à la ligne plutôt que défiler : un `pre` n'est pas interactif. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 14px 16px;
  font-size: 0.9rem;
  line-height: 1.55;
  background: var(--code-bg);
  color: var(--code-fg);
  border-radius: 10px;
}
.step-doc {
  align-self: flex-start;
  color: color-mix(in srgb, var(--blue) 50%, var(--fg));
}

/* Coloration des extraits (highlight.ts) — le fond du code est sombre dans
   les deux thèmes : une seule palette, chaque teinte au-delà de 7:1. */
.tok-comment {
  color: #9fb0c8;
  font-style: italic;
}
.tok-string {
  color: #b5e3a0;
}
.tok-keyword {
  color: #d2b8ff;
}
.tok-decorator {
  color: #ffd27a;
  font-weight: 700;
}
.tok-type {
  color: #8fdcff;
}
.tok-number {
  color: #ffbf98;
}
.block-text code,
.tab-decorators dd code {
  font-size: 0.92em;
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--bg-soft);
}
/* Un onglet : des paragraphes qui suivent la logique métier, chacun suivi
   du code qu'il explique. */
.block + .block {
  margin-top: 22px;
}
.block-text {
  margin: 0 0 10px;
  max-width: 78ch;
  line-height: 1.6;
}
.excerpt-file {
  font-weight: 600;
  color: var(--fg);
}
.excerpt-step {
  padding: 0 8px;
  color: var(--fg);
  border-radius: 999px;
  background: color-mix(in srgb, var(--blue) 14%, transparent);
}
/* Les décorateurs de l'onglet : une ligne chacun, sans carte. */
.tab-decorators {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 6px 14px;
  margin: 24px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--border);
  font-size: 0.88rem;
}
.tab-decorators > div {
  display: contents;
}
.tab-decorators dt code {
  font-weight: 700;
  color: color-mix(in srgb, var(--violet) 60%, var(--fg));
}
.tab-decorators dd {
  margin: 0;
  line-height: 1.5;
}
.decorator-from {
  color: var(--muted);
  font-size: 0.92em;
}

/* Page « API entre programmes » : les essais, dans l'ordre, chacun avec sa
   réponse réelle. */
.trials {
  display: grid;
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.trial {
  padding: 16px 18px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
}
.trial-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.trial-head h3 {
  margin: 0;
  font-size: 1.02rem;
}
.trial-num {
  display: inline-grid;
  place-items: center;
  width: 1.7em;
  height: 1.7em;
  border-radius: 50%;
  font-size: 0.85rem;
  font-weight: 700;
  background: color-mix(in srgb, var(--blue) 18%, transparent);
}
.trial-expect {
  margin-left: auto;
  font-size: 0.8rem;
  color: var(--muted);
}
.trial > p {
  margin: 8px 0 12px;
  line-height: 1.55;
}
.trial > p code,
.trial-hint code {
  font-size: 0.92em;
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--bg-soft);
}
.trial-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.trial-actions button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.trial-hint {
  font-size: 0.85rem;
  color: var(--muted);
}
.trial-result,
.claims {
  margin-top: 12px;
}
.trial-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 0 0 8px;
}
.status {
  min-width: 3ch;
  padding: 2px 10px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 0.85rem;
  text-align: center;
}
/* Mêlées au texte : lisibles dans les deux thèmes. */
.status.ok {
  color: color-mix(in srgb, var(--green) 55%, var(--fg));
  background: color-mix(in srgb, var(--green) 16%, transparent);
}
.status.ko {
  color: color-mix(in srgb, #c62828 60%, var(--fg));
  background: color-mix(in srgb, #c62828 14%, transparent);
}
.trial-headers {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 0 0 8px;
  font-size: 0.84rem;
}
.trial-headers dt {
  color: var(--muted);
}
.trial-headers dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.trial-result pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 12px 14px;
  font-size: 0.85rem;
  line-height: 1.5;
  background: var(--code-bg);
  color: var(--code-fg);
  border-radius: 10px;
}
.claims > p {
  margin: 0 0 8px;
  font-size: 0.88rem;
}
.claims dl {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
  gap: 8px;
  margin: 0;
}
.claims dl > div {
  min-width: 0;
  padding: 8px 10px;
  background: var(--bg-soft);
  border-radius: 8px;
}
.claims dt {
  font-size: 0.78rem;
  color: var(--muted);
}
.claims dd {
  margin: 2px 0 0;
  font-size: 0.86rem;
  overflow-wrap: anywhere;
}
/* Bouton secondaire sur une carte : le bleu brut tombe à 3:1 en sombre. */
.trial-actions .btn:not(.primary) {
  color: color-mix(in srgb, var(--blue) 50%, var(--fg));
  border-color: color-mix(in srgb, var(--blue) 45%, var(--border));
}

/* Sonde du kit (`kit/ProbeResult.tsx`) : en-têtes groupés par paire — le
   groupe s'efface, la grille garde ses deux colonnes. */
.trial-headers > div {
  display: contents;
}
.status.pending {
  color: var(--muted);
  background: var(--bg-soft);
}
.probe-ms {
  margin-left: auto;
  font-size: 0.8rem;
  color: var(--muted);
}
.probe-redirect {
  margin: 0 0 8px;
  font-size: 0.86rem;
}
.probe-chunks {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 12px 14px;
  list-style: none;
  font-size: 0.85rem;
  background: var(--code-bg);
  color: var(--code-fg);
  border-radius: 10px;
}
.probe-chunks li {
  display: flex;
  gap: 12px;
  animation: probe-in 180ms ease-out;
}
.probe-at {
  min-width: 7ch;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}
@keyframes probe-in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .probe-chunks li {
    animation: none;
  }
}

/* Premiers pas : le code de l'étape, entre l'explication et l'essai. */
.trial .excerpt {
  margin: 0 0 12px;
}
.first-form {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 10px;
}
.first-form label {
  display: grid;
  gap: 4px;
  font-size: 0.84rem;
  color: var(--muted);
}
.first-form input {
  min-width: 0;
  width: 11rem;
  padding: 7px 10px;
  font: inherit;
  color: var(--fg);
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 8px;
}

/* Les constantes d'un extrait, et leur valeur lue dans les sources. */
.excerpt-consts {
  display: grid;
  gap: 4px;
  margin: 8px 0 0;
  padding: 10px 14px;
  font-size: 0.84rem;
  background: var(--bg-soft);
  border-radius: 10px;
}
.excerpt-consts > div {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  min-width: 0;
}
.excerpt-consts dt code {
  font-weight: 700;
}
.excerpt-consts dt::after {
  content: " =";
  color: var(--muted);
}
.excerpt-consts dd {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.excerpt-consts dd span {
  color: var(--muted);
  font-size: 0.92em;
}
/* Un réglage (terminal, .env, journal) : montré, pas cité d'un fichier. */
.snippet-label {
  font-weight: 600;
  color: var(--fg);
}
