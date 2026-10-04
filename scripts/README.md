<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs — ne pas éditer : `npm run skills:doc`. -->

# `scripts/` — l'outillage du dépôt

Chaque script du dépôt, rangé par **nature** : ce qu'il fait, comment le lancer, et **qui le lance**
(commande npm, hook git, étape de forge, autre script). Tout est extrait du source — l'en-tête
du script (`@usage`, `@option`, `@env`, `@requires`, `@output`) est la seule place où sa
documentation s'écrit. `npm run skills:check` refuse un script sans `@usage` et un index périmé.

Un script dont l'appelant manque n'est lancé par aucun automate : il se tape à la main.

## `lib/`

Helpers transverses, importés par les scripts des autres dossiers.

### [`repo-root.mjs`](lib/repo-root.mjs)

Racine du dépôt — seule implémentation pour les scripts de `scripts/`.

- **Usage** : `import { REPO_ROOT } from "../lib/repo-root.mjs"`
- **Variable** `REPO_ROOT`
- **Variable** `ROOT_PACKAGE_NAME`
- **Appelé par** : `deps/check-deps-latest.mjs` · `gates/check-licenses.mjs` · `gates/check-package-deps.mjs` · `gates/size-check.mjs` · `generate/brand-assets.mjs` · `generate/env-snapshot.ts` · `generate/generate-man.mjs` · `generate/generate-symbols.ts` · `repo/long-run-lock.mjs` · `repo/tmp-layout.mjs` · `scaffold/check-scaffold-format.mjs` · `scaffold/check-scaffold-frontends.mjs` · `scaffold/format-templates.mjs` · `site/build-docs-site.mjs` · `site/build-perf-site.mjs` · `site/build-qualite-site.mjs` · `site/build-site-plan.mjs` · `site/readme-html.mjs` · `test/test-all.ts`
- **Testé par** : `gates/dev-credentials.test.mjs` · `gates/vitest-tmp-guard.test.mjs` · `site/site-plan.test.mjs`

### [`symbols-publish.mjs`](lib/symbols-publish.mjs)

Graphe symbolique : à quel module appartient un fichier, quels modules sont

- **Usage** : `import { moduleOf, publishedModules, filterGraphToModules } from "../lib/symbols-publish.mjs"`
- **Appelé par** : `node.js.yml` · `generate/generate-symbols.ts` · `release/pack-all.mjs`
- **Testé par** : `lib/symbols-publish.test.mjs`

### [`symbols-publish.test.mjs`](lib/symbols-publish.test.mjs)

Copie publiée du graphe symbolique — module d'un fichier, modules publiés,

- **Lancé par** : `node.js.yml` · `npm run test:tooling`

## `gates/`

Gardes de commit et de forge : chacune refuse un état précis du dépôt.

### [`check-externals.mjs`](gates/check-externals.mjs)

Audit de la dérive `external` ⇄ manifeste, sur TOUT le dépôt — core, packages ET modules.

- **Usage** : `npm run externals:check`
- **Usage** : `node scripts/gates/check-externals.mjs --json`
- **Appelé par** : `npm run externals:check`
- **Testé par** : `gates/check-externals.test.mjs`

### [`check-externals.test.mjs`](gates/check-externals.test.mjs)

Suite de l'audit `external` — écrite pour le faire ÉCHOUER, pas pour l'accompagner.

- **Lancé par** : `npm run test:externals` · `npm run test:tooling`

### [`check-licenses.mjs`](gates/check-licenses.mjs)

check-licenses — DÉLÈGUE à la commande du produit, et ne décide plus rien.

- **Usage** : `node scripts/gates/check-licenses.mjs [--json] [--cwd <dir>]`
- **Produit** : celle de `nodefony licenses`, verbatim, avec son code de sortie
- **Appelé par** : `npm run check:licenses`

### [`check-no-nul-bytes.mjs`](gates/check-no-nul-bytes.mjs)

