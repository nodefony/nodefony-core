/**
 * NODEFONY FRAMEWORK — Configuration DEFAULT de `@nodefony/realtime`.
 *
 * Pour l'instant minimal. Sera enrichi en P13.4 (façade `RealtimeService` +
 * `defineRealtimeConfig()` builder) avec :
 *  - `backplane` : "loopback" | "cluster-ipc" | "redis" | "kafka" | IBackplane custom
 *  - `redis` / `kafka` : options du driver choisi
 *  - `hub.maxBufferedAmount` / `pingIntervalMs` / `adaptiveCadence`
 *  - `probe.enabled` / `sampleEveryMs`
 *
 * Voir `docs/configuration.md` pour la cible figée du builder.
 *
 * Surcharge côté app : clé `module-realtime` dans le `config.ts` racine, ou
 * `module.options` du module consumer dans son propre `config.ts`.
 */
const config = {
  /**
   * Active le module realtime au boot.
   * Recommandation prod : `true`.
   */
  enabled: true,
};

export default config;
export type RealtimeConfig = typeof config;
