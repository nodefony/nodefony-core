<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs (`npm run skills:doc`) — seul le bloc « À savoir » s'écrit à la main, il est conservé. -->

# `scripts/deps/`

Inventaire et garde des dépendances, gabarits compris.

## À savoir avant d'y toucher

<!-- À LA MAIN : début -->

_Rien de noté : ce qui se découvre en travaillant ici s'écrit dans ce bloc._

<!-- À LA MAIN : fin -->

Index de tout l'outillage : [`scripts/`](../README.md).

- [`lib/`](lib/README.md) — Helpers propres à l'inventaire des dépendances.

## [`audit-gate.mjs`](audit-gate.mjs)

Garde d'audit de la forge : échoue sur toute vulnérabilité de gravité haute ou critique, sauf un avis inscrit dans `ACCEPTED_ADVISORIES` tant qu'aucune version corrigée n'est publiée.

- **Usage** : `node scripts/deps/audit-gate.mjs`
- **Variable** `GITHUB_STEP_SUMMARY`
- **Appelé par** : `node.js.yml`
- **Utilise** : `deps/lib/audit.mjs`

## [`audit.test.mjs`](audit.test.mjs)

`advisoriesOf` / `auditVerdicts` — la garde d'audit de la forge. Vécu : l'avis picomatch GHSA-fc5q-39xc-vjpf élargi à `<= 4.0.7`, dernière version publiée, a rougi la forge sans qu'aucun `overrides` puisse rien y faire. L'exception nommée le tolère tant qu'aucun correctif n'existe, et seulement jusque-là. /

- **Lancé par** : `npm run test:tooling`
- **Utilise** : `deps/lib/audit.mjs`

## [`check-deps-latest.mjs`](check-deps-latest.mjs)

Inventaire EXHAUSTIF des dépendances en retard — remplaçant de `npm outdated`.

- **Usage** : `npm run deps:check`
- **Usage** : `npm run deps:gate`
- **Option** `--strict` — + plages déjà satisfaites
- **Option** `--all` — + les pins déjà à jour (implique --strict)
- **Option** `--json` — sortie machine
- **Option** `--gate` — GARDE : code non nul si l'arbre se dédoublerait
- **Variable** `NF_DEPS_REGISTRY`
- **Variable** `NF_DEPS_ROOT`
- **Appelé par** : `npm run deps:check` · `npm run deps:gate` · `node.js.yml`
- **Testé par** : `deps/deps-gate.test.mjs`
- **Utilise** : `lib/repo-root.mjs` · `deps/lib/deprecations.mjs` · `deps/lib/engines.mjs` · `deps/lib/overrides.mjs` · `deps/lib/reconcile-versions.mjs`

## [`deprecations.test.mjs`](deprecations.test.mjs)

Constat des dépendances déclarées que l'amont a dépréciées — vécu : `@types/figlet@1.12.0`, paquet vide que rien ne signalait. /

- **Lancé par** : `npm run test:tooling`
- **Utilise** : `deps/lib/deprecations.mjs`

## [`deps-gate.test.mjs`](deps-gate.test.mjs)

Suite de bout en bout de la garde des dépendances — écrite pour la faire ÉCHOUER, jamais pour l'accompagner.

- **Lancé par** : `npm run test:deps-gate` · `npm run test:tooling`
- **Utilise** : `deps/check-deps-latest.mjs`

## [`engines.test.mjs`](engines.test.mjs)

Planchers Node des dépendances face au nôtre — vécu : `@inquirer/prompts` 8.8.0 exigeait `^24.15.0` sous un dépôt à `>=24.14.0`, sans que rien ne le dise. /

- **Lancé par** : `npm run test:tooling`
- **Utilise** : `deps/lib/engines.mjs`

## [`overrides.test.mjs`](overrides.test.mjs)

`forcedByOverride` — une dépendance qu'un tiers déclare est-elle forcée par les `overrides` de la racine ? Sans cette lecture, `deps:check` annonçait un dédoublement que le dépôt avait déjà rendu impossible (vite sous Angular). `overrideBreaches` — un override pousse-t-il un tiers hors de sa plage ? Vécu : rolldown 1.3 forcé sous vite (`~1.2.16`) rendait le bundle de Studio invalide ; `deps:gate` refuse désormais ce forçage sans motif inscrit. /

- **Lancé par** : `npm run test:tooling`
- **Utilise** : `deps/lib/overrides.mjs`

## [`reconcile-versions.test.mjs`](reconcile-versions.test.mjs)

Suite de la réconciliation de versions — écrite pour faire ÉCHOUER la garde, pas pour l'accompagner.

- **Lancé par** : `npm run test:deps-gate` · `npm run test:tooling`
- **Utilise** : `deps/lib/reconcile-versions.mjs`
