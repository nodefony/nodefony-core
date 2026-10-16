import { defineConfig } from "vitest/config";
import { gateReporter } from "../../../../scripts/test/vitest/gates.ts";
import { transformCache } from "../../../../scripts/test/vitest/perf.ts";
import { tmpGuard } from "../../../../scripts/test/vitest/tmp-guard.ts";

/**
 * Intégration — la porte MCP de développement sur un SERVEUR RÉEL (`npm run test:integration`,
 * lancée par le job CI qui démarre le serveur). Séparée de `npm test`, qui
 * tourne SANS serveur : rangée là, la suite se sautait en silence.
 *
 * Le rapporteur exige que les preuves ci-dessous aient PASSÉ : en CI, une suite
 * sautée faute de serveur est un échec, pas un vert.
 */
export default defineConfig({
  test: {
    globalSetup: tmpGuard(),
    ...transformCache,
    reporters: [
      "default",
      gateReporter([
        {
          label: "porte MCP de développement sur serveur réel",
          proof: [
            "publie les outils INTÉGRÉS à l'URL du contrat public",
            "la progression traverse le flux SSE jusqu'au client",
          ],
        },
      ]),
    ],
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
  oxc: {
    decorator: { legacy: true, emitDecoratorMetadata: true },
  },
});
