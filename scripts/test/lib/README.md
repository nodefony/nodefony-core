<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs (`npm run skills:doc`) — seul le bloc « À savoir » s'écrit à la main, il est conservé. -->

# `scripts/test/lib/`

Helpers de l'orchestrateur de tests : verdicts sur les conteneurs d'infra, remise à zéro de MongoDB.

## À savoir avant d'y toucher

<!-- À LA MAIN : début -->

_Rien de noté : ce qui se découvre en travaillant ici s'écrit dans ce bloc._

<!-- À LA MAIN : fin -->

Index de tout l'outillage : [`scripts/`](../../README.md).

## [`docker.ts`](docker.ts)

Verdicts sur les conteneurs d'infra du dépôt — sans le moindre effet de bord.

- **Usage** : `import { containerHealthy } from "./lib/docker.ts"`
- **Appelé par** : `test/coverage-all.ts` · `test/test-all.ts`

## [`mongoReset.ts`](mongoReset.ts)

Remise à zéro de la base d'un banc MongoDB — le décor repart VIERGE.

- **Usage** : `import { resetMongoDatabase } from "./lib/mongoReset.ts"`
- **Appelé par** : `test/test-all.ts`
