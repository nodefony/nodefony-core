import { defineConfig } from "vitest/config";
import {
  gateReporter,
  PROXY_GATE,
} from "../../../../scripts/test/vitest/gates.ts";
import { transformCache } from "../../../../scripts/test/vitest/perf.ts";
import { tmpGuard } from "../../../../scripts/test/vitest/tmp-guard.ts";

/**
 * Le serveur derrière de VRAIS reverse-proxy (nginx + haproxy) — un décor à
 * part, joué par l'entrée `proxy` du job CI « Décor » (compose `--profile proxy`,
 * serveur `NF_BIND_ALL=1`, `nodefony.com` dans /etc/hosts).
 *
 * Sorti de `vitest.integration.config.ts` : le job d'intégration ne lève aucun
 * proxy, et le banc s'y sautait en silence. Ici le rapporteur EXIGE qu'il ait
 * tourné — en CI, un décor absent est un échec, pas un vert.
 */
export default defineConfig({
  test: {
    globalSetup: tmpGuard(),
    ...transformCache,
    globals: true,
    reporters: [
      "default",
      gateReporter([
        {
          gate: PROXY_GATE,
          proof: [
            "l'IP forgée par le client est JETÉE",
            "une WebSocket franchit le proxy",
          ],
        },
      ]),
    ],
    include: ["nodefony/tests/integration/reverse-proxy.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
