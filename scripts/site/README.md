<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs (`npm run skills:doc`) — seul le bloc « À savoir » s'écrit à la main, il est conservé. -->

# `scripts/site/`

Rendu du site de documentation publié et de ses pages annexes.

## À savoir avant d'y toucher

<!-- À LA MAIN : début -->

_Rien de noté : ce qui se découvre en travaillant ici s'écrit dans ce bloc._

<!-- À LA MAIN : fin -->

Index de tout l'outillage : [`scripts/`](../README.md).

- [`lib/`](lib/README.md) — Helpers propres au rendu du site de documentation.

## [`api-reference.test.mjs`](api-reference.test.mjs)

- **Lancé par** : `npm run test:tooling`
- **Utilise** : `site/lib/api-reference.mjs`

## [`assemble-site.mjs`](assemble-site.mjs)

Assemble le site en ligne à partir de rendus DÉJÀ faits : la version publiée à la racine, `dev` sous `/next/`, chaque release archivée sous `/<version>/`.

- **Usage** : `node scripts/site/assemble-site.mjs --published <dossier> --out <dossier> [--next <dossier>] [--archives <dossier>] [--version <x.y.z>]`
- **Variable** `NEXT`
- **Variable** `VERSION`
- **Appelé par** : `pages.yml`
- **Testé par** : `site/site-versions.test.mjs`
- **Utilise** : `lib/repo-root.mjs` · `site/lib/out-dir.mjs` · `site/lib/site-versions.mjs`

## [`build-docs-site.mjs`](build-docs-site.mjs)

Construit le SITE de documentation publié — toute la doc Nodefony en HTML autonome, régénérée à chaque release.

- **Usage** : `node scripts/site/build-docs-site.mjs [--out tmp/sites/docs] [--mount /docs] [--channel published|next] [--quiet]`
- **Usage** : `node scripts/site/build-docs-site.mjs --list`
- **Variable** `BRANCH`
- **Variable** `BUILT_AT`
- **Variable** `CHANNEL`
- **Variable** `COMMIT`
- **Variable** `FAVICON`
- **Variable** `MOUNT`
- **Variable** `OUT`
- **Variable** `PUBLISHED`
- **Variable** `REPO_URL`
- **Variable** `SITE_URL`
- **Variable** `STYLE_CODE`
- **Variable** `VERSION`
- **Appelé par** : `node.js.yml` · `.githooks/pre-push` · `site/build-site.mjs` · `.claude/skills/nodefony-devkit-bench/scripts/bench-first-impression.mjs` · `.claude/skills/nodefony-documentation/scripts/doc-lint.mjs` · `.claude/skills/nodefony-documentation/scripts/render-figures.mjs`
- **Utilise** : `lib/repo-root.mjs` · `site/lib/api-reference.mjs` · `site/lib/html-text.mjs` · `site/lib/markdown-source.mjs` · `site/lib/out-dir.mjs` · `site/lib/site-versions.mjs` · `site/markdown-highlight.mjs`

## [`build-perf-site.mjs`](build-perf-site.mjs)

Construit le site « Performance » publié — une page par version, plus `latest`.

- **Usage** : `node scripts/site/build-perf-site.mjs [--out tmp/sites/perf] [--data docs/performance/data]`
- **Variable** `BLOB`
- **Variable** `DATA_DIR`
- **Variable** `OUT`
- **Appelé par** : `site/build-site.mjs`
- **Utilise** : `lib/repo-root.mjs` · `site/lib/html-text.mjs` · `site/markdown-highlight.mjs`

## [`build-qualite-site.mjs`](build-qualite-site.mjs)

Construit le site « Qualité » publié — le verdict d'une CAMPAGNE DE TEST par version.

- **Usage** : `node scripts/site/build-qualite-site.mjs [--out tmp/sites/quality] [--data docs/qualite/data]`
- **Variable** `DATA`
- **Appelé par** : `site/build-site.mjs`
- **Utilise** : `lib/repo-root.mjs`

## [`build-site-plan.mjs`](build-site-plan.mjs)

Publie le PLAN du site : `llms.txt`, `sitemap.xml` et `robots.txt`.

- **Usage** : `npm run site:plan`
- **Usage** : `node scripts/site/build-site-plan.mjs [--out tmp/sites/docs] [--base <url>]`
- **Variable** `APP_TEMPLATE_HREF`
- **Appelé par** : `npm run site:plan` · `site/build-site.mjs`
- **Utilise** : `lib/repo-root.mjs` · `site/lib/app-template-deps.mjs`