check-no-nul-bytes — un octet NUL dans une source la rend INVISIBLE aux outils.

- **Usage** : `node scripts/gates/check-no-nul-bytes.mjs           # tous les fichiers SUIVIS`
- **Usage** : `node scripts/gates/check-no-nul-bytes.mjs --staged  # ceux de l'index (pre-commit)`
- **Produit** : la liste des fichiers fautifs avec la ligne du premier octet ; sortie 1 si un seul l'est
- **Appelé par** : `npm run check:nul` · `.githooks/pre-commit`

### [`check-package-deps.mjs`](gates/check-package-deps.mjs)

Garde de pré-commit — surface des paquets du dépôt du framework.

- **Usage** : `node scripts/gates/check-package-deps.mjs`
- **Appelé par** : `.githooks/pre-commit`

### [`check-platform-channels.mjs`](gates/check-platform-channels.mjs)

Gate — aucun nom de canal/méthode de plateforme écrit EN DUR dans le code.

- **Usage** : `node scripts/gates/check-platform-channels.mjs`
- **Variable** `TABLE`
- **Appelé par** : `.githooks/pre-commit`

### [`check-portable-filenames.mjs`](gates/check-portable-filenames.mjs)

check-portable-filenames — un nom de fichier que Windows REFUSE ne doit pas entrer.

- **Usage** : `node scripts/gates/check-portable-filenames.mjs           # tous les fichiers SUIVIS`
- **Usage** : `node scripts/gates/check-portable-filenames.mjs --staged  # ceux de l'index (pre-commit)`
- **Produit** : la liste des noms refusés, avec la raison exacte ; sortie 1 si un seul l'est
- **Appelé par** : `npm run check:filenames` · `.githooks/pre-commit`

### [`check-script-descriptions.mjs`](gates/check-script-descriptions.mjs)

check-script-descriptions — chaque script `npm` dit ce qu'il fait.

- **Usage** : `node scripts/gates/check-script-descriptions.mjs`
- **Usage** : `node scripts/gates/check-script-descriptions.mjs <autre/package.json> [...]`
- **Produit** : la liste des manquants et des orphelines ; sortie 1 si l'une existe
- **Appelé par** : `npm run check:scripts`

### [`dev-credentials.test.mjs`](gates/dev-credentials.test.mjs)

Gate — UN SEUL mot de passe de développement, et tout ce qui l'annonce dit vrai.

- **Lancé par** : `npm run test:dev-credentials` · `npm run test:tooling`

### [`size-check.mjs`](gates/size-check.mjs)

Gate de budget bundle des subpaths client (ADR-0007 D10).

- **Usage** : `npm run size:check`
- **Usage** : `npm run size:check -- --json`
- **Appelé par** : `npm run size:check` · `release/release.mjs`

### [`vitest-tmp-guard.test.mjs`](gates/vitest-tmp-guard.test.mjs)

Toute configuration vitest du dépôt pose la garde des dossiers temporaires

- **Lancé par** : `npm run test:tooling`

## `scaffold/`

Contrôles et mise en forme des gabarits d'application.

### [`check-scaffold-format.mjs`](scaffold/check-scaffold-format.mjs)

Le code que `nodefony create` PRODUIT est-il accepté par le formateur que ce

- **Usage** : `npm run format:scaffold`
- **Usage** : `node scripts/scaffold/check-scaffold-format.mjs --keep`
- **Appelé par** : `npm run format:scaffold` · `.githooks/pre-commit`

### [`check-scaffold-frontends.mjs`](scaffold/check-scaffold-frontends.mjs)

Le front que `nodefony create app --frontend <fw>` PRODUIT passe-t-il les

- **Usage** : `node scripts/scaffold/check-scaffold-frontends.mjs [react vue angular svelte] [--keep]`
- **Appelé par** : `scaffold.yml`

### [`format-templates.mjs`](scaffold/format-templates.mjs)

Formate les gabarits de scaffold **sans casser leurs balises eta**.

