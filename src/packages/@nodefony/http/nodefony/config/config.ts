/**
 * @nodefony/http — Configuration par défaut du module HTTP.
 *
 * Ces valeurs sont les DEFAULTS du framework.
 *
 * SURCHARGE PAR L'APPLICATION :
 *   Le module app (ou tout autre module) peut surcharger n'importe quelle
 *   clé via sa propre config en utilisant la clé "module-http" :
 *
 *   // src/modules/app/nodefony/config/config.ts
 *   export default {
 *     "module-http": {
 *       session: { name: "myapp" },
 *       statics: { assets: { path: "public/assets" } },
 *     }
 *   };
 *
 *   La fusion est récursive — seules les clés surchargées sont remplacées.
 */

import { Nodefony } from "nodefony";

const tmpDir = Nodefony.getKernel()?.tmpDir?.path || "/tmp";

export default {
  /**
   * Recharge automatique des fichiers en développement.
   * En production, mettre à false pour les performances.
   */
  watch: true,

  /**
   * Valeur de l'en-tête HTTP "Server:" renvoyée dans toutes les réponses.
   * Mettre à null pour ne pas exposer l'identité du serveur en production.
   */
  headerServer: "nodefony",

  /**
   * CONFIANCE ENVERS LE REVERSE-PROXY — en-têtes `X-Forwarded-*`.
   *
   * Détermine si Nodefony fait confiance aux en-têtes `X-Forwarded-For`
   * (IP cliente réelle), `X-Forwarded-Proto` (scheme) et `X-Forwarded-Host`.
   *
   * ⚠️ SÉCURITÉ : ces en-têtes sont triviaux à forger par n'importe quel client.
   * S'y fier sans restriction permet l'IP spoofing (contournement de rate-limit
   * / d'allow-list IP, falsification des logs d'audit) et le scheme spoofing.
   *
   * Valeurs :
   *   - `false` (DÉFAUT, secure) : ignore les `X-Forwarded-*` → IP = socket réel,
   *     scheme = connexion réelle. Correct si l'app est exposée DIRECTEMENT.
   *   - `true` : confiance totale. À n'utiliser QUE si un reverse-proxy de
   *     confiance est l'UNIQUE point d'entrée (aucun accès direct possible).
   *   - IP / CIDR / liste : ne faire confiance que si la connexion (socket)
   *     provient de ces adresses. Ex : `["10.0.0.0/8", "::1"]`.
   *   - presets : `"loopback"`, `"linklocal"`, `"uniquelocal"`.
   *
   * @see RFC 7239 — Forwarded HTTP Extension
   */
  trustProxy: false,

  /**
   * EN-TÊTES DE SÉCURITÉ HTTP — defaults OWASP secure-by-default.
   * Posés en amont (http-kernel.onHttpRequest) sur HTTP/HTTPS/HTTP2 — couvre
   * aussi les statics. Mettre une valeur à `null` pour désactiver le header.
   * @see https://owasp.org/www-project-secure-headers/
   */
  securityHeaders: {
    /**
     * Empêche le browser de "deviner" un type MIME différent du Content-Type.
     * Mitige les attaques de MIME-sniffing (ex: .txt exécuté comme JS).
     * Valeur fixe RFC : "nosniff" — pas d'autre valeur reconnue.
     */
    contentTypeOptions: "nosniff" as string | null,

    /**
     * Bloque l'embed du site dans un iframe externe — défense contre clickjacking.
     * "DENY" = jamais (recommandé) | "SAMEORIGIN" = même origine seulement.
     * NB : superposé par CSP `frame-ancestors` (Phase 6) — gardé pour compat
     * navigateurs anciens.
     */
    frameOptions: "DENY" as string | null,

    /**
     * HSTS — forcer HTTPS pendant `max-age` secondes (TLS uniquement, ignoré sur HTTP).
     * Posé UNIQUEMENT sur réponses HTTPS/HTTP2 (poser sur HTTP n'a aucun effet RFC).
     * Défaut 1 an + includeSubDomains (recommandation OWASP). `preload` opt-in :
     * ajoute le domaine à la HSTS preload list — ENGAGEMENT IRRÉVERSIBLE, ne pas
     * activer sans avoir lu https://hstspreload.org/#removal.
     */
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: false,
    } as {
      maxAge: number;
      includeSubDomains: boolean;
      preload: boolean;
    } | null,
  },

  /**
   * PARSEUR DE FORMULAIRES ET UPLOADS — formidable
   * @see https://github.com/felixge/node-formidable
   *
   * Utilisé pour parser les corps multipart/form-data et application/x-www-form-urlencoded.
   * Toutes ces valeurs peuvent être surchargées par le module app.
   */
  formidable: {
    /** Répertoire temporaire de dépôt des fichiers uploadés. */
    uploadDir: tmpDir,

    /**
     * Taille maximale d'un fichier uploadé en octets.
     * 524288000 = 500 MB. Réduire en production selon les besoins.
     */
    maxFileSize: 524288000,

    /**
     * Taille maximale CUMULÉE de tous les fichiers d'une même requête (octets).
     * Borne le volume écrit sur disque temporaire par requête → protège contre
     * la saturation disque (avec `multiples: true`, plusieurs fichiers sont
     * cumulables). Explicite ici (défaut formidable = `maxFileSize`) pour rendre
     * l'intention de cap disque visible. 524288000 = 500 MB / requête.
     */
    maxTotalFileSize: 524288000,

    /** Autoriser plusieurs fichiers dans un même formulaire. */
    multiples: true,

    /**
     * Taille maximale cumulée de tous les champs texte (hors fichiers).
     * 2097152 = 2 MB. Un corps > cette limite → erreur (actuellement mappée en 500,
     * futur: 413 Payload Too Large).
     */
    maxFieldsSize: 2097152,

    /** Nombre maximal de champs dans un formulaire (protection contre les abus). */
    maxFields: 1000,

    /** Encodage des champs texte. */
    encoding: "utf-8",
  },

  /**
   * PARSEUR DE QUERY STRING — qs
   * @see https://github.com/ljharb/qs
   *
   * Utilisé pour parser les query strings des URLs (GET params).
   */
  queryString: {
    /** Nombre maximal de paramètres acceptés dans la query string. */
    parameterLimit: 1000,

    /** Séparateur de paramètres. "&" est le standard HTTP. */
    delimiter: "&",

    /**
     * Ignorer le "?" en début de query string lors du parsing.
     * true = qs reçoit "foo=bar" sans le "?" initial.
     */
    ignoreQueryPrefix: true,
  },

  /**
   * SERVEUR HTTP (port 5151 par défaut)
   * @see https://nodejs.org/api/http.html#class-httpserver
   *
   * Surcharge possible : "module-http": { http: { timeout: 60000 } }
   */
  http: {
    /**
     * Nombre maximal d'en-têtes HTTP acceptés par requête.
     * Protection contre les attaques par headers flooding.
     */
    maxHeadersCount: 2000,

    /**
     * Délai keep-alive en ms entre deux requêtes sur la même connexion TCP.
     * 5000 ms = standard HTTP/1.1. Augmenter pour les clients lents.
     */
    keepAliveTimeout: 5000,

    /**
     * Timeout global de la socket en ms.
     * Si aucune donnée n'arrive dans ce délai, la connexion est fermée.
     * 120000 = 2 minutes.
     */
    timeout: 120000,

    /**
     * Timeout pour recevoir la requête complète (headers + body) en ms.
     * 30000 = 30 secondes. Protège contre les "slow loris" attacks.
     */
    requestTimeout: 30000,

    /**
     * Timeout pour envoyer la réponse complète en ms.
     * 30000 = 30 secondes. Utile pour les réponses streamed longues.
     */
    responseTimeout: 30000,

    /**
     * En-têtes HTTP supplémentaires à ajouter à toutes les réponses HTTP.
     * Exemple : { "X-Frame-Options": "DENY", "Strict-Transport-Security": "..." }
     * null = aucun en-tête supplémentaire.
     */
    headers: null,
  },

  /**
   * SERVEUR HTTPS (port 5152 par défaut)
   * Mêmes options que http + options TLS spécifiques.
   * @see https://nodejs.org/api/https.html
   *
   * Surcharge possible : "module-http": { https: { requestTimeout: 60000 } }
   */
  https: {
    /**
     * Rejeter les certificats TLS non valides (auto-signés inclus).
     * false en développement (certs auto-signés). TOUJOURS true en production.
     */
    rejectUnauthorized: false,

    maxHeadersCount: 2000,
    keepAliveTimeout: 5000,
    timeout: 120000,
    requestTimeout: 30000,
    responseTimeout: 30000,
    headers: null,
  },

  /**
   * SERVEUR HTTP/2
   * Activé automatiquement sur le même port HTTPS (allowHTTP1: true).
   * @see https://nodejs.org/api/http2.html
   */
  http2: {
    /**
     * Autoriser le server push HTTP/2 (envoi proactif de ressources au client).
     * Désactiver si le reverse proxy (nginx, Caddy) gère le push lui-même.
     */
    enablePush: true,
  },

  /**
   * SERVEUR HTTP/3 (QUIC)
   * Réservé pour une implémentation future.
   * Node.js >= 28 sera requis pour le support natif HTTP/3.
   */
  http3: {},

  /**
   * CERTIFICATS TLS
   * Utilisés par le serveur HTTPS et WSS.
   *
   * Si ca/key/cert sont vides, Nodefony génère automatiquement un certificat
   * au démarrage :
   *   - en développement, via `mkcert` si disponible (CA locale trustée → HTTPS
   *     sans erreur navigateur, requis pour le HMR cross-origin/WSS), sinon
   *     fallback auto-signé node-forge (avec SAN, mais non trusté) ;
   *   - en production, fallback auto-signé node-forge (fournir un vrai cert).
   *
   * Surcharge pour la production :
   *   "module-http": {
   *     certificates: {
   *       ca:   "/etc/ssl/ca.pem",
   *       key:  "/etc/ssl/private.key",
   *       cert: "/etc/ssl/cert.pem",
   *     }
   *   }
   */
  certificates: {
    /** Chemin vers le CA bundle (Certificate Authority). Vide = auto-signé. */
    ca: "",

    /** Chemin vers la clé privée TLS. Vide = générée automatiquement. */
    key: "",

    /** Chemin vers le certificat TLS. Vide = généré automatiquement. */
    cert: "",

    /** Options de génération en développement. */
    dev: {
      /**
       * Préférer `mkcert` (CA locale trustée) pour le certificat de dev.
       * true = HTTPS sans erreur navigateur (HMR cross-origin/WSS) si mkcert
       * est installé (`brew install mkcert nss && mkcert -install`).
       * false = forcer le fallback auto-signé node-forge. Ignoré hors dev.
       */
      useMkcert: true,
    },

    /** Options pour la génération automatique du certificat auto-signé. */
    openssl: {
      /** Taille de la clé RSA en bits. 2048 minimum, 4096 recommandé en prod. */
      size: 2048,
      attrs: [
        {
          name: "commonName",
          value: Nodefony.getKernel()?.domain || "nodefony.com",
        },
        {
          name: "organizationName",
          value: Nodefony.getKernel()?.projectName || "",
        },
        {
          name: "organizationalUnitName",
          value: "Development",
        },
      ],
    },
  },

  /**
   * SERVEUR WEBSOCKET (ws:// — port 5151)
   * Fonctionne sur le même port que le serveur HTTP.
   * @see https://github.com/websockets/ws
   *
   * Surcharge possible : "module-http": { websocket: { keepaliveInterval: 30000 } }
   */
  websocket: {
    /**
     * Intervalle d'envoi des pings keep-alive en ms.
     * Détecte les connexions zombies (client disparu sans fermer proprement).
     */
    keepaliveInterval: 20000,

    /**
     * Délai de grâce après un ping sans réponse avant de fermer la connexion.
     * Si le client ne répond pas dans ce délai → connexion fermée.
     */
    keepaliveGracePeriod: 10000,

    /**
     * Timeout pour fermer proprement une connexion WebSocket.
     * Après ce délai sans close frame du client, la socket est détruite.
     */
    closeTimeout: 5000,

    /**
     * Taille maximale (octets) d'un message WebSocket entrant.
     * Au-delà, `ws` ferme la connexion avec le code RFC 6455 §7.4.1
     * **1009 "Message Too Big"** (et émet `error` → capté par
     * `WebsocketContext.onConnectionError`, pas de crash process).
     *
     * Défaut **1 MiB** : secure-by-default contre le DoS mémoire (un message
     * non borné = allocation côté serveur pilotée par le client). Précédent
     * socket.io (`maxHttpBufferSize` = 1e6). `ws` lui-même défaute à 100 MiB.
     * Une app qui transfère de gros payloads doit relever explicitement ce seuil :
     *   "module-http": { websocket: { maxPayload: 16 * 1024 * 1024 } }
     */
    maxPayload: 1024 * 1024,
  },

  /**
   * SERVEUR WEBSOCKET SECURE (wss:// — port 5152)
   * Mêmes options que websocket, sur le port HTTPS.
   */
  websocketSecure: {
    keepaliveInterval: 20000,
    keepaliveGracePeriod: 10000,
    closeTimeout: 5000,
    maxPayload: 1024 * 1024,
  },

  /**
   * SOCKJS (transport WebSocket de fallback)
   * Utilisé pour la compatibilité avec les clients qui ne supportent pas WS natif.
   * @deprecated — peut être retiré dans une future version.
   */
  sockjs: {
    protocol: "https",
    websocket: true,
    domain: "localhost",
    port: 5152,
    prefix: "/sockjs-node",
    stats: {
      cached: false,
      cachedAssets: false,
    },
  },

  /**
   * FICHIERS STATIQUES — serve-static
   *
   * Le serveur statique sert les fichiers depuis les répertoires déclarés ici.
   * Il est appelé AVANT le routage : si un fichier correspond, il est servi
   * directement sans passer par les controllers.
   *
   * SÉCURITÉ : serve-static bloque automatiquement le path traversal (/../).
   * CACHE : les en-têtes Cache-Control / ETag sont gérés automatiquement.
   *
   * Pour ajouter un répertoire statique depuis un module (ex: module app) :
   *   "module-http": {
   *     statics: {
   *       assets: {
   *         path: "public/assets",         // relatif à la racine du projet
   *         options: {
   *           maxAge: 30 * 24 * 60 * 60 * 1000,  // 30 jours en ms
   *           index: false,                // désactiver index.html auto
   *           dotfiles: "deny",            // bloquer les .env, .htaccess
   *         }
   *       }
   *     }
   *   }
   *
   * DÉVELOPPEMENT UNIQUEMENT : en production, utilisez un reverse proxy
   * (nginx, Caddy, Varnish) pour les fichiers statiques — bien plus efficace.
   *
   * @see https://github.com/expressjs/serve-static
   */
  statics: {
    /**
     * Options appliquées à TOUS les répertoires statiques (sauf surcharge par entrée).
     * Chaque entrée dans statics peut override ces valeurs via sa clé "options".
     */
    defaultOptions: {
      /** Activer la gestion du Cache-Control header. */
      cacheControl: true,

      /**
       * Durée de mise en cache côté client en secondes.
       * 96 * 3600 = 4 jours. Augmenter pour les assets versionnés (images, fonts).
       */
      maxAge: 96 * 60 * 60,
    },

    /**
     * Répertoire "web" servi par défaut depuis la racine du projet.
     * Accessible via http://localhost:5151/[fichier]
     *
     * Surcharge depuis le module app :
     *   "module-http": { statics: { web: { path: "dist/public" } } }
     */
    web: {
      /** Chemin relatif à la racine du projet (kernel.path). */
      path: "public",
      options: {
        /** 30 jours en ms pour les assets statiques du projet. */
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    },
  },

  /**
   * GESTIONNAIRE DE SESSIONS
   *
   * Les sessions sont stockées côté serveur, identifiées par un cookie chiffré (AES-256-CTR).
   *
   * HANDLERS DISPONIBLES :
   *   "files"      — stockage filesystem (défaut, sans dépendance)
   *   "sequelize"  — base de données relationnelle via @nodefony/sequelize
   *   "mongoose"   — MongoDB via @nodefony/mongoose
   *   "memcached"  — Memcached via le service memcached
   *
   * SURCHARGE PAR LE MODULE APP :
   *   "module-http": {
   *     session: {
   *       name: "myapp_session",
   *       handler: "sequelize",
   *       cookie: { maxAge: 3600, secure: true }
   *     }
   *   }
   */
  session: {
    /**
     * Utiliser les transactions Sequelize pour les sessions.
     * Uniquement pertinent si handler = "sequelize".
     */
    applyTransaction: true,

    /**
     * Démarrage automatique de la session à chaque requête.
     *   false          — pas de démarrage auto (démarrage explicite dans le controller)
     *   true           — démarre la session avec le contexte par défaut
     *   "contextName"  — démarre avec un contexte nommé (namespace de session)
     *
     * Recommandation : false par défaut, démarrer explicitement avec startSession()
     * dans les controllers qui en ont besoin.
     */
    start: false,

    /**
     * Mode strict : rejette les IDs de session inconnus (non trouvés en storage).
     * true = sécurité renforcée, crée une nouvelle session si l'ID est invalide.
     * false = compatible avec les anciennes sessions (migration).
     */
    use_strict_mode: true,

    /** Nom du cookie de session (aussi utilisé comme clé de query string si use_trans_sid). */
    name: "nodefony",

    /**
     * Handler de stockage des sessions.
     * La valeur doit correspondre à un service enregistré dans le DI container
     * ou à l'un des handlers built-in : "files" | "sequelize" | "mongoose" | "memcached".
     */
    handler: "files",

    /**
     * Chemin de stockage pour le handler "files".
     * Relatif à la racine du projet. Créé automatiquement s'il n'existe pas.
     */
    save_path: "./tmp/sessions",

    /**
     * Probabilité de déclenchement du garbage collector des sessions expirées.
     * gc_probability / gc_divisor = 5/100 = 5% de chance à chaque requête.
     * Augmenter si beaucoup de sessions zombies s'accumulent.
     */
    gc_probability: 5,
    gc_divisor: 100,

    /**
     * Durée de vie maximale d'une session inactive en secondes (garbage collection).
     * 1440 secondes = 24 minutes.
     */
    gc_maxlifetime: 1440,

    /**
     * Algorithme de hachage pour générer les IDs de session.
     * "md5" ou "sha1". sha1 est plus résistant aux collisions.
     */
    hash_function: "md5",

    /** Transmettre l'ID de session via les cookies (recommandé). */
    use_cookies: true,

    /**
     * N'accepter l'ID de session QUE via les cookies (pas en query string).
     * true = meilleure sécurité (pas de session fixation via URL).
     */
    use_only_cookies: true,

    /**
     * Vérifier que le Referer correspond au domaine courant.
     * false par défaut (peut bloquer les requêtes cross-origin légitimes).
     */
    referer_check: false,

    /**
     * Options du cookie de session.
     * Fusionnées avec les defaults de Cookie (httpOnly: true, secure: true).
     */
    cookie: {
      /**
       * Durée de vie du cookie en secondes.
       * 0 = cookie de session (supprimé à la fermeture du navigateur).
       * 3600 = expire après 1 heure.
       */
      maxAge: 0,

      /** Inaccessible via JavaScript (document.cookie) — protection XSS. */
      httpOnly: true,

      /** Envoyé uniquement via HTTPS. TOUJOURS true en production. */
      secure: true,

      /** Signer le cookie avec le secret HMAC du kernel. */
      signed: false,
    },

    /**
     * Configuration du service Memcached (uniquement si handler = "memcached").
     * @see https://github.com/3rd-Eden/memcached
     */
    memcached: {
      servers: {
        nodefony: {
          location: "127.0.0.1",
          port: 11211,
          /** Poids relatif de ce serveur dans le pool (utile pour le clustering). */
          weight: 1,
        },
      },
      options: {
        debug: false,
        /** Timeout de connexion au serveur Memcached en ms. */
        timeout: 5000,
      },
    },
  },

  /**
   * CLIENT HTTP (fetch interne)
   * Service utilisé par les controllers pour faire des requêtes HTTP sortantes.
   * null = configuration par défaut (pas d'agent personnalisé).
   * Exemple de surcharge : { agent: { rejectUnauthorized: false } }
   */
  requestClient: null,
};

/**
 * NB : Le format de log par requête (`pretty`/`json`/`default`) se configure
 * au niveau KERNEL (`nodefony/config/config.ts` → `log.requestFormat`), pas
 * ici. La décision appartient à syslog (transport partagé), pas au module
 * HTTP — voir `HttpKernel.applyRequestLoggerFromConfig()`.
 */
