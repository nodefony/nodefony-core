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
   * Base URL des assets servis en PRODUCTION (CDN / object storage / edge).
   * Vide (défaut) = assets servis depuis l'origine Nodefony en chemins relatifs
   * (`/_assets/<name>/...`, `/test/...`) — comportement historique. Renseignée
   * (ex. `https://cdn.example.com`), elle PRÉFIXE :
   *   - le `base` Vite au build (imports/CSS internes → CDN),
   *   - les URLs de `renderProdTags` (`<script>`/`<link>` → CDN),
   *   - le helper template `asset('/x')` (statiques à la main → CDN).
   * Le slash final est normalisé. N'affecte JAMAIS le mount `Statics` (qui reste
   * relatif à l'origine) : seules les URLs ÉMISES changent. Cf `assets:publish`.
   * Recommandation prod cloud-native : pointer le CDN devant l'object storage.
   */
  assetBaseUrl: "",

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

  /**
   * Host du serveur Nodefony cible du proxy Vite (`server.proxy`).
   * Quand le browser fait `fetch("/api/...")` depuis la page React servie
   * par Vite, Vite proxifie vers `${backendProtocol}://${backendHost}:${backendPort}${path}`.
   */
  backendHost: "127.0.0.1",

  /**
   * Port du serveur Nodefony cible du proxy Vite. HTTP par défaut (5151 dans
   * la config par défaut du module @nodefony/http). Ajuster si l'app surcharge.
   */
  backendPort: 5151,

  /**
   * Protocole utilisé pour le proxy Vite vers Nodefony. `http` par défaut —
   * mettre `https` si tu veux proxifier vers le serveur HTTPS Nodefony (5152).
   * Note : avec `https`, prévoir `secure: false` côté proxy si certificat self-signed.
   */
  backendProtocol: "http" as "http" | "https",

  /**
   * Activer HTTPS pour le dev server Vite — récupère les certificats du service
   * `certificates` de @nodefony/http (mêmes certs que `server-https` 5152).
   * Side effect : la page rendue par Nodefony charge maintenant `https://host:port`
   * pour les scripts Vite. Le browser demande une confiance pour 5173 si la CA
   * root Nodefony n'est pas installée localement.
   * Recommandation : `true` quand la page Nodefony est servie en HTTPS (5152) —
   * évite le mixed-content warning. Sinon `false`.
   */
  https: false,

  /**
   * Variables d'environnement supplémentaires passées au child Vite. Les clés
   * préfixées `VITE_` sont automatiquement exposées au browser via
   * `import.meta.env.VITE_*`. Exemple : `{ VITE_API_BASE: "/api/v1" }`.
   * À surcharger par module via `module-frontend.viteEnv` dans la config app.
   * Recommandation prod : utiliser un `.env.production` dans le `root` Vite
   * plutôt que cette option, pour ne pas leak les secrets dans le code Nodefony.
   */
  viteEnv: {} as Record<string, string>,

  /**
   * Options de résilience du superviseur Vite. Toutes optionnelles — les
   * defaults internes du supervisor s'appliquent si rien n'est fourni.
   * Surcharge typique : désactiver l'auto-restart en CI (`autoRestart: false`)
   * pour faire échouer le pipeline sur un crash Vite au lieu de le masquer.
   */
  resilience: {
    /** Auto-restart sur crash inattendu (default `true`). */
    autoRestart: true,
    /** Max tentatives de restart avant `state: "errored"` (default `5`). */
    maxRestarts: 5,
    /** Backoff exponentiel base (default `500ms`). */
    restartBackoffBaseMs: 500,
    /** Plafond du backoff (default `8000ms`). */
    restartBackoffMaxMs: 8_000,
    /** Health check interval — `0` désactive (default `30000ms`). */
    healthCheckIntervalMs: 30_000,
    /** Échecs consécutifs avant restart (default `3`). */
    healthCheckFailureThreshold: 3,
    /** Timeout par health check (default `5000ms`). */
    healthCheckTimeoutMs: 5_000,
    /** Ports à essayer si EADDRINUSE — devPort, devPort+1, … (default `3`). */
    portRetryAttempts: 3,
  },
};

export default config;
export type FrontendConfig = typeof config;
