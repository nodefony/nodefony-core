import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * vitest + coverage-v8 pour @nodefony/studio.
 *
 * Mirror de la config @nodefony/frontend : les tests unit importent la SOURCE
 * pure des providers realtime (`nodefony/realtime/providers.ts` → node:os/v8/
 * perf_hooks uniquement), PAS le dist Rollup ni @nodefony/http/framework → pas
 * besoin d'aliaser sequelize/mongoose.
 *
 * Compat mocha+chai sans réécriture :
 *  - `globals: true` → describe/it globaux.
 *  - `import "mocha"` aliasé vers un shim vide.
 *
 * Hors scope unit (split documenté, cf MEMORY.md) :
 *  - `StudioRealtimeController` (WS endpoint) = intégration live-server, couverte
 *    par la suite WS de @nodefony/http (subscribe/unsubscribe → frame JSON-RPC).
 *  - Le frontend React (stores MobX, ConnectionDrawer) = à instrumenter à part.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["nodefony/tests/unit/**/*.test.ts"],
    setupFiles: [r("./nodefony/tests/vitest.setup.ts")],
    coverage: {
      provider: "v8",
      include: ["nodefony/realtime/**/*.ts"],
      exclude: ["nodefony/tests/**", "**/dist/**", "**/*.d.ts"],
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: ".coverage",
    },
  },
  resolve: {
    alias: {},
  },
});
