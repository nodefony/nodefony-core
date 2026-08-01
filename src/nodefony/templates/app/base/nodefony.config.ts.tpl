import { defineConfig, use } from "nodefony";
import type { env } from "./env";

/**
 * Configuration de l'application — UN fichier, seulement les ÉCARTS aux
 * défauts du framework (deep-merge au boot). Le par-environnement passe par
 * `ctx` (isProd/isDev/env typé), jamais par un fichier parallèle.
 *
 * Voir la config RÉSOLUE, valeur ET provenance : `npx nodefony inspect config`,
 * ou la console Studio. Guide complet : `docs/guides/configuration.md`.
 */
export default defineConfig<typeof env>((ctx) => ({
  /**
   * Interface d'écoute. En container, écouter TOUTES les interfaces : le port
   * mapping Docker/k8s n'atteint jamais un bind sur 127.0.0.1.
   */
  domain: ctx.isProd ? "0.0.0.0" : "127.0.0.1",

  /**
   * Écoute HTTP et HTTPS. Rien ici ⇒ défauts du framework (5151, et 5152 en
   * HTTP/2) ; un port est une propriété du DÉPLOIEMENT et se déclare par
   * l'environnement — cf `.env`.
   *
   * HTTPS est actif même en dev parce que les API navigateur modernes exigent
   * un contexte sécurisé (WebRTC/getUserMedia, presse-papiers, service workers,
   * notifications). Le certificat de développement est généré au premier boot —
   * via **mkcert** s'il est installé (autorité locale de confiance, zéro
   * avertissement navigateur), sinon auto-signé.
   *
   * - Ne garder qu'un port, en clair (TLS terminé à l'ingress) : `https: false`.
   * - Inspecter ou regénérer le certificat : `npx nodefony http:certificates`.
   */
  servers: {
    ...(ctx.env.NF_PORT ?? ctx.env.PORT
      ? { http: { port: ctx.env.NF_PORT ?? ctx.env.PORT } }
      : {}),
    ...(ctx.env.NF_PORT_HTTPS ? { https: { port: ctx.env.NF_PORT_HTTPS } } : {}),
  },

  log: {
    debug: ctx.isProd ? [] : "*",
    /** stdout = contrat cloud-native (collecteur de logs de l'orchestrateur). */
    driver: ctx.env.NF_LOG_DRIVER,
  },

  /**
   * Manifeste ORDONNÉ des modules — l'ordre du tableau = l'ordre de chargement.
   * La `policy` d'une entrée FILTRE, elle ne réordonne jamais :
   *
   * - `"mandatory"` → socle de l'app : toujours chargé, non filtrable
   *   (déclare l'intention « sans lui, cette app n'a pas de sens ») ;
   * - `"optional"` → défaut : chargé, sauf si sa GARDE `when` dit non ;
   * - `"dev"` → chargé UNIQUEMENT hors production : outillage, démo, consoles
   *   (0 coût prod — un module non listé n'est même pas importé).
   *
   * La garde `when` rend un booléen : `false` ⇒ le module n'est pas chargé du
   * tout. Elle reçoit la config résolue — `when: (config) => …` — mais peut
   * l'ignorer et fermer sur `ctx`, ce que fait redis plus bas
   * (`when: () => !!ctx.infra.cache`) : la question qu'il pose porte sur
   * l'ENVIRONNEMENT (une URL Redis est-elle déclarée ?), pas sur sa propre
   * configuration. Décider d'après `config` sert quand la réponse dépend d'une
   * clé du module lui-même.
   */
  modules: [
<% if (it.complete) { %>    /**
     * ORM Drizzle (SQL). Sans `NF_DATABASE_URL` : sqlite LOCAL, et l'app
     * persiste out-of-the-box (users, sessions, jetons). Déclare
     * `NF_DATABASE_URL` (postgres://…) pour pointer une vraie base.
     */
    "@nodefony/drizzle",

<% } %>    /** Socle serveur : HTTP/WS natifs + probes /livez /readyz. */
    use("@nodefony/http", {}),

    /** Router + controllers + décorateurs (`@controller`, `@route`). */
    "@nodefony/framework",
<% if (it.complete) { %>
    /**
     * Socket Nodefony (canaux duplex multiplexés). Backplane `cluster` = IPC
     * intra-pod, 0 dépendance externe ; `redis` = opt-in cross-pod.
     */
    use("@nodefony/realtime", { backplane: { driver: "cluster" } }),

    /**
     * Firewall applicatif + audit — chaque requête passe le pipeline sécurité.
     * Les zones sont validées Zod au boot (config invalide = fail-closed).
     */
    use("@nodefony/security", {
      /**
       * Zones firewall de TES routes. `main` essaie `session` (cookie BFF →
       * `context.user` rempli) puis `anonymous` : rien n'est bloqué tel quel.
       * Hors zone, l'identité n'est JAMAIS résolue.
       *
       * - EXIGER le login sur `/api` : retire `"anonymous"` de `main`.
       * - Protéger plus large : élargis le pattern (ex. `"^/(api|compte)"`).
       *
       * Le firewall trie par longueur de pattern : `/api/secure/*` tombe donc
       * dans `secure`, sans `anonymous` → 401 avant ton controller. Essaie
       * `GET /api/secure/hello`.
       *
       * `main` et `secure` sont STATEFUL : l'identité tient dans une session
       * serveur, portée par un cookie opaque et révocable — le bon modèle pour
       * un NAVIGATEUR. `machine`, plus bas, montre l'autre cas : un appelant
       * qui ne stocke pas de cookie ne doit RIEN recevoir qu'il faille stocker.
       *
       * ⚠️ `stateless: false` (le défaut) NE FAIT PAS ÉCHOUER l'essai — et c'est
       * le piège. Depuis un navigateur, ou avec un `curl -c`, tout marche : le
       * cookie posé à la première requête est renvoyé aux suivantes. Le vrai
       * client, lui, ne stocke rien ; il repart ANONYME à chaque appel, et le
       * symptôme arrive en production sous la forme d'un 401 intermittent que
       * rien dans le code ne montre. Ajouter `"session"` à côté de `"apikey"`
       * produit exactement le même défaut, en plus discret encore : la clé
       * ouvre, et l'application ouvre une session par-dessus pour personne.
       */
      /**
       * ⚠️ Un `pattern` couvre un PRÉFIXE, pas les routes qu'on a en tête —
       * et c'est TOUT l'intérêt : les routes ajoutées demain sous ce préfixe
       * naissent protégées, sans que personne ait à y penser.
       *
       * D'où le piège, mesuré : pour fermer `/api/account/profile` et
       * `/api/account/invoices`, on écrit
       * `pattern: "^/api/account/(profile|invoices)"`. Les deux routes
       * refusent bien l'anonyme, l'essai est vert, la revue passe — et la
       * TROISIÈME route du compte, ajoutée un mois plus tard, est PUBLIQUE.
       * Rien ne le signale : la zone existe, elle a l'air de couvrir l'espace.
       * Le bon pattern est `"^/api/account"`.
       *
       * La zone retenue est celle dont le pattern est le plus LONG parmi
       * celles qui correspondent (`firewall.ts:245`) — pas la première
       * déclarée. C'est ainsi que `^/api/secure` l'emporte sur `^/api`
       * ci-dessous. Un pattern énuméré gagne donc lui aussi sur ses propres
       * routes, ce qui rend l'erreur silencieuse : ce qu'on teste marche.
       */
      areas: {
        main: {
          pattern: "^/api",
          authenticators: ["session", "anonymous"],
        },
        secure: {
          pattern: "^/api/secure",
          authenticators: ["session"],
        },
        // Appelant qui n'est PAS un navigateur — service partenaire, script,
        // agent. Zone ACTIVE, et non un exemple en commentaire : c'est le code
        // qu'on a sous les yeux qu'on recopie, jamais celui qu'on lit à côté.
        // Rien ne tombe ici tant qu'aucune route ne commence par `/api/machine`.
        machine: {
          pattern: "^/api/machine",
          authenticators: ["apikey"], // PAS "session" — ce client n'a pas de cookie
          stateless: true, // false ⇒ l'app ouvre une session qu'il ne renverra jamais
        },
      },

      /**
       * Clés de chiffrement au repos — les VALEURS vivent dans `.env.local`
       * (gitignoré), générées à la création de l'app. Rotation ou rattrapage :
       * `npx nodefony security:secrets --write`.
       */
      totp: { encryptionKey: ctx.env.NF_TOTP_KEY },
      webhooks: { encryptionKey: ctx.env.NF_WEBHOOK_KEY },
      csrf: { secret: ctx.env.NF_CSRF_SECRET },

      /**
       * Hiérarchie de rôles — un rôle COUVRE ceux qu'il liste, transitivement.
       * `ROLE_NODEFONY_*` = plateforme (console Studio) ; `ROLE_*` = applicatif.
       * Le compte admin semé par `nodefony/security/provisionUsers.ts` les porte.
       */
      roleHierarchy: {
        ROLE_NODEFONY_ADMIN: ["ROLE_ADMIN", "ROLE_SUPERVISOR", "ROLE_DEV"],
        ROLE_ADMIN: ["ROLE_USER"],
      },
    }),

    /** Builder Vite + statics : sert le frontend de l'app (HMR en dev). */
    "@nodefony/frontend",

    /**
     * Console d'administration → `/nodefony` : modules chargés, routes, config
     * résolue, sessions, logs.
     *
     * `policy: "dev"` parce que c'est une surface d'ADMIN : absente de la
     * production. Pour l'y garder — choix ASSUMÉ — protège `/nodefony` par une
     * zone firewall, PUIS passe la policy à `"mandatory"`.
     *
     * `ui: "static"` sert les assets pré-buildés du paquet npm (rien à
     * recompiler). `"auto"`/`"vite"` feraient passer l'UI Studio par TON serveur
     * Vite — pour développer Studio lui-même — et exigeraient ses plugins dans
     * TES devDependencies (une app Vue/Angular n'a pas `@vitejs/plugin-react`).
     */
    use("@nodefony/studio", { ui: "static" }, { policy: "dev" }),

    /**
     * Accès Redis générique — chargé par la DÉCLARATION de l'infra cache :
     * `NF_REDIS_URL` présente ⇔ module chargé (un seul signal, pas de magie
     * localhost). Consommateurs : backplane realtime `redis`, sessions,
     * idempotence.
     */
    use("@nodefony/redis", undefined, {
      when: () => !!ctx.infra.cache,
    }),
<% } else if (it.front) { %>
    /**
     * Builder Vite + statics : sert le frontend <%= it.frontend %> de l'app
     * (HMR en dev, build pré-compilé en prod).
     */
    "@nodefony/frontend",
<% } %>
    /**
     * Outillage de DÉVELOPPEMENT — la porte HTTP de la carte de visite de cette
     * application (`/nodefony/devkit`). La même carte au terminal ne dépend PAS
     * de ce module : `npx nodefony card` est servie par le cœur et répond même
     * ici retiré, application non construite ou environnement non posé.
     *
     * `policy: "dev"` : ce qu'il expose (modules chargés, chemins de
     * documentation, commandes à lancer) aide pendant le développement et n'est,
     * en production, qu'une divulgation de ton architecture. Un module non chargé
     * n'est même pas importé — le coût en production est nul, pas « faible ».
     *
     * Il est en `devDependencies` : `npm ci --omit=dev` ne l'installe pas.
     */
    use("@nodefony/devkit", {}, { policy: "dev" }),
  ],
}));
