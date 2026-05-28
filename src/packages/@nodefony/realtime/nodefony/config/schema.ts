import { z } from "zod";

/**
 * Schéma Zod de la configuration de @nodefony/realtime.
 *
 * Source de vérité (TS type dérivé via `z.infer<>`). Validé au boot du Module
 * class (hook `onKernelRegister`) → plante propre avec messages clairs si la
 * config est invalide, pas d'`undefined.x` silencieux en runtime.
 *
 * Pour l'instant minimal. Sera enrichi en P13.4 avec les sections (style
 * `defineSecurityConfig` à 12 sections, cf [[feedback_config_validation_zod]]) :
 *  - `backplane` : "loopback" | "cluster-ipc" | "redis" | "kafka" | IBackplane custom
 *  - `redis` / `kafka` : options du driver choisi
 *  - `hub.maxBufferedAmount` / `pingIntervalMs` / `adaptiveCadence`
 *  - `probe.enabled` / `sampleEveryMs`
 *
 * Voir `docs/configuration.md` pour la cible figée du builder `defineRealtimeConfig()`.
 */
export const realtimeConfigSchema = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .describe(
        "Active le module realtime au boot. Recommandation prod : true. " +
          "false = module chargé mais inerte (registry, mais aucun hub/listener actif).",
      ),
  })
  .describe("Configuration de @nodefony/realtime.");

export type RealtimeConfig = z.infer<typeof realtimeConfigSchema>;
