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
 *  - **Prod-safe par défaut** (le runtime par défaut est `production`) : `debug:[]`,
 *    `domain:"localhost"`.
 *  - **AUCUN array non-vide** : le deep-merge (`extend(true, …)`) fusionne les arrays
 *    par index ; garder les defaults d'array vides garantit qu'un array user les
 *    REMPLACE proprement. Invariant vérifié par test (`defineConfig.test.ts`).
 *  - **Pas de défaut pour les champs « propriété de l'app » ou pilotés ailleurs** :
 *    `App`/identité (app), `orm` (chantier ORM : forme `{driver}` multi-ORM),
 *    `domainCheck`/`domainAlias` (validation Host, off par défaut — opt-in app/sécu,
 *    en cours de consolidation avec `http.trustedHosts`), `cluster` (`resolveTopology`).
 *  - **Aucun fossile legacy** : pas de `watch` (watch Rollup runtime retiré, dev =
 *    DevSupervisor) ni de `devServer` (config webpack legacy ; Phase 14 = Vite côté
 *    module frontend).
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
  locale: "en_en",
  templating: "eta",
  packageManager: "npm",

  // ── Réseau ──
  // `domain` = adresse d'écoute (Kernel.setDomain). La validation Host
  // (`domainCheck`/`domainAlias` vs `http.trustedHosts`) est opt-in app/sécu.
  domain: "localhost",
  servers: {
    statics: true,
    http: { port: 5151 },
    https: { port: 5152, protocol: "2.0" },
    ws: {},
    wss: {},
  },

  // ── Observabilité (valeurs statiques ; env-dépendances superposées par defineEnv) ──
  log: {
    active: true,
    debug: [],
    requestFormat: "auto",
    buffered: "auto",
    driver: "stdout",
    file: { sync: false },
    // `auto` : le driver de relecture s'adapte au mode de lancement au boot
    // (mono → `memory` ; worker de cluster → `cluster-file`, vue unifiée). Une
    // valeur explicite (memory/file/loki/…) surcharge et fige ce choix.
    queryDriver: "auto",
  },
};
