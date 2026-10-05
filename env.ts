/**
 * CATALOGUE des variables d'environnement de l'application — `defineEnv`.
 *
 * SEUL point du projet qui lit `process.env`. Chaque variable est déclarée avec sa
 * coercion typée (string/number/boolean/enum), son défaut et sa doc ; `defineEnv`
 * lit la source UNE fois au boot, valide (zod) et retourne un objet **figé + typé**.
 *
 * Le type inféré (`typeof env`) alimente `ConfigContext<Env>` dans
 * `nodefony.config.ts` → `ctx.env.NF_LOG_DRIVER` est auto-complété + typé + documenté
 * en hover. Une valeur PRÉSENTE mais invalide (enum hors liste, nombre malformé) fait
 * échouer le boot avec un message clair nommant la variable (≠ fallback silencieux qui
 * masque un bug de déploiement) ; une valeur ABSENTE prend le défaut déclaré.
 *
 * Recette « lire une var d'env » : la déclarer ICI, puis lire `ctx.env.X` dans
 * `nodefony.config.ts`. Ne JAMAIS lire `process.env.X` ailleurs. Les secrets / URLs
 * viennent de `.env` sur le poste (jamais commité), de l'orchestrateur (k8s Secret,
 * Cloud Run, `-e`) ou d'un secret-manager en production ; la notice complète est
 * `.env.example` (générée : `npx nodefony env --example`).
 *
 * Secret en conteneur : toute variable accepte aussi `<NOM>_FILE` (Docker secret,
 * K8s, Vault) → la valeur est lue depuis le fichier monté pointé (cf ADR-0006).
 */
import { defineEnv, envBoolean, envEnum, envNumber, envString } from "nodefony";

