/**
 * DÉFAUTS FRAMEWORK de la configuration d'application.
 *
 * C'est ce qui rend `nodefony.config.ts` minuscule : tout ce que l'app n'écrit
 * pas vient d'ici (deep-merge au `defineConfig().resolve()`). Avant ce chantier,
 * ces valeurs étaient écrites EN DUR dans le `config.ts` de chaque app — donc
 * subies et dupliquées. Elles sont désormais centralisées + figées par un golden
 * test (anti-drift comportemental).
 *
 * Principes :
 *  - **Statique uniquement** : aucune valeur dépendante de l'env ou du kernel ici.
 *    Les valeurs env-dépendantes (driver de log selon `NF_LOG_DRIVER`, URLs Loki…)
 *    sont superposées par le catalogue `defineEnv` (Lot 2) / par l'app.
 *  - **Prod-safe par défaut** (le runtime par défaut est `production`) : `watch:false`,
 *    `debug:[]`, `domain:"localhost"`, `domainCheck:true`.
 *  - **AUCUN array non-vide** : le deep-merge (`extend(true, …)`) fusionne les arrays
 *    par index ; garder les defaults d'array vides garantit qu'un array user les
 *    REMPLACE proprement. Invariant vérifié par test (`defineConfig.test.ts`).
 *  - **Pas d'identité d'app** (`App`, auteur) ni de legacy (`domainAlias`) ni de
 *    topologie (`cluster`, résolue par `resolveTopology`) : fournis par l'app.
 */
import type { ResolvedAppConfig } from "./types";

/**
 * Configuration framework par défaut, fusionnée sous la config de l'app au boot.
 * Ne JAMAIS muter à l'exécution (le merge `extend(true, {}, defaultAppConfig, …)`
 * clone ; l'invariant d'immutabilité est couvert par test).
 */
export const defaultAppConfig: ResolvedAppConfig = {
  // Aucun module par défaut : l'app déclare son manifeste (array vide = remplaçable).
  modules: [],

  // ── Application ──
  watch: false,
  locale: "en_en",
  templating: "eta",
  orm: "sequelize",
  packageManager: "npm",

  // ── Réseau ──
  domain: "localhost",
  domainCheck: true,
  servers: {
    statics: true,
    http: { port: 5151 },
    https: { port: 5152, protocol: "2.0" },
    ws: {},
    wss: {},
  },
  devServer: {
    hot: false,
    overlay: true,
    logging: "info",
    progress: false,
    protocol: "https",
    websocket: true,
  },

  // ── Observabilité (valeurs statiques ; env-dépendances superposées par defineEnv) ──
  log: {
    active: true,
    debug: [],
    requestFormat: "auto",
    buffered: "auto",
    driver: "stdout",
    file: { sync: false },
    queryDriver: "memory",
  },
};
