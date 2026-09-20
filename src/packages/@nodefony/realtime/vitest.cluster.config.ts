import { defineConfig } from "vitest/config";
import { oxcDecorators } from "../../../../vitest.oxc.ts";
import { gateReporter } from "../../../../vitest.gates.ts";
import { transformCache } from "../../../../vitest.perf.ts";

/**
 * Lot SÉPARÉ pour les deux bancs qui forkent de VRAIS process.
 *
 * `clusterIpc.e2e` et `redisCluster.e2e` montent une topologie multi-process
 * complète : chaque worker est un `fork()` qui charge `tsx`, puis tout le module
 * `nodefony`, avant d'annoncer `ready`. Le banc attend cette annonce sur un
 * budget de temps — et un budget de temps mesure la MACHINE dès que les cœurs
 * sont pris ailleurs.
 *
 * C'est exactement ce qui arrivait dans la passe par défaut : `turbo run test`
 * lance une trentaine de workspaces en parallèle, chacun avec ses propres
 * workers vitest ; le boot d'un worker forké y dépassait le budget, le master
 * abandonnait, et le worker écrivait ensuite dans un canal fermé — un `EPIPE`
 * qui remplaçait la vraie cause dans la sortie. Les deux bancs étaient rouges
 * SYSTÉMATIQUEMENT en passe complète et verts SYSTÉMATIQUEMENT seuls : ce n'est
 * pas un flake, c'est une incompatibilité de décor.
 *
 * Le remède est celui de la suite `load` de `@nodefony/http` : un lot à part,
 * qu'on lance quand la machine est à lui. **Ne PAS relever le budget d'attente**
 * — il ne ferait que déplacer le seuil sous lequel la machine gagne.
 *
 * Décor : `NF_RUN_CLUSTER_E2E=1` ouvre les deux, plus un Redis joignable pour le
 * second. Sans eux, les suites se sautent — et c'est `gateReporter` qui refuse
 * ce silence en intégration continue.
 *
 * ```bash
 * cd src/packages/@nodefony/realtime && npm run test:cluster
 * ```
 */
export default defineConfig({
  test: {
    ...transformCache,
    globals: true,
    reporters: [
      "default",
      gateReporter([
        {
          switch: "NF_RUN_CLUSTER_E2E",
          label: "Cluster e2e (IPC + Redis)",
          // Les deux topologies de la promesse centrale du framework : le
          // fan-out entre PROCESS (fork, sans infra) et entre PODS (Redis).
          proof: ["e2e cluster IPC", "e2e cluster Redis"],
          // `npm test` ne joue plus ces bancs : le mode d'emploi doit nommer le
          // lot, sinon il envoie chercher là où il n'y a rien.
          command: "npm run test:cluster",
        },
      ]),
    ],
    include: [
      "nodefony/tests/integration/clusterIpc.e2e.test.ts",
      "nodefony/tests/integration/redisCluster.e2e.test.ts",
    ],
    // Les deux fichiers forkent chacun jusqu'à trois process : les jouer
    // ensemble reproduirait, à l'échelle du lot, la contention qu'on vient
    // d'écarter à l'échelle du dépôt.
    fileParallelism: false,
    poolOptions: { forks: { singleFork: true } },
    // Même marge que la config par défaut : le boot d'un worker (tsx + import de
    // `nodefony`) tient largement dedans quand la machine n'est pas disputée.
    testTimeout: 15000,
  },
  oxc: oxcDecorators,
});
