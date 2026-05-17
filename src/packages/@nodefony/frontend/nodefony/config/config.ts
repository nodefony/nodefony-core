/**
 * NODEFONY FRAMEWORK — Configuration DEFAULT de `@nodefony/frontend`.
 *
 * Ce module pilote Vite (builder + dev server) pour transpiler les frontends
 * déclarés dans chaque module Nodefony :
 *
 *   { frontend: { type: "react19", entry: "./frontend/src/main.tsx" } }
 *
 * Surcharge par l'application via `module-frontend` dans le config racine.
 *
 * Approche actuelle (POC `poc/frontend-child`) :
 *  - Vite tourne dans un process système isolé (`child_process.spawn`).
 *  - Le navigateur tape directement le port Vite pour les assets / HMR.
 *  - Nodefony rend l'index.html lui-même et injecte les `<script>` ad-hoc.
 *
 * L'alternative (`poc/frontend-single`) lance Vite via `vite.createServer()`
 * dans le process Node principal — même API publique, supervisor différent.
 */
const config = {
  /**
   * Host d'écoute du dev server Vite — utilisé tel quel dans les `<script>`
   * injectés (donc doit être joignable depuis le navigateur).
   * Recommandation prod : N/A (Vite ne tourne pas en prod, c'est le manifest qui pilote).
   */
  devHost: "127.0.0.1",

  /**
   * Port d'écoute du dev server Vite. Par défaut Vite démarre sur 5173.
   * Si occupé : Vite incrémente jusqu'à trouver un port libre — le superviseur
   * détecte le port réel dans son stdout et met à jour son `status()`.
   */
  devPort: 5173,

  /**
   * Démarrer automatiquement le superviseur Vite quand le kernel passe
   * en mode `development`. En `production` / `staging`, ignoré.
   * Recommandation : `true` en dev, sinon les helpers template injecteront
   * une URL morte.
   */
  autoStartInDevelopment: true,

  /**
   * Présets activés (sera utilisé pour le scan paresseux des plugins).
   * Liste exhaustive supportée : "react19", "vue3", "svelte5", "solid", "vanilla".
   * Recommandation : laisser tous activés, seuls les modules qui les déclarent
   *   déclenchent le chargement réel des deps.
   */
  enabledPresets: ["react19", "vanilla"] as Array<
    "react19" | "vue3" | "svelte5" | "solid" | "vanilla"
  >,

  /**
   * Dossier de sortie par défaut pour la prod build, relatif à la racine
   * du module consommateur. Réécrit par la prop `outDir` de la déclaration.
   */
  defaultOutDir: "./public/dist",

  /**
   * Racine front par défaut (contient index.html) côté module.
   */
  defaultRoot: "./frontend",

  /**
   * Timeout (ms) d'attente du "Local: http://…" dans le stdout Vite avant
   * de considérer le démarrage comme cassé.
   * Recommandation prod : N/A. Dev : 30s suffisent pour cold-start Vite.
   */
  startupTimeoutMs: 30_000,

  /**
   * Active la propagation des logs Vite vers le syslog Nodefony (sinon ils
   * vont dans stdout du process enfant uniquement).
   */
  pipeViteLogs: true,
};

export default config;
export type FrontendConfig = typeof config;
