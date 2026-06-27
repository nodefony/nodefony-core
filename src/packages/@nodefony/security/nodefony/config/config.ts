import { defineSecurityConfig } from "./defineSecurityConfig";

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  @nodefony/security — CONFIGURATION DE RÉFÉRENCE (entièrement commentée)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Toutes les options de sécurité sont listées ici avec leur explication et leur
 * **valeur par défaut**. Défauts = SÛRS (Zero Trust, CORS strict, Studio OFF).
 *
 * Validée par `defineSecurityConfig()` (Zod) au chargement → erreur claire au boot
 * si une valeur est invalide. Détecte aussi les conflits de patterns de zones.
 *
 * SURCHARGE :
 *   • App (statique, typé)  : `config/security.ts` → `defineSecurityConfig({...})`.
 *   • App par environnement : `config/{dev,prod}/security.ts` (compose l'objet de base).
 *   • Studio (runtime, à chaud, désactivable) : overlay persité — chaque section
 *     porte `enabled` → on coupe/active une défense SANS redéploiement.
 *
 * Chaque option est aussi auto-décrite côté schéma (`.describe()`) → Studio génère
 * son formulaire d'édition depuis `securityConfigJsonSchema()` (aucune UI hardcodée).
 */
export default {
  // Recharge la config en dev quand le fichier change. Défaut: false.
  watch: false,

  ...defineSecurityConfig({
    // ══════════════════ ENCODEURS (hash mot de passe) ══════════════════
    encoders: {
      // Encodeur de l'utilisateur. Argon2id (RFC 9106) = défaut 2026 : memory-hard
      // (19 MiB par hash) → le brute-force GPU massivement parallèle s'effondre.
      // Bornes du schéma = minimums OWASP (m=19 MiB, t=2, p=1) ; monter en prod
      // sensible (ex. memoryKiB: 47104, timeCost: 1).
      // bcrypt reste supporté (legacy, limite 72 octets): { type: "bcrypt", rounds: 12 }.
      user: { type: "argon2id", memoryKiB: 19456, timeCost: 2, parallelism: 1 },
    },

    // ══════════════════ HIÉRARCHIE DE RÔLES ══════════════════
    // ROLE_X hérite des rôles listés (résolu au boot en DFS ; cycle → throw).
    // Défaut: {} (rôles plats, aucune hiérarchie).
    // Ex: { ROLE_SUPER_ADMIN: ["ROLE_ADMIN"], ROLE_ADMIN: ["ROLE_USER"] }
    roleHierarchy: {},

    // ══════════════════ ZONES (firewall) ══════════════════
    // Chaque zone = pattern d'URL (+ host éventuel) + chaîne d'authenticators.
    // Défaut: {} → AUCUNE route protégée (firewall = no-op, perf maximale).
    // Ex:
    //   main_api: { pattern: "^/api/(?!admin)", authenticators: ["jwt"] }
    //   admin:    { pattern: "^/api/admin", authenticators: ["mtls","jwt"], host: "admin.exemple.com" }
    // Options par zone :
    //   pattern        (requis)      RegExp d'URL.
    //   security       déf. true     zone protégée (Zero Trust). false = publique explicite.
    //   stateless      déf. false    stratégie d'identité au-dessus du protocole (HTTP reste
    //                                stateless par nature). false = registre serveur autorisé :
    //                                session créée AU LOGIN seulement (jamais pour un anonyme),
    //                                cookie opaque révocable (BFF). true = aucun registre :
    //                                chaque requête porte sa preuve (JWT/clé API), session ignorée.
    //   mode           déf. "first"  "first" = le 1er authenticator qui reconnaît la requête
    //                                authentifie (cookie OU bearer) ; "all" = tous doivent
    //                                passer (ex. mtls+jwt sur une zone admin).
    //   authenticators déf. []       noms exécutés selon `mode`. Validés au boot.
    //   host           déf. -        domaine/vhost (ex. admin.exemple.com). Omis = tous domaines.
    //   entryPoint     déf. -        route de login/redirect si non authentifié.
    //   realtime       déf. false    zone valable AUSSI en WebSocket (api.request + subscribe),
    //                                pas seulement HTTP. Le verrou WS lit la même zone que HTTP.
    areas: {},

    // ══════════════════ CORS (Cross-Origin Resource Sharing) ══════════════════
    cors: {
      enabled: true, //                       active la gestion CORS. Défaut: true.
      origins: [], //                         whitelist d'origines. JAMAIS "*" + credentials. Défaut: [].
      credentials: false, //                  cookies cross-origin. true UNIQUEMENT avec whitelist. Défaut: false.
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], // méthodes autorisées.
      allowedHeaders: ["Authorization", "Content-Type", "X-Requested-With"], // en-têtes acceptés.
      exposedHeaders: [], //                  en-têtes exposés au client JS. Défaut: [].
      maxAgeS: 600, //                        cache préflight (s). Défaut: 600 (10 min).
    },

    // ══════════════════ CSRF (Fetch Metadata d'abord — OWASP 2025) ══════════════════
    // Le navigateur tamponne lui-même la provenance (Sec-Fetch-Site) : infalsifiable
    // par un site attaquant. Le token synchronizer devient l'exception (@CsrfProtect).
    csrf: {
      enabled: true, //          défense CSRF par défaut. Défaut: true.
      fetchMetadata: true, //    PRIMAIRE : rejette les mutations cross-site (Sec-Fetch-Site). Défaut: true.
      sameSite: "Lax", //        attribut COOKIE de session. Défaut: "Lax" (Strict casse les liens entrants ; banking → Strict).
      checkOrigin: true, //      fallback Origin/Referer sur POST/PUT/PATCH/DELETE (vieux navigateurs). Défaut: true.
      strictSameSite: false, //  Sec-Fetch-Site: same-site (sous-domaine) → false=toléré / true=403 (multi-tenant). Défaut: false. ≠ cookie `sameSite`.
      trustedOrigins: [], //     alias multi-domaine légitimes (ex. ["https://app.example.org"]) autorisés même cross-site. Défaut: []. ≠ cors.origins (pas de lecture CORS).
    },

    // ══════════════════ EN-TÊTES DE SÉCURITÉ (natif, sans la lib helmet) ══════════════════
    headers: {
      enabled: true, //                  applique les en-têtes. Défaut: true.
      hsts: true, //                     Strict-Transport-Security (HTTPS forcé). Défaut: true.
      hstsMaxAgeS: 31536000, //          durée HSTS (s). Défaut: 1 an (includeSubDomains).
      // CSP « secure-but-usable » : seul `script-src` est strict (self + nonce/requête =
      // la vraie défense XSS) ; le reste couvre les besoins réels des apps web modernes
      // (CSS-in-JS, images/fonts inline, blobs, fetch/WS same-origin, workers). `{{nonce}}`
      // substitué par requête si cspNonces. Durcissements : object 'none', base-uri/form-action 'self'.
      csp:
        "default-src 'self'; " +
        "script-src 'self' 'nonce-{{nonce}}'; " +
        "style-src 'self' 'unsafe-inline'; " + // CSS-in-JS : attributs `style=""` non couvrables par nonce
        // icônes/logos base64 + canvas/charts + avatars externes (Gravatar /
        // Google / GitHub) — allowlist stricte (les autres providers OIDC =
        // ajouter le domaine de leur `picture` ici).
        "img-src 'self' data: blob: https://www.gravatar.com https://*.googleusercontent.com https://avatars.githubusercontent.com; " +
        "font-src 'self' data:; " + //            polices inline
        "connect-src 'self'; " + //               fetch + WebSocket same-origin (API + realtime)
        "worker-src 'self' blob:; " + //          web workers (mermaid/cytoscape…)
        "object-src 'none'; " + //                bloque Flash/plugins (anti-XSS legacy)
        "base-uri 'self'; " + //                  empêche l'injection d'une <base> pirate
        "form-action 'self'", //                  POST uniquement vers l'origine
      cspNonces: true, //                nonce CSP par requête (bloque l'inline non signé). Défaut: true.
      frameguard: "deny", //             X-Frame-Options. Défaut: "deny" (anti-clickjacking).
      noSniff: true, //                  X-Content-Type-Options: nosniff. Défaut: true.
      referrerPolicy: "no-referrer", //  Referrer-Policy. Défaut: "no-referrer".
      hidePoweredBy: true, //            retire X-Powered-By (anti-fingerprinting). Défaut: true.
      // ── Avancés : décommenter pour activer (non posés par défaut) ──
      // coop: "same-origin",            // Cross-Origin-Opener-Policy — isolation Spectre.
      // coep: "require-corp",           // Cross-Origin-Embedder-Policy — ⚠️ casse les ressources tierces non-CORP.
      // corp: "same-origin",            // Cross-Origin-Resource-Policy.
      // originAgentCluster: true,       // Origin-Agent-Cluster — isolation mémoire par origine.
      // permissionsPolicy: "camera=(), microphone=(), geolocation=()", // désactive caméra/micro/géo.
    },

    // ══════════════════ THROTTLING LOGIN (NIST SP 800-63B) ══════════════════
    // Backoff PROGRESSIF par identifiant saisi — JAMAIS de verrouillage dur
    // automatique (un lockout offrirait à l'attaquant un déni de service gratuit
    // sur le compte de sa victime). Bloqué → 429 + Retry-After (RFC 6585).
    // Le verrouillage ADMINISTRATIF reste IUser.isLocked() (décision humaine).
    rateLimit: {
      enabled: true, //          active le throttling. Défaut: true.
      freeAttempts: 3, //        échecs consécutifs sans délai (fautes de frappe). Défaut: 3.
      baseDelayS: 1, //          délai initial (s) — double à chaque échec suivant. Défaut: 1.
      capDelayS: 900, //         plafond du délai (s). Défaut: 900 (15 min).
      maxTracked: 10000, //      borne mémoire (identifiants suivis, éviction FIFO). Défaut: 10000.
    },

    // ══════════════════ JWT (API service↔service / agents) ══════════════════
    // Le web/navigateur utilise la SESSION BFF (cookie opaque révocable) — le JWT
    // est réservé aux échanges machine↔machine où le stateless a un vrai sens.
    jwt: {
      enabled: true, //          active l'auth JWT. Défaut: true.
      alg: "EdDSA", //           algo de signature. Défaut: "EdDSA" (reco). RS256 possible.
      accessTtlS: 900, //        durée access token. Défaut: 900 (15 min).
      refreshTtlS: 604800, //    durée refresh token. Défaut: 604800 (7 jours).
      rotateRefresh: true, //    rotation du refresh à chaque usage (OWASP). Défaut: true.
      jwks: true, //             expose JWKS + `kid` (rotation de clés). Défaut: true.
      audiences: [], //          claims `aud` acceptés (RFC 8707). Vide = audience de l'app (= issuer). Validation OBLIGATOIRE.
      // issuer: "https://api.exemple.com", // claim `iss`. Omis = dérivé du domaine de l'app au boot.
      keystore: {
        // Source du matériel de signature (priorité) : env → fichier → mémoire+warn.
        // keySetJson: env.NF_JWT_KEYSET, // JWK Set injecté depuis l'env (prod). SECRET.
        // dir: "var/security",           // persistance keyset.json (chmod 600), opt-in dev/VPS.
        // (rien) → clé éphémère en mémoire + warning : refresh non durables au restart.
      },
    },

    // ══════════════════ STORE DE JETONS (refresh / PAT / denylist) ══════════════════
    // État serveur des jetons longue durée : un access JWT (15 min) est auto-porté et
    // non révocable avant son exp ; la révocation "révocable" (logout, ban, rotation)
    // exige cet état. Pluggable comme les stores de session.
    tokenStore: {
      driver: "memory", //         memory|file|drizzle|mongoose|redis. Défaut: "memory" (dev/tests, volatile).
      gcIntervalS: 600, //         purge des jetons expirés (s). 0 = off. Chaque process purge son store.
      gcJitter: true, //           délai aléatoire anti-balayage-simultané (cluster). Défaut: true.
      retentionRevokedDays: 30, // rétention d'un PAT révoqué sans exp (audit). Défaut: 30.
    },

    // ══════════════════ PASSKEYS (WebAuthn L3 / FIDO2) ══════════════════
    // MFA phishing-resistant (NIST AAL2, synced par défaut). Le password devient
    // le fallback, pas l'inverse.
    passkeys: {
      enabled: true, //                 active WebAuthn. Défaut: true.
      // rpId: "exemple.com",        // Relying Party ID. Omis = domaine de l'app au boot.
      // rpName: "Mon app",          // nom lisible affiché dans l'invite OS. Omis = nom de l'app.
      origins: [], //                   origines autorisées aux ceremonies. Vide = origine de l'app.
      userVerification: "preferred", // biométrie/PIN: "required" | "preferred" | "discouraged".
      residentKey: "preferred", //      passkey découvrable (login usernameless). Défaut: "preferred".
      authenticatorAttachment: "platform", // "platform" = empreinte intégrée (Touch ID/Hello, PAS de QR) | "cross-platform" = clé/tél (YubiKey, QR) | "any" = les deux.
      attestation: "none", //           "none" = passkeys grand public (pas de vérif certs fabricant). Défaut: "none".
      timeoutMs: 60000, //              délai utilisateur par ceremony (ms). Défaut: 60000.
      challengeTtlS: 300, //            TTL du challenge serveur (anti-replay, s). Défaut: 300.
      store: "memory", //               "memory" (volatile) | "file" (persiste sur disque, mono-process). Cluster/prod → ORM/Redis (à venir).
      // storePath: "var/webauthn-credentials.json", // chemin du fichier (driver "file"). Défaut: <cwd>/var/webauthn-credentials.json.
    },

    // ══════════════════ TOKEN EXCHANGE (RFC 8693 — agents IA) ══════════════════
    // Un agent agit "on-behalf-of" un utilisateur avec une chaîne `act` auditable
    // (délégation explicite ≠ impersonation). Slot réservé — implémentation P12.
    tokenExchange: {
      enabled: false, // Défaut: false (non implémenté).
    },

    // ══════════════════ CLÉS API (PAT — style GitHub/Claude) ══════════════════
    // Format émis : <prefix>_<pubid>_<secret><crc> (ex. nf_a1b2c3d4_… ). Secret
    // = 256 bits aléatoires → HASHÉ (sha256) au repos, affiché UNE seule fois.
    apiKeys: {
      enabled: true, //           active les clés API. Défaut: true.
      prefix: "nf", //            marque (minuscules/chiffres). Défaut: "nf".
      defaultExpiryDays: 90, //   expiration par défaut (jours). null = jamais. Défaut: 90.
      lastUsedThrottleS: 60, //   coalescence d'écriture "last used" (s, perf). 0 = à chaque usage. Défaut: 60.
      maxPerSubject: 100, //      plafond de clés actives par porteur (anti-abus). Défaut: 100.
      allowedScopes: null, //     catalogue de scopes autorisés à la création. null = libre. Défaut: null.
    },

    // ══════════════════ WEBHOOKS (sortants, signés) ══════════════════
    webhooks: {
      enabled: true, //              active les webhooks. Défaut: true.
      signAlg: "sha256", //         HMAC sortant (X-Nodefony-Signature-256). Défaut: "sha256".
      timestampToleranceS: 300, //  fenêtre anti-replay (s, style Stripe). Défaut: 300.
      denyPrivateIps: true, //      bloque SSRF (IP privées / 169.254.169.254). Défaut: true. NE PAS désactiver en prod.
      maxRetries: 5, //             tentatives de livraison. Défaut: 5.
    },

    // ══════════════════ AUDIT (journal sécurité) ══════════════════
    audit: {
      enabled: true, //         active l'audit. Défaut: true.
      immutable: true, //       append-only (tamper-evident). Défaut: true.
      stream: true, //          diffusion realtime WS vers Studio. Défaut: true.
      retentionDays: 365, //    rétention (jours). Défaut: 365.
    },

    // ══════════════════ STUDIO (console admin — TRÈS protégée) ══════════════════
    // ⚠️ La console est la cible la plus sensible. Défauts = les plus restrictifs.
    studio: {
      enabled: false, //              console admin. Défaut: false (OFF, surtout en prod).
      exposure: "localhost", //       portée réseau. Défaut: "localhost". "private" | "public".
      allowedIps: [], //              whitelist CIDR. Deny par défaut si exposure="public". Défaut: [].
      requireMfa: false, //           MFA admin. Défaut: false (enforcement pas encore câblé — true mentirait).
      auditAllActions: true, //       audit de CHAQUE action mutante. Défaut: true.
    },
  }),
};
