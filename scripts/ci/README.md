<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs (`npm run skills:doc`) — seul le bloc « À savoir » s'écrit à la main, il est conservé. -->

# `scripts/ci/`

Ce que la forge lance ou éprouve sur elle-même.

## À savoir avant d'y toucher

<!-- À LA MAIN : début -->

_Rien de noté : ce qui se découvre en travaillant ici s'écrit dans ce bloc._

<!-- À LA MAIN : fin -->

Index de tout l'outillage : [`scripts/`](../README.md).

## [`actions-pinned.test.mjs`](actions-pinned.test.mjs)

Gate — toute action GitHub tierce est épinglée par SHA de commit.

- **Lancé par** : `node.js.yml` · `npm run test:tooling`

## [`no-cancel.test.mjs`](no-cancel.test.mjs)

Gate — aucun workflow du dépôt n'arrête de lui-même une exécution en cours.

- **Lancé par** : `node.js.yml` · `npm run test:tooling`

## [`run-watched.mjs`](run-watched.mjs)

Lance une commande de la forge et REND LA MAIN quand elle se termine — même si un descendant détaché garde sa sortie ouverte — en nommant ce descendant.

- **Usage** : `node scripts/ci/run-watched.mjs [--idle <s>] [--] <commande…>`
- **Appelé par** : `e2e-autonomes.yml` · `memory.yml` · `node.js.yml` · `scaffold.yml`
- **Testé par** : `ci/run-watched.test.mjs`

## [`run-watched.test.mjs`](run-watched.test.mjs)

Le lanceur de la forge rend la main quand la commande finit, même si un descendant détaché garde sa sortie ouverte — et il nomme ce descendant.

- **Lancé par** : `node.js.yml` · `npm run test:tooling`
- **Utilise** : `ci/run-watched.mjs`
