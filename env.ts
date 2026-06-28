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
import { defineEnv, envBoolean, envEnum, envString } from "nodefony";

export const env = defineEnv({
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
   * Driver de RELECTURE du log backplane (≠ sink d'écriture). `memory` (ring
   * volatile, dev) | `file` | `cluster-file` | `loki` | `opensearch`. La résolution
   * finale (et le fallback `memory` si la destination est KO) est faite au boot.
   */
  NF_LOG_QUERY_DRIVER: envString({
    default: "memory",
    description: "Driver de relecture du log backplane.",
  }),

  /**
   * Destination PROD Loki (LB.4), active si `NF_LOG_QUERY_DRIVER=loki`. Optionnelle
   * (sans URL → fallback `memory` au boot, jamais de crash).
   */
  LOKI_URL: envString({
    optional: true,
    description: "URL HTTP de la destination Loki (poussée + relecture).",
  }),

  /**
   * Destination PROD OpenSearch (LB.4), active si `NF_LOG_QUERY_DRIVER=opensearch`.
   * Optionnelle (sans URL → fallback `memory` au boot).
   */
  OPENSEARCH_URL: envString({
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
   * → `provisionUsers`). `drizzle` (défaut) = persistance SQL réelle, dev ≡ prod ;
   * `memory` = annuaire volatil (zéro I/O SQLite) pour les **tests de charge**
   * (la mesure n'est pas polluée par le sync better-sqlite3), les scripts et les
   * tests manuels. Surcharge ponctuelle : `NF_USER_STORE=memory` dans `.env.local`.
   */
  NF_USER_STORE: envEnum(["drizzle", "memory"] as const, {
    default: "drizzle",
    description:
      "Dépôt du service users : drizzle (persistant) | memory (volatil).",
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
  NF_IDEMPOTENCY_STORE: envEnum(["memory", "redis", "drizzle"] as const, {
    default: "memory",
    description:
      "Cache d'idempotence : memory (per-pod) | redis | drizzle (distribués cross-pod).",
  }),

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
  NF_WEBHOOK_STORE: envEnum(["memory", "drizzle"] as const, {
    default: "memory",
    description: "Backend des endpoints webhook (memory | drizzle durable).",
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
});
