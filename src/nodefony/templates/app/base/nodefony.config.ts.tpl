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
  // ── HTTPS actif PAR DÉFAUT, même en dev (défaut du framework, aucun écart
  //    ici) : les API navigateur modernes exigent un contexte sécurisé —
  //    WebRTC/getUserMedia, presse-papiers, service workers, notifications.
  //    Au premier boot, un certificat de DÉVELOPPEMENT est généré tout seul
  //    (mkcert si installé → CA locale trustée, zéro warning navigateur ;
  //    sinon auto-signé). Inspection/regénération : `npx nodefony certificates`.
  //    En production : fournis un vrai certificat, OU termine le TLS à
  //    l'ingress/LB et désactive l'écoute sécurisée ci-dessous.
  // ── DÉSACTIVER l'écoute sécurisée (HTTPS + WSS en héritent tous deux) :
  //    décommente — il ne restera qu'un port exposé, en clair (5151) :
  // servers: { https: false },
  log: {
    debug: ctx.isProd ? [] : "*",
    // stdout = contrat cloud-native (collecteur de logs de l'orchestrateur).
    driver: ctx.env.NF_LOG_DRIVER,
  },
  // ── Manifeste ORDONNÉ des modules — l'ordre du tableau = l'ordre de chargement.
  //    Chaque entrée peut porter une POLICY (elle FILTRE, ne réordonne jamais) :
  //      "mandatory" → socle de l'app : toujours chargé, non filtrable
  //                    (déclare l'intention « sans lui, cette app n'a pas de sens »)
  //      "optional"  → défaut : chargé, filtrable par une garde `when: (config) => bool`
  //                    (ex. redis plus bas : chargé SEULEMENT si l'infra est déclarée)
  //      "dev"       → chargé UNIQUEMENT hors production : outillage, démo, consoles
  //                    (0 coût prod — un module non listé n'est même pas importé)
  modules: [
<% if (it.complete) { %>    // ── ORM — Drizzle (SQL) par défaut. Sans NF_DATABASE_URL = sqlite LOCAL
    //    (profil solo) : l'app persiste out-of-the-box (users, sessions, jetons).
    //    Déclare NF_DATABASE_URL (postgres://…) pour pointer une vraie base.
    "@nodefony/drizzle",

<% } %>    // ── Socle serveur : HTTP/WS natifs + probes /livez /readyz (ON par défaut).
    use("@nodefony/http", {}),
    // Router + controllers + décorateurs (@controller, @route).
    "@nodefony/framework",
<% if (it.complete) { %>
    // ── Socket Nodefony (canaux duplex multiplexés). Backplane `cluster` = IPC
    //    intra-pod, 0 dépendance externe ; `redis` = opt-in cross-pod.
    use("@nodefony/realtime", { backplane: { driver: "cluster" } }),

    // ── Firewall applicatif + audit — chaque requête passe le pipeline sécurité.
    //    Déclare tes zones quand tu protèges des routes (validées Zod au boot,
    //    config invalide = fail-closed) :
    //    use("@nodefony/security", { firewalls: { main: { pattern: "^/api", … } } }),
    use("@nodefony/security", {
      // Clés de chiffrement au repos — les VALEURS ont été générées dans
      // `.env.local` (gitignoré) à la création de l'app. Rotation ou
      // rattrapage : `npx nodefony security:secrets --write`.
      totp: { encryptionKey: ctx.env.NF_TOTP_KEY }, // secrets 2FA chiffrés
      webhooks: { encryptionKey: ctx.env.NF_WEBHOOK_KEY }, // signatures sortantes
      csrf: { secret: ctx.env.NF_CSRF_SECRET }, // jetons anti-CSRF (partagé cluster)
      // Hiérarchie de rôles (un rôle COUVRE ceux qu'il liste, transitivement).
      // ROLE_NODEFONY_* = plateforme (console Studio) ; ROLE_* = applicatif.
      // Le compte admin seedé (nodefony/security/provisionUsers.ts) les porte.
      roleHierarchy: {
        ROLE_NODEFONY_ADMIN: ["ROLE_ADMIN", "ROLE_SUPERVISOR", "ROLE_DEV"],
        ROLE_ADMIN: ["ROLE_USER"],
      },
    }),

    // ── Frontend (builder Vite + statics) + console d'administration Studio
    //    → http://127.0.0.1:5151/nodefony
    //    `policy: "dev"` : Studio embarqué en DÉVELOPPEMENT seulement — c'est
    //    une surface d'ADMIN (introspection config/sessions/logs). Pour l'avoir
    //    aussi en production : 1) protège /nodefony par une zone firewall,
    //    2) passe la policy à "mandatory" (toujours chargé). Un `"optional"`
    //    conviendrait aussi mais dirait moins ton intention : une console
    //    d'admin volontairement exposée est un choix ASSUMÉ, pas un défaut.
    "@nodefony/frontend",
    { name: "@nodefony/studio", policy: "dev" },

    // ── Accès Redis générique — chargé par la DÉCLARATION de l'infra cache :
    //    `NF_REDIS_URL` présente ⇔ module chargé (un seul signal, pas de magie
    //    localhost). Consommateurs : backplane realtime `redis`, sessions,
    //    idempotence.
    use("@nodefony/redis", undefined, {
      when: () => !!ctx.infra.cache,
    }),
<% } else if (it.front) { %>
    // ── Builder Vite + statics : sert le frontend <%= it.frontend %> de l'app
    //    (HMR en dev, build pré-compilé en prod).
    "@nodefony/frontend",
<% } %>  ],
}));
