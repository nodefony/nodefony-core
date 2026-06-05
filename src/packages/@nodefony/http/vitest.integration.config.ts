import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";

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
    include: [
      "nodefony/tests/http/**/*.test.ts",
      "nodefony/tests/integration/**/*.test.ts",
      "nodefony/tests/routing/**/*.test.ts",
      "nodefony/tests/websockets/**/*.test.ts",
    ],
    exclude: [...configDefaults.exclude, "nodefony/tests/http/memory.test.ts"],
    setupFiles: [r("./nodefony/tests/vitest.setup.ts")],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@nodefony/sequelize": r("./nodefony/tests/stubs/sequelize.ts"),
      "@nodefony/mongoose": r("./nodefony/tests/stubs/mongoose.ts"),
    },
  },
});
