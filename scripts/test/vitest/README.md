<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs (`npm run skills:doc`) — seul le bloc « À savoir » s'écrit à la main, il est conservé. -->

# `scripts/test/vitest/`

Socles partagés par TOUTES les configs vitest du dépôt — garde des dossiers temporaires, gates d'infrastructure, décorateurs oxc, cache de transformation — et la config des suites lancées depuis la racine. Importés par les configs, jamais lancés à la main.

## À savoir avant d'y toucher

<!-- À LA MAIN : début -->

**Comment les fichiers s'articulent.** Chaque `vitest*.config.ts` d'un paquet importe ces socles par un chemin relatif (`../../../../scripts/test/vitest/…`) : `tmp-guard.ts` dans `globalSetup`, `perf.ts` étalé dans `test`, `oxc.ts` à côté de `test` quand le paquet a des décorateurs, `gates.ts` dans `reporters` quand une suite touche un serveur réel. `vitest.tooling.config.ts` fait la même chose pour les sept scripts `test:*` lancés depuis la racine, qui la reçoivent par `--config`.

**Ce qui casse sans bruit — à savoir avant de modifier :**

- **La garde ne s'active que si une config la DÉCLARE** (`globalSetup: tmpGuard()`). `scripts/gates/vitest-tmp-guard.test.mjs` le vérifie pour chaque fichier suivi qui s'appelle `vitest*.config.*` : une config nommée autrement (`tooling.config.ts`) sort du contrôle sans que rien ne le signale.
- **vitest exécute les teardowns de `globalSetup` à REBOURS.** Un setup propre au paquet se passe en ARGUMENT (`tmpGuard(r("./autre.ts"))`), jamais à côté : `tmpGuard` se place en tête pour être nettoyé en DERNIER. Un setup placé après elle serait retiré avant son contrôle.
- **`vitest.tooling.config.ts` ne doit jamais devenir `vitest.config.ts`** : un nom par défaut serait chargé en silence par toute commande vitest lancée à la racine, et par l'extension de l'éditeur.
- **`gates.ts` lit `docker/docker-compose.yml` et le realm Keycloak depuis la racine du dépôt** (`REPO_ROOT`, calculé depuis l'emplacement du fichier). Ses lectures sont dans des `catch` volontairement muets (paquet publié, checkout partiel) : **déplacer le fichier sans corriger `REPO_ROOT` ne fait rien échouer** — les valeurs retombent sur leurs défauts.
- **`gates.ts` est la source UNIQUE des variables d'infra `NF_*`.** Trois lecteurs en dépendent : `src/nodefony/src/tests/ciGateVars.test.ts` (les workflows et `gates.ts` doivent dire la même chose), `scripts/generate/env-snapshot.ts` (génère `.ai/ENV.md`) et les filtres `paths` de `.github/workflows/orm.yml` (le workflow ORM se relance quand `gates.ts` change).
- **`perf.ts` ne change que la vitesse.** `src/nodefony/src/tests/vitestPerfPreset.test.ts` exige que chaque config de paquet l'étale ; les deux bancs de charge en sont exclus nommément (décor constant entre deux mesures).
- **`oxc.ts` est obligatoire dès qu'un test transforme des décorateurs** : oxc ne lit pas le `experimentalDecorators` du tsconfig, et sans lui Node lève `SyntaxError` au chargement du test.
- **Tout fichier de ce dossier invalide le cache de TOUTES les suites** : `turbo.json` le déclare dans `globalDependencies` (`scripts/test/vitest/**`).
- **Déplacer ou renommer un fichier d'ici** : réécrire les imports relatifs des configs, les filtres de `orm.yml`, puis relancer `npm run typecheck:tools`, `npm run skills:check` et `npm run doc:anchors`.

<!-- À LA MAIN : fin -->

Index de tout l'outillage : [`scripts/`](../../README.md).

## [`gates.ts`](gates.ts)

**Gates d'infrastructure des suites de test — source unique du monorepo.**

- **Usage** : `reporters: ["default", gateReporter([PG_GATE])]  // config vitest d’une suite qui touche un serveur réel`
- **Variable** `COMPOSE`
- **Variable** `COMPOSE_FILE`
- **Variable** `NF_GATES_ALLOW`
- **Variable** `NF_GATES_EXPECT`
- **Variable** `POSTGRES_PORT`
- **Appelé par** : `orm.yml` · `src/nodefony/vitest.config.ts` · `src/packages/@nodefony/drizzle/vitest.config.ts` · `src/packages/@nodefony/http/vitest.integration.config.ts` · `src/packages/@nodefony/http/vitest.load.config.ts` · `src/packages/@nodefony/mongoose/vitest.config.ts` · `src/packages/@nodefony/realtime/vitest.cluster.config.ts` · `src/packages/@nodefony/realtime/vitest.config.ts` · `src/packages/@nodefony/redis/vitest.config.ts` · `generate/env-snapshot.ts` · `test/coverage-all.ts`
- **Testé par** : `src/nodefony/src/tests/ciGateVars.test.ts` · `src/packages/@nodefony/realtime/nodefony/tests/integration/RedisBackplane.test.ts` · `src/packages/@nodefony/realtime/nodefony/tests/integration/redisCluster.e2e.test.ts`

## [`oxc.ts`](oxc.ts)

Options oxc partagées par les `vitest.config.ts` des workspaces.

- **Usage** : `oxc: oxcDecorators,              // à côté de test: { … } dans une config vitest`
- **Appelé par** : `src/modules/test/vitest.config.ts` · `src/nodefony/vitest.config.ts` · `src/packages/@nodefony/drizzle/vitest.config.load.ts` · `src/packages/@nodefony/drizzle/vitest.config.ts` · `src/packages/@nodefony/framework/vitest.config.ts` · `src/packages/@nodefony/framework/vitest.integration.config.ts` · `src/packages/@nodefony/mongoose/vitest.config.ts` · `src/packages/@nodefony/orm-core/vitest.config.ts` · `src/packages/@nodefony/realtime/vitest.cluster.config.ts` · `src/packages/@nodefony/realtime/vitest.config.ts`

## [`perf.ts`](perf.ts)

**Options Vitest qui ne changent que la VITESSE — jamais ce qui est exercé.**

- **Usage** : `test: { ...transformCache, … }   // dans une config vitest`
- **Appelé par** : `src/modules/mediasoup/vitest.config.ts` · `src/modules/test/vitest.config.ts` · `src/nodefony/vitest.config.ts` · `src/packages/@nodefony/devkit/vitest.config.ts` · `src/packages/@nodefony/documentation/vitest.config.ts` · `src/packages/@nodefony/drizzle/vitest.config.ts` · `src/packages/@nodefony/framework/vitest.config.ts` · `src/packages/@nodefony/framework/vitest.integration.config.ts` · `src/packages/@nodefony/frontend/vitest.config.ts` · `src/packages/@nodefony/frontend/vitest.integration.config.ts` · `src/packages/@nodefony/http/vitest.config.ts` · `src/packages/@nodefony/http/vitest.decors.config.ts` · `src/packages/@nodefony/http/vitest.integration.config.ts` · `src/packages/@nodefony/llm/vitest.config.ts` · `src/packages/@nodefony/mongoose/vitest.config.ts` · `src/packages/@nodefony/orm-core/vitest.config.ts` · `src/packages/@nodefony/realtime/vitest.cluster.config.ts` · `src/packages/@nodefony/realtime/vitest.config.ts` · `src/packages/@nodefony/redis/vitest.config.ts` · `src/packages/@nodefony/security/vitest.config.ts` · `src/packages/@nodefony/studio/vitest.config.ts` · `src/packages/@nodefony/user/vitest.config.ts`
- **Testé par** : `src/nodefony/src/tests/vitestPerfPreset.test.ts`

## [`tmp-guard.ts`](tmp-guard.ts)

Garde des dossiers temporaires d'une passe vitest — le jetable d'un test, le test lui-même le supprime (CLAUDE.md, « le système de fichiers n'est pas un fourre-tout »).

- **Usage** : `globalSetup: tmpGuard()                 // dans test: { … } d'une config vitest`
- **Usage** : `globalSetup: tmpGuard(r("./autre.ts"))  // avec un globalSetup propre au paquet`
- **Appelé par** : `src/modules/mediasoup/vitest.config.ts` · `src/modules/test/vitest.config.ts` · `src/nodefony/vitest.config.ts` · `src/packages/@nodefony/devkit/vitest.config.ts` · `src/packages/@nodefony/documentation/vitest.config.ts` · `src/packages/@nodefony/drizzle/vitest.config.ts` · `src/packages/@nodefony/framework/vitest.config.ts` · `src/packages/@nodefony/framework/vitest.integration.config.ts` · `src/packages/@nodefony/frontend/vitest.config.ts` · `src/packages/@nodefony/frontend/vitest.integration.config.ts` · `src/packages/@nodefony/http/vitest.config.ts` · `src/packages/@nodefony/http/vitest.decors.config.ts` · `src/packages/@nodefony/http/vitest.integration.config.ts` · `src/packages/@nodefony/http/vitest.load.config.ts` · `src/packages/@nodefony/llm/vitest.config.ts` · `src/packages/@nodefony/mongoose/vitest.config.ts` · `src/packages/@nodefony/orm-core/vitest.config.ts` · `src/packages/@nodefony/realtime/vitest.cluster.config.ts` · `src/packages/@nodefony/realtime/vitest.config.ts` · `src/packages/@nodefony/redis/vitest.config.ts` · `src/packages/@nodefony/security/vitest.config.ts` · `src/packages/@nodefony/studio/vitest.config.ts` · `src/packages/@nodefony/user/vitest.config.ts` · `test/vitest/vitest.tooling.config.ts`

## [`vitest.tooling.config.ts`](vitest.tooling.config.ts)

Config des suites lancées depuis la RACINE (`test:tooling`, `test:release`, `test:pilotage`…) : les réglages par défaut de vitest, plus la garde des dossiers temporaires — rien d'autre.

- **Usage** : `npm run test:tooling             // et les six autres scripts test:* lancés depuis la racine`
- **Appelé par** : `npm run test:externals` · `npm run test:deps-gate` · `npm run test:site-plan` · `npm run test:dev-credentials` · `npm run test:tooling` · `npm run test:pilotage` · `npm run test:release`
- **Utilise** : `test/vitest/tmp-guard.ts`
