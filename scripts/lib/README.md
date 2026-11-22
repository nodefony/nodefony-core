<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs (`npm run skills:doc`) — seul le bloc « À savoir » s'écrit à la main, il est conservé. -->

# `scripts/lib/`

Helpers transverses, importés par les scripts des autres dossiers.

## À savoir avant d'y toucher

<!-- À LA MAIN : début -->

_Rien de noté : ce qui se découvre en travaillant ici s'écrit dans ce bloc._

<!-- À LA MAIN : fin -->

Index de tout l'outillage : [`scripts/`](../README.md).

## [`conformance-verdict.mjs`](conformance-verdict.mjs)

Verdict d'une suite de conformité BOÎTE NOIRE confrontée à sa liste d'échecs CONNUS. Pur : ni processus, ni fichier — le banc lit, cette règle juge.

- **Usage** : `import { judge, parseJUnit, parseKnownFailing } from "../lib/conformance-verdict.mjs"`
- **Appelé par** : `src/modules/test/conformance/http2.mjs`
- **Testé par** : `lib/conformance-verdict.test.mjs`

## [`conformance-verdict.test.mjs`](conformance-verdict.test.mjs)

Forme exacte du rapport d'h2spec v2.6.0 (`reporter/junit_report.go`) : cas vides en balise ouvrante + fermante, contenu d'échec brut.

- **Lancé par** : `npm run test:tooling`
- **Utilise** : `lib/conformance-verdict.mjs`

## [`cookie-jar.mjs`](cookie-jar.mjs)

Pot à cookies des bancs e2e — fusionne une réponse dans l'en-tête `Cookie` déjà tenu, comme le fait un navigateur (RFC 6265 §5.3).

- **Usage** : `import { mergeSetCookie } from "../../../../scripts/lib/cookie-jar.mjs"`
- **Appelé par** : `.claude/skills/nodefony-load-test/scripts/debug-runtime-e2e.mjs` · `.claude/skills/nodefony-load-test/scripts/totp-mfa-attack-e2e.mjs` · `.claude/skills/nodefony-load-test/scripts/totp-mfa-e2e.mjs` · `.claude/skills/nodefony-load-test/scripts/users-admin-factors-e2e.mjs` · `.claude/skills/nodefony-load-test/scripts/webhooks-dataplane-e2e.mjs`
- **Testé par** : `lib/cookie-jar.test.mjs`

## [`cookie-jar.test.mjs`](cookie-jar.test.mjs)

Le pot à cookies des bancs e2e se comporte comme un navigateur : une réponse qui ne porte qu'un cookie ne fait pas tomber les autres.

- **Lancé par** : `npm run test:tooling`
- **Utilise** : `lib/cookie-jar.mjs`

## [`pinned-binary.mjs`](pinned-binary.mjs)

Binaire tiers ÉPINGLÉ : téléchargé une fois, refusé si sa somme diffère de celle FIGÉE par l'appelant, extrait à chaque usage depuis l'archive vérifiée.

- **Usage** : `import { ensurePinnedBinary, probeExecutable } from "../lib/pinned-binary.mjs"`
- **Appelé par** : `src/modules/test/conformance/http2.mjs` · `src/modules/test/conformance/run.mjs`
- **Testé par** : `lib/pinned-binary.test.mjs`

## [`pinned-binary.test.mjs`](pinned-binary.test.mjs)

- **Lancé par** : `npm run test:tooling`
- **Utilise** : `lib/pinned-binary.mjs`

## [`redis-session-purge.mjs`](redis-session-purge.mjs)

Purge les sessions qu'un serveur de test laisse dans SA base Redis — seule implémentation.

- **Usage** : `import { purgeTestSessions } from "../lib/redis-session-purge.mjs"`
- **Appelé par** : `test/test-all.ts`
- **Testé par** : `lib/redis-session-purge.test.mjs`

## [`redis-session-purge.test.mjs`](redis-session-purge.test.mjs)

Port fermé : une connexion tentée échouerait autrement qu'avec ce message.

- **Variable** `NF_REDIS_TEST_URL`
- **Lancé par** : `npm run test:tooling`
- **Utilise** : `lib/redis-session-purge.mjs` · `lib/repo-root.mjs`

## [`repo-root.mjs`](repo-root.mjs)

Racine du dépôt — seule implémentation pour les scripts de `scripts/`.

- **Usage** : `import { REPO_ROOT } from "../lib/repo-root.mjs"`
- **Appelé par** : `.claude/skills/nodefony-documentation/scripts/mermaid-check.mjs` · `.claude/skills/nodefony-load-test/scripts/boot-bench.mjs` · `.claude/skills/nodefony-load-test/scripts/boot-profile.mjs` · `.claude/skills/nodefony-load-test/scripts/console-boot-bench.mjs` · `.claude/skills/nodefony-load-test/scripts/server-boot-bench.mjs` · `src/modules/test/conformance/http2.mjs` · `deps/check-deps-latest.mjs` · `gates/check-licenses.mjs` · `gates/check-package-deps.mjs` · `gates/size-check.mjs` · `generate/brand-assets.mjs` · `generate/env-reference.ts` · `generate/env-snapshot.ts` · `generate/generate-man.mjs` · `generate/generate-symbols.ts` · `generate/readmes.mjs` · `repo/long-run-lock.mjs` · `repo/tmp-layout.mjs` · `scaffold/check-scaffold-boot.mjs` · `scaffold/check-scaffold-format.mjs` · `scaffold/check-scaffold-frontends.mjs` · `scaffold/format-templates.mjs` · `site/assemble-site.mjs` · `site/build-docs-site.mjs` · `site/build-perf-site.mjs` · `site/build-qualite-site.mjs` · `site/build-site-plan.mjs` · `site/build-site.mjs` · `site/readme-html.mjs` · `test/test-all.ts` · `test/testbed-report.ts`
- **Testé par** : `gates/dev-credentials.test.mjs` · `gates/vitest-tmp-guard.test.mjs` · `generate/readmes.test.mjs` · `lib/redis-session-purge.test.mjs` · `release/accueil-gate.test.mjs` · `site/perf-figures.test.mjs` · `site/schemas-organigramme.test.mjs` · `site/schemas-sequence.test.mjs` · `site/site-plan.test.mjs` · `site/site-versions.test.mjs`

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

## [`tail-of.mjs`](tail-of.mjs)

La fin d'une sortie, en DISANT ce qui manque.

- **Usage** : `import { tailOf } from "../lib/tail-of.mjs"`
- **Appelé par** : `scaffold/check-scaffold-boot.mjs` · `scaffold/check-scaffold-frontends.mjs`

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
- **Appelé par** : `.claude/skills/nodefony-ticket/scripts/pr-finish.mjs` · `gates/check-symbol-stability.mjs` · `generate/readmes.mjs` · `lib/symbols-publish.mjs` · `release/api-diff.mjs` · `release/dts-deps.mjs` · `release/pack-all.mjs` · `release/peers.mjs` · `release/readme-gate.mjs` · `release/release.mjs` · `release/types-rigor.mjs` · `site/lib/api-reference.mjs` · `test/coverage-all.ts`
- **Testé par** : `lib/workspaces.test.mjs` · `release/release-core.test.mjs`

## [`workspaces.test.mjs`](workspaces.test.mjs)

Vécu : `npm query` rend l'arbre INSTALLÉ. Un module ajouté sans `npm install` derrière lui est sur le disque et absent de npm — le pack l'aurait oublié.

- **Lancé par** : `npm run test:tooling`
- **Utilise** : `lib/workspaces.mjs`