- **Usage** : `npm run format:templates`
- **Usage** : `npm run format:templates -- --check`
- **Variable** `CHECK`
- **Appelé par** : `npm run format:templates`

## `deps/`

Inventaire et garde des dépendances, gabarits compris.

### [`check-deps-latest.mjs`](deps/check-deps-latest.mjs)

Inventaire EXHAUSTIF des dépendances en retard — remplaçant de `npm outdated`.

- **Usage** : `npm run deps:check`
- **Usage** : `npm run deps:gate`
- **Variable** `CATALOGUE_SCAFFOLD`
- **Variable** `NF_DEPS_REGISTRY`
- **Variable** `NF_DEPS_ROOT`
- **Variable** `REGISTRY`
- **Appelé par** : `npm run deps:check` · `npm run deps:gate` · `node.js.yml`
- **Testé par** : `deps/deps-gate.test.mjs`

### [`deps-gate.test.mjs`](deps/deps-gate.test.mjs)

Suite de bout en bout de la garde des dépendances — écrite pour la faire

- **Lancé par** : `npm run test:deps-gate` · `npm run test:tooling`

### [`lib/reconcile-versions.mjs`](deps/lib/reconcile-versions.mjs)

La question qui décide d'une divergence de version : **existe-t-il UNE version

- **Usage** : `import { reconcilie, dedouble } from "./lib/reconcile-versions.mjs"`
- **Appelé par** : `deps/check-deps-latest.mjs`
- **Testé par** : `deps/reconcile-versions.test.mjs`

### [`reconcile-versions.test.mjs`](deps/reconcile-versions.test.mjs)

Suite de la réconciliation de versions — écrite pour faire ÉCHOUER la garde,

- **Lancé par** : `npm run test:deps-gate` · `npm run test:tooling`

## `test/`

Orchestration des suites de test et de la couverture.

### [`coverage-all.ts`](test/coverage-all.ts)

Rejoue la couverture de CHAQUE module qui en déclare une, avec le DÉCOR

- **Usage** : `npm run coverage`
- **Usage** : `npm run coverage -- --only <module>`
- **Usage** : `npm run coverage -- --json`
- **Variable** `ONLY`
- **Variable** `OUT`
- **Appelé par** : `npm run coverage`

### [`lib/docker.ts`](test/lib/docker.ts)

Verdicts sur les conteneurs d'infra du dépôt — sans le moindre effet de bord.

- **Usage** : `import { containerHealthy } from "./lib/docker.ts"`
- **Appelé par** : `test/coverage-all.ts` · `test/test-all.ts`

### [`lib/mongoReset.ts`](test/lib/mongoReset.ts)

Remise à zéro de la base d'un banc MongoDB — le décor repart VIERGE.

- **Usage** : `import { resetMongoDatabase } from "./lib/mongoReset.ts"`
- **Appelé par** : `test/test-all.ts`

### [`realtime-coverage-map.mjs`](test/realtime-coverage-map.mjs)

Carte de couverture du temps réel — quel étage de test EXERCE quel fichier source.

- **Usage** : `node scripts/test/realtime-coverage-map.mjs [--json]`
- **Appelé par** : aucun automate

### [`test-all.ts`](test/test-all.ts)

`npm run test:all` — lance **toute** la batterie de tests du monorepo, et rend

- **Usage** : `npm run test:all`
- **Usage** : `npm run test:all -- --infra`
- **Usage** : `npm run test:all -- --load --dialects --mongo`
- **Variable** `NF_DATABASE_URL`
- **Variable** `NF_MYSQL_URL`
- **Variable** `NF_RUN_CLUSTER_E2E`
- **Appelé par** : `npm run test:all`

## `generate/`

Génération d'artefacts : graphe symbolique, page de manuel, catalogue d'environnement, logo.

### [`brand-assets.mjs`](generate/brand-assets.mjs)

brand-assets.mjs — dérive le PNG et le favicon du logo depuis sa source SVG.

