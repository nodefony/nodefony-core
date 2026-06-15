/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  nodefony.config.ts — CONFIGURATION DE L'APPLICATION (fichier unique)       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Tout ce qui n'est PAS écrit ici prend le défaut du framework (`defaultAppConfig`,
 * deep-mergé au boot). Commencer minuscule, grandir par composition — jamais subir
 * le découpage. Forme fonction `(ctx) => …` pour différencier par environnement.
 *
 * `ctx` = { env, appEnv, runtimeEnv, isProd, isDev, isTest } — `ctx.env` est le
 * catalogue typé de `./env.ts`.
 *
 * ── 6 RECETTES (pour faire grandir cette config) ──────────────────────────────
 *  1. Ajouter un module        → ajouter son nom dans `modules`.
 *  2. Configurer un module      → `use("@nodefony/security", { firewalls: {…} })`.
 *  3. Module dev/conditionnel   → `{ name, policy: "dev" }` ou `use(n, c, { when })`.
 *  4. Réglage par-env           → tester `ctx.isProd` / `ctx.isDev` (déjà utilisé ci-dessous).
 *  5. Lire une var d'env        → la déclarer dans `./env.ts`, lire `ctx.env.X` (jamais `process.env`).
 *  6. Extraire un domaine       → quand un bloc grossit : `import { servers } from "./config/servers"` (choix, pas obligation).
 *
 * Voir toutes les options + défauts : `nodefony config:show` / onglet Configuration de Studio.
 */
import { defineConfig, use } from "nodefony";
import type { env } from "./env";
import { oauth2Config } from "./config/oauth";

/** Type du catalogue d'env → `ctx.env` typé + auto-complété dans la fonction de config. */
type Env = typeof env;

