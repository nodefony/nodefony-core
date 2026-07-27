import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";
import { gateReporter } from "../../../../vitest.gates";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Suite d'INTÉGRATION @nodefony/http (ex-`.mocharc.integration.json`).
 *
 * Tests serveur LIVE (127.0.0.1:5151/5152) : HTTP/HTTPS/HTTP2, routing, WS, décorateurs.
 * Prérequis : serveur dev UP (skill nodefony-start-server). Exclut la suite lourde
 * (`load/**` + `memory.test.ts`) → c'est la non-régression rapide.
 *
 * Séquentiel forcé (`fileParallelism:false` + `singleFork`) : tous les fichiers tapent
 * LE MÊME serveur — la parallélisation introduirait du bruit (sessions, ports, ordering).
 * Mocha tournait déjà en un seul process séquentiel : on préserve ce comportement.
 */
export default defineConfig({
  test: {
    globals: true,
    // Aucune cible d'infra n'est déclarée ici : cette suite parle à un serveur
    // local, pas à une base. Le rapporteur est présent pour l'autre usage —
    // `NF_GATES_EXPECT`, par lequel une PASSE (et non le paquet) exige qu'un cas
    // précis ait réellement tourné. C'est le besoin d'une étape qui sélectionne
    // par `-t` : un motif qui ne mord plus laisse vitest sortir 0 avec zéro cas
    // exécuté, et l'étape devient décorative sans que rien ne le dise.
    // Sans cette variable, le rapporteur ne dit rien et ne coûte rien.
    reporters: ["default", gateReporter([])],
    include: [
      "nodefony/tests/http/**/*.test.ts",
      "nodefony/tests/integration/**/*.test.ts",
      "nodefony/tests/routing/**/*.test.ts",
      "nodefony/tests/websockets/**/*.test.ts",
    ],
    exclude: [...configDefaults.exclude, "nodefony/tests/http/memory.test.ts"],
    setupFiles: [r("./nodefony/tests/vitest.setup.ts")],
    // Sonde le mode du serveur (route publique /livez) → NODEFONY_TEST_ENV, lu
    // par describe.skipIf(IS_PROD_TARGET) pour skipper les tests dev-only en prod.
    globalSetup: [r("./nodefony/tests/probeServerEnv.global.ts")],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@nodefony/mongoose": r("./nodefony/tests/stubs/mongoose.ts"),
    },
  },
});
