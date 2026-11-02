import { defineConfig } from "vitest/config";
import { oxcDecorators } from "../../../../scripts/test/vitest/oxc.ts";
import { transformCache } from "../../../../scripts/test/vitest/perf.ts";

/**
 * Banc de compatibilité ENTRE VERSIONS de la socket (#629) — client publié ↔
 * serveur courant, client courant ↔ serveur publié.
 *
 * Lot séparé : il exige la version PUBLIÉE installée par
 * `npm run release:compat` (`scripts/release/compat.mjs`), qui pose
 * `NF_COMPAT_DIR` puis lance cette config. Lancé seul, il s'arrête en nommant
 * la commande — jamais un vert sans la version de référence.
 */
export default defineConfig({
  test: {
    ...transformCache,
    globals: true,
    include: ["nodefony/tests/compat/**/*.compat.test.ts"],
    testTimeout: 15000,
  },
  oxc: oxcDecorators,
});
