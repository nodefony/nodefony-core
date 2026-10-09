<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs (`npm run skills:doc`) — seul le bloc « À savoir » s'écrit à la main, il est conservé. -->

# `scripts/gates/`

Gardes de commit et de forge : chacune refuse un état précis du dépôt.

## À savoir avant d'y toucher

<!-- À LA MAIN : début -->

_Rien de noté : ce qui se découvre en travaillant ici s'écrit dans ce bloc._

<!-- À LA MAIN : fin -->

Index de tout l'outillage : [`scripts/`](../README.md).

## [`check-externals.mjs`](check-externals.mjs)

Audit de la dérive `external` ⇄ manifeste, sur TOUT le dépôt — core, packages ET modules.

- **Usage** : `npm run externals:check`
- **Usage** : `node scripts/gates/check-externals.mjs --json`
- **Appelé par** : `npm run externals:check`
- **Testé par** : `gates/check-externals.test.mjs`

## [`check-externals.test.mjs`](check-externals.test.mjs)

Suite de l'audit `external` — écrite pour le faire ÉCHOUER, pas pour l'accompagner.

- **Lancé par** : `npm run test:externals` · `npm run test:tooling`
- **Utilise** : `gates/check-externals.mjs`

## [`check-licenses.mjs`](check-licenses.mjs)

check-licenses — DÉLÈGUE à la commande du produit, et ne décide plus rien.

- **Usage** : `node scripts/gates/check-licenses.mjs [--json] [--cwd <dir>]`
- **Produit** : celle de `nodefony licenses`, verbatim, avec son code de sortie
- **Appelé par** : `npm run check:licenses`
- **Utilise** : `lib/repo-root.mjs`

## [`check-no-nul-bytes.mjs`](check-no-nul-bytes.mjs)

check-no-nul-bytes — un octet NUL dans une source la rend INVISIBLE aux outils.

- **Usage** : `node scripts/gates/check-no-nul-bytes.mjs           # tous les fichiers SUIVIS`
- **Usage** : `node scripts/gates/check-no-nul-bytes.mjs --staged  # ceux de l'index (pre-commit)`
- **Produit** : la liste des fichiers fautifs avec la ligne du premier octet ; sortie 1 si un seul l'est
- **Appelé par** : `npm run check:nul` · `.githooks/pre-commit`

## [`check-package-deps.mjs`](check-package-deps.mjs)

Garde de pré-commit — surface des paquets du dépôt du framework.

- **Usage** : `node scripts/gates/check-package-deps.mjs`
- **Appelé par** : `.githooks/pre-commit`
- **Utilise** : `lib/repo-root.mjs`

## [`check-platform-channels.mjs`](check-platform-channels.mjs)

Gate — aucun nom de canal/méthode de plateforme écrit EN DUR dans le code.

- **Usage** : `node scripts/gates/check-platform-channels.mjs`
- **Variable** `TABLE`
- **Appelé par** : `.githooks/pre-commit`

## [`check-portable-filenames.mjs`](check-portable-filenames.mjs)

check-portable-filenames — un nom de fichier que Windows REFUSE ne doit pas entrer.

- **Usage** : `node scripts/gates/check-portable-filenames.mjs           # tous les fichiers SUIVIS`
- **Usage** : `node scripts/gates/check-portable-filenames.mjs --staged  # ceux de l'index (pre-commit)`
- **Produit** : la liste des noms refusés, avec la raison exacte ; sortie 1 si un seul l'est
- **Appelé par** : `npm run check:filenames` · `.githooks/pre-commit`

## [`check-script-descriptions.mjs`](check-script-descriptions.mjs)

check-script-descriptions — chaque script `npm` dit ce qu'il fait.

- **Usage** : `node scripts/gates/check-script-descriptions.mjs`
- **Usage** : `node scripts/gates/check-script-descriptions.mjs <autre/package.json> [...]`
- **Produit** : la liste des manquants et des orphelines ; sortie 1 si l'une existe
- **Appelé par** : `npm run check:scripts`

## [`check-type-assertions.mjs`](check-type-assertions.mjs)

check-type-assertions — PROVISOIRE : le total des conversions de type qui RESSERRENT un type (`x as T` plus étroit que `x`, donc `as unknown as T`) ne monte pas, paquet par paquet, d'ici à leur correction.

- **Usage** : `node scripts/gates/check-type-assertions.mjs            # contrôle`
- **Usage** : `node scripts/gates/check-type-assertions.mjs --update   # abaisse les plafonds (jamais ne les monte)`
- **Usage** : `node scripts/gates/check-type-assertions.mjs --triage   # relevé : d'où vient chaque valeur convertie (#572)`
- **Variable** `RULE`
- **Produit** : l'écart par paquet ; sortie 0 tenu · 1 refusé · 78 oxlint n'a pas répondu
- **Appelé par** : `node.js.yml` · `.githooks/pre-commit`

## [`dev-credentials.test.mjs`](dev-credentials.test.mjs)

Gate — UN SEUL mot de passe de développement, et tout ce qui l'annonce dit vrai.

- **Lancé par** : `npm run test:dev-credentials` · `npm run test:tooling`
- **Utilise** : `lib/repo-root.mjs`

## [`size-check.mjs`](size-check.mjs)

Gate de budget bundle des subpaths client (ADR-0007 D10).

- **Usage** : `npm run size:check`
- **Usage** : `npm run size:check -- --json`
- **Appelé par** : `npm run size:check` · `release/release.mjs`
- **Utilise** : `lib/repo-root.mjs`

## [`vitest-tmp-guard.test.mjs`](vitest-tmp-guard.test.mjs)

Toute configuration vitest du dépôt pose la garde des dossiers temporaires (scripts/test/vitest/tmp-guard.ts). Une config qui l'oublie rouvre la fuite qu'elle ferme : 28 454 entrées et 42 Go laissés dans le dossier temporaire du système avant elle — et un oubli ne se verrait pas, puisqu'une passe sans garde est verte.

- **Lancé par** : `npm run test:tooling`
- **Utilise** : `lib/repo-root.mjs`
