<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs (`npm run skills:doc`) — seul le bloc « À savoir » s'écrit à la main, il est conservé. -->

# `scripts/deps/`

Inventaire et garde des dépendances, gabarits compris.

## À savoir avant d'y toucher

<!-- À LA MAIN : début -->

_Rien de noté : ce qui se découvre en travaillant ici s'écrit dans ce bloc._

<!-- À LA MAIN : fin -->

Index de tout l'outillage : [`scripts/`](../README.md).

- [`lib/`](lib/README.md) — Helpers propres à l'inventaire des dépendances.

## [`check-deps-latest.mjs`](check-deps-latest.mjs)

Inventaire EXHAUSTIF des dépendances en retard — remplaçant de `npm outdated`.

- **Usage** : `npm run deps:check`
- **Usage** : `npm run deps:gate`
- **Variable** `CATALOGUE_SCAFFOLD`
- **Variable** `NF_DEPS_REGISTRY`
- **Variable** `NF_DEPS_ROOT`
- **Variable** `REGISTRY`
- **Appelé par** : `npm run deps:check` · `npm run deps:gate` · `node.js.yml`
- **Testé par** : `deps/deps-gate.test.mjs`
- **Utilise** : `lib/repo-root.mjs` · `deps/lib/reconcile-versions.mjs`

## [`deps-gate.test.mjs`](deps-gate.test.mjs)

Suite de bout en bout de la garde des dépendances — écrite pour la faire ÉCHOUER, jamais pour l'accompagner.

- **Lancé par** : `npm run test:deps-gate` · `npm run test:tooling`
- **Utilise** : `deps/check-deps-latest.mjs`

## [`reconcile-versions.test.mjs`](reconcile-versions.test.mjs)

Suite de la réconciliation de versions — écrite pour faire ÉCHOUER la garde, pas pour l'accompagner.

- **Lancé par** : `npm run test:deps-gate` · `npm run test:tooling`
- **Utilise** : `deps/lib/reconcile-versions.mjs`
