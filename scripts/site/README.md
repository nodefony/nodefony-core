<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs (`npm run skills:doc`) — seul le bloc « À savoir » s'écrit à la main, il est conservé. -->

# `scripts/site/`

Rendu du site de documentation publié et de ses pages annexes.

## À savoir avant d'y toucher

<!-- À LA MAIN : début -->

_Rien de noté : ce qui se découvre en travaillant ici s'écrit dans ce bloc._

<!-- À LA MAIN : fin -->

Index de tout l'outillage : [`scripts/`](../README.md).

- [`lib/`](lib/README.md) — Helpers propres au rendu du site de documentation.

## [`build-docs-site.mjs`](build-docs-site.mjs)

Construit le SITE de documentation publié — toute la doc Nodefony en HTML autonome, régénérée à chaque release.

- **Usage** : `node scripts/site/build-docs-site.mjs [--out tmp/sites/docs] [--base ""] [--quiet]`
- **Usage** : `node scripts/site/build-docs-site.mjs --list`
- **Variable** `BRANCH`
- **Variable** `BUILT_AT`
- **Variable** `COMMIT`
- **Variable** `FAVICON`
- **Variable** `MOUNT`
- **Variable** `OUT`
- **Variable** `REPO_URL`
- **Variable** `ROOT`
- **Variable** `SITE_URL`
- **Variable** `STYLE_CODE`
- **Variable** `VERSION`
- **Appelé par** : `node.js.yml` · `pages.yml` · `.githooks/pre-push` · `.claude/skills/nodefony-devkit-bench/scripts/bench-first-impression.mjs`
- **Utilise** : `lib/repo-root.mjs` · `site/lib/html-text.mjs` · `site/markdown-highlight.mjs`

## [`build-perf-site.mjs`](build-perf-site.mjs)

Construit le site « Performance » publié — une page par version, plus `latest`.

- **Usage** : `node scripts/site/build-perf-site.mjs [--out tmp/sites/perf] [--data docs/performance/data]`
- **Variable** `BLOB`
- **Variable** `DATA_DIR`
- **Variable** `OUT`
- **Appelé par** : `pages.yml`
- **Utilise** : `lib/repo-root.mjs` · `site/markdown-highlight.mjs`

## [`build-qualite-site.mjs`](build-qualite-site.mjs)

Construit le site « Qualité » publié — le verdict d'une CAMPAGNE DE TEST par version.

- **Usage** : `node scripts/site/build-qualite-site.mjs [--out tmp/sites/quality] [--data docs/qualite/data]`
- **Variable** `DATA`
- **Appelé par** : `pages.yml`
- **Utilise** : `lib/repo-root.mjs`

## [`build-site-plan.mjs`](build-site-plan.mjs)

Publie le PLAN du site : `llms.txt`, `sitemap.xml` et `robots.txt`.

- **Usage** : `npm run site:plan`
- **Usage** : `node scripts/site/build-site-plan.mjs [--out tmp/sites/docs] [--base <url>]`
- **Variable** `APP_TEMPLATE_HREF`
- **Appelé par** : `npm run site:plan` · `pages.yml`
- **Utilise** : `lib/repo-root.mjs` · `site/lib/app-template-deps.mjs`

## [`check-site-links.mjs`](check-site-links.mjs)

Refuse un site dont un lien interne ne mène nulle part.

- **Usage** : `node scripts/site/check-site-links.mjs <dossier-du-site>`
- **Variable** `ROOT`
- **Appelé par** : `pages.yml`
- **Testé par** : `.claude/skills/nodefony-identifiers/scripts/check-identifier-language.test.mjs`

## [`markdown-highlight.mjs`](markdown-highlight.mjs)

markdown-highlight.mjs — coloration syntaxique des blocs de code du site publié.

- **Usage** : `import { highlight, STYLE_CODE } from "./markdown-highlight.mjs"`
- **Appelé par** : `site/build-docs-site.mjs` · `site/build-perf-site.mjs` · `site/readme-html.mjs`

## [`readme-html.mjs`](readme-html.mjs)

readme-html.mjs — Nodefony, matrice de présentation (10 minutes).

- **Usage** : `node scripts/site/readme-html.mjs [fichier-de-sortie.html]`
- **Variable** `BLOB`
- **Variable** `OUT`
- **Variable** `RAW`
- **Variable** `STYLE_CODE`
- **Appelé par** : `pages.yml` · `.claude/skills/nodefony-devkit-bench/scripts/bench-first-impression.mjs`
- **Utilise** : `lib/repo-root.mjs` · `site/lib/html-text.mjs` · `site/markdown-highlight.mjs`

## [`site-plan.test.mjs`](site-plan.test.mjs)

Éprouve le lecteur de dépendances du gabarit d'application.

- **Lancé par** : `npm run test:site-plan` · `node.js.yml` · `npm run test:tooling`
- **Utilise** : `lib/repo-root.mjs` · `site/lib/app-template-deps.mjs`