- **Usage** : `node scripts/generate/brand-assets.mjs`
- **Variable** `SVG`
- **Appelé par** : aucun automate

### [`env-catalog.ts`](generate/env-catalog.ts)

Ce que les variables de DÉCOR DE BANC font — la seule part qu'aucun automate

- **Usage** : `import { BENCH_DECOR, type IEnvDeclaration } from "./env-catalog"`
- **Appelé par** : `generate/env-snapshot.ts`

### [`env-snapshot.ts`](generate/env-snapshot.ts)

Catalogue des variables d'environnement — projection DÉRIVÉE, jamais saisie.

- **Usage** : `npm run env:snapshot`
- **Usage** : `tsx scripts/generate/env-snapshot.ts --check`
- **Variable** `NF_X`
- **Appelé par** : `npm run env:snapshot` · `.githooks/pre-commit`

### [`generate-man.mjs`](generate/generate-man.mjs)

Écrit `src/nodefony/man/nodefony.1` depuis le CLI RÉEL.

- **Usage** : `node scripts/generate/generate-man.mjs`
- **Usage** : `node scripts/generate/generate-man.mjs --check`
- **Appelé par** : `release/release.mjs`
- **Testé par** : `src/nodefony/src/tests/manPage.test.ts`

### [`generate-password-blocklist.mjs`](generate/generate-password-blocklist.mjs)

Fige la liste des mots de passe les plus courants en artefact VERSIONNÉ.

- **Usage** : `node scripts/generate/generate-password-blocklist.mjs <fichier-source> [...autres]`
- **Appelé par** : aucun automate
- **Testé par** : `src/packages/@nodefony/user/tests/unit/passwordPolicy.test.ts`

### [`generate-symbols.config.ts`](generate/generate-symbols.config.ts)

Configuration for scripts/generate/generate-symbols.ts

- **Usage** : `import config from "./generate-symbols.config.ts"`
- **Appelé par** : `generate/generate-symbols.ts`

### [`generate-symbols.ts`](generate/generate-symbols.ts)

generate-symbols.ts — Symbol graph extractor for AI agents.

- **Usage** : `npm run generate-symbols`
- **Option** `--verbose` — détail ligne par ligne des homonymes
- **Option** `--check-staged` — code 1 si un fichier indexé touche la zone parsée
- **Option** `--check-range` — <de> <à>  code 1 si la zone a bougé entre deux révisions, ou si le graphe manque
- **Appelé par** : `npm run generate-symbols` · `node.js.yml`

## `site/`

Rendu du site de documentation publié et de ses pages annexes.

### [`build-docs-site.mjs`](site/build-docs-site.mjs)

Construit le SITE de documentation publié — toute la doc Nodefony en HTML

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
- **Appelé par** : `node.js.yml` · `pages.yml` · `.claude/skills/nodefony-devkit-bench/scripts/bench-first-impression.mjs`

### [`build-perf-site.mjs`](site/build-perf-site.mjs)

Construit le site « Performance » publié — une page par version, plus `latest`.

- **Usage** : `node scripts/site/build-perf-site.mjs [--out tmp/sites/perf] [--data docs/performance/data]`
- **Variable** `BLOB`
- **Variable** `DATA_DIR`
- **Variable** `OUT`
- **Appelé par** : `pages.yml`

### [`build-qualite-site.mjs`](site/build-qualite-site.mjs)

Construit le site « Qualité » publié — le verdict d'une CAMPAGNE DE TEST par version.

- **Usage** : `node scripts/site/build-qualite-site.mjs [--out tmp/sites/quality] [--data docs/qualite/data]`
- **Variable** `DATA`
- **Appelé par** : `pages.yml`

### [`build-site-plan.mjs`](site/build-site-plan.mjs)

Publie le PLAN du site : `llms.txt`, `sitemap.xml` et `robots.txt`.

