<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs (`npm run skills:doc`) — seul le bloc « À savoir » s'écrit à la main, il est conservé. -->

# `scripts/release/`

Chaîne de publication du produit.

## À savoir avant d'y toucher

<!-- À LA MAIN : début -->

_Rien de noté : ce qui se découvre en travaillant ici s'écrit dans ce bloc._

<!-- À LA MAIN : fin -->

Index de tout l'outillage : [`scripts/`](../README.md).

## [`accueil-gate.mjs`](accueil-gate.mjs)

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

## [`accueil-gate.test.mjs`](accueil-gate.test.mjs)

La confrontation de l'accueil aux `dist-tags`, éprouvée SANS réseau.

- **Lancé par** : `npm run test:release`
- **Utilise** : `release/accueil-gate.mjs`

## [`accueil-liens.test.mjs`](accueil-liens.test.mjs)

Le README du dépôt envoie vers la documentation PUBLIÉE, jamais vers un `.md`.

- **Lancé par** : `npm run test:release`

## [`api-diff-core.mjs`](api-diff-core.mjs)

Noyau de la mesure de surface publique : ce qu'un paquet expose, et ce qui a changé entre deux versions — sous-chemins d'`exports`, exports à l'exécution, exports de types, et membre par membre pour les classes et interfaces.

- **Usage** : `import { listRuntimeExports, exportEntries } from "./api-diff-core.mjs"`
- **Appelé par** : `.claude/skills/nodefony-release/scripts/compare-exports.mjs` · `release/api-diff.mjs` · `release/release.mjs` · `release/types-rigor.mjs`
- **Testé par** : `release/api-diff-core.test.mjs`

## [`api-diff-core.test.mjs`](api-diff-core.test.mjs)

Le noyau de la mesure de surface publique, éprouvé sur des déclarations écrites ici : chaque verdict qui ferait passer une rupture pour un ajout, ou du bruit pour une rupture, a son cas. /

- **Lancé par** : `npm run test:release`
- **Utilise** : `release/api-diff-core.mjs`

## [`api-diff.mjs`](api-diff.mjs)

Mesure ce qui a changé dans la surface publique entre une version PUBLIÉE sur npm et le `dist` local — par paquet publiable : sous-chemins d'`exports`, exports à l'exécution, exports de types, et membre par membre.

- **Usage** : `npm run release:api-diff`
- **Usage** : `npm run release:api-diff -- --from <version> [--details]`
- **Appelé par** : `npm run release:api-diff` · `release/release.mjs` · `release/types-rigor.mjs`
- **Utilise** : `lib/workspaces.mjs` · `release/api-diff-core.mjs`

## [`attendre-ci.mjs`](attendre-ci.mjs)

Attend le verdict de la CI du commit qu'on s'apprête à publier — et REFUSE s'il n'est pas vert.

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
- **Utilise** : `release/release-core.mjs`

## [`env-docs.test.mjs`](env-docs.test.mjs)

Les pages qui disent à un DÉPLOYEUR quelles variables poser — la page de l'image sur Docker Hub, le guide Docker, le guide Kubernetes — confrontées aux catalogues qui font foi.

- **Lancé par** : `npm run test:release`

## [`fix-dts-extensions.mjs`](fix-dts-extensions.mjs)

Post-processing des `.d.ts` générés : ajoute les extensions AUX SPECIFIERS RELATIFS pour rendre les types publiés conformes à la résolution Node ESM (`node16`/`nodenext` : extension OBLIGATOIRE, doc Node esm.md) — décision d'audit 0.7, cf docs/release/nodefony-10.md §6bis.

- **Usage** : `node scripts/release/fix-dts-extensions.mjs <dir> [--quiet]`
- **Appelé par** : `release/pack-all.mjs`

## [`hub-description.mjs`](hub-description.mjs)

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

## [`hub-description.test.mjs`](hub-description.test.mjs)

Le contrôle de la page Docker Hub, éprouvé SANS réseau.

- **Variable** `SOURCE`
- **Lancé par** : `npm run test:release`
- **Utilise** : `release/hub-description.mjs`

## [`image-gate.mjs`](image-gate.mjs)

**Refuse de publier une image de conteneur qui embarque un secret.**

- **Usage** : `npm run release:image-gate`
- **Usage** : `node scripts/release/image-gate.mjs <image>`
- **Usage** : `node scripts/release/image-gate.mjs --files <inventaire.txt>`
- **Appelé par** : `npm run release:image-gate` · `release.yml` · `release/smoke-docker.sh`
- **Testé par** : `release/image-gate.test.mjs`

## [`image-gate.test.mjs`](image-gate.test.mjs)

Le contrôle qui refuse une image porteuse d'un secret, éprouvé SANS docker.

- **Lancé par** : `npm run test:release`
- **Utilise** : `release/image-gate.mjs`