export default defineConfig<Env>((ctx) => ({
  // ── Identité de l'application (affichée dans la CLI et les logs d'init) ──────
  App: {
    projectYear: "2024",
    authorName: "Camensuli Christophe",
    authorMail: "ccamensuli@gmail.com",
  },

  // ── Réseau ──────────────────────────────────────────────────────────────────
  // Domaine d'écoute (un seul, pas de vhost). Prod = toutes interfaces (0.0.0.0,
  // derrière l'ingress) ; dev = loopback. `NF_BIND_ALL=1` (dev) force 0.0.0.0 pour
  // exposer le serveur au banc reverse-proxy Docker (conteneurs). Ports/serveurs =
  // défauts framework (HTTP 5151, HTTPS 5152 HTTP/2) ; changer : `servers: { http: { port } }`.
  domain: ctx.isProd || ctx.env.NF_BIND_ALL ? "0.0.0.0" : "127.0.0.1",
  // Active la barrière Host kernel-level (anti Host-header injection) : un Host
  // entrant doit matcher la liste `trustedHosts` du module http. (`domainAlias`
  // legacy retiré — `trustedHosts` est l'unique allowlist consommée.)
  domainCheck: true,

  // ── Observabilité ─────────────────────────────────────────────────────────
  log: {
    // dev : tout en DEBUG ; prod : aucun DEBUG (INFO+ seulement).
    debug: ctx.isProd ? [] : "*",
    // Sink d'écriture + relecture du backplane — pilotés par l'environnement (./env).
    driver: ctx.env.NF_LOG_DRIVER,
    file: { sync: ctx.env.NF_LOG_FILE_SYNC },
    queryDriver: ctx.env.NF_LOG_QUERY_DRIVER,
    // Destinations PROD (LB.4) : montées seulement si l'URL est fournie ET que
    // `queryDriver` vaut leur nom (sinon fallback "memory" au boot, jamais de crash).
    ...(ctx.env.LOKI_URL ? { loki: { url: ctx.env.LOKI_URL } } : {}),
    ...(ctx.env.OPENSEARCH_URL
      ? { opensearch: { url: ctx.env.OPENSEARCH_URL } }
      : {}),
  },

  // ── Topologie / cluster (cloud-native, sans PM2) ────────────────────────────
  // La topologie (nombre de workers) vit dans `nodefony/config/cluster/cluster.config.ts`
  // (fichier kernel-free) : le process MASTER le lit STANDALONE, AVANT de booter le
  // moindre Kernel, pour décider du fork. Le Kernel booté ne lit pas ce champ → inutile
  // de le dupliquer ici. Override runtime : CLI `--workers` > `NODEFONY_WORKERS` > ce fichier.

  // ── Modules de l'application ────────────────────────────────────────────────
  // ⚠️ L'ORDRE = ordre (priorité) de chargement. Invariants réels — ne pas réordonner :
  //   - realtime APRÈS framework (se greffe via AdminBroker avant mountAll)
  //   - frontend AVANT ses consumers (mediasoup, test-frontend-*)
  //   - documentation AVANT studio (le front Studio consomme /nodefony/documentation/api/*)
  // Policies : `mandatory` (socle, jamais gaté) · `optional` (défaut, gaté par `when`)
  //          · `dev` (chargé hors production). `use(name, config, opts)` colocalise
  // la config d'un module avec son chargement (typage par module via le registre).
  modules: [
    // ── ORM — Drizzle (SQL) par défaut. Le gating par driver (when c.orm?.driver)
    //    arrivera avec la suite du virage ORM (Mongoose refait sur le modèle Service).
    "@nodefony/drizzle",

    // ── Socle serveur — toujours présent (web + routing + sécurité).
    use(
      "@nodefony/http",
      {
        // En dev, accepte les certificats auto-signés (mkcert). Prod : true.
        rejectUnauthorized: !ctx.isDev,
        // Certificat TLS (HTTPS/WSS). DEV : génération auto — mkcert (CA locale
        // trustée → 0 warning navigateur, HMR Vite) si dispo, sinon auto-signé
        // node-forge (SHA-256). PROD : fournir un VRAI certificat (Let's Encrypt,
        // ingress k8s, reverse-proxy edge) — Nodefony n'est PAS une autorité de
        // certification ; la génération reste un confort de DÉVELOPPEMENT.
        // (Re)génération / inspection manuelle : `nodefony certificates [--force]`.
        certificates: {
          // PROD : décommenter pour fournir le vrai certificat (fail-fast si absent).
          // strategy: "explicit",
          // key: ctx.env.TLS_KEY, cert: ctx.env.TLS_CERT, ca: ctx.env.TLS_CA,
          openssl: {
            size: 2048,
            // Hachage de signature — JAMAIS SHA-1 (interdit CA/B Forum, SHAttered 2017).
            hash: "sha256",
            validityDays: 365,
            attrs: [
              {
                name: "commonName",
                value: ctx.isProd ? "nodefony.com" : "localhost",
              },
              { name: "organizationName", value: "Nodefony Signing Authority" },
              { name: "organizationalUnitName", value: "Development" },
              { name: "countryName", value: "FR" },
              { name: "stateOrProvinceName", value: "BDR" },
              { name: "localityName", value: "Marseille" },
            ],
          },
          // Subject Alternative Name — fait foi pour la vérification d'hôte
          // (RFC 6125 : le commonName est ignoré). Vide = dérivé du kernel
          // (localhost + domain ; une IP va en iPAddress). Banc reverse-proxy
          // par domaine (NF_BIND_ALL) : couvrir `nodefony.com` pour permettre à
          // haproxy `verify required` + `sni` de valider le cert backend.
          san: ctx.env.NF_BIND_ALL
            ? { dns: ["nodefony.com", "localhost"], ip: ["127.0.0.1", "::1"] }
            : { dns: [], ip: [] },
        },
        // Barrière Host (consommée si `domainCheck: true` ci-dessus) : le domaine
        // canonique est toujours accepté ; on liste localhost + 127.0.0.1 pour taper
        // le serveur via les deux noms en dev/cluster local. `nodefony.com` permet
        // l'accès par NOM DE DOMAINE — en dev via `/etc/hosts` (nodefony.com →
        // 127.0.0.1), en prod via le vrai DNS. Le port est strippé avant le match
        // (cf domainMatcher) → `nodefony.com:5151` matche `nodefony.com`.
        trustedHosts: ["localhost", "127.0.0.1", "nodefony.com"],
        // trustProxy : n'honore les en-têtes forwarded que derrière un proxy de
        // confiance. Activé via NF_BIND_ALL (banc reverse-proxy Docker : IP source
        // des conteneurs = réseau privé 172.16/12, 192.168/16, 10/8). En prod,
        // régler explicitement selon l'ingress. Défaut SÛR : false (0 confiance).
        trustProxy: ctx.env.NF_BIND_ALL ? ["loopback", "uniquelocal"] : false,
        // Stockage de session via @nodefony/drizzle (orm-core).
        session: { handler: "drizzle" },
        formidable: { uploadDir: "./tmp/upload" },
      },
      { policy: "mandatory" },
    ),
    { name: "@nodefony/framework", policy: "mandatory" },

    // Realtime APRÈS framework. Backplane `cluster` (IPC intra-pod, master relay) par
    // DÉFAUT : 0 dépendance externe. Mono-process → hub local ; cluster (`--workers N`)
    // → fan-out IPC entre workers du même pod. Redis = OPT-IN cross-pod (voir plus bas).
    use("@nodefony/realtime", { backplane: { driver: "cluster" } }),

    // Sécurité applicative (P6) — requise dès qu'on sert du trafic.
    // Zones (firewall) : chaque zone = pattern d'URL + chaîne d'authenticators
    // (validées Zod au boot — config invalide = firewall fail-closed, tout rejeté).
    // Les zones se déclarent au plus près de leurs routes : un module porte sa
    // zone via l'override `module-security` dans SA config (ex. la zone
    // `test-secure` du banc P6 vit dans src/modules/test/nodefony/config/config.ts).
    // Social login OAuth 2.0 : config extraite dans `./config/oauth.ts`
    // (providers + secrets via env). La racine reste lisible.
    use(
      "@nodefony/security",
      { oauth2: oauth2Config(ctx) },
      { policy: "mandatory" },
    ),

    // ── Démo / tests d'intégration — hors production.
    { name: "@nodefony/test", policy: "dev" },

    // Frontend AVANT ses consumers.
    "@nodefony/frontend",
    { name: "@nodefony/test-frontend-react", policy: "dev" },
    { name: "@nodefony/test-frontend-vue", policy: "dev" },
    { name: "@nodefony/test-frontend-angular", policy: "dev" },
    { name: "@nodefony/mediasoup", policy: "dev" },

    // ── Doc transverse AVANT Studio.
    "@nodefony/documentation",

    // Studio admin — console d'administration du framework.
    { name: "@nodefony/studio", policy: "mandatory" },

    // ── Accès Redis générique — requis UNIQUEMENT pour le backplane realtime `redis`
    //    (fan-out cross-pod). Avec le défaut IPC (intra-pod) il est inutile.
    //    Décommenter + REDIS_PASSWORD pour le fan-out cross-pod (Phase 16) :
    // use("@nodefony/redis", undefined, {
    //   when: (c) => (c.modules ?? []).some(
    //     (m) => typeof m === "object" && m.name === "@nodefony/realtime",
    //   ),
    // }),

    // ── Exemple : module NoSQL Mongoose (non chargé par défaut). Décommenter ICI
    //    pour l'activer, avec sa config colocalisée :
    // use("@nodefony/mongoose", {
    //   debug: true,
    //   connectors: {
    //     nodefony: {
    //       host: "localhost",
    //       port: 27017,
    //       dbname: "nodefony",
    //       options: { user: "nodefony", pass: "nodefony", maxPoolSize: 50 },
    //     },
    //   },
    // }),
  ],
}));
