<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs (`npm run skills:doc`) — seul le bloc « À savoir » s'écrit à la main, il est conservé. -->

# `scripts/deps/lib/`

Helpers propres à l'inventaire des dépendances.

## À savoir avant d'y toucher

<!-- À LA MAIN : début -->

_Rien de noté : ce qui se découvre en travaillant ici s'écrit dans ce bloc._

<!-- À LA MAIN : fin -->

Index de tout l'outillage : [`scripts/`](../../README.md).

## [`deprecations.mjs`](deprecations.mjs)

Dépendances DÉCLARÉES dont la version au verrou est dépréciée en amont.

- **Usage** : `import { deprecatedInstalled, deprecatedVersionsOf } from "./lib/deprecations.mjs"`
- **Appelé par** : `deps/check-deps-latest.mjs`
- **Testé par** : `deps/deprecations.test.mjs`

## [`overrides.mjs`](overrides.mjs)

Lecture des `overrides` npm de la racine : une dépendance qu'un tiers déclare est-elle FORCÉE par nous ?

- **Usage** : `import { forcedByOverride } from "./lib/overrides.mjs"`
- **Appelé par** : `deps/check-deps-latest.mjs`
- **Testé par** : `deps/overrides.test.mjs`

## [`reconcile-versions.mjs`](reconcile-versions.mjs)

La question qui décide d'une divergence de version : **existe-t-il UNE version qui satisfait toutes les spécifications relevées ?**

- **Usage** : `import { reconcilie, dedouble } from "./lib/reconcile-versions.mjs"`
- **Appelé par** : `deps/check-deps-latest.mjs`
- **Testé par** : `deps/reconcile-versions.test.mjs`