## [`image-labels-gate.mjs`](image-labels-gate.mjs)

**Refuse de publier une image dont les étiquettes OCI ne disent pas d'où elle vient.**

- **Usage** : `node scripts/release/image-labels-gate.mjs <image> --version <v> --revision <sha>`
- **Variable** `LICENCE_ATTENDUE`
- **Variable** `OCI`
- **Appelé par** : `release.yml`
- **Testé par** : `release/image-labels-gate.test.mjs`

## [`image-labels-gate.test.mjs`](image-labels-gate.test.mjs)

Le contrôle des étiquettes OCI, éprouvé SANS docker.

- **Variable** `OCI`
- **Lancé par** : `npm run test:release`
- **Utilise** : `release/image-labels-gate.mjs`

## [`pack-all.mjs`](pack-all.mjs)

Pack release des workspaces publiables (modèle B — N-packages lockstep).

- **Usage** : `npm run release:pack`
- **Variable** `NF_RELEASE_REPO`
- **Variable** `OUT`
- **Appelé par** : `npm run release:pack` · `release-smoke.yml` · `scaffold.yml` · `release/release.mjs` · `release/smoke-docker.sh` · `.claude/skills/nodefony-devkit-bench/scripts/lib/isolation.mjs`
- **Utilise** : `lib/symbols-publish.mjs` · `lib/workspaces.mjs` · `release/fix-dts-extensions.mjs` · `release/release-core.mjs`

## [`readme-gate.mjs`](readme-gate.mjs)

**Refuse de publier quand un README de paquet ment à sa page npm.**

- **Usage** : `npm run readme:gate`
- **Variable** `NF_README_ROOT`
- **Appelé par** : `npm run readme:gate` · `release/release.mjs`
- **Testé par** : `release/readme-gate.test.mjs`
- **Utilise** : `lib/workspaces.mjs` · `release/accueil-gate.mjs`

## [`readme-gate.test.mjs`](readme-gate.test.mjs)

La confrontation des README publiés, éprouvée SANS npm ni réseau.

- **Lancé par** : `npm run test:release`
- **Utilise** : `release/readme-gate.mjs`

## [`release-core.mjs`](release-core.mjs)

release-core.mjs — le RAISONNEMENT d'une release, sans aucune entrée/sortie.

- **Usage** : `import { validerVersion, comparerVersions, SEMVER } from "./release-core.mjs"`
- **Variable** `LONGUEUR_MIN_DESCRIPTION`
- **Appelé par** : `release/attendre-ci.mjs` · `release/pack-all.mjs` · `release/release.mjs`
- **Testé par** : `release/release-core.test.mjs`

## [`release-core.test.mjs`](release-core.test.mjs)

Suite du cœur de release — écrite pour FAIRE ÉCHOUER le script, pas pour l'accompagner.

- **Variable** `BON`
- **Lancé par** : `npm run test:release`
- **Utilise** : `release/release-core.mjs` · `release/release.mjs`

## [`release.mjs`](release.mjs)

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
- **Utilise** : `lib/workspaces.mjs` · `gates/size-check.mjs` · `generate/generate-man.mjs` · `release/accueil-gate.mjs` · `release/api-diff-core.mjs` · `release/api-diff.mjs` · `release/attendre-ci.mjs` · `release/pack-all.mjs` · `release/readme-gate.mjs` · `release/release-core.mjs`

## [`smoke-docker.sh`](smoke-docker.sh)

Smoke test release (modèle B) + preuve Dockerfile/graceful shutdown/frontend.

- **Usage** : `npm run release:smoke -- [--scenario all|base|front|studio|edge|sql|cluster|global|pm]`
- **Variable** `IMAGE`
- **Variable** `MOTEUR`
- **Variable** `QAPP_NAME`
- **Variable** `REDIS_PORT`
- **Variable** `SERVICE`
- **Appelé par** : `npm run release:smoke` · `release-preflight.yml`
- **Utilise** : `release/image-gate.mjs` · `release/pack-all.mjs`

## [`tarball-types.test.mjs`](tarball-types.test.mjs)

Les types d'un paquet du cœur se résolvent-ils DEPUIS SON TARBALL ?

- **Lancé par** : `npm run test:release`

## [`types-rigor.mjs`](types-rigor.mjs)

Mesure la rigueur des TYPES PUBLIÉS : densité de `any`, rapport `unknown`/`any`, part des déclarations qui contiennent un `any` — pour le `dist` local, et pour tout paquet npm donné en comparaison.

- **Usage** : `npm run release:types-rigor`
- **Usage** : `node scripts/release/types-rigor.mjs [--from <version>] [--peers <liste>]`
- **Appelé par** : `npm run release:types-rigor`
- **Utilise** : `lib/workspaces.mjs` · `release/api-diff-core.mjs` · `release/api-diff.mjs`