- **Usage** : `npm run site:plan`
- **Usage** : `node scripts/site/build-site-plan.mjs [--out tmp/sites/docs] [--base <url>]`
- **Variable** `APP_TEMPLATE_HREF`
- **Appelé par** : `npm run site:plan` · `pages.yml`

### [`check-site-links.mjs`](site/check-site-links.mjs)

Refuse un site dont un lien interne ne mène nulle part.

- **Usage** : `node scripts/site/check-site-links.mjs <dossier-du-site>`
- **Variable** `ROOT`
- **Appelé par** : `pages.yml`
- **Testé par** : `.claude/skills/nodefony-identifiers/scripts/check-identifier-language.test.mjs`

### [`lib/app-template-deps.mjs`](site/lib/app-template-deps.mjs)

Les dépendances de production d'une application MINIMALE, lues dans le gabarit

- **Usage** : `import { APP_TEMPLATE_PATH, minimalAppDependencies } from "./lib/app-template-deps.mjs"`
- **Appelé par** : `site/build-site-plan.mjs`
- **Testé par** : `site/site-plan.test.mjs`

### [`lib/html-text.mjs`](site/lib/html-text.mjs)

Retrait des balises HTML — **une seule implémentation pour tout le dépôt**.

- **Usage** : `import { sansBalises } from "./lib/html-text.mjs"`
- **Appelé par** : `site/build-docs-site.mjs` · `site/readme-html.mjs`

### [`markdown-highlight.mjs`](site/markdown-highlight.mjs)

markdown-highlight.mjs — coloration syntaxique des blocs de code du site publié.

- **Usage** : `import { highlight, STYLE_CODE } from "./markdown-highlight.mjs"`
- **Appelé par** : `site/build-docs-site.mjs` · `site/build-perf-site.mjs` · `site/readme-html.mjs`

### [`readme-html.mjs`](site/readme-html.mjs)

readme-html.mjs — Nodefony, matrice de présentation (10 minutes).

- **Usage** : `node scripts/site/readme-html.mjs [fichier-de-sortie.html]`
- **Variable** `BLOB`
- **Variable** `OUT`
- **Variable** `RAW`
- **Variable** `STYLE_CODE`
- **Appelé par** : `pages.yml` · `.claude/skills/nodefony-devkit-bench/scripts/bench-first-impression.mjs`

### [`site-plan.test.mjs`](site/site-plan.test.mjs)

Éprouve le lecteur de dépendances du gabarit d'application.

- **Lancé par** : `npm run test:site-plan` · `node.js.yml` · `npm run test:tooling`

## `repo/`

Hygiène de l'arbre de travail : verrous, rangement de tmp/, commit sans verrou orphelin.

### [`long-run-lock.mjs`](repo/long-run-lock.mjs)

Verrou « un run long occupe l'arbre » — seule implémentation, trois lecteurs.

- **Usage** : `node scripts/repo/long-run-lock.mjs check`
- **Usage** : `node scripts/repo/long-run-lock.mjs clear`
- **Appelé par** : `.githooks/pre-commit` · `.claude/hooks/guard-edit.sh` · `repo/tmp-layout.mjs` · `test/test-all.ts`
- **Testé par** : `repo/long-run-lock.test.mjs`

### [`long-run-lock.test.mjs`](repo/long-run-lock.test.mjs)

Verrou « un run long occupe l'arbre » — tenu, libéré, orphelin, et la CLI

- **Lancé par** : `npm run test:tooling`

### [`safe-commit.sh`](repo/safe-commit.sh)

safe-commit.sh — wrapper de `git commit` qui retire un .git/index.lock orphelin.

- **Usage** : `bash scripts/repo/safe-commit.sh -m "message"`
- **Usage** : `git ci -m "message"  (alias local : git config --local alias.ci "!bash scripts/repo/safe-commit.sh")`
- **Appelé par** : aucun automate

### [`tmp-layout.mjs`](repo/tmp-layout.mjs)

