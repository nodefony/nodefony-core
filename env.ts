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
 * viennent de l'orchestrateur (k8s Secret, Cloud Run, `-e`) ou d'un secret-manager ;
 * le modèle d'onboarding complet est `.env.example`.
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
    description: "Port d'écoute HTTP (défaut framework 5151).",
  }),

  /**
   * Alias PLATEFORME du port HTTP : Cloud Run, Heroku, Railway, Fly injectent
   * `PORT` sans préfixe et attendent que le process écoute DESSUS. On l'accepte
   * tel quel (zéro glue de déploiement). `NF_PORT` gagne s'il est aussi présent
   * (même règle que `NF_DATABASE_URL` vs `DATABASE_URL`).
   */
  PORT: envNumber({
    optional: true,
    description:
      "Alias plateforme du port HTTP (Cloud Run/Heroku) — NF_PORT gagne.",
  }),

  /**
   * Port du serveur HTTPS/HTTP2. Absent = défaut framework (5152). Pas d'alias
   * plateforme : en cloud-native, le TLS est terminé à l'ingress et le pod sert
   * en clair (`servers: { https: false }`) — ce port sert au dev, au bare-metal
   * et aux déploiements TLS bout-en-bout.
   */
  NF_PORT_HTTPS: envNumber({
    optional: true,
    description: "Port d'écoute HTTPS/HTTP2 (défaut framework 5152).",
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
    description:
      "Infra database : URL unique (sqlite:|postgres://|mysql://|mongodb://), dialecte déduit du scheme.",
  }),

  /**
   * Infra `cache` (éphémère partagé) : URL Redis. Sa présence CHARGE le module
   * `@nodefony/redis` (gating `when` du manifeste) et aiguille les briques
   * éphémères en `store: "auto"` (idempotence, sessions) vers Redis. Alias
   * plateforme accepté : `REDIS_URL` (`NF_` gagne). Porte le secret → jamais loggée brute.
   */
  NF_REDIS_URL: envString({
    optional: true,
    description:
      "Infra cache : URL Redis (redis://…) — sa présence charge @nodefony/redis.",
  }),

  /**
   * Sink d'écriture des logs (LB.W). `stdout` = cloud-native (pipe non-bloquant) ;
   * `file` = 1 fd async par worker (anti-goulet en cluster) ; `null` = bench.
   * Recommandation prod : `stdout` (collecteur centralisé) ou `file` (sidecar).
   */
  NF_LOG_DRIVER: envEnum(["stdout", "file", "null"] as const, {
    default: "stdout",
    description: "Sink d'écriture des logs : stdout | file | null.",
  }),

  /**
   * Avec `NF_LOG_DRIVER=file`, écrit en `writeSync` direct par worker au lieu du
   * buffer async (fichier local rapide). Défaut `false` (ne bloque jamais l'event
   * loop). Recommandation prod : `false` (laisser le buffer absorber les pics).
   */
  NF_LOG_FILE_SYNC: envBoolean({
    default: false,
    description: "Écriture synchrone du sink fichier (writeSync par worker).",
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
    description: "Driver de relecture du log backplane (auto|memory|file|…).",
  }),

  /**
   * Infra `logs`, destination Loki (LB.4). Sa présence dérive le driver de
   * relecture (`NF_LOG_QUERY_DRIVER=auto` → `loki`). Optionnelle (destination KO
   * au runtime → fallback `memory`, jamais de crash).
   */
  NF_LOKI_URL: envString({
    optional: true,
    description: "URL HTTP de la destination Loki (poussée + relecture).",
  }),

  /**
   * Infra `logs`, destination OpenSearch (LB.4). Sa présence dérive le driver de
   * relecture (`NF_LOG_QUERY_DRIVER=auto` → `opensearch`). Optionnelle.
   */
  NF_OPENSEARCH_URL: envString({
    optional: true,
    description: "URL HTTP de la destination OpenSearch (poussée + relecture).",
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
    description: "DEV : bind 0.0.0.0 + trustProxy (banc reverse-proxy Docker).",
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
    description:
      "Livraison de l'UI Studio : auto (défaut) | static (pré-buildé, sans Vite) | vite.",
  }),

  /**
   * Origine PUBLIQUE du dev-server Vite (P14.17) — celle que le NAVIGATEUR
   * utilise quand elle diffère de l'adresse d'écoute. `{port}` est substitué
   * par le port réel de chaque famille Vite (suit les retries de port).
   * Le cas d'usage local : le navigateur en CONTENEUR (`--profile browser`)
   * qui doit joindre Vite via la passerelle Docker →
   * `NF_FRONTEND_PUBLIC_ORIGIN=https://host.docker.internal:{port}`.
   * Codespaces/Gitpod n'en ont pas besoin : détection automatique.
   * Absente = dérivation locale `devHost:port` (comportement historique).
   */
  NF_FRONTEND_PUBLIC_ORIGIN: envString({
    optional: true,
    description:
      "Origine publique Vite (scheme://host[:port|:{port}]) — dev déporté/conteneur.",
  }),

  // ── Social login OAuth 2.0 (P6 J9) ─────────────────────────────────────────
  // Secrets délivrés par les fournisseurs (Google Cloud Console / GitHub
  // Developer Settings › OAuth Apps). OPTIONNELS : un fournisseur n'est monté
  // QUE si SES deux secrets sont présents (sinon le bouton n'apparaît pas, 0
  // route morte). JAMAIS commités — `.env` local ou secret-manager.
  GOOGLE_CLIENT_ID: envString({
    optional: true,
    description: "OAuth Google — Client ID (Google Cloud Console).",
  }),
  GOOGLE_CLIENT_SECRET: envString({
    optional: true,
    description: "OAuth Google — Client Secret (SECRET, jamais loggé).",
  }),
  GITHUB_CLIENT_ID: envString({
    optional: true,
    description: "OAuth GitHub — Client ID (Developer Settings › OAuth Apps).",
  }),
  GITHUB_CLIENT_SECRET: envString({
    optional: true,
    description: "OAuth GitHub — Client Secret (SECRET, jamais loggé).",
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
  OAUTH_REDIRECT_BASE: envString({
    default: "https://localhost:5152",
    description: "Base d'URL des callbacks OAuth (exact match fournisseur).",
  }),

  // ── Source d'identité de l'application (provisioning du service "users") ────
  /**
   * Implémentation du dépôt utilisateur posé par l'app au boot (`App.onKernelReady`
   * → `provisionUsers`). `auto` (défaut) = suit l'infra database déclarée
   * (`NF_DATABASE_URL` SQL → drizzle, mongo → mongoose), repli `drizzle` (SQL local
   * — les comptes DOIVENT survivre au restart) ; `drizzle`/`mongoose` = explicite ;
   * `memory` = annuaire volatil (zéro I/O SQLite) pour les **tests de charge**
   * (la mesure n'est pas polluée par le sync better-sqlite3), les scripts et les
   * tests manuels. Surcharge ponctuelle : `NF_USER_STORE=memory` dans `.env.local`.
   */
  NF_USER_STORE: envEnum(["auto", "drizzle", "mongoose", "memory"] as const, {
    default: "auto",
    description:
      "Dépôt du service users : auto (suit l'infra database) | drizzle | mongoose | memory (volatil).",
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
  NF_STORE: envString({ optional: true }),

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
      description:
        "Cache d'idempotence : auto (suit l'infra déclarée) | memory (per-pod) | redis | drizzle (distribués cross-pod).",
    },
  ),

  /**
   * Mot de passe de l'administrateur seedé au boot. En **dev**, défaut `secret`
   * (comptes de fixture connus, bancs out-of-the-box) ; surcharge possible via
   * `.env.local`. En **prod**, AUCUN défaut : sans cette variable, aucun compte
   * n'est seedé (un mot de passe par défaut serait un trou de sécurité — le hash
   * de `secret` est public dans le code). Le fournir via `.env.local` / secret-manager.
   */
  NF_ADMIN_PASSWORD: envString({
    optional: true,
    description:
      "Mot de passe de l'admin seedé (dev défaut 'secret' ; prod requis).",
  }),

  /**
   * Mot de passe du compte `user` de fixture (DEV uniquement, défaut `secret`).
   * Jamais utilisé en production (seul l'admin y est seedé, et via NF_ADMIN_PASSWORD).
   */
  NF_USER_PASSWORD: envString({
    optional: true,
    description:
      "Mot de passe du compte de fixture 'user' (dev, défaut 'secret').",
  }),

  /**
   * Backend du registre d'endpoints webhook (P6.13). `memory` (dev — perdu au
   * redémarrage) | `drizzle` (DURABLE — table `webhook_endpoint` sur l'ORM SQL
   * `"default"`). Câblé par `nodefony/security/webhookStore.ts` (entité + fabrique).
   */
  NF_WEBHOOK_STORE: envEnum(["auto", "memory", "drizzle"] as const, {
    default: "auto",
    description:
      "Backend des endpoints webhook : auto (suit l'infra déclarée) | memory | drizzle (durable).",
  }),

  /**
   * Clé de chiffrement des secrets de signature webhook au repos (P6.13,
   * HKDF→AES-256-GCM). PROD : OBLIGATOIRE — absente = webhooks désactivés (un
   * secret chiffré par une clé éphémère serait illisible après redémarrage / sur
   * les autres pods). DEV : optionnelle (clé éphémère générée + warning).
   */
  NF_WEBHOOK_KEY: envString({
    optional: true,
    description:
      "Clé de chiffrement des secrets de signature webhook (prod requis).",
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
    description:
      "Clé de chiffrement des secrets 2FA/TOTP au repos (prod requis, ≥ 32 octets).",
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
    description:
      "Secret des jetons anti-CSRF (synchronizer) — partagé entre process en cluster.",
  }),
});
