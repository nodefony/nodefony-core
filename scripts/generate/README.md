<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs (`npm run skills:doc`) — seul le bloc « À savoir » s'écrit à la main, il est conservé. -->

# `scripts/generate/`

Génération d'artefacts : graphe symbolique, page de manuel, catalogue d'environnement, logo.

## À savoir avant d'y toucher

<!-- À LA MAIN : début -->

_Rien de noté : ce qui se découvre en travaillant ici s'écrit dans ce bloc._

<!-- À LA MAIN : fin -->

Index de tout l'outillage : [`scripts/`](../README.md).

## [`brand-assets.mjs`](brand-assets.mjs)

brand-assets.mjs — dérive le PNG et le favicon du logo depuis sa source SVG.

- **Usage** : `node scripts/generate/brand-assets.mjs`
- **Variable** `SVG`
- **Appelé par** : aucun automate
- **Utilise** : `lib/repo-root.mjs`

## [`env-catalog.ts`](env-catalog.ts)

Ce que les variables de DÉCOR DE BANC font — la seule part qu'aucun automate ne sait rendre.

- **Usage** : `import { BENCH_DECOR, type IEnvDeclaration } from "./env-catalog"`
- **Appelé par** : `generate/env-snapshot.ts`

## [`env-snapshot.ts`](env-snapshot.ts)

Catalogue des variables d'environnement — projection DÉRIVÉE, jamais saisie.

- **Usage** : `npm run env:snapshot`
- **Usage** : `tsx scripts/generate/env-snapshot.ts --check`
- **Variable** `NF_X`
- **Appelé par** : `npm run env:snapshot` · `.githooks/pre-commit`
- **Utilise** : `lib/repo-root.mjs` · `test/vitest/gates.ts` · `generate/env-catalog.ts`

## [`generate-man.mjs`](generate-man.mjs)

Écrit `src/nodefony/man/nodefony.1` depuis le CLI RÉEL.

- **Usage** : `node scripts/generate/generate-man.mjs`
- **Usage** : `node scripts/generate/generate-man.mjs --check`
- **Appelé par** : `release/release.mjs`
- **Testé par** : `src/nodefony/src/tests/manPage.test.ts`
- **Utilise** : `lib/repo-root.mjs`

## [`generate-password-blocklist.mjs`](generate-password-blocklist.mjs)

Fige la liste des mots de passe les plus courants en artefact VERSIONNÉ.

- **Usage** : `node scripts/generate/generate-password-blocklist.mjs <fichier-source> [...autres]`
- **Appelé par** : aucun automate
- **Testé par** : `src/packages/@nodefony/user/tests/unit/passwordPolicy.test.ts`

## [`generate-symbols.config.ts`](generate-symbols.config.ts)

Configuration for scripts/generate/generate-symbols.ts

- **Usage** : `import config from "./generate-symbols.config.ts"`
- **Appelé par** : `generate/generate-symbols.ts`

## [`generate-symbols.ts`](generate-symbols.ts)

generate-symbols.ts — Symbol graph extractor for AI agents.

- **Usage** : `npm run generate-symbols`
- **Option** `--verbose` — détail ligne par ligne des homonymes
- **Option** `--check-staged` — code 1 si un fichier indexé touche la zone parsée
- **Option** `--check-range` — <de> <à>  code 1 si la zone a bougé entre deux révisions, ou si le graphe manque
- **Appelé par** : `npm run generate-symbols` · `node.js.yml`
- **Utilise** : `lib/repo-root.mjs` · `lib/symbols-publish.mjs` · `generate/generate-symbols.config.ts`
