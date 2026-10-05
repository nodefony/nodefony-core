import { defineEnv, envBoolean, envEnum, envNumber, envString } from "nodefony";

/**
 * Catalogue typé des variables d'environnement — SEUL lecteur de `process.env`.
 * Validé au boot (fail-fast), exposé au descripteur de config via `ctx.env`.
<% if (it.complete) { %> *
 * 💾 PERSISTANCE (infra déclarée) : tu déclares une ou deux URLs, le framework
 * DÉRIVE les stores (users, sessions, jetons, idempotence…) — `store: "auto"`.
<% } %> */
export const env = defineEnv({
  /**
   * Port d'écoute HTTP. Absent = défaut du framework (5151). Le déclarer est le
   * cas du DÉPLOIEMENT : le port y est un contrat (service k8s, ingress, sonde).
   * En dev, ne rien mettre : si 5151 est déjà pris (une autre app Nodefony),
   * le framework prend le port libre suivant et l'ANNONCE (`portPolicy: "auto"`,
   * défaut hors production) — en production il échoue franchement (`strict`),
   * car un pod qui écoute ailleurs en silence est un pod injoignable.
   */
  NF_PORT: envNumber({
    optional: true,
    description: "Port d'écoute HTTP (défaut framework 5151).",
  }),

  /**
   * Alias PLATEFORME : Cloud Run, Heroku, Railway et Fly injectent `PORT` et
   * exigent que le process écoute dessus. On l'accepte tel quel — zéro glue de
   * déploiement. `NF_PORT` l'emporte si les deux sont présents.
   */
  PORT: envNumber({
    optional: true,
    description:
      "Alias plateforme du port HTTP (Cloud Run/Heroku) — NF_PORT gagne.",
  }),

  /**
   * Port d'écoute HTTPS/HTTP2 (défaut framework 5152). Pas d'alias plateforme :
   * en cloud, le TLS est terminé à l'ingress et le pod sert en clair.
   */
  NF_PORT_HTTPS: envNumber({
    optional: true,
    description: "Port d'écoute HTTPS/HTTP2 (défaut framework 5152).",
  }),

  /**
   * DEV — écoute sur TOUTES les interfaces (`0.0.0.0`) au lieu de la seule
   * boucle locale, pour ouvrir l'application depuis un téléphone, une tablette
   * ou un autre poste du réseau local (`https://<IP-de-la-machine>:5152`).
   * Page, scripts Vite et rechargement à chaud passent par le MÊME port :
   * une seule exception de certificat à accepter sur l'appareil. Absente =
   * boucle locale seule — le serveur de développement expose ses outils
   * d'administration, il ne s'ouvre pas au réseau sans qu'on le demande.
   * En production l'écoute est déjà sur toutes les interfaces.
   */
  NF_BIND_ALL: envBoolean({
    default: false,
    description:
      "DEV : écoute sur toutes les interfaces (0.0.0.0) — ouvrir l'app depuis le réseau local.",
  }),

  NF_LOG_DRIVER: envEnum(["stdout", "file", "null"] as const, {
    default: "stdout",
  }),

  /**
   * Nombre de processus Node lancés par `nodefony production` / `cluster`.
   * Trois formes : `1` — le défaut, un process par pod, la mise à l'échelle
   * est le travail de l'orchestrateur ; `"auto"` — un worker par cœur ALLOUÉ
   * (quota cgroup du conteneur, jamais `os.cpus()`) ; ou un nombre explicite.
   * Trois voies, de la plus forte à la plus faible : `--workers <n|auto>` sur
   * la ligne de commande > cette variable > le fichier
   * `nodefony/config/cluster/cluster.config.ts` (non généré : sa valeur serait
   * le défaut — à créer si la topologie doit vivre en git, voir le README).
   * Lue par le maître AVANT le boot : déclarée ici pour le catalogue
   * (`npx nodefony env`), pas pour être lue par l'application. `npm run dev`
   * l'ignore — le développement est toujours mono-process.
   */
  NF_WORKERS: envString({
    optional: true,
    description:
      "Processus Node à lancer : 1 (défaut, un par pod) | auto (cœurs alloués, cgroup) | <n>.",
  }),
<% if (it.complete) { %>
  /**
   * Infra `database` : URL unique, dialecte déduit du scheme
   * (`sqlite:./var/app.db` | `postgres://…` | `mysql://…` | `mongodb://…`).
   * ABSENTE = profil solo : sqlite local (l'app persiste quand même).
   * Alias plateforme accepté : `DATABASE_URL`. Secret → jamais loggée brute.
   */
  NF_DATABASE_URL: envString({
    optional: true,
    description:
      "Infra database : URL unique (sqlite:|postgres://|mysql://|mongodb://), dialecte déduit du scheme.",
  }),

  /**
   * Infra `cache` (éphémère partagé) : URL Redis. Sa présence CHARGE le module
   * `@nodefony/redis` et aiguille les briques éphémères (sessions, idempotence)
   * vers Redis. Alias plateforme accepté : `REDIS_URL`.
   */
  NF_REDIS_URL: envString({
    optional: true,
    description:
      "Infra cache : URL Redis (redis://…) — sa présence charge @nodefony/redis.",
  }),

  /**
   * 🔐 Clés de chiffrement au repos (module security) — les VALEURS vivent dans
   * `.env` (gitignoré), générées à la création de l'app. Rotation ou
   * rattrapage : `npx nodefony security:secrets --write`. En production :
   * Secret k8s / vault — jamais en git.
   *
   * Les deux PREMIÈRES sont `optional` À DESSEIN : absentes, la brique
   * concernée se désactive en fail-safe (2FA, webhooks) avec un log CRITIC —
   * une application qui n'en use pas doit pouvoir démarrer sans elles. Ne pas
   * leur ajouter `requiredIn` par symétrie : ce serait refuser de démarrer une
   * application qui ne s'en sert pas.
   */
  NF_TOTP_KEY: envString({
    optional: true,
    description:
      "Clé de chiffrement des secrets 2FA/TOTP au repos (32 octets base64).",
  }),
  NF_WEBHOOK_KEY: envString({
    optional: true,
    description:
      "Clé de chiffrement des secrets de signature webhook (32 octets base64).",
  }),
  /**
   * Celle-ci n'a PAS de repli acceptable. Absente, un secret est tiré au
   * démarrage : chaque exemplaire en tire un différent, et chaque redémarrage
   * en change — un pod refuse alors le jeton anti-CSRF qu'un autre vient
   * d'émettre, et l'utilisateur voit un formulaire rejeté au hasard, sans la
   * moindre erreur dans les journaux. `requiredIn` fait échouer le démarrage
   * là où ça compte, et `nodefony doctor --env production` le dit AVANT.
   */
  NF_CSRF_SECRET: envString({
    optional: true,
    requiredIn: ["production"],
    description:
      "Secret des jetons anti-CSRF (synchronizer) — partagé entre process en cluster.",
  }),

  /**
   * URL PUBLIQUE de l'application en tant qu'ÉMETTEUR de jetons (claim `iss`,
   * RFC 8414 §2 : https, ni requête ni fragment). Elle ne se devine pas —
   * derrière un relais, `Host` et `X-Forwarded-*` viennent du client : c'est
   * l'exploitant qui l'écrit. **Absente ⇒** en développement l'adresse locale ;
   * en production `"nodefony"` : les jetons fonctionnent, mais rien n'est
   * publié et aucun tiers ne peut vérifier une signature émise ici.
   * **STABLE** : gravée dans chaque jeton, la changer les invalide.
   */
  NF_JWT_ISSUER: envString({
    optional: true,
    description:
      "URL publique de l'app comme émetteur de jetons (https) — sans elle, aucune découverte RFC 8414.",
  }),

  /**
   * 🔐 Clé de SIGNATURE des jetons JWT, PARTAGÉE par tous les process qui
   * servent l'application — pods derrière un répartiteur, workers de
   * `nodefony cluster`. Elle est câblée dans `jwt.keystore.keySetJson`.
   *
   * **Pourquoi elle existe.** Chaque jeton porte le `kid` de la clé qui l'a
   * signé. Deux process qui ont chacun leur clé refusent les jetons l'un de
   * l'autre : l'utilisateur est déconnecté au hasard de la répartition (401).
   *
   * **Absente ⇒** développement : rien à faire, la clé vit dans `var/keys/`
   * (persistée, créée par un seul worker). Production : chaque process signe
   * avec une clé ÉPHÉMÈRE, annoncée par un WARNING au premier jeton — tolérable
   * pour UN seul process, faux dès le deuxième, et tous les jetons sont perdus à
   * chaque redémarrage. Facultative pour la même raison que `NF_TOTP_KEY` : une
   * application qui n'émet aucun jeton doit pouvoir démarrer sans elle.
   *
   * **Valeur** : un jeu de clés Ed25519 en JSON, sur UNE ligne —
   * `npx nodefony security:secrets --jwt-keyset`. Elle contient la clé PRIVÉE :
   * gestionnaire de secrets (Secret k8s, vault), jamais un fichier du poste, jamais
   * git. En développement rien à poser : la clé vit dans `var/keys/`.
   * **Illisible ⇒** la configuration security est refusée au démarrage, le
   * chemin nommé, la valeur jamais recopiée.
   *
   * **STABLE** : la remplacer refuse les jetons en vol. Rotation : ajouter la
   * nouvelle clé au tableau `keys`, la désigner dans `active`, garder l'ancienne
   * le temps que ses jetons expirent.
   */
  NF_JWT_KEYSET: envString({
    optional: true,
    description:
      "Clé de signature des JWT partagée par tous les pods/workers (JSON une ligne, `security:secrets --jwt-keyset`) — absente : une clé par process.",
  }),

  /**
   * Mot de passe du compte admin seedé au premier boot (voir
   * `nodefony/security/users.ts`). DEV : défaut `nodefony-dev-42` (compte admin/nodefony-dev-42,
   * comme Grafana — pratique, LOCAL uniquement). PROD : OBLIGATOIRE — sans lui
   * le seed refuse (jamais de mot de passe par défaut en production).
   *
   * Pas de `requiredIn` : l'exigence ne vaut qu'au PREMIER démarrage. Une fois
   * le compte créé, la variable ne sert plus — la rendre requise ferait refuser
   * de démarrer un déploiement qui tourne depuis des mois.
   */
  NF_ADMIN_PASSWORD: envString({
    optional: true,
    description:
      "Mot de passe du compte admin seedé au 1er boot (obligatoire en production).",
  }),

  /**
   * Connexion par Keycloak (OpenID Connect). Le fournisseur n'est monté que si
   * les TROIS sont posées (`nodefony/config/security.ts`) : absentes, l'app
   * démarre sans bouton ni avertissement. Le décor de développement — profil
   * `keycloak` du `compose.yaml`, realm `docker/keycloak/import/` — en donne les
   * valeurs, commentées dans `.env`.
   *
   * Préfixées `NF_` : Keycloak est AUTO-HÉBERGÉ, ces valeurs sont émises par TON
   * serveur et aucun écosystème n'en fixe le nom.
   */
  NF_KEYCLOAK_ISSUER: envString({
    optional: true,
    description:
      "OIDC Keycloak — émetteur = URL du realm, en https (ex. https://localhost:8444/realms/<%= it.appName %>).",
  }),
  NF_KEYCLOAK_CLIENT_ID: envString({
    optional: true,
    description: "OIDC Keycloak — identifiant du client confidentiel.",
  }),
  NF_KEYCLOAK_CLIENT_SECRET: envString({
    optional: true,
    description:
      "OIDC Keycloak — secret du client confidentiel (SECRET, jamais loggé).",
  }),
  /**
   * Base d'URL des retours OAuth : l'URL PUBLIQUE de l'application, que le
   * fournisseur compare au caractère près à celle qu'il a enregistrée (RFC 9700).
   * Absente = `https://localhost:<NF_PORT_HTTPS>`, l'adresse de développement —
   * à poser en production. `localhost`, jamais `127.0.0.1` : cookies et passkeys
   * exigent un nom.
   */
  NF_OAUTH_REDIRECT_BASE: envString({
    optional: true,
    description:
      "Base d'URL des retours OAuth (exact match fournisseur) — l'URL publique en production.",
  }),
<% } %><% if (it.complete || it.front) { %>
  // Le dev-server Vite n'a AUCUNE variable d'environnement : il reste sur la
  // boucle locale et Nodefony le relaie sur l'origine de la page — ton poste,
  // un navigateur en conteneur et un téléphone du réseau local chargent la
  // même page en même temps, sans rien à poser.
<% } %>});
