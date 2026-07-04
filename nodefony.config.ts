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
    ...(ctx.env.NF_LOKI_URL ? { loki: { url: ctx.env.NF_LOKI_URL } } : {}),
    ...(ctx.env.NF_OPENSEARCH_URL
      ? { opensearch: { url: ctx.env.NF_OPENSEARCH_URL } }
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
        // Stockage de session via @nodefony/drizzle (orm-core). Le modèle de
        // session NIST/OWASP (idle + absolute + touch sur activité HTTP/WS) vit
        // dans @nodefony/http : les défauts sains (idle 30 min, absolute 12 h)
        // suffisent — le touch garde une session ACTIVE vivante sans la rendre
        // éternelle. Plus de pansement maxLifetimeS (la dérive est corrigée).
        session: {
          store: "drizzle",
        },
        formidable: { uploadDir: "./tmp/upload" },
      },
      { policy: "mandatory" },
    ),
    // Idempotence des mutations : `auto` (défaut — suit l'infra déclarée :
    // NF_REDIS_URL → redis, sinon NF_DATABASE_URL → drizzle, sinon memory) |
    // `memory` (per-pod) | `redis` | `drizzle` (distribués cross-pod). Opt-in
    // explicite `NF_IDEMPOTENCY_STORE`. Le framework résout le nom au boot
    // (fail-loud si non enregistré). Cf `@Idempotent` (P6.8).
    use(
      "@nodefony/framework",
      { idempotency: { store: ctx.env.NF_IDEMPOTENCY_STORE } },
      { policy: "mandatory" },
    ),

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
      {
        oauth2: oauth2Config(ctx),
        // Hiérarchie de rôles (RBAC, niveau A de l'autorisation) — ROLE_X hérite
        // des rôles listés (résolu au boot en DFS ; cycle → throw). Additif :
        // un rôle gagne les droits des rôles couverts, jamais l'inverse.
        // Surfacé dans Studio → /nodefony/roles (Hiérarchie + Graphe).
        //
        // DEUX ÉCHELLES — frontière = convention de NOM (multi-tenant-ready) :
        //  • PLATEFORME `ROLE_NODEFONY_*` — l'OPÉRATEUR de l'instance (hébergeur
        //    SaaS, le « landlord »). GLOBAL, cross-tenant, JAMAIS scopé ni
        //    assigné à un client. Le SEUL à transcender l'isolation tenant
        //    (opt-out du scope auto). NE confondez JAMAIS avec un « admin de
        //    tenant » (= ROLE_ADMIN, scopé à son organisation).
        //  • TENANT `ROLE_*` — exercés DANS le tenant de l'acteur. Mono-tenant
        //    aujourd'hui = rôles plats (`user.roles`). En multi-tenant (P17), ils
        //    viendront du membership user×tenant, PAS de `user.roles` global
        //    (modif INTERNE de UserToken.getRoles, additive — cf
        //    project_multitenant_chantier_kit §2bis). La hiérarchie ci-dessous
        //    reste valable : seule la SOURCE des rôles tenant changera.
        roleHierarchy: {
          // PLATEFORME — couvre tous les rôles métier (et, transitivement, USER)
          // → un seul rôle pour « voit/fait tout » sur l'instance entière.
          ROLE_NODEFONY_ADMIN: [
            "ROLE_ADMIN",
            "ROLE_SECURITY_AUDITOR",
            "ROLE_DEV",
            "ROLE_SUPERVISOR",
          ],
          // TENANT (scopables) — chacun couvre l'utilisateur de base.
          ROLE_ADMIN: ["ROLE_USER"], // admin applicatif (gestion des utilisateurs)
          ROLE_SECURITY_AUDITOR: ["ROLE_USER"], // audit sécurité (journal, firewall lecture)
          ROLE_DEV: ["ROLE_USER"], // développeur (ORM, modules, routes, doc technique)
          ROLE_SUPERVISOR: ["ROLE_USER"], // exploitant / SRE (supervision, cluster, logs)
        },
        // Webhooks sortants (P6.13) — secret de signature chiffré au repos. Clé
        // prod via env (absente en prod = webhooks OFF, fail-safe ; dev = clé
        // éphémère + warning). `enabled`/SSRF/livraison gardent leurs défauts.
        webhooks: {
          encryptionKey: ctx.env.NF_WEBHOOK_KEY,
          // Backend du registre : memory (défaut) | drizzle (durable). Le câblage
          // de la fabrique + l'entité vit dans `nodefony/security/webhookStore.ts`.
          store: ctx.env.NF_WEBHOOK_STORE,
          // DEV : autorise les cibles localhost + http:// pour le récepteur de
          // test local (module test → /test/webhooks/sink). PROD : SSRF strict
          // (défauts) — un webhook prod ne doit JAMAIS viser une IP privée/du http.
          denyPrivateIps: ctx.isProd,
          allowHttp: !ctx.isProd,
        },
      },
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

    // ── Accès Redis générique — chargé par la DÉCLARATION de l'infra cache :
    //    `NF_REDIS_URL` présente ⇔ module chargé (un seul signal, pas de magie
    //    localhost). Consommateurs cross-pod : backplane realtime `redis`,
    //    stores `redis` (idempotence, sessions, tokens). Demander un store
    //    `redis` SANS déclarer `NF_REDIS_URL` = échec franc à la résolution
    //    (fail-loud), jamais de connexion implicite.
    use("@nodefony/redis", undefined, {
      when: () => !!ctx.infra.cache,
    }),

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
