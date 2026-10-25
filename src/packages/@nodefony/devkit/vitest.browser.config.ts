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
    label: "navigateur réel (conteneur nodefony-browser)",
    proof: [
      "toutes les familles sur la page protégée",
      "le scénario complet : accueil, canal, latence, api, reconnexion",
    ],
  },
];

/**
 * Les sondes navigateur sur un VRAI navigateur — le conteneur `nodefony-browser`
 * (compose `--profile browser`) devant le serveur de développement lancé avec
 * `NF_BIND_ALL=1`. Décor à part, joué par l'entrée `browser` du job CI « Décor ».
 *
 * Sorti de `vitest.config.ts` (`npm test`, sans serveur ni conteneur) : il s'y
 * sautait en silence. Ici le rapporteur EXIGE qu'il ait tourné — en CI, un décor
 * absent est un échec, pas un vert.
 */
export default defineConfig({
  test: {
    globalSetup: tmpGuard(),
    ...transformCache,
    reporters: ["default", gateReporter(expectations)],
    include: ["tests/browser-fonctionnel.test.ts"],
    fileParallelism: false,
    testTimeout: 180_000,
  },
  oxc: {
    decorator: { legacy: true, emitDecoratorMetadata: false },
  },
});
