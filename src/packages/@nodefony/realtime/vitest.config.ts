import { defineConfig, configDefaults } from "vitest/config";
import { oxcDecorators } from "../../../../vitest.oxc.ts";
import { gateReporter, REDIS_GATE } from "../../../../vitest.gates.ts";
import { transformCache } from "../../../../vitest.perf.ts";

/**
 * vitest + coverage-v8 pour @nodefony/realtime.
 *
 * Standard coverage du repo. Tests = `node:assert` + describe/it en **globals**.
 *
 * **`gateReporter` est ce qui rend ce module honnête.** Une bonne part de ce qui
 * compte ici ne s'exerce QUE contre un vrai Redis (fan-out cross-pod, cloisonnement
 * par namespace, injection depuis le bus) ou derrière un interrupteur de coût
 * (`NF_RUN_PERF`). Ces suites s'auto-skippent quand le décor manque
 * — et un skip compte comme un succès : la suite affichait « tout vert » sans avoir
 * touché une ligne de backplane. Le reporter nomme la cible non exercée, donne la
 * commande pour l'ouvrir, et FAIT ÉCHOUER la passe en intégration continue.
 *
 * Les `proof` nomment chaque banc qui doit avoir tourné, un par un. Elles ne
 * doublent pas les variables : un Redis joignable ne prouve pas qu'on lui a
 * parlé. Cette liste était écrite dans `orm.yml` sous forme de `jq` ; elle a sa
 * place ici, où elle protège AUSSI qui lance la suite à la main.
 *
 * **Ce lot ne porte PAS les bancs qui forkent de vrais process** : `clusterIpc.e2e`
 * et `redisCluster.e2e` vivent dans `vitest.cluster.config.ts`, avec leur propre
 * gate `NF_RUN_CLUSTER_E2E` — la raison est écrite là-bas.
 */
export default defineConfig({
  test: {
    ...transformCache,
    globals: true,
    reporters: [
      "default",
      gateReporter([
        {
          gate: REDIS_GATE,
          // Quatre bancs distincts parlent à un vrai Redis, et il faut les
          // compter tous les quatre : ne prouver que le premier avait fait
          // conclure « une seule preuve cross-pod » alors que six autres cas
          // tournaient déjà.
          proof: [
            "RedisBackplane — intégration",
            "F83 — injection tierce",
            "RedisBackplane — contre-pression",
            "RedisBackplane — reconnexion",
          ],
        },
      ]),
    ],
    include: [
      "nodefony/tests/unit/**/*.test.ts",
      "nodefony/tests/integration/**/*.test.ts",
    ],
    // Les deux bancs qui forkent de VRAIS process vivent dans leur propre lot
    // (`vitest.cluster.config.ts`, `npm run test:cluster`). Ici, ils tourneraient
    // au milieu d'une passe qui sature déjà les cœurs : le boot d'un worker
    // dépasse alors le budget d'attente du master, et le banc rend un rouge qui
    // parle de la machine, pas du code. Leur gate `NF_RUN_CLUSTER_E2E` a suivi
    // dans l'autre config — un gate se déclare là où sa cible peut s'exercer.
    exclude: [
      ...configDefaults.exclude,
      "nodefony/tests/integration/clusterIpc.e2e.test.ts",
      "nodefony/tests/integration/redisCluster.e2e.test.ts",
    ],
    // Marge confortable : plusieurs bancs enchaînent des attentes de 150 ms × N.
    testTimeout: 15000,
    coverage: {
      provider: "v8",
      include: ["index.ts", "nodefony/**/*.ts"],
      exclude: ["nodefony/interfaces/**", "**/*.d.ts", "**/dist/**"],
      reporter: ["text", "text-summary", "json-summary", "lcov"],
      reportsDirectory: ".coverage",
    },
  },
  oxc: oxcDecorators,
});
