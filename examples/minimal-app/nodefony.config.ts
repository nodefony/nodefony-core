import { defineConfig, use } from "nodefony";
import type { env } from "./env.js";

/**
 * Configuration de l'application — UN fichier, seulement les ÉCARTS aux
 * défauts du framework (deep-merge au boot). Le par-environnement passe par
 * `ctx` (isProd/isDev/env typé), jamais par un fichier parallèle.
 */
export default defineConfig<typeof env>((ctx) => ({
  // Un container doit écouter TOUTES les interfaces : le port mapping
  // Docker/k8s n'atteint jamais un bind 127.0.0.1.
  domain: ctx.isProd ? "0.0.0.0" : "127.0.0.1",
  servers: {
    // Cas nominal cloud-native : le TLS est terminé à l'ingress/LB — le pod
    // sert en clair. `false` désactive HTTPS (et le WSS qui en hérite) :
    // pas de certificats auto-générés au boot, un seul port exposé (5151).
    https: false,
  },
  log: {
    debug: ctx.isProd ? [] : "*",
    // stdout = contrat cloud-native (collecteur de logs de l'orchestrateur).
    driver: ctx.env.NF_LOG_DRIVER,
  },
  modules: [
    // Les probes /livez /readyz (config `health`) sont ON par défaut —
    // consommées par le HEALTHCHECK du Dockerfile et les probes k8s.
    use("@nodefony/http", {}),
    "@nodefony/framework",
  ],
}));
