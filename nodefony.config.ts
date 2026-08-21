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
 * Voir toutes les options + défauts : onglet Configuration de Studio (`/nodefony`).
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
  // exposer le serveur au banc reverse-proxy Docker (conteneurs).
  domain: ctx.isProd || ctx.env.NF_BIND_ALL ? "0.0.0.0" : "127.0.0.1",
  // Active la barrière Host kernel-level (anti Host-header injection) : un Host
  // entrant doit matcher la liste `trustedHosts` du module http. (`domainAlias`
  // legacy retiré — `trustedHosts` est l'unique allowlist consommée.)
  domainCheck: true,

  // ── Ports d'écoute ──────────────────────────────────────────────────────────
  // Les clés ne sont émises QUE si l'environnement les déclare : sans elles, les
  // défauts du framework s'appliquent (HTTP 5151, HTTPS 5152 en HTTP/2) — on ne
  // retape jamais un défaut, sinon il existe à deux endroits et diverge.
  //
  // POURQUOI passer par l'env plutôt que d'écrire un port en dur ici : le port est
  // une propriété du DÉPLOIEMENT, pas du code. En PaaS (Cloud Run, Heroku, Railway)
  // la plateforme IMPOSE son port via `PORT` — un port en dur = pod qui écoute là où
  // personne n'appelle. En dev on ne déclare rien : `portPolicy` vaut `auto` (défaut
  // hors prod/test) → deux apps Nodefony cohabitent, le décalage de port est ANNONCÉ
  // et publié pour `nodefony status`/`stop`. En prod/test, `portPolicy` vaut `strict` :
  // un port occupé est un échec franc (le port est un CONTRAT : service, ingress, sonde).
  // Forcer la politique : `servers: { portPolicy: "strict" }`.
  servers: {
    ...((ctx.env.NF_PORT ?? ctx.env.PORT)
      ? { http: { port: ctx.env.NF_PORT ?? ctx.env.PORT } }
      : {}),
    ...(ctx.env.NF_PORT_HTTPS
      ? { https: { port: ctx.env.NF_PORT_HTTPS } }
      : {}),
  },

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
        // Serveur HTTPS : en dev, accepte les certificats auto-signés (mkcert) ;
        // en prod, rejette tout certificat TLS non valide (secure-by-default).
        // ⚠️ Doit vivre sous `https` (httpsServerSchema) — au top-level la clé est
        // silencieusement strippée au parse et la valeur n'est JAMAIS appliquée.
        https: { rejectUnauthorized: !ctx.isDev },
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
        //
        // `host.docker.internal` : un navigateur qui tourne DANS un conteneur (le
        // service `browser` de docker-compose.yml) ne peut pas dire « localhost »
        // — ce nom y désigne le conteneur lui-même. Docker Desktop lui donne
        // `host.docker.internal` pour joindre la machine hôte, et c'est ce nom qui
        // arrive dans l'en-tête `Host` : sans lui dans l'allowlist, la barrière
        // répond `421 Misdirected Request` alors que le réseau, lui, passe.
        //
        // 🔴 EXCEPTION ASSUMÉE, PROPRE À CE DÉPÔT — inconditionnelle, y compris en
        // production. Elle était auparavant limitée au développement, ce qui
        // paraissait plus sûr et rendait en fait le navigateur en conteneur
        // INUTILISABLE là où l'on en a le plus besoin : les audits (Lighthouse,
        // accessibilité, agentic) se mènent sur un runtime `production`, et le
        // conteneur y recevait `421` dès la connexion — donc aucune page derrière
        // authentification n'était observable, ni par un humain ni par un agent.
        //
        // Pourquoi c'est acceptable ICI : ce dépôt est le banc de développement du
        // framework, jamais un déploiement exposé. `host.docker.internal` n'est
        // d'ailleurs pas un nom résolvable publiquement — c'est une convention
        // Docker Desktop, absente d'internet et des clusters. L'élargissement porte
        // donc sur un nom que seul un conteneur local peut présenter.
        //
        // 🔴 CE QUI NE DOIT PAS ESSAIMER : le SCAFFOLD ne pose pas cette entrée, et
        // ne doit jamais la poser. Une application générée n'a aucune raison de
        // faire confiance à ce nom en production — ses gabarits ne mentionnent
        // `host.docker.internal` que dans la marche à suivre pour observer un
        // écran depuis un conteneur (`compose.yaml.tpl`, `AGENTS.md.tpl`), là où
        // c'est un conseil de dev et non une règle de sécurité. Vérifié : aucun
        // gabarit n'écrit `trustedHosts`. Si un jour l'un d'eux le fait, cette
        // entrée reste conditionnée au développement CHEZ LUI.
        //
        // Cette liste porte AUSSI, depuis la dérivation d'origine par `Host`, la
        // décision « quels noms le rendu a le droit de suivre » : y ajouter un
        // hôte ouvre à la fois la barrière 421, l'allowlist Vite, le CSP et
        // l'origine des assets. Une seule liste, quatre effets — c'est voulu.
        trustedHosts: [
          "localhost",
          "127.0.0.1",
          "nodefony.com",
          "host.docker.internal",
        ],
        // trustProxy : n'honore les en-têtes forwarded que derrière un proxy de
        // confiance. Activé via NF_BIND_ALL (banc reverse-proxy Docker : IP source
        // des conteneurs = réseau privé 172.16/12, 192.168/16, 10/8). En prod,
        // régler explicitement selon l'ingress. Défaut SÛR : false (0 confiance).
        trustProxy: ctx.env.NF_BIND_ALL ? ["loopback", "uniquelocal"] : false,
        // Stockage de session en `auto` : sans infra déclarée mais @nodefony/drizzle
        // chargé → sqlite local (persistant) ; honore l'override global
        // `NF_STORE=memory` (banc de charge). Le modèle NIST/OWASP (idle + absolute +
        // touch sur activité HTTP/WS) vit dans @nodefony/http (défauts sains : idle
        // 30 min, absolute 12 h). Multi-nœud → déclarer NF_DATABASE_URL / NF_REDIS_URL.
        session: {
          store: "auto",
        },
        // Upload multipart (moteur busboy). `uploadDir` = dossier de dépôt ;
        // vide → résolu sur `kernel.tmpDir`. (Ex-clé `formidable` = moteur retiré.)
        upload: { uploadDir: "./tmp/upload" },
      },
      { policy: "mandatory" },
    ),
    // Idempotence des mutations : `auto` (défaut) suit l'infra déclarée —
    // NF_REDIS_URL → redis, sinon NF_DATABASE_URL → drizzle ; SANS infra réseau,
    // un backend local persistant chargé (drizzle sqlite, puis mongoose) passe
    // AVANT le repli `memory`. `NF_STORE` force tout cela d'un cran au-dessus. |
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
        // Rôle ÉMETTEUR (RFC 8414) — l'URL publique sous laquelle cette app
        // signe ses jetons. Elle ne se devine PAS (derrière un relais, `Host`
        // vient du client) : c'est l'exploitant qui l'écrit. Renseignée, elle
        // ouvre `/.well-known/oauth-authorization-server` et
        // `/.well-known/jwks.json` — sans quoi aucun tiers ne peut vérifier une
        // signature émise ici. En dev, l'adresse publique EST connue.
        jwt: {
          issuer:
            ctx.env.NF_JWT_ISSUER ??
            (ctx.isProd ? undefined : "https://localhost:5152"),
          // Clés de signature PERSISTANTES (dossier gitignoré, chmod 600).
          //
          // 🔴 Sans elles, chaque process génère la sienne au démarrage : un
          // jeton émis par la CLI (`nodefony security:token`) porte un `kid`
          // que le serveur en marche ne connaît pas, et il est refusé en
          // « autorisation requise ». Mesuré : trois `kid` distincts pour la
          // même application, un par process et un de plus après redémarrage.
          // Elles survivent aussi aux redémarrages — les jetons en vol ne sont
          // plus invalidés à chaque rebuild du serveur de développement.
          //
          // En PRODUCTION, ce dossier n'a pas de sens (pods jetables, système
          // de fichiers éphémère) : la clé y vient de l'environnement
          // (`keySetJson`), partagée par tous les pods.
          keystore: ctx.isProd ? {} : { dir: "var/keys" },
        },
        // 2FA TOTP (P6) — secret 2FA chiffré au repos (AES-256-GCM). Clé prod via
        // env (absente en prod = 2FA OFF, fail-safe : un secret chiffré par une clé
        // éphémère serait illisible après redémarrage / sur les autres pods ; dev =
        // clé éphémère + warning). MÊME pont env que les webhooks.
        totp: {
          encryptionKey: ctx.env.NF_TOTP_KEY,
        },
        // Jetons anti-CSRF (synchronizer) — le secret DOIT être partagé entre
        // les process : en cluster, un secret par pod ferait rejeter un jeton
        // émis par un autre pod. Absent en dev = secret éphémère + warning,
        // comme les deux clés voisines. `npx nodefony security:secrets`.
        csrf: {
          secret: ctx.env.NF_CSRF_SECRET,
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

    // Frontend AVANT ses consumers. Ce que Vite ÉCOUTE et ce que le NAVIGATEUR
    // appelle restent deux choses distinctes — mais la seconde se DÉRIVE
    // désormais du `Host` de chaque requête : le poste (`127.0.0.1`) et un
    // navigateur en conteneur (`host.docker.internal`) chargent la même page,
    // en même temps, sans rien à configurer. Codespaces/Gitpod se détectent
    // toujours seuls. `publicOrigin` reste disponible pour un tunnel ou un
    // proxy frontal — c'est alors un réglage durable, qui gagne sur la
    // dérivation, jamais un décor d'observation qu'on oublierait de retirer.
    { name: "@nodefony/frontend" },
    { name: "@nodefony/test-frontend-react", policy: "dev" },
    { name: "@nodefony/test-frontend-vue", policy: "dev" },
    { name: "@nodefony/test-frontend-angular", policy: "dev" },
    { name: "@nodefony/test-frontend-svelte", policy: "dev" },
    { name: "@nodefony/mediasoup", policy: "dev" },

    // ── Doc transverse AVANT Studio.
    "@nodefony/documentation",

    // Studio admin — console d'administration du framework. `ui` reste sur `auto`
    // (→ Vite/HMR dans ce dépôt) sauf décor contraire : `NF_STUDIO_UI=static` sert
    // le pré-buildé, seul mode joignable depuis un navigateur en conteneur (le
    // pourquoi est dans ./env.ts).
    use(
      "@nodefony/studio",
      { ui: ctx.env.NF_STUDIO_UI },
      { policy: "mandatory" },
    ),

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

    /**
     * Outillage de DÉVELOPPEMENT : carte de visite de l'application et portes de
     * découverte pour un agent.
     *
     * `policy: "dev"` — ce qu'il expose (modules chargés, chemins de doc, verbes
     * à lancer) aide pendant le développement et n'est, en production, qu'une
     * divulgation. Un module non chargé n'est même pas importé : coût nul.
     */
    use(
      "@nodefony/devkit",
      {
        // ── Porte MCP PROTÉGÉE (P6.9) ──────────────────────────────────────
        // Un seul réglage commande le rôle : `authorizationServers`. Vide, la
        // porte est anonyme ; non vide, elle exige un jeton et publie où en
        // obtenir un (RFC 9728).
        //
        // Ici l'émetteur, c'est CETTE application : elle signe ses propres
        // jetons et publie ses clés (`/.well-known/jwks.json`), donc son
        // vérificateur sait les relire — exactement comme il relirait ceux
        // d'un Keycloak. C'est ce qui permet un MCP authentifié SANS monter
        // le moindre serveur d'autorisation tiers.
        mcp: {
          authorization: {
            authorizationServers: [
              ctx.env.NF_JWT_ISSUER ?? "https://localhost:5152",
            ],
            // 🔴 L'audience attendue des jetons — elle s'ÉCRIT, jamais dérivée
            // du `Host` : sinon un `Host` forgé obtiendrait un jeton d'audience
            // arbitraire ET passerait la vérification, ce qui viderait la
            // liaison d'audience de son unique raison d'être. C'est l'adresse
            // par laquelle un client entre réellement (cf `.mcp.json`) ; en
            // production, l'URL publique en https.
            resource: "http://localhost:5151/nodefony/mcp",
            resourceName: "Nodefony — outils de développement",
            // 🔴 LES DEUX MODES À LA FOIS, et c'est un choix de DÉVELOPPEMENT.
            //
            // Un client MCP conforme qui reçoit un `401` veut obtenir un jeton
            // TOUT SEUL : il suit le défi, lit les métadonnées, trouve notre
            // émetteur — et y cherche un `authorization_endpoint` et un
            // `token_endpoint` que cette application n'offre pas (elle n'est pas
            // un serveur d'autorisation OAuth ; cf P6.9d). Il s'arrête donc là,
            // et l'outil devient inutilisable pour qui ne sait pas coller un
            // en-tête à la main.
            //
            // `true` : la porte SERT les outils publics sans jeton, et retient
            // les outils réservés (`IMcpTool.scopes` / `requiresAuth`) tant
            // qu'une identité n'est pas prouvée. L'authentification devient un
            // GAIN, pas un péage — et la vérification de jeton, elle, reste
            // entièrement exercée dès qu'un porteur en présente un.
            //
            // En production, ce drapeau s'écrit `false` : là, une porte ouverte
            // n'a plus d'excuse.
            anonymous: !ctx.isProd,
          },
        },
      },
      { policy: "dev" },
    ),
  ],
}));
