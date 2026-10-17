<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs (`npm run skills:doc`) — seul le bloc « À savoir » s'écrit à la main, il est conservé. -->

# `scripts/site/lib/`

Helpers propres au rendu du site de documentation.

## À savoir avant d'y toucher

<!-- À LA MAIN : début -->

_Rien de noté : ce qui se découvre en travaillant ici s'écrit dans ce bloc._

<!-- À LA MAIN : fin -->

Index de tout l'outillage : [`scripts/`](../../README.md).

## [`app-template-deps.mjs`](app-template-deps.mjs)

Les dépendances de production d'une application MINIMALE, lues dans le gabarit que `nodefony create app` rend.

- **Usage** : `import { APP_TEMPLATE_PATH, minimalAppDependencies } from "./lib/app-template-deps.mjs"`
- **Appelé par** : `site/build-site-plan.mjs`
- **Testé par** : `site/site-plan.test.mjs`

## [`html-text.mjs`](html-text.mjs)

Retrait des balises HTML — **une seule implémentation pour tout le dépôt**.

- **Usage** : `import { sansBalises } from "./lib/html-text.mjs"`
- **Appelé par** : `site/build-docs-site.mjs` · `site/readme-html.mjs`

## [`markdown-source.mjs`](markdown-source.mjs)

Préparation de la SOURCE Markdown d'une page avant son rendu par le site.

- **Usage** : `import { sansCommentaires } from "./lib/markdown-source.mjs"`
- **Appelé par** : `site/build-docs-site.mjs`
- **Testé par** : `site/markdown-source.test.mjs`

## [`out-dir.mjs`](out-dir.mjs)

Dossier de sortie d'un générateur du site : neuf à chaque rendu, ou refusé.

- **Usage** : `import { prepareOutDir } from "./lib/out-dir.mjs"`
- **Appelé par** : `site/assemble-site.mjs` · `site/build-docs-site.mjs` · `site/build-site.mjs`
- **Testé par** : `site/site-versions.test.mjs`

## [`site-versions.mjs`](site-versions.mjs)

Versions du site publié — qui vit où, et comment passer de l'une à l'autre.

- **Usage** : `import { planVersions, manifestFor } from "./lib/site-versions.mjs"`
- **Appelé par** : `pages.yml` · `site/assemble-site.mjs` · `site/build-docs-site.mjs` · `site/build-site.mjs` · `site/readme-html.mjs`
- **Testé par** : `site/site-versions.test.mjs`