Arborescence de `tmp/` — seule implémentation : la table, les dossiers, le

- **Usage** : `node scripts/repo/tmp-layout.mjs`
- **Usage** : `node scripts/repo/tmp-layout.mjs --prune [--dry-run]`
- **Usage** : `node scripts/repo/tmp-layout.mjs --check`
- **Appelé par** : `.claude/skills/nodefony-session/scripts/session-end.mjs`
- **Testé par** : `repo/tmp-layout.test.mjs`

### [`tmp-layout.test.mjs`](repo/tmp-layout.test.mjs)

Arborescence de `tmp/` — catégories créées, README régénéré, égarés signalés,

- **Lancé par** : `node.js.yml` · `npm run test:tooling`

## `ci/`

Ce que la forge lance ou éprouve sur elle-même.

### [`actions-pinned.test.mjs`](ci/actions-pinned.test.mjs)

Gate — toute action GitHub tierce est épinglée par SHA de commit.

- **Lancé par** : `node.js.yml` · `npm run test:tooling`

### [`no-cancel.test.mjs`](ci/no-cancel.test.mjs)

Gate — aucun workflow du dépôt n'arrête de lui-même une exécution en cours.

- **Lancé par** : `node.js.yml` · `npm run test:tooling`

### [`run-watched.mjs`](ci/run-watched.mjs)

Lance une commande de la forge et REND LA MAIN quand elle se termine — même

- **Usage** : `node scripts/ci/run-watched.mjs [--idle <s>] [--] <commande…>`
- **Appelé par** : `e2e-autonomes.yml` · `memory.yml` · `node.js.yml` · `scaffold.yml`
- **Testé par** : `ci/run-watched.test.mjs`

### [`run-watched.test.mjs`](ci/run-watched.test.mjs)

Le lanceur de la forge rend la main quand la commande finit, même si un

- **Lancé par** : `node.js.yml` · `npm run test:tooling`

## `release/`

Chaîne de publication du produit.

### [`accueil-gate.mjs`](release/accueil-gate.mjs)

**Refuse de publier quand l'accueil du dépôt n'annonce pas ce que npm sert.**

- **Usage** : `node scripts/release/accueil-gate.mjs [--json] [--dist-tags <json>]`
- **Usage** : `node scripts/release/accueil-gate.mjs --basculer`
- **Variable** `NF_ACCUEIL_PAQUET`
- **Variable** `NF_ACCUEIL_REGISTRY`
- **Variable** `NF_ACCUEIL_ROOT`
- **Variable** `PAQUET`
- **Variable** `REGISTRY`
- **Appelé par** : `release-preflight.yml` · `release.yml` · `release/readme-gate.mjs` · `release/release.mjs`
- **Testé par** : `release/accueil-gate.test.mjs`

### [`accueil-gate.test.mjs`](release/accueil-gate.test.mjs)

La confrontation de l'accueil aux `dist-tags`, éprouvée SANS réseau.

- **Lancé par** : `npm run test:release`

### [`accueil-liens.test.mjs`](release/accueil-liens.test.mjs)

Le README du dépôt envoie vers la documentation PUBLIÉE, jamais vers un `.md`.

- **Lancé par** : `npm run test:release`

### [`api-diff-core.mjs`](release/api-diff-core.mjs)

Noyau de la mesure de surface publique : ce qu'un paquet expose, et ce qui a

- **Usage** : `import { listRuntimeExports, exportEntries } from "./api-diff-core.mjs"`
- **Appelé par** : `release/api-diff.mjs` · `release/release.mjs` · `release/types-rigor.mjs` · `.claude/skills/nodefony-release/scripts/compare-exports.mjs`
- **Testé par** : `release/api-diff-core.test.mjs`

### [`api-diff-core.test.mjs`](release/api-diff-core.test.mjs)

Le noyau de la mesure de surface publique, éprouvé sur des déclarations

- **Lancé par** : `npm run test:release`

### [`api-diff.mjs`](release/api-diff.mjs)

