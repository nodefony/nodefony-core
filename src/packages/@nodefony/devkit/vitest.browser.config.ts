import { defineConfig } from "vitest/config";
import { gateReporter } from "../../../../scripts/test/vitest/gates.ts";
import { transformCache } from "../../../../scripts/test/vitest/perf.ts";
import { tmpGuard } from "../../../../scripts/test/vitest/tmp-guard.ts";

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
    reporters: [
      "default",
      gateReporter([
        {
          label: "navigateur réel (conteneur nodefony-browser)",
          proof: [
            "toutes les familles sur la page protégée",
            "le scénario complet : accueil, canal, latence, api, reconnexion",
          ],
        },
      ]),
    ],
    include: ["tests/browser-fonctionnel.test.ts"],
    fileParallelism: false,
    testTimeout: 180_000,
  },
  oxc: {
    decorator: { legacy: true, emitDecoratorMetadata: true },
  },
});
