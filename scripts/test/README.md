<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs (`npm run skills:doc`) — seul le bloc « À savoir » s'écrit à la main, il est conservé. -->

# `scripts/test/`

Orchestration des suites de test et de la couverture.

## À savoir avant d'y toucher

<!-- À LA MAIN : début -->

_Rien de noté : ce qui se découvre en travaillant ici s'écrit dans ce bloc._

<!-- À LA MAIN : fin -->

Index de tout l'outillage : [`scripts/`](../README.md).

- [`lib/`](lib/README.md) — Helpers de l'orchestrateur de tests : verdicts sur les conteneurs d'infra, remise à zéro de MongoDB.
- [`vitest/`](vitest/README.md) — Socles partagés par TOUTES les configs vitest du dépôt — garde des dossiers temporaires, gates d'infrastructure, décorateurs oxc, cache de transformation — et la config des suites lancées depuis la racine. Importés par les configs, jamais lancés à la main.

## [`coverage-all.ts`](coverage-all.ts)

Rejoue la couverture de CHAQUE module qui en déclare une, avec le DÉCOR d'infra — et dit ce qu'elle n'a pas mesuré.

- **Usage** : `npm run coverage`
- **Usage** : `npm run coverage -- --only <module>`
- **Usage** : `npm run coverage -- --json`
- **Variable** `ONLY`
- **Variable** `OUT`
- **Appelé par** : `npm run coverage`
- **Utilise** : `lib/workspaces.mjs` · `test/lib/docker.ts` · `test/vitest/gates.ts`

## [`realtime-coverage-map.mjs`](realtime-coverage-map.mjs)

Carte de couverture du temps réel — quel étage de test EXERCE quel fichier source.

- **Usage** : `node scripts/test/realtime-coverage-map.mjs [--json]`
- **Appelé par** : aucun automate

## [`test-all.ts`](test-all.ts)

`npm run test:all` — lance **toute** la batterie de tests du monorepo, et rend une image de ce qui a réellement été exercé.

- **Usage** : `npm run test:all`
- **Usage** : `npm run test:all -- --infra`
- **Usage** : `npm run test:all -- --load --dialects --mongo`
- **Variable** `NF_DATABASE_URL`
- **Variable** `NF_MYSQL_URL`
- **Variable** `NF_RUN_CLUSTER_E2E`
- **Appelé par** : `npm run test:all`
- **Utilise** : `lib/repo-root.mjs` · `test/lib/docker.ts` · `test/lib/mongoReset.ts` · `repo/long-run-lock.mjs`
