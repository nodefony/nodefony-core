import { defineConfig, use } from "nodefony";
import type { env } from "./env";

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
    // ── ORM — Drizzle (SQL) par défaut. Sans NF_DATABASE_URL = sqlite LOCAL
    //    (profil solo) : l'app persiste out-of-the-box (users, sessions, jetons).
    //    Déclare NF_DATABASE_URL (postgres://…) pour pointer une vraie base.
    "@nodefony/drizzle",

    // ── Socle serveur : HTTP/WS natifs + probes /livez /readyz (ON par défaut).
    use("@nodefony/http", {}),
    // Router + controllers + décorateurs (@controller, @route).
    "@nodefony/framework",

    // ── Socket Nodefony (canaux duplex multiplexés). Backplane `cluster` = IPC
    //    intra-pod, 0 dépendance externe ; `redis` = opt-in cross-pod.
    use("@nodefony/realtime", { backplane: { driver: "cluster" } }),

    // ── Firewall applicatif + audit — chaque requête passe le pipeline sécurité.
    //    Déclare tes zones quand tu protèges des routes (validées Zod au boot,
    //    config invalide = fail-closed) :
    //    use("@nodefony/security", { firewalls: { main: { pattern: "^/api", … } } }),
    use("@nodefony/security", {}),

    // ── Frontend (builder Vite + statics) + console d'administration Studio
    //    → http://127.0.0.1:5151/nodefony
    //    `policy: "dev"` : Studio embarqué en DÉVELOPPEMENT seulement. Pour
    //    l'activer en production, protège d'abord /nodefony par une zone
    //    firewall (introspection config/sessions = surface admin), puis passe
    //    la policy à "mandatory".
    "@nodefony/frontend",
    { name: "@nodefony/studio", policy: "dev" },

    // ── Accès Redis générique — chargé par la DÉCLARATION de l'infra cache :
    //    `NF_REDIS_URL` présente ⇔ module chargé (un seul signal, pas de magie
    //    localhost). Consommateurs : backplane realtime `redis`, sessions,
    //    idempotence.
    use("@nodefony/redis", undefined, {
      when: () => !!ctx.infra.cache,
    }),
  ],
}));