Mesure ce qui a changé dans la surface publique entre une version PUBLIÉE sur

- **Usage** : `npm run release:api-diff`
- **Usage** : `npm run release:api-diff -- --from <version> [--details]`
- **Appelé par** : `npm run release:api-diff` · `release/release.mjs` · `release/types-rigor.mjs`

### [`attendre-ci.mjs`](release/attendre-ci.mjs)

Attend le verdict de la CI du commit qu'on s'apprête à publier — et REFUSE

- **Usage** : `node scripts/release/attendre-ci.mjs --sha <sha> --run-id <id>`
- **Option** `--sha` — - le commit à juger (défaut : `GITHUB_SHA`)
- **Option** `--run-id` — - l'exécution courante, pour ne jamais s'attendre soi-même
- **Option** `--repo` — - le dépôt à juger, `org/dépôt` (défaut : `GITHUB_REPOSITORY`).
- **Option** `--timeout-min` — - abandon après N minutes (défaut 45)
- **Option** `--grace-min` — - délai pendant lequel « aucune exécution » vaut « pas encore indexée » et non « rouge » (défaut 3)
- **Variable** `GITHUB_REPOSITORY` — - `org/dépôt`, posé par la forge
- **Variable** `GH_TOKEN` — - jeton de lecture des exécutions
- **Produit** : le verdict, et la liste NOMMÉE de ce qui a échoué
- **Appelé par** : `release.yml` · `release/release.mjs`

### [`fix-dts-extensions.mjs`](release/fix-dts-extensions.mjs)

Post-processing des `.d.ts` générés : ajoute les extensions AUX SPECIFIERS

- **Usage** : `node scripts/release/fix-dts-extensions.mjs <dir> [--quiet]`
- **Appelé par** : `release/pack-all.mjs`

### [`hub-description.mjs`](release/hub-description.mjs)

**Publie sur Docker Hub la description de l'image — depuis un fichier versionné.**

- **Usage** : `node scripts/release/hub-description.mjs [--dry-run]`
- **Variable** `API`
- **Variable** `DEPOT`
- **Variable** `MAX_LONGUE`
- **Variable** `NF_DOCKERHUB_TOKEN`
- **Variable** `NF_DOCKERHUB_USER`
- **Variable** `NF_HUB_API`
- **Variable** `NF_HUB_DEPOT`
- **Variable** `NF_HUB_ROOT`
- **Variable** `NF_HUB_SOURCE`
- **Variable** `SOURCE`
- **Appelé par** : `release.yml`
- **Testé par** : `release/hub-description.test.mjs`

### [`hub-description.test.mjs`](release/hub-description.test.mjs)

Le contrôle de la page Docker Hub, éprouvé SANS réseau.

- **Variable** `SOURCE`
- **Lancé par** : `npm run test:release`

### [`image-gate.mjs`](release/image-gate.mjs)

**Refuse de publier une image de conteneur qui embarque un secret.**

- **Usage** : `npm run release:image-gate`
- **Usage** : `node scripts/release/image-gate.mjs <image>`
- **Usage** : `node scripts/release/image-gate.mjs --files <inventaire.txt>`
- **Appelé par** : `npm run release:image-gate` · `release.yml` · `release/smoke-docker.sh`
- **Testé par** : `release/image-gate.test.mjs`

### [`image-gate.test.mjs`](release/image-gate.test.mjs)

Le contrôle qui refuse une image porteuse d'un secret, éprouvé SANS docker.

- **Lancé par** : `npm run test:release`

### [`image-labels-gate.mjs`](release/image-labels-gate.mjs)

**Refuse de publier une image dont les étiquettes OCI ne disent pas d'où elle vient.**

- **Usage** : `node scripts/release/image-labels-gate.mjs <image> --version <v> --revision <sha>`
- **Variable** `LICENCE_ATTENDUE`
- **Variable** `OCI`
- **Appelé par** : `release.yml`
- **Testé par** : `release/image-labels-gate.test.mjs`

