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
      // Encodeur de l'utilisateur. bcrypt rounds 12 (~250 ms/hash) = défaut prod-safe.
      // Reco prod sensible: 13-14 (plus lent = plus résistant au brute-force offline).
      // Bornes: min 10, max 15.
      user: { type: "bcrypt", rounds: 12 },
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
    //   pattern        (requis)   RegExp d'URL.
    //   security       déf. true  zone protégée (Zero Trust). false = publique explicite.
    //   stateless      déf. true  HTTP stateless (JWT cookie). false = stateful.
    //   authenticators déf. []    noms à exécuter (tous doivent passer). Validés au boot.
    //   host           déf. -     domaine/vhost (ex. admin.exemple.com). Omis = tous domaines.
    //   entryPoint     déf. -     route de login/redirect si non authentifié.
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

    // ══════════════════ CSRF (OWASP 2024 — pas de token classique) ══════════════════
    csrf: {
      enabled: true, //        défense CSRF par défaut. Défaut: true.
      sameSite: "Strict", //   SameSite des cookies sensibles. Défaut: "Strict" (reco). Lax/None possibles.
      checkOrigin: true, //    vérifie Origin/Referer sur POST/PUT/PATCH/DELETE. Défaut: true.
    },

    // ══════════════════ EN-TÊTES DE SÉCURITÉ (natif, sans la lib helmet) ══════════════════
    headers: {
      enabled: true, //                  applique les en-têtes. Défaut: true.
      hsts: true, //                     Strict-Transport-Security (HTTPS forcé). Défaut: true.
      hstsMaxAgeS: 31536000, //          durée HSTS (s). Défaut: 1 an (includeSubDomains).
      csp: "default-src 'self'", //      Content-Security-Policy. Défaut: self only.
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

    // ══════════════════ RATE LIMIT / ANTI BRUTE-FORCE ══════════════════
    rateLimit: {
      enabled: true, //          active la limitation. Défaut: true.
      loginPoints: 5, //         tentatives login avant throttle. Défaut: 5.
      loginDurationS: 60, //     fenêtre de comptage (s). Défaut: 60.
      lockoutThreshold: 10, //   échecs avant verrouillage du compte. Défaut: 10.
    },

    // ══════════════════ JWT (jetons stateless en cookie) ══════════════════
    jwt: {
      enabled: true, //          active l'auth JWT. Défaut: true.
      alg: "EdDSA", //           algo de signature. Défaut: "EdDSA" (reco). RS256 possible.
      accessTtlS: 900, //        durée access token. Défaut: 900 (15 min).
      refreshTtlS: 604800, //    durée refresh token. Défaut: 604800 (7 jours).
      rotateRefresh: true, //    rotation du refresh à chaque usage (OWASP). Défaut: true.
      jwks: true, //             expose JWKS + `kid` (rotation de clés). Défaut: true.
    },

    // ══════════════════ CLÉS API (PAT — style GitHub/Claude) ══════════════════
    apiKeys: {
      enabled: true, //          active les clés API. Défaut: true.
      prefix: "nf", //           préfixe : nf_<prefix>_<secret>. Défaut: "nf". Clé HASHÉE au repos, affichée 1×.
      defaultExpiryDays: 90, //  expiration par défaut (jours). null = jamais. Défaut: 90.
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
      requireMfa: true, //            MFA obligatoire pour l'admin. Défaut: true.
      authenticators: ["jwt"], //     auth de la zone admin. Reco si public: ["mtls","jwt"]. Défaut: ["jwt"].
      auditAllActions: true, //       audit de CHAQUE action mutante. Défaut: true.
    },
  }),
};
