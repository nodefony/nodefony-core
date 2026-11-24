// Configuration Svelte lue par `@sveltejs/vite-plugin-svelte` à la racine du
// projet Vite (`frontend/`). Sans ce fichier, le plugin avertit à CHAQUE build
// (« no Svelte config found ») — et un avertissement qu'on apprend à ignorer
// masque le prochain qui comptera.
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  // Préprocesseur Vite : TypeScript et PostCSS dans les blocs <script>/<style>.
  preprocess: vitePreprocess(),
};
