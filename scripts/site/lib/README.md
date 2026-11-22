<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs (`npm run skills:doc`) — seul le bloc « À savoir » s'écrit à la main, il est conservé. -->

# `scripts/site/lib/`

Helpers propres au rendu du site de documentation.

## À savoir avant d'y toucher

<!-- À LA MAIN : début -->

_Rien de noté : ce qui se découvre en travaillant ici s'écrit dans ce bloc._

<!-- À LA MAIN : fin -->

Index de tout l'outillage : [`scripts/`](../../README.md).

## [`admonitions.mjs`](admonitions.mjs)

Les encarts GitHub (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`) rendus en HTML, et leur style.

- **Usage** : `import { ADMONITION_CSS, decorateAdmonitions } from "./lib/admonitions.mjs"`
- **Appelé par** : `site/build-docs-site.mjs` · `site/readme-html.mjs`

## [`adr-publication.mjs`](adr-publication.mjs)

Ce qu'un ADR doit porter pour être PUBLIÉ sur le site.

- **Usage** : `import { adrPublicationDefects } from "./lib/adr-publication.mjs"`
- **Appelé par** : `site/build-docs-site.mjs`
- **Testé par** : `site/adr-publication.test.mjs`

## [`api-reference.mjs`](api-reference.mjs)

Référence d'API du site : ce que chaque paquet publié EXPOSE, rendu en pages Markdown que le générateur de documentation publie sous `api/`.

- **Usage** : `import { extractApiModel, renderApiPages } from "./lib/api-reference.mjs"`
- **Appelé par** : `site/build-docs-site.mjs`
- **Testé par** : `site/api-reference.test.mjs`
- **Utilise** : `lib/workspaces.mjs` · `release/api-diff-core.mjs`

## [`app-template-deps.mjs`](app-template-deps.mjs)

Les dépendances de production d'une application MINIMALE, lues dans le gabarit que `nodefony create app` rend.

- **Usage** : `import { APP_TEMPLATE_PATH, minimalAppDependencies } from "./lib/app-template-deps.mjs"`
- **Appelé par** : `site/build-site-plan.mjs` · `site/lib/llms-plan.mjs`
- **Testé par** : `site/site-plan.test.mjs`

## [`html-text.mjs`](html-text.mjs)

Retrait des balises HTML — **une seule implémentation pour tout le dépôt**.

- **Usage** : `import { sansBalises, anchorHeadings } from "./lib/html-text.mjs"`
- **Appelé par** : `site/build-docs-site.mjs` · `site/build-perf-site.mjs` · `site/readme-html.mjs`
- **Testé par** : `site/html-text.test.mjs`

## [`llms-plan.mjs`](llms-plan.mjs)

Le plan de lecture du site au format llms.txt (https://llmstxt.org) — en ANGLAIS, et COURT.

- **Usage** : `import { llmsPlan } from "./lib/llms-plan.mjs"`
- **Appelé par** : `site/build-site-plan.mjs`
- **Testé par** : `site/llms-plan.test.mjs`
- **Utilise** : `site/lib/app-template-deps.mjs` · `release/release-core.mjs`

## [`markdown-source.mjs`](markdown-source.mjs)

Préparation de la SOURCE Markdown d'une page avant son rendu par le site.

- **Usage** : `import { sansCommentaires } from "./lib/markdown-source.mjs"`
- **Appelé par** : `site/build-docs-site.mjs`
- **Testé par** : `site/markdown-source.test.mjs` · `site/translations.test.mjs`

## [`module-docs.mjs`](module-docs.mjs)

Les modules du dépôt qui portent un dossier `docs/`, et la clé courte qui fait leur adresse sur le site (`/docs/modules/<clé>/`).

- **Usage** : `import { moduleDocsDirs, moduleDocsUrl } from "./lib/module-docs.mjs"`
- **Appelé par** : `generate/readmes.mjs` · `site/build-docs-site.mjs`
- **Testé par** : `generate/readmes.test.mjs`

## [`out-dir.mjs`](out-dir.mjs)

Dossier de sortie d'un générateur du site : neuf à chaque rendu, ou refusé.

- **Usage** : `import { prepareOutDir } from "./lib/out-dir.mjs"`
- **Appelé par** : `site/assemble-site.mjs` · `site/build-docs-site.mjs` · `site/build-site.mjs`
- **Testé par** : `site/site-versions.test.mjs`

## [`page-summary.mjs`](page-summary.mjs)

Le résumé d'une page publiée : l'extrait qu'un moteur de recherche montrera (`<meta name="description">`), et que le plan `llms.txt` cite à côté du lien. Sans lui, le moteur en invente un — souvent le fil d'Ariane ou une ligne de code, ce qui ne dit rien de la page.

- **Usage** : `import { pageSummary } from "./lib/page-summary.mjs"`
- **Appelé par** : `site/build-docs-site.mjs` · `site/build-perf-site.mjs` · `site/build-qualite-site.mjs` · `.claude/skills/nodefony-load-test/scripts/prod-readiness-report.mjs`
- **Testé par** : `site/llms-plan.test.mjs`

## [`seo-check.mjs`](seo-check.mjs)

Le référencement d'un site RENDU, page par page : ce qu'un moteur de recherche, l'aperçu d'un lien partagé et un agent lisent dans l'en-tête.

- **Usage** : `import { readSeoHead, siteDefects } from "./lib/seo-check.mjs"`
- **Appelé par** : `site/build-site-plan.mjs` · `site/check-site-seo.mjs` · `site/lib/sitemap.mjs`
- **Testé par** : `site/seo-check.test.mjs` · `site/translations.test.mjs`

## [`seo-head.mjs`](seo-head.mjs)

L'en-tête de référencement d'UNE page publiée : description, adresse canonique, aperçu de partage (Open Graph + carte), données structurées schema.org — tout ce que `check-site-seo.mjs` exige, émis au même endroit pour toutes les pages du site (documentation, accueil, mesures, qualité).

- **Usage** : `import { seoHead, brandTitle, techArticle } from "./lib/seo-head.mjs"`
- **Appelé par** : `site/build-docs-site.mjs` · `site/build-perf-site.mjs` · `site/build-qualite-site.mjs` · `site/readme-html.mjs` · `.claude/skills/nodefony-load-test/scripts/prod-readiness-report.mjs`
- **Testé par** : `site/translations.test.mjs`

## [`site-nav.mjs`](site-nav.mjs)

Le menu commun des sites VOISINS de la documentation — performance et qualité — rendu par chacun de leurs générateurs.

- **Usage** : `import { siteNav, relativeUrl, menuTargets } from "./lib/site-nav.mjs"`
- **Appelé par** : `site/build-docs-site.mjs` · `site/build-perf-site.mjs` · `site/build-qualite-site.mjs` · `.claude/skills/nodefony-load-test/scripts/prod-readiness-report.mjs`
- **Testé par** : `site/site-nav.test.mjs`

## [`site-versions.mjs`](site-versions.mjs)

Versions du site publié — qui vit où, et comment passer de l'une à l'autre.

- **Usage** : `import { planVersions, manifestFor } from "./lib/site-versions.mjs"`
- **Appelé par** : `pages.yml` · `site/assemble-site.mjs` · `site/build-docs-site.mjs` · `site/build-site.mjs` · `site/check-site-links.mjs` · `site/readme-html.mjs`
- **Testé par** : `site/site-versions.test.mjs`

## [`sitemap.mjs`](sitemap.mjs)

Le plan pour les moteurs au format sitemap 0.9 — fonctions PURES, éprouvées sans rendre le site (`site-plan.test.mjs`).

- **Usage** : `import { sitemapXml, sitemapEntries, modifiedDate } from "./lib/sitemap.mjs"`
- **Appelé par** : `site/build-site-plan.mjs`
- **Testé par** : `site/site-plan.test.mjs`
- **Utilise** : `site/lib/seo-check.mjs`

## [`translations.mjs`](translations.mjs)

Les pages TRADUITES du site : qui traduit quoi, et la traduction est-elle à jour de sa source ?

- **Usage** : `import { translationGroups, staleTranslations, sourceFingerprint } from "./lib/translations.mjs"`
- **Appelé par** : `site/build-docs-site.mjs`
- **Testé par** : `site/translations.test.mjs`