## [`build-site.mjs`](build-site.mjs)

Rend UN site complet — accueil, documentation, mesures, qualité, plan — dans un dossier, pour une version donnée.

- **Usage** : `node scripts/site/build-site.mjs --out dist-site [--channel published|next] [--site-url <url>]`
- **Variable** `BASE`
- **Variable** `CHANNEL`
- **Variable** `NEXT_DIR`
- **Appelé par** : `pages.yml` · `release.yml`
- **Testé par** : `site/site-versions.test.mjs`
- **Utilise** : `lib/repo-root.mjs` · `generate/generate-symbols.ts` · `site/build-docs-site.mjs` · `site/build-perf-site.mjs` · `site/build-qualite-site.mjs` · `site/build-site-plan.mjs` · `site/lib/out-dir.mjs` · `site/lib/site-versions.mjs` · `site/readme-html.mjs` · `repo/turbo.mjs`

## [`check-site-links.mjs`](check-site-links.mjs)

Refuse un site dont un lien interne ne mène nulle part.

- **Usage** : `node scripts/site/check-site-links.mjs <dossier-du-site>`
- **Variable** `ROOT`
- **Appelé par** : `pages.yml`
- **Testé par** : `site/site-versions.test.mjs` · `.claude/skills/nodefony-identifiers/scripts/check-identifier-language.test.mjs`
- **Utilise** : `site/lib/site-versions.mjs`

## [`html-text.test.mjs`](html-text.test.mjs)

- **Lancé par** : `npm run test:tooling`
- **Utilise** : `site/lib/html-text.mjs`

## [`markdown-highlight.mjs`](markdown-highlight.mjs)

markdown-highlight.mjs — coloration syntaxique des blocs de code du site publié.

- **Usage** : `import { highlight, STYLE_CODE } from "./markdown-highlight.mjs"`
- **Appelé par** : `site/build-docs-site.mjs` · `site/build-perf-site.mjs` · `site/readme-html.mjs`

## [`markdown-source.test.mjs`](markdown-source.test.mjs)

- **Lancé par** : `npm run test:tooling`
- **Utilise** : `site/lib/markdown-source.mjs`

## [`readme-html.mjs`](readme-html.mjs)

readme-html.mjs — Nodefony, matrice de présentation (10 minutes).

- **Usage** : `node scripts/site/readme-html.mjs [fichier-de-sortie.html] [--channel published|next]`
- **Variable** `BLOB`
- **Variable** `CHANNEL`
- **Variable** `OUT`
- **Variable** `PRERELEASE`
- **Variable** `RAW`
- **Variable** `REPO`
- **Variable** `STYLE_CODE`
- **Appelé par** : `site/build-site.mjs` · `.claude/skills/nodefony-devkit-bench/scripts/bench-first-impression.mjs`
- **Utilise** : `lib/repo-root.mjs` · `site/lib/html-text.mjs` · `site/lib/site-versions.mjs` · `site/markdown-highlight.mjs`

## [`schemas-organigramme.test.mjs`](schemas-organigramme.test.mjs)

Le tracé des organigrammes du site — jugé sur le CORPUS réel.

- **Variable** `REPO_ROOT`
- **Lancé par** : `npm run test:tooling`
- **Utilise** : `lib/repo-root.mjs`

## [`schemas-sequence.test.mjs`](schemas-sequence.test.mjs)

Les diagrammes de séquence du site tiennent leurs libellés — sur le CORPUS réel.

- **Variable** `REPO_ROOT`
- **Lancé par** : `npm run test:tooling`
- **Utilise** : `lib/repo-root.mjs`

## [`site-plan.test.mjs`](site-plan.test.mjs)

Éprouve le lecteur de dépendances du gabarit d'application.

- **Lancé par** : `npm run test:site-plan` · `node.js.yml` · `npm run test:tooling`
- **Utilise** : `lib/repo-root.mjs` · `site/lib/app-template-deps.mjs`

## [`site-versions.test.mjs`](site-versions.test.mjs)

Éprouve l'agencement des versions du site et le dossier de sortie neuf.

- **Lancé par** : `npm run test:tooling`
- **Utilise** : `lib/repo-root.mjs` · `site/assemble-site.mjs` · `site/build-site.mjs` · `site/check-site-links.mjs` · `site/lib/out-dir.mjs` · `site/lib/site-versions.mjs` · `release/accueil-gate.mjs`
