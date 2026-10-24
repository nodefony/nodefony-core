<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs (`npm run skills:doc`) — seul le bloc « À savoir » s'écrit à la main, il est conservé. -->

# `scripts/lib/`

Helpers transverses, importés par les scripts des autres dossiers.

## À savoir avant d'y toucher

<!-- À LA MAIN : début -->

_Rien de noté : ce qui se découvre en travaillant ici s'écrit dans ce bloc._

<!-- À LA MAIN : fin -->

Index de tout l'outillage : [`scripts/`](../README.md).

## [`redis-session-purge.mjs`](redis-session-purge.mjs)

Purge les sessions qu'un serveur de test laisse dans SA base Redis — seule implémentation.

- **Usage** : `import { purgeTestSessions } from "../lib/redis-session-purge.mjs"`
- **Appelé par** : `test/test-all.ts`
- **Testé par** : `lib/redis-session-purge.test.mjs`

## [`redis-session-purge.test.mjs`](redis-session-purge.test.mjs)

Port fermé : une connexion tentée échouerait autrement qu'avec ce message.

- **Variable** `NF_REDIS_TEST_URL`
- **Variable** `OTHER`
- **Lancé par** : `npm run test:tooling`
- **Utilise** : `lib/redis-session-purge.mjs` · `lib/repo-root.mjs`

## [`repo-root.mjs`](repo-root.mjs)

Racine du dépôt — seule implémentation pour les scripts de `scripts/`.

- **Usage** : `import { REPO_ROOT } from "../lib/repo-root.mjs"`
- **Variable** `REPO_ROOT`
- **Variable** `ROOT_PACKAGE_NAME`
- **Appelé par** : `deps/check-deps-latest.mjs` · `gates/check-licenses.mjs` · `gates/check-package-deps.mjs` · `gates/size-check.mjs` · `generate/brand-assets.mjs` · `generate/env-reference.ts` · `generate/env-snapshot.ts` · `generate/generate-man.mjs` · `generate/generate-symbols.ts` · `repo/long-run-lock.mjs` · `repo/tmp-layout.mjs` · `scaffold/check-scaffold-format.mjs` · `scaffold/check-scaffold-frontends.mjs` · `scaffold/format-templates.mjs` · `site/assemble-site.mjs` · `site/build-docs-site.mjs` · `site/build-perf-site.mjs` · `site/build-qualite-site.mjs` · `site/build-site-plan.mjs` · `site/build-site.mjs` · `site/readme-html.mjs` · `test/test-all.ts`
- **Testé par** : `gates/dev-credentials.test.mjs` · `gates/vitest-tmp-guard.test.mjs` · `lib/redis-session-purge.test.mjs` · `site/schemas-organigramme.test.mjs` · `site/schemas-sequence.test.mjs` · `site/site-plan.test.mjs` · `site/site-versions.test.mjs`

## [`symbols-publish.mjs`](symbols-publish.mjs)

Graphe symbolique : à quel module appartient un fichier, quels modules sont PUBLIÉS, et la copie du graphe réduite à eux — seule implémentation.

- **Usage** : `import { moduleOf, publishedModules, filterGraphToModules } from "../lib/symbols-publish.mjs"`
- **Appelé par** : `node.js.yml` · `generate/generate-symbols.ts` · `release/pack-all.mjs`
- **Testé par** : `lib/symbols-publish.test.mjs`
- **Utilise** : `lib/workspaces.mjs`

## [`symbols-publish.test.mjs`](symbols-publish.test.mjs)

Copie publiée du graphe symbolique — module d'un fichier, modules publiés, filtrage sans relation orpheline. /

- **Lancé par** : `node.js.yml` · `npm run test:tooling`
- **Utilise** : `lib/symbols-publish.mjs`

## [`turbo-replay.mjs`](turbo-replay.mjs)

Ce que turbo a REJOUÉ du cache au lieu de l'exécuter — seule implémentation.

- **Usage** : `import { replayedTasks } from "../lib/turbo-replay.mjs"`
- **Appelé par** : `test/test-all.ts`
- **Testé par** : `lib/turbo-replay.test.mjs`

## [`turbo-replay.test.mjs`](turbo-replay.test.mjs)

Lignes RÉELLES d'une passe `test:all` (#472), couleurs comprises.

- **Lancé par** : `npm run test:tooling`
- **Utilise** : `lib/turbo-replay.mjs`

## [`workspaces.mjs`](workspaces.mjs)

Les workspaces du dépôt, résolus par npm — seule implémentation pour scripts/.

- **Usage** : `import { publishableWorkspaces, listWorkspaces } from "../lib/workspaces.mjs"`
- **Usage** : `import { releasableWorkspaces, readWorkspaceManifests } from "../lib/workspaces.mjs"`
- **Appelé par** : `lib/symbols-publish.mjs` · `release/api-diff.mjs` · `release/pack-all.mjs` · `release/readme-gate.mjs` · `release/release.mjs` · `release/types-rigor.mjs` · `site/lib/api-reference.mjs` · `test/coverage-all.ts`
- **Testé par** : `lib/workspaces.test.mjs` · `release/release-core.test.mjs`

## [`workspaces.test.mjs`](workspaces.test.mjs)

Vécu : `npm query` rend l'arbre INSTALLÉ. Un module ajouté sans `npm install` derrière lui est sur le disque et absent de npm — le pack l'aurait oublié.

- **Lancé par** : `npm run test:tooling`
- **Utilise** : `lib/workspaces.mjs`
