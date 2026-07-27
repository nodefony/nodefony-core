import { defineConfig } from "vitest/config";
import { oxcDecorators } from "../../../../vitest.oxc";
import { gateReporter, REDIS_GATE } from "../../../../vitest.gates";

/**
 * vitest + coverage-v8 pour @nodefony/realtime.
 *
 * Standard coverage du repo. Tests = `node:assert` + describe/it en **globals**.
 *
 * **`gateReporter` est ce qui rend ce module honnête.** Une bonne part de ce qui
 * compte ici ne s'exerce QUE contre un vrai Redis (fan-out cross-pod, cloisonnement
 * par namespace, injection depuis le bus) ou derrière un interrupteur de coût
 * (`RUN_CLUSTER_E2E`, `RUN_PERF`). Ces suites s'auto-skippent quand le décor manque
 * — et un skip compte comme un succès : la suite affichait « tout vert » sans avoir
 * touché une ligne de backplane. Le reporter nomme la cible non exercée, donne la
 * commande pour l'ouvrir, et FAIT ÉCHOUER la passe en intégration continue.
 *
 * Les `proof` nomment chaque banc qui doit avoir tourné, un par un. Elles ne
 * doublent pas les variables : un Redis joignable ne prouve pas qu'on lui a
 * parlé. Cette liste était écrite dans `orm.yml` sous forme de `jq` ; elle a sa
 * place ici, où elle protège AUSSI qui lance la suite à la main.
 */
export default defineConfig({
  test: {
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
        {
          switch: "RUN_CLUSTER_E2E",
          label: "Cluster e2e (IPC + Redis)",
          // Les deux topologies de la promesse centrale du framework : le
          // fan-out entre PROCESS (fork, sans infra) et entre PODS (Redis).
          proof: ["e2e cluster IPC", "e2e cluster Redis"],
        },
      ]),
    ],
    include: [
      "nodefony/tests/unit/**/*.test.ts",
      "nodefony/tests/integration/**/*.test.ts",
    ],
    // Les tests e2e cluster IPC fork des process enfants via tsx + IPC : laisser
    // une marge confortable (defaut 5s trop court avec setTimeout 150ms × N).
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