export const env = defineEnv({
  // ── Réseau : ports d'écoute ────────────────────────────────────────────────
  /**
   * Port du serveur HTTP en clair. Absent = défaut framework (5151). Le rendre
   * EXPLICITE est le cas PROD : le port y est un **contrat** (service k8s,
   * ingress, sonde de santé) — c'est aussi pourquoi `servers.portPolicy` vaut
   * `strict` hors dev (un port occupé = échec franc, jamais un glissement
   * silencieux qui donnerait un pod « sain » que personne n'atteint).
   * En dev, ne rien déclarer : `portPolicy: auto` prend le prochain port libre
   * (plusieurs apps Nodefony côte à côte) et ANNONCE le décalage.
   */
  NF_PORT: envNumber({
    optional: true,
    section: "Réseau et processus",
    title: "Port HTTP",
    description:
      "Le port sur lequel l'application répond en HTTP (sans chiffrement).\nEn développement, laisse vide : si le port est déjà pris par une autre application, le suivant est choisi et annoncé au démarrage. En production, fixe-le : c'est le port qu'attendent l'hébergeur et ses sondes de santé — s'il est occupé, le démarrage échoue.",
    example: "8080",
    defaultNote: "5151",
  }),

  /**
   * Alias PLATEFORME du port HTTP : Cloud Run, Heroku, Railway, Fly injectent
   * `PORT` sans préfixe et attendent que le process écoute DESSUS. On l'accepte
   * tel quel (zéro glue de déploiement). `NF_PORT` gagne s'il est aussi présent
   * (même règle que `NF_DATABASE_URL` vs `DATABASE_URL`).
   */
  PORT: envNumber({
    optional: true,
    section: "Réseau et processus",
    title: "Port HTTP fourni par l'hébergeur",
    description:
      "Cloud Run, Heroku, Railway ou Fly posent eux-mêmes cette variable et attendent que l'application écoute dessus : tu n'as rien à écrire. Si NF_PORT est aussi posée, c'est NF_PORT qui l'emporte.",
  }),

  /**
   * Port du serveur HTTPS/HTTP2. Absent = défaut framework (5152). Pas d'alias
   * plateforme : en cloud-native, le TLS est terminé à l'ingress et le pod sert
   * en clair (`servers: { https: false }`) — ce port sert au dev, au bare-metal
   * et aux déploiements TLS bout-en-bout.
   */
  NF_PORT_HTTPS: envNumber({
    optional: true,
    section: "Réseau et processus",
    title: "Port HTTPS",
    description:
      "Le port sur lequel l'application répond en HTTPS (chiffré, HTTP/2).\nEn développement, laisse vide. Dans le cloud, le chiffrement se fait souvent devant l'application (ingress, répartiteur de charge) : ce port ne sert alors pas.",
    example: "8443",
    defaultNote: "5152",
  }),

  /**
   * DEV uniquement — expose le serveur sur TOUTES les interfaces (`domain` 0.0.0.0
   * au lieu de 127.0.0.1) ET active `trustProxy` (loopback + uniquelocal) pour
   * honorer les en-têtes forwarded. Sert le **banc reverse-proxy Docker**
   * (`docker compose --profile proxy`, joignable depuis les conteneurs). Défaut
   * `false` : le dev reste loopback-only + zéro confiance proxy (sûr). En prod le
   * bind est déjà 0.0.0.0 et `trustProxy` se règle explicitement.
   */
  NF_BIND_ALL: envBoolean({
    default: false,
    section: "Réseau et processus",
    title: "Ouvrir au réseau (développement)",
    description:
      "En développement, l'application n'écoute que ta propre machine. true l'ouvre à toutes les interfaces — pour l'atteindre depuis un conteneur Docker (banc de proxy inverse), un téléphone ou un autre poste — et fait confiance aux en-têtes d'un proxy local.\nLaisse false sinon : le serveur de développement expose des outils d'administration.",
  }),

  // ── Infra déclarée (modèle « infra déclarée » — cf docs/guides/configuration.md) ──
  /**
   * Infra `database` (durable) : UNE URL déclare la base de l'app — le dialecte est
   * déduit du scheme (`sqlite:…` | `postgres://…` | `mysql://…` | `mongodb://…`) et
   * les briques durables en `store: "auto"` (users, tokens, audit, webhooks…) la
   * suivent. Alias plateforme accepté : `DATABASE_URL` (Heroku/Railway — `NF_` gagne).
   * Absente = profil solo (sqlite local + memory + files). Porte le secret → jamais loggée brute.
   */
  NF_DATABASE_URL: envString({
    optional: true,
    // L'URL porte le mot de passe : sa place est le gestionnaire de secrets.
    placement: "secrets",
    section: "Base de données et cache",
    title: "Base de données",
    description:
      "L'adresse de ta base de données, en une seule URL : son début dit de quelle base il s'agit (sqlite:, postgres://, mysql://, mongodb://).\nSans elle, l'application utilise une base SQLite dans var/databases/ — rien à installer, et les données survivent au redémarrage. Elle contient un mot de passe : jamais commitée. DATABASE_URL (Heroku, Railway) est aussi acceptée.",
    example: "postgres://app:motdepasse@localhost:5432/app",
  }),

  /**
   * Infra `cache` (éphémère partagé) : URL Redis. Sa présence CHARGE le module
   * `@nodefony/redis` (gating `when` du manifeste) et aiguille les briques
   * éphémères en `store: "auto"` (idempotence, sessions) vers Redis. Alias
   * plateforme accepté : `REDIS_URL` (`NF_` gagne). Porte le secret → jamais loggée brute.
   */
  NF_REDIS_URL: envString({
    optional: true,
    // L'URL porte le mot de passe : sa place est le gestionnaire de secrets.
    placement: "secrets",
    section: "Base de données et cache",
    title: "Redis (cache partagé)",
    description:
      "L'adresse d'un serveur Redis. Sa seule présence branche Redis : les sessions et l'anti-double-envoi des formulaires sont alors partagés entre plusieurs exemplaires de l'application.\nSans elle, tout reste en mémoire — parfait pour un seul exemplaire. REDIS_URL est aussi acceptée.",
    example: "redis://:motdepasse@localhost:6379",
  }),

  // ── Source d'identité de l'application (provisioning du service "users") ────
  /**
   * Implémentation du dépôt utilisateur posé par l'app au boot (`App.onKernelReady`
   * → `provisionUsers`). `auto` (défaut) = suit l'infra database déclarée
   * (`NF_DATABASE_URL` SQL → drizzle, mongo → mongoose), repli `drizzle` (SQL local
   * — les comptes DOIVENT survivre au restart) ; `drizzle`/`mongoose` = explicite ;
   * `memory` = annuaire volatil (zéro I/O SQLite) pour les **tests de charge**
   * (la mesure n'est pas polluée par le sync better-sqlite3), les scripts et les
   * tests manuels. Surcharge ponctuelle : `NF_USER_STORE=memory` dans `.env`.
   */
  NF_USER_STORE: envEnum(["auto", "drizzle", "mongoose", "memory"] as const, {
    default: "auto",
    section: "Stockages (où chaque brique garde ses données)",
    title: "Où sont stockés les comptes",
    description:
      "auto suit la base de données déclarée (et sinon SQLite local : les comptes survivent au redémarrage). memory garde tout en mémoire — perdu à l'arrêt, réservé aux bancs de charge et aux essais.",
  }),

  /**
   * OVERRIDE GLOBAL de sélection de store — force TOUTE brique `auto` (session,
   * tokens, passkeys, totp, audit, webhooks, idempotence, users) vers ce backend,
   * en amont de toute préférence d'infra. Cas d'usage : `NF_STORE=memory` pour un
   * banc de CHARGE — mesurer le framework sans le goulot sqlite/disque, en UNE
   * variable, sans toucher aux configs par brique. Vide = pas d'override. N'affecte
   * PAS un store configuré explicitement (il ne passe pas par `auto`). Un backend
   * demandé mais non enregistré sur une brique est ignoré pour elle (jamais de crash).
   */
  NF_STORE: envString({
    optional: true,
    section: "Stockages (où chaque brique garde ses données)",
    title: "Forcer tous les stockages (bancs de charge)",
    description:
      "Envoie d'un coup tous les stockages réglés sur auto (sessions, jetons, comptes…) vers ce backend. Sert aux bancs de charge (memory) : mesurer le framework sans le disque. Laisse vide en temps normal.",
    example: "memory",
  }),

  // ── Backing du cache d'idempotence des mutations (P6.8) ────────────────────
  /**
   * Store d'idempotence (anti double-effet `@Idempotent` + data plane admin).
   * `memory` (défaut) = cache per-pod (la socket reste affine à son pod ; suffit
   * en mono-pod). Deux stores DISTRIBUÉS cross-pod (le 409 in-flight marche
   * VRAIMENT en cluster multi-pod, façon Stripe) :
   * - `redis` = `SET NX PX` atomique + TTL natif → EXIGE `@nodefony/redis` chargé ;
   * - `drizzle` = réservation SQL atomique (`INSERT … ON CONFLICT DO UPDATE`) sur
   *   la base applicative → pour un cluster qui a déjà du SQL mais pas de Redis
   *   (GC applicatif, pas de TTL natif). Multi-pod réel = connecteur drizzle en
   *   Postgres (en SQLite mono-fichier, `memory` suffit ; câblage actif en sqlite
   *   pour l'app dev, fail-loud si l'ORM n'est pas en sqlite — cf chantier multi-dialecte).
   * Un store distribué demandé mais non câblé → le boot ÉCHOUE (fail-loud, jamais
   * de dédup silencieuse). Reco prod multi-pod : `redis` (ou `drizzle` si pas de Redis).
   */
  NF_IDEMPOTENCY_STORE: envEnum(
    ["auto", "memory", "redis", "drizzle"] as const,
    {
      default: "auto",
      section: "Stockages (où chaque brique garde ses données)",
      title: "Anti-double-envoi des requêtes",
      description:
        "Où l'application retient les requêtes déjà traitées, pour qu'un double clic ne crée pas deux commandes. auto suit l'infrastructure déclarée ; memory suffit avec un seul exemplaire ; redis ou drizzle (base SQL) partagent l'information entre plusieurs exemplaires. Un stockage partagé demandé mais absent bloque le démarrage.",
    },
  ),

  /**
   * Backend du registre d'endpoints webhook (P6.13). `memory` (dev — perdu au
   * redémarrage) | `drizzle` (DURABLE — table `webhook_endpoint` sur l'ORM SQL
   * `"default"`). Câblé par `nodefony/security/webhookStore.ts` (entité + fabrique).
   */
  NF_WEBHOOK_STORE: envEnum(["auto", "memory", "drizzle"] as const, {
    default: "auto",
    section: "Stockages (où chaque brique garde ses données)",
    title: "Où sont stockés les webhooks",
    description:
      "Les adresses de webhooks déclarées dans la console d'administration. auto suit la base de données ; memory les perd au redémarrage ; drizzle les garde en base.",
  }),

  /**
   * Sink d'écriture des logs (LB.W). `stdout` = cloud-native (pipe non-bloquant) ;
   * `file` = 1 fd async par worker (anti-goulet en cluster) ; `null` = bench.
   * Recommandation prod : `stdout` (collecteur centralisé) ou `file` (sidecar).
   */
  NF_LOG_DRIVER: envEnum(["stdout", "file", "null"] as const, {
    default: "stdout",
    section: "Journaux",
    title: "Destination des journaux",
    description:
      "Où partent les journaux de l'application : stdout (la sortie standard — le bon choix dans un conteneur, l'hébergeur les collecte), file (des fichiers dans logs/), ou null (nulle part, pour un banc de mesure).",
  }),

  /**
   * Avec `NF_LOG_DRIVER=file`, écrit en `writeSync` direct par worker au lieu du
   * buffer async (fichier local rapide). Défaut `false` (ne bloque jamais l'event
   * loop). Recommandation prod : `false` (laisser le buffer absorber les pics).
   */
  NF_LOG_FILE_SYNC: envBoolean({
    default: false,
    section: "Journaux",
    title: "Journaux en fichier : écriture immédiate",
    description:
      "Avec NF_LOG_DRIVER=file, écrit chaque ligne tout de suite au lieu de les regrouper. Plus sûr si l'application s'arrête brutalement, mais plus lent sous charge. Laisse false en production.",
  }),

  /**
   * Driver de RELECTURE du log backplane (≠ sink d'écriture). `auto` (défaut) :
   * une URL de destination déclarée (NF_LOKI_URL/NF_OPENSEARCH_URL) impose son
   * driver — l'URL ⇒ le driver, un seul knob (les DEUX URLs sans choix explicite =
   * échec au boot) ; sinon s'adapte au mode (mono → `memory`, cluster →
   * `cluster-file`). Valeurs explicites : `memory` | `file` | `cluster-file` |
   * `loki` | `opensearch` (surcharge d'expert, jamais réécrite).
   */
  NF_LOG_QUERY_DRIVER: envString({
    default: "auto",
    section: "Journaux",
    title: "Relecture des journaux (console d'administration)",
    description:
      "D'où la console d'administration relit les journaux. auto choisit seul : Loki ou OpenSearch si leur adresse est posée, sinon la mémoire (un process) ou des fichiers (cluster). Valeurs possibles : auto, memory, file, cluster-file, loki, opensearch. À ne changer qu'en connaissance de cause.",
  }),

  /**
   * Infra `logs`, destination Loki (LB.4). Sa présence dérive le driver de
   * relecture (`NF_LOG_QUERY_DRIVER=auto` → `loki`). Optionnelle (destination KO
   * au runtime → fallback `memory`, jamais de crash).
   */
  NF_LOKI_URL: envString({
    optional: true,
    section: "Journaux",
    title: "Loki (journaux centralisés)",
    description:
      "L'adresse d'un serveur Grafana Loki. Posée, l'application y envoie ses journaux et la console d'administration les y relit. Si Loki ne répond pas, rien ne plante : la relecture repasse en mémoire.\nNe pose pas Loki ET OpenSearch sans choisir NF_LOG_QUERY_DRIVER : le démarrage refuserait.",
    example: "http://localhost:3100",
  }),

  /**
   * Infra `logs`, destination OpenSearch (LB.4). Sa présence dérive le driver de
   * relecture (`NF_LOG_QUERY_DRIVER=auto` → `opensearch`). Optionnelle.
   */
  NF_OPENSEARCH_URL: envString({
    optional: true,
    section: "Journaux",
    title: "OpenSearch (journaux centralisés)",
    description:
      "L'adresse d'un serveur OpenSearch. Posée, l'application y envoie ses journaux et la console d'administration les y relit.\nNe pose pas OpenSearch ET Loki sans choisir NF_LOG_QUERY_DRIVER : le démarrage refuserait.",
    example: "http://localhost:9200",
  }),

  /**
   * Mot de passe de l'administrateur seedé au boot. En **dev**, défaut
   * `secret-de-dev-42` (`DEV_FIXTURE_PASSWORD`)
   * (comptes de fixture connus, bancs out-of-the-box) ; surcharge possible via
   * `.env`. En **prod**, AUCUN défaut : sans cette variable, aucun compte
   * n'est seedé (un mot de passe par défaut serait un trou de sécurité — le hash
   * de `secret` est public dans le code). Le fournir par le gestionnaire de secrets.
   */
  NF_ADMIN_PASSWORD: envString({
    optional: true,
    section: "Comptes créés au démarrage",
    title: "Mot de passe administrateur",
    description:
      "Le compte « admin » est créé au premier démarrage avec ce mot de passe. En développement, un mot de passe connu s'applique si tu ne mets rien. En production, aucun : sans cette variable, aucun compte n'est créé. Une fois le compte créé, la variable ne sert plus.",
    defaultNote: "secret-de-dev-42 en développement ; aucun en production",
  }),

  /**
   * Mot de passe du compte `user` de fixture (DEV uniquement, défaut
   * `secret-de-dev-42`).
   * Jamais utilisé en production (seul l'admin y est seedé, et via NF_ADMIN_PASSWORD).
   */
  NF_USER_PASSWORD: envString({
    optional: true,
    section: "Comptes créés au démarrage",
    title: "Mot de passe du compte de test « user »",
    description:
      "Le compte « user » (droits ordinaires) n'existe qu'en développement, pour les essais et les bancs. Il n'est jamais créé en production.",
    defaultNote: "secret-de-dev-42",
  }),

  /**
   * Clé de chiffrement des secrets 2FA/TOTP au repos (AES-256-GCM, ≥ 32 octets
   * après décodage). PROD : OBLIGATOIRE — absente = 2FA désactivé (un secret
   * chiffré par une clé éphémère serait illisible après redémarrage / sur les
   * autres pods). DEV : optionnelle (clé éphémère générée + warning). Même pont
   * que {@link NF_WEBHOOK_KEY}.
   */
  NF_TOTP_KEY: envString({
    optional: true,
    section: "Clés et secrets",
    title: "Clé de chiffrement de la double authentification",
    description:
      "Chiffre, dans la base, le secret de double authentification (le code à six chiffres) de chaque compte. Générée à la création de l'application.\nEn production, sans elle, la double authentification est désactivée.",
    defaultNote: "clé éphémère en développement ; 2FA désactivée en production",
  }),

  /**
   * Clé de chiffrement des secrets de signature webhook au repos (P6.13,
   * HKDF→AES-256-GCM). PROD : OBLIGATOIRE — absente = webhooks désactivés (un
   * secret chiffré par une clé éphémère serait illisible après redémarrage / sur
   * les autres pods). DEV : optionnelle (clé éphémère générée + warning).
   */
  NF_WEBHOOK_KEY: envString({
    optional: true,
    section: "Clés et secrets",
    title: "Clé de chiffrement des webhooks",
    description:
      "Chiffre, dans la base, les secrets qui signent les webhooks. Générée à la création de l'application (npx nodefony security:secrets --write).\nEn production, sans elle, les webhooks sont désactivés : une clé qui change à chaque démarrage rendrait les secrets illisibles.",
    defaultNote:
      "clé éphémère en développement ; webhooks désactivés en production",
  }),

  /**
   * Secret des jetons anti-CSRF (synchronizer token). PROD/cluster :
   * OBLIGATOIRE et PARTAGÉ entre les process — un secret par pod ferait
   * échouer la validation d'un jeton émis par un autre pod. DEV : optionnel,
   * un secret éphémère est généré et le boot le DIT (jamais de dégradation
   * silencieuse) — poser la variable suffit à faire taire l'avertissement.
   * `npx nodefony security:secrets` génère la clé et le câblage.
   */
  NF_CSRF_SECRET: envString({
    optional: true,
    section: "Clés et secrets",
    title: "Secret anti-falsification des formulaires",
    description:
      "Signe les jetons qui protègent les formulaires contre les envois forgés depuis un autre site (CSRF). Généré à la création de l'application.\nAvec plusieurs exemplaires, il doit être le même partout — sinon un formulaire est refusé au hasard.",
    defaultNote: "tiré au démarrage (un par process)",
  }),

  /**
   * URL PUBLIQUE de cette application en tant qu'ÉMETTEUR de jetons (claim
   * `iss`, RFC 7519 ; identifiant RFC 8414 §2 → https, ni requête ni fragment).
   *
   * Elle ne se DEVINE pas : derrière un relais (HAProxy, ingress, CDN), le
   * processus n'a aucun moyen fiable de connaître son adresse publique —
   * `Host` et `X-Forwarded-*` arrivent DANS la requête, donc du client. Un
   * document de métadonnées dérivé de la requête ferait servir, par le vrai
   * serveur, l'identité d'un attaquant. C'est donc l'exploitant qui l'écrit,
   * comme il écrit déjà son domaine.
   *
   * Absente = repli `"nodefony"` : les jetons sont émis et vérifiés
   * normalement (l'app est son propre émetteur ET son propre vérificateur),
   * mais RIEN n'est publié — aucun tiers ne peut vérifier une signature émise
   * ici. **STABLE** : gravée dans chaque jeton déjà émis, la changer les
   * invalide.
   */
  NF_JWT_ISSUER: envString({
    optional: true,
    section: "Jetons (JWT)",
    title: "Adresse publique de l'émetteur de jetons",
    description:
      "L'adresse publique de l'application, gravée dans chaque jeton qu'elle émet. Posée, elle permet à d'autres services de vérifier ces jetons. Sans elle, les jetons marchent pour l'application elle-même, mais personne d'autre ne peut les vérifier.\nNe la change plus ensuite : les jetons déjà émis seraient refusés.",
    example: "https://app.example.com",
    defaultNote:
      "https://localhost:5152 en développement ; aucune en production",
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
   * (persistée, créée par un seul worker). Production : CE dépôt tourne sur
   * une seule machine et garde aussi `var/keys/` (`nodefony/config/security.ts`) ;
   * une application générée, elle, refuse de démarrer sans cette variable.
   * Facultative pour la même raison que `NF_TOTP_KEY` : une application qui
   * n'émet aucun jeton doit pouvoir démarrer sans elle.
   *
   * **Valeur** : un jeu de clés Ed25519 en JSON, sur UNE ligne —
   * `npx nodefony security:secrets --jwt-keyset`. Elle contient la clé PRIVÉE :
   * gestionnaire de secrets (Secret k8s, vault), jamais un fichier du poste, jamais
   * git. En développement rien à poser : la clé vit dans `var/keys/`. Si on la pose
   * malgré tout dans `.env` (banc local), l'entourer de quotes simples.
   * **Illisible ⇒** la configuration security est refusée au démarrage, le
   * chemin nommé, la valeur jamais recopiée.
   *
   * **STABLE** : la remplacer refuse les jetons en vol. Rotation : ajouter la
   * nouvelle clé au tableau `keys`, la désigner dans `active`, garder l'ancienne
   * le temps que ses jetons expirent.
   */
  NF_JWT_KEYSET: envString({
    optional: true,
    section: "Jetons (JWT)",
    title: "Clé de signature des jetons (production)",
    description:
      "En développement, rien à poser : la clé est créée dans var/keys/.\nEn production, tous les exemplaires de l'application doivent signer avec la MÊME clé — sinon un utilisateur est déconnecté au hasard. Génère-la une fois (npx nodefony security:secrets --jwt-keyset) et range-la dans le gestionnaire de secrets de ton hébergeur, jamais dans un fichier.",
    defaultNote:
      "var/keys/ (sur ce dépôt, en production aussi : une seule machine)",
  }),

  // ── Social login OAuth 2.0 (P6 J9) ─────────────────────────────────────────
  // Secrets délivrés par les fournisseurs (Google Cloud Console / GitHub
  // Developer Settings › OAuth Apps). OPTIONNELS : un fournisseur n'est monté
  // QUE si SES deux secrets sont présents (sinon le bouton n'apparaît pas, 0
  // route morte). JAMAIS commités — `.env` local ou secret-manager.
  //
  // 🔴 CES QUATRE NOMS N'ONT PAS DE PRÉFIXE `NF_`, ET C'EST UNE DÉCISION.
  // Le préfixe dit à qui appartient la VALEUR, pas qui la lit : ces
  // identifiants sont ÉMIS par Google et GitHub, et leur écosystème fixe déjà
  // leur nom (la documentation des deux fournisseurs, Auth.js, Passport).
  // Préfixer reviendrait à revendiquer un bien qui n'est pas le nôtre et à
  // obliger l'utilisateur à dédoubler une variable qu'il possède déjà. La règle
  // et ses trois exceptions : `CLAUDE.md`, § variables d'environnement.
  // Le test : QUI a émis cette valeur ? Google ⇒ son nom. Nous ⇒ `NF_`.
  GOOGLE_CLIENT_ID: envString({
    optional: true,
    section: "Connexion avec Google ou GitHub",
    title: "Connexion Google : identifiant",
    description:
      "Délivré par Google Cloud Console, avec son secret. Les deux posés, un bouton « Google » apparaît sur la page de connexion ; sinon, rien ne s'affiche. Nom imposé par Google, d'où l'absence de préfixe NF_.",
  }),

  GOOGLE_CLIENT_SECRET: envString({
    optional: true,
    section: "Connexion avec Google ou GitHub",
    title: "Connexion Google : secret",
    description:
      "Le secret qui accompagne GOOGLE_CLIENT_ID, délivré par Google Cloud Console.",
  }),

  GITHUB_CLIENT_ID: envString({
    optional: true,
    section: "Connexion avec Google ou GitHub",
    title: "Connexion GitHub : identifiant",
    description:
      "Délivré par GitHub (Settings › Developer settings › OAuth Apps), avec son secret. Les deux posés, un bouton « GitHub » apparaît sur la page de connexion.",
  }),

  GITHUB_CLIENT_SECRET: envString({
    optional: true,
    section: "Connexion avec Google ou GitHub",
    title: "Connexion GitHub : secret",
    description:
      "Le secret qui accompagne GITHUB_CLIENT_ID, délivré par GitHub.",
  }),

  // Keycloak est AUTO-HÉBERGÉ : ses valeurs sont émises par NOTRE serveur, et
  // aucun nom d'écosystème ne fait foi — d'où le préfixe `NF_`, à l'inverse des
  // quatre ci-dessus. Le fournisseur n'est monté que si les TROIS sont posées ;
  // le décor de dev (profil `keycloak` du compose) en donne les valeurs,
  // écrites dans docker/keycloak/import/realm-nodefony.json, à poser dans `.env`.
  NF_KEYCLOAK_ISSUER: envString({
    optional: true,
    section: "Connexion Keycloak",
    title: "Keycloak : adresse du realm",
    description:
      "Pour se connecter avec un serveur Keycloak (OpenID Connect) : l'adresse du realm, en https. Le bouton « Keycloak » n'apparaît que si les trois variables NF_KEYCLOAK_* sont posées.",
    example: "https://localhost:8444/realms/nodefony",
    sensitive: false,
  }),

  NF_KEYCLOAK_CLIENT_ID: envString({
    optional: true,
    section: "Connexion Keycloak",
    title: "Keycloak : identifiant du client",
    description:
      "Le nom du client déclaré pour cette application dans le realm Keycloak.",
    example: "nodefony-dev",
    sensitive: false,
  }),

  NF_KEYCLOAK_CLIENT_SECRET: envString({
    optional: true,
    section: "Connexion Keycloak",
    title: "Keycloak : secret du client",
    description:
      "Le secret de ce client, copié depuis la console Keycloak (onglet « Credentials » du client).",
  }),

  /**
   * Base d'URL des callbacks OAuth (RFC 9700 : exact match avec l'URL
   * enregistrée chez le fournisseur). Callback complet = `<base>/nodefony/
   * security/api/oauth2/<provider>/callback`.
   *
   * Défaut = `https://localhost:5152` — PAS `127.0.0.1` : les passkeys/WebAuthn
   * REFUSENT une IP comme domaine (rpId), seul `localhost` (ou un vrai domaine)
   * marche en dev. On standardise donc TOUT le dev sur `localhost` (OAuth +
   * passkey + session) → un seul host, zéro incohérence cookie/rpId.
   * ⚠️ Enregistrer le callback chez le fournisseur en `https://localhost:5152/...`.
   * Google : si `https://localhost` est refusé, utiliser `http://localhost:5151`.
   */
  //
  // Préfixée, elle : contrairement aux quatre ci-dessus, personne ne l'émet —
  // c'est l'application qui se la donne. Un nom générique que l'application se
  // donne est une collision pure, et une collision ne se manifeste jamais par
  // une erreur.
  NF_OAUTH_REDIRECT_BASE: envString({
    default: "https://localhost:5152",
    section: "Connexion externe : réglage commun",
    title: "Adresse publique pour les retours de connexion",
    description:
      "Google, GitHub ou Keycloak renvoient l'utilisateur vers l'application après la connexion, à une adresse qu'ils comparent au caractère près à celle enregistrée chez eux :\n    <NF_OAUTH_REDIRECT_BASE>/nodefony/security/api/oauth2/<fournisseur>/callback\nEn production, mets l'URL publique de l'application. En développement, garde localhost — jamais 127.0.0.1 : les passkeys refusent une adresse IP. Si Google refuse https://localhost, utilise http://localhost:5151.",
    example: "https://app.example.com",
  }),

  /**
   * Livraison de l'UI Studio — molette `ui` de `@nodefony/studio`, exposée ici
   * pour qu'un décor puisse la poser sans éditer la config.
   *
   * - `auto` (défaut) : dans CE dépôt, résout vers `vite` → HMR, sources vivantes.
   * - `static` : sert les assets pré-buildés (`dist/frontend/`, produits par
   *   `npm run build:ui`). **Aucune dépendance au dev-server Vite.**
   * - `vite` : force le dev-server.
   *
   * POURQUOI cette molette existe pour un banc en CONTENEUR : en `auto`/`vite`, la
   * page Studio annonce ses assets en URL ABSOLUE (`https://127.0.0.1:5173/...`,
   * cf `TemplateHelper.renderDevTags`). Ce `127.0.0.1` est celui du NAVIGATEUR :
   * dans un conteneur il désigne le conteneur lui-même, qui n'héberge aucun Vite
   * → page blanche et `ERR_CONNECTION_REFUSED`, alors que le HTML, lui, est bien
   * servi. En `static`, les assets sont same-origin sous `/_assets/studio/` : la
   * page se charge quel que soit le nom par lequel on est entré. C'est en prime le
   * mode que voient les applications qui installent Studio depuis npm.
   *
   * ⚠️ En `static` on perd le HMR — c'est un mode d'OBSERVATION, pas de dev front.
   */
  NF_STUDIO_UI: envEnum(["auto", "static", "vite"], {
    default: "auto",
    section: "Console d'administration",
    title: "Console d'administration : mode d'affichage",
    description:
      "Comment la console d'administration (Studio) est servie : auto (le bon choix), vite (sources vivantes, rechargement à chaud) ou static (fichiers déjà construits, sans Vite — utile pour l'ouvrir depuis un conteneur).",
  }),

  // Le dev-server Vite n'a plus de variable d'environnement : Nodefony le
  // relaie sur l'origine de la page (le poste et un navigateur en conteneur
  // sont servis en même temps, sans rien à poser).
  // Ce qui a motivé le retrait : posée pour observer un écran puis oubliée,
  // cette variable a rendu Studio inaccessible depuis le poste, sans la moindre
  // erreur côté serveur. Un décor d'observation n'a rien à faire dans
  // l'environnement.
});
