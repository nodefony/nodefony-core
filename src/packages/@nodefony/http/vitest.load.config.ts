import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Suite LOURDE @nodefony/http (ex-`.mocharc.load.json`) — charge + heap + leak + scopes DI.
 *
 * Contenu : `tests/load/**` (RPS, débit WS, connexions WS) + `tests/http/memory.test.ts`
 * (le GATE mémoire : 1000 GET, 100 crashs, 100 WS, uploads — seuils heap = BLOCKERS).
 * Prérequis : serveur dev UP. À lancer AVANT tout commit touchant Kernel / pipeline /
 * cycle de vie / mémoire (cf CLAUDE.md « RÈGLE ABSOLUE PERF & MÉMOIRE »), pas à chaque
 * non-régression.
 *
 * Séquentiel STRICT (`fileParallelism:false` + `singleFork`) : OBLIGATOIRE ici — les deltas
 * de heap serveur et les comptes de scopes ALS seraient corrompus par des requêtes
 * concurrentes inter-fichiers. Timeout 600 s (les bancs de charge montent à 10 min).
 * Le gate mémoire seul : `vitest run --config vitest.load.config.ts nodefony/tests/http/memory.test.ts`.
 */
export default defineConfig({
  test: {
    globals: true,
    include: [
      "nodefony/tests/load/**/*.test.ts",
      "nodefony/tests/http/memory.test.ts",
    ],
    setupFiles: [r("./nodefony/tests/vitest.setup.ts")],
    // Sonde le mode du serveur (route publique /livez) → NODEFONY_TEST_ENV, lu
    // par describe.skipIf(IS_PROD_TARGET) pour skipper les tests dev-only en prod.
    globalSetup: [r("./nodefony/tests/probeServerEnv.global.ts")],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
  resolve: {
    alias: {
      "@nodefony/mongoose": r("./nodefony/tests/stubs/mongoose.ts"),
    },
  },
});
