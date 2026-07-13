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
  // ── PORTS : rien n'est écrit ici tant que l'environnement ne le déclare pas
  //    → les défauts du framework s'appliquent (HTTP 5151, HTTPS 5152 en HTTP/2).
  //    Un port est une propriété du DÉPLOIEMENT, pas du code : en PaaS (Cloud
  //    Run, Heroku, Railway) la plateforme IMPOSE le sien via `PORT`, et un port
  //    codé en dur donnerait un service qui écoute là où personne n'appelle.
  //    En dev, deux apps Nodefony peuvent tourner côte à côte : le port déjà pris
  //    glisse au suivant et le décalage est ANNONCÉ (`portPolicy: "auto"`, défaut
  //    hors production). En production/test, `portPolicy: "strict"` → échec franc.
  // ── DÉSACTIVER l'écoute sécurisée (HTTPS + WSS en héritent tous deux) :
  //    ajoute `https: false` dans le bloc ci-dessous — il ne restera qu'un port
  //    exposé, en clair (le cas nominal cloud : TLS terminé à l'ingress).
  servers: {
    ...(ctx.env.NF_PORT ?? ctx.env.PORT
      ? { http: { port: ctx.env.NF_PORT ?? ctx.env.PORT } }
      : {}),
    ...(ctx.env.NF_PORT_HTTPS ? { https: { port: ctx.env.NF_PORT_HTTPS } } : {}),
  },
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
    //    Les zones sont validées Zod au boot (config invalide = fail-closed).
    use("@nodefony/security", {
      // ── Zone firewall de TES routes — ACTIVE et jamais bloquante telle
      //    quelle : `mode: "first"` (défaut) essaie `session` (cookie BFF →
      //    l'utilisateur connecté est résolu, `context.user` rempli) PUIS
      //    `anonymous` (sans preuve, on laisse passer). Hors zone, l'identité
      //    n'est JAMAIS résolue — même connecté, une route hors zone ne sait
      //    pas qui tu es.
      //    · EXIGER le login sur /api : retire "anonymous".
      //    · Protéger plus large : élargis le pattern (ex "^/(api|compte)").
      //    Les aires /nodefony (console d'admin) restent portées par le
      //    framework — rien à déclarer ici.
      areas: {
        main: {
          pattern: "^/api",
          authenticators: ["session", "anonymous"],
        },
        // Zone PROTÉGÉE — pattern PLUS SPÉCIFIQUE que ^/api : le firewall
        // trie par longueur → /api/secure/* tombe ICI, pas dans `main`.
        // Pas d'"anonymous" : sans session → 401 AVANT ton controller
        // (Zero Trust). Essaie : GET /api/secure/hello (carte 1 de la home).
        secure: {
          pattern: "^/api/secure",
          authenticators: ["session"],
        },
      },
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
    //
    //    Livraison de l'UI Studio — molette `ui: "auto" | "static" | "vite"`.
    //    Ici `static` ÉPINGLÉ : les assets PRÉ-BUILDÉS shippés dans le paquet
    //    npm (Studio marche sans rien recompiler). `auto`/`vite` ferait passer
    //    l'UI Studio (React) par TON serveur Vite — utile UNIQUEMENT pour
    //    développer Studio lui-même, et exigerait ses plugins dans TES
    //    devDependencies (une app Vue/Angular n'a pas @vitejs/plugin-react).
    //    Pour l'avoir aussi en production (choix ASSUMÉ, cf policy ci-dessus) :
    //    use("@nodefony/studio", { ui: "static" }, { policy: "mandatory" }),
    "@nodefony/frontend",
    use("@nodefony/studio", { ui: "static" }, { policy: "dev" }),

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
