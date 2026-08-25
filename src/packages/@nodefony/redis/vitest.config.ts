import { defineConfig } from "vitest/config";
import { gateReporter, REDIS_GATE } from "../../../../vitest.gates";

/**
 * vitest + coverage-v8 pour @nodefony/redis.
 *
 * Standard coverage du repo (cf @nodefony/realtime / @nodefony/orm-core). Tests
 * unitaires = `node:assert` + describe/it en globals, SANS serveur Redis (on
 * teste le schéma Zod, le builder et l'assemblage des options `createClient`).
 * Les tests d'intégration (connexion réelle) exigent l'infra
 * `docker/docker-compose.yml` et vivent dans `tests/integration/`.
 */
export default defineConfig({
  test: {
    globals: true,
    // Deux variables gouvernent l'accès au serveur réel (`REDIS_URL` pour les
    // bancs de pagination, `NF_REDIS_TEST_URL` pour le banc comportemental) : en
    // fournir une seule laissait 14 tests skippés — suite VERTE, sans un mot.
    reporters: ["default", gateReporter([REDIS_GATE])],
    include: [
      "nodefony/tests/unit/**/*.test.ts",
      "nodefony/tests/integration/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["index.ts", "nodefony/**/*.ts"],
      exclude: ["nodefony/interfaces/**", "**/*.d.ts", "**/dist/**"],
      reporter: ["text", "text-summary", "json-summary", "lcov"],
      reportsDirectory: ".coverage",
    },
  },
});
