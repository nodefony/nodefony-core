/**
 * Build de PUBLISH de l'UI Studio — assets statiques shippés dans le paquet npm.
 *
 * ≠ `vite.config.generated.mjs` (dev HMR, régénéré par @nodefony/frontend) :
 * ici un build APP-mode classique (`index.html` en entrée) → `dist/frontend/`
 * autosuffisant (index.html transformé + assets hashés immuables), servi par
 * `PrebuiltUi` (@nodefony/http) quand la molette `ui` résout `static`.
 * Le consommateur npm ne compile JAMAIS cette UI (pattern bull-board/GraphiQL).
 *
 * Lancé par `npm run build:ui` (hook `prepack`). `base` DOIT rester aligné sur
 * le `publicPath` monté par le module (`/_assets/studio/`).
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: "/_assets/studio/",
  resolve: { dedupe: ["react", "react-dom"] },
  plugins: [react({ jsxRuntime: "automatic" })],
  build: {
    outDir: resolve(here, "../dist/frontend"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