### [`image-labels-gate.test.mjs`](release/image-labels-gate.test.mjs)

Le contrôle des étiquettes OCI, éprouvé SANS docker.

- **Variable** `OCI`
- **Lancé par** : `npm run test:release`

### [`pack-all.mjs`](release/pack-all.mjs)

Pack release des workspaces publiables (modèle B — N-packages lockstep).

- **Usage** : `npm run release:pack`
- **Variable** `NF_RELEASE_REPO`
- **Variable** `OUT`
- **Appelé par** : `npm run release:pack` · `release-smoke.yml` · `scaffold.yml` · `release/release.mjs` · `release/smoke-docker.sh` · `.claude/skills/nodefony-devkit-bench/scripts/lib/isolation.mjs`

### [`readme-gate.mjs`](release/readme-gate.mjs)

**Refuse de publier quand un README de paquet ment à sa page npm.**

- **Usage** : `npm run readme:gate`
- **Variable** `NF_README_ROOT`
- **Appelé par** : `npm run readme:gate` · `release/release.mjs`
- **Testé par** : `release/readme-gate.test.mjs`

### [`readme-gate.test.mjs`](release/readme-gate.test.mjs)

La confrontation des README publiés, éprouvée SANS npm ni réseau.

- **Lancé par** : `npm run test:release`

### [`release-core.mjs`](release/release-core.mjs)

release-core.mjs — le RAISONNEMENT d'une release, sans aucune entrée/sortie.

- **Usage** : `import { validerVersion, comparerVersions, SEMVER } from "./release-core.mjs"`
- **Variable** `LONGUEUR_MIN_DESCRIPTION`
- **Appelé par** : `release/attendre-ci.mjs` · `release/pack-all.mjs` · `release/release.mjs`
- **Testé par** : `release/release-core.test.mjs`

### [`release-core.test.mjs`](release/release-core.test.mjs)

Suite du cœur de release — écrite pour FAIRE ÉCHOUER le script, pas pour

- **Variable** `BON`
- **Lancé par** : `npm run test:release`

### [`release.mjs`](release/release.mjs)

release.mjs — PRÉPARE une release Nodefony, et refuse tout ce qui ne se rattrape pas.

- **Usage** : `npm run release -- --version <v> --npm-tag <tag> [--write] [--pack]`
- **Usage** : `npm run release -- --version <v> --publish`
- **Variable** `BRANCHE_ATTENDUE`
- **Variable** `BRANCHE_PUBLICATION`
- **Variable** `PUBLIER`
- **Variable** `TAG_NPM`
- **Variable** `VERSION`
- **Appelé par** : `npm run release` · `node.js.yml` · `release-preflight.yml` · `release.yml`
- **Testé par** : `release/release-core.test.mjs`

### [`smoke-docker.sh`](release/smoke-docker.sh)

Smoke test release (modèle B) + preuve Dockerfile/graceful shutdown/frontend.

- **Usage** : `npm run release:smoke -- [--scenario all|base|front|studio|edge|sql|cluster|pm]`
- **Variable** `IMAGE`
- **Variable** `MOTEUR`
- **Variable** `QAPP_NAME`
- **Variable** `REDIS_PORT`
- **Variable** `SERVICE`
- **Appelé par** : `npm run release:smoke` · `release-preflight.yml`

### [`tarball-types.test.mjs`](release/tarball-types.test.mjs)

Les types d'un paquet du cœur se résolvent-ils DEPUIS SON TARBALL ?

- **Lancé par** : `npm run test:release`

### [`types-rigor.mjs`](release/types-rigor.mjs)

Mesure la rigueur des TYPES PUBLIÉS : densité de `any`, rapport

- **Usage** : `npm run release:types-rigor`
- **Usage** : `node scripts/release/types-rigor.mjs [--from <version>] [--peers <liste>]`
- **Appelé par** : `npm run release:types-rigor`
