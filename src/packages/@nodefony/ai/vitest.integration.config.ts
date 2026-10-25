import { defineConfig } from "vitest/config";
import {
  gateReporter,
  type GateExpectations,
} from "../../../../scripts/test/vitest/gates.ts";
import { transformCache } from "../../../../scripts/test/vitest/perf.ts";
import { tmpGuard } from "../../../../scripts/test/vitest/tmp-guard.ts";

/**
 * Décors que cette passe exige — lus aussi par l'onglet Décors de la console
 * (`scripts/test/lib/testbed.ts`), pour dire quelle suite chaque décor débloque.
 */
export const expectations: GateExpectations = [
  {
    label: "porte MCP d'application sur serveur réel",
    proof: [
      "ne sert QUE ses outils",
      "la progression traverse le flux SSE d'une porte d'application",
    ],
  },
  {
    label: "porte MCP d'application protégée — identité de l'appelant",
    proof: ["sous jeton, la porte établit l'appelant"],
  },
  {
    label: "porte stdio — `nodefony ai:stdio` lancée pour de vrai",
    proof: [
      "sert la porte stdio : outils listés, appel, -32700, notification muette, code 0",
      "se connecte, liste, appelle, et annule un outil long",
    ],
  },
];

/**
 * Intégration — la mécanique MCP sur un SERVEUR RÉEL (`npm run test:integration`,
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
    reporters: ["default", gateReporter(expectations)],
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
  oxc: {
    decorator: { legacy: true, emitDecoratorMetadata: false },
  },
});
