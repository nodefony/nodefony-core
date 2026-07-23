import { z } from "zod";

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  @nodefony/security — CONFIGURATION DU MODULE (schéma Zod = source unique)
 *
 * ⭐ TL;DR : CE SCHÉMA EST LA CONFIG. Chaque `.default(...)` = la valeur d'usine ;
 * changer un défaut du module = ÉDITER ICI (et nulle part ailleurs). L'app, elle,
 * surcharge via `use("@nodefony/...", { … })` dans SON `nodefony.config.ts`.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * RÈGLE D'OR (ADR-0006) : ce fichier porte le **schéma Zod commenté** (type +
 * validation + défaut + doc) ET matérialise les défauts via `parse({})`. Aucune
 * valeur n'est re-tapée ailleurs. Le builder (`defineModuleConfig.ts` →
 * `defineSecurityConfig` : parse + détection de conflits de zones + freeze)
 * importe le schéma D'ICI (nœud bas : ce fichier n'importe que `zod`).
 *
 * Principes (≠ copie Symfony) :
 * - **Groupé par préoccupation** : une section = un sujet sécu (firewall, cors,
 *   csrf, headers, rateLimit, jwt, apiKeys, webhooks, audit, studio).
 * - **Tout est désactivable** : chaque défense porte `enabled` → Studio l'allume/
 *   l'éteint à chaud (overlay runtime, sans redéploiement).
 * - **Auto-documenté + introspectable** : chaque champ porte `.describe()` →
 *   `securityConfigJsonSchema()` produit un JSON Schema dont Studio dérive un
 *   formulaire d'édition (zéro UI hardcodée).
 * - **Défauts SÛRS** : Zero Trust, CORS strict (jamais `*`+credentials), Studio OFF.
 *
 * OÙ SURCHARGER (précédence croissante — cf ADR-0006) :
 *   • App (typé)         : `use("@nodefony/security", { … })` dans `nodefony.config.ts` ;
 *   • Par environnement  : la fonction `(ctx) => …` de `nodefony.config.ts` (`ctx.isProd`…) ;
 *   • Déploiement/Docker : `NF__SECURITY__<CHEMIN>=valeur` (override env générique) ;
 *   • Studio (à chaud)   : chaque section porte `enabled` → activable/désactivable.
 */

const encoderSchema = z.object({
  type: z
    .enum(["argon2id", "bcrypt"])
    .default("argon2id")
    .describe(
      "Algorithme de hash du mot de passe. Argon2id (RFC 9106) = défaut : memory-hard, résiste au parallélisme GPU/ASIC. bcrypt = legacy supporté (limite 72 octets).",
    ),
  // ── Argon2id — minimums OWASP (m=19 MiB, t=2, p=1) imposés par le schéma ──
  memoryKiB: z
    .number()
    .int()
    .min(19456)
    .default(19456)
    .describe(
      "Argon2id : mémoire par hash (KiB). 19456 = 19 MiB, minimum OWASP.",
    ),
  timeCost: z
    .number()
    .int()
    .min(2)
    .default(3)
    .describe(
      "Argon2id : passes d'itération. Défaut 3 (> minimum OWASP t=2 ; RFC 9106 « uniformly safe ») — renchérit l'attaquant sans augmenter la RAM par hash (anti-DoS). Bench cible 50-100 ms/hash.",
    ),
  parallelism: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe("Argon2id : lanes parallèles. Défaut 1 (OWASP)."),
  // ── bcrypt (legacy) ──
  rounds: z
    .number()
    .int()
    .min(10)
    .max(15)
    .default(12)
    .describe("bcrypt : coût (10–15). Ignoré par argon2id."),
});

const areaSchema = z.object({
  pattern: z.string().describe("Pattern d'URL (RegExp) capturé par la zone."),
  security: z
    .boolean()
    .default(true)
    .describe("Zone protégée (Zero Trust). false = publique explicite."),
  stateless: z
    .boolean()
    .default(false)
    .describe(
      "Stratégie d'identité AU-DESSUS du protocole (HTTP reste stateless par nature). false (défaut) : la zone PEUT tenir un registre serveur — la session n'est créée qu'AU LOGIN (jamais pour un anonyme, zéro alloc), cookie opaque révocable (BFF). true : aucun registre — chaque requête porte sa preuve complète (JWT/clé API), la session est ignorée même si un cookie est présent.",
    ),
  mode: z
    .enum(["first", "all"])
    .default("first")
    .describe(
      "Chaîne d'authenticators : 'first' = le premier qui reconnaît la requête authentifie (ex. cookie OU bearer) ; 'all' = tous doivent passer (ex. mtls+jwt zone admin).",
    ),
  authenticators: z
    .array(z.string())
    .default([])
    .describe(
      "Authenticators de la zone (sémantique selon `mode`). Validés au boot contre le registre.",
    ),
  entryPoint: z
    .string()
    .optional()
    .describe("Route de login/redirect si non authentifié."),
  host: z
    .string()
    .optional()
    .describe(
      "Domaine/vhost de la zone (ex. admin.exemple.com). Omis = tous domaines.",
    ),
  realtime: z
    .boolean()
    .default(true)
    .describe(
      "Zone valable AUSSI pour les frames WebSocket (api.request + subscribe), pas seulement HTTP. Défaut `true` (Zero Trust : une zone protégée ferme TOUS ses transports — un opt-IN laisserait le WS anonyme par omission = fail-open). `false` = opt-out explicite pour une zone strictement HTTP. Le verrou WS consulte la MÊME zone que HTTP — invariant : `api.request {path}` n'accorde jamais plus que `GET {path}`.",
    ),
});

const corsSchema = z
  .object({
    enabled: z.boolean().default(true).describe("Active la gestion CORS."),
    origins: z
      .array(z.string())
      .default([])
      .describe("Whitelist d'origines. JAMAIS '*' avec credentials."),
    credentials: z
      .boolean()
      .default(false)
      .describe(
        "Autorise les cookies cross-origin (exige une whitelist d'origines).",
      ),
    methods: z
      .array(z.string())
      .default(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
    allowedHeaders: z
      .array(z.string())
      .default(["Authorization", "Content-Type", "X-Requested-With"]),
    exposedHeaders: z.array(z.string()).default([]),
    maxAgeS: z
      .number()
      .int()
      .default(600)
      .describe("Cache préflight (secondes)."),
  })
  .describe("Cross-Origin Resource Sharing.")
  .refine((c) => !(c.credentials && c.origins.includes("*")), {
    message:
      "CORS: credentials=true est INCOMPATIBLE avec origins:['*'] (le navigateur le refuse, OWASP). Lister les origines explicitement.",
  });

const csrfSchema = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .describe(
        "Défense CSRF par défaut (Fetch Metadata + SameSite + Origin).",
      ),
    fetchMetadata: z
      .boolean()
      .default(true)
      .describe(
        "Défense PRIMAIRE : rejette les mutations cross-site via Sec-Fetch-Site (tamponné par le navigateur, infalsifiable — modèle Go 1.25 CrossOriginProtection).",
      ),
    sameSite: z.enum(["Strict", "Lax", "None"]).default("Lax"),
    checkOrigin: z
      .boolean()
      .default(true)
      .describe(
        "Fallback : compare Origin/Referer aux origines de l'app sur les méthodes mutantes (vieux navigateurs sans Sec-Fetch-*).",
      ),
    strictSameSite: z
      .boolean()
      .default(false)
      .describe(
        "Politique sur Sec-Fetch-Site: same-site (un SOUS-DOMAINE de la même famille déclenche la mutation). false (défaut) = tolérant (sous-domaines de confiance) ; true = ne tolérer QUE same-origin + none (déploiement multi-tenant / sous-domaine non maîtrisé). ⚠️ distinct de l'attribut cookie `sameSite` ci-dessus.",
      ),
    trustedOrigins: z
      .array(z.string())
      .default([])
      .describe(
        "Origines ALIAS légitimes de l'app (façades multi-domaine, ex. ['https://app.example.org']) — autorisées MÊME en cross-site, sur Fetch Metadata ET fallback. Distinct de `cors.origins` (qui, lui, ouvre AUSSI la lecture CORS des réponses) : un simple alias de domaine ne doit pas exposer les réponses au JS tiers. Match exact d'origine (scheme://host[:port]).",
      ),
    secret: z
      .string()
      .min(16)
      .optional()
      .describe(
        "Secret HMAC du token synchronizer (`@CsrfProtect`, défense en profondeur opt-in). PROD : fixer via env (≥16 car.) — DOIT être PARTAGÉ entre process (cluster) sinon les tokens d'un pod sont rejetés par un autre. DEV : si absent, un secret éphémère est généré au boot (re-généré à chaque restart → invalide les tokens en cours). Sans valeur, `@CsrfProtect` fonctionne en dev mais N'EST PAS sûr en cluster.",
      ),
  })
  .describe(
    "Cross-Site Request Forgery — Fetch Metadata d'abord (OWASP 2025) ; token synchronizer = opt-in @CsrfProtect.",
  );

const headersSchema = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .describe("En-têtes de sécurité HTTP (natif, sans la lib helmet)."),
    hsts: z
      .boolean()
      .default(true)
      .meta({
        reserved: true,
        description:
          "INERTE ICI — l'en-tête est posé par @nodefony/http à l'entrée brute " +
          "(couvre statics, erreurs et serveur nu ; une seule source par en-tête). " +
          "Pour le régler : `http.securityHeaders.strictTransportSecurity` " +
          "(`null` pour ne pas émettre l'en-tête).",
      }),
    hstsMaxAgeS: z
      .number()
      .int()
      .default(31536000)
      .meta({
        reserved: true,
        description:
          "INERTE ICI — pour régler la durée : " +
          "`http.securityHeaders.strictTransportSecurity.maxAge`.",
      }),
    csp: z
      .string()
      .default(
        // Source UNIQUE du défaut CSP (l'ancienne copie « réf humaine » de
        // config.ts est supprimée — plus de divergence runtime ≠ Zod possible).
        "default-src 'self'; script-src 'self' 'nonce-{{nonce}}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://www.gravatar.com https://*.googleusercontent.com https://avatars.githubusercontent.com; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'",
      )
      .describe(
        "Content-Security-Policy « secure-but-usable ». Seul `script-src` est strict (self + `{{nonce}}` substitué par requête si `cspNonces`) = défense XSS ; le reste couvre les besoins réels (CSS-in-JS, img/font inline, blobs, fetch/WS same-origin, workers) + durcissements (object 'none', base-uri/form-action 'self').",
      ),
    cspNonces: z
      .boolean()
      .default(true)
      .describe("Nonce CSP par requête (bloque l'inline non signé)."),
    frameguard: z
      .enum(["deny", "sameorigin"])
      .default("deny")
      .meta({
        reserved: true,
        description:
          "INERTE ICI — l'en-tête anti-clickjacking est posé par @nodefony/http " +
          "(il couvre aussi les statics et les erreurs). Pour le régler : " +
          "`http.securityHeaders.frameOptions` (`DENY` | `SAMEORIGIN` | `null`).",
      }),
    noSniff: z
      .boolean()
      .default(true)
      .meta({
        reserved: true,
        description:
          "INERTE ICI — posé par @nodefony/http (couvre aussi statics et erreurs). " +
          "Pour le régler : `http.securityHeaders.contentTypeOptions` " +
          "(`nosniff`, ou `null` pour désactiver).",
      }),
    referrerPolicy: z
      .enum([
        "no-referrer",
        "no-referrer-when-downgrade",
        "same-origin",
        "origin",
        "strict-origin",
        "origin-when-cross-origin",
        "strict-origin-when-cross-origin",
        "unsafe-url",
      ])
      .default("no-referrer")
      .describe(
        "Referrer-Policy (W3C, ensemble fini → complété + validé). Posé par security (applicatif).",
      ),
    hidePoweredBy: z
      .boolean()
      .default(true)
      .meta({
        reserved: true,
        description:
          "INERTE — sans objet sous Nodefony, qui n'émet jamais de X-Powered-By " +
          "(contrairement à Express). L'en-tête `Server` est géré par " +
          "@nodefony/http. Rien à activer : il n'y a rien à retirer.",
      }),
    // ── Avancés : optionnels (non posés par défaut ; commentés dans config.ts) ──
    coop: z
      .enum(["same-origin", "same-origin-allow-popups", "unsafe-none"])
      .optional()
      .describe("Cross-Origin-Opener-Policy (isolation Spectre)."),
    coep: z
      .enum(["require-corp", "credentialless", "unsafe-none"])
      .optional()
      .describe(
        "Cross-Origin-Embedder-Policy (require-corp casse les ressources tierces non-CORP).",
      ),
    corp: z
      .enum(["same-origin", "same-site", "cross-origin"])
      .optional()
      .describe("Cross-Origin-Resource-Policy."),
    originAgentCluster: z
      .boolean()
      .optional()
      .describe("Origin-Agent-Cluster (isolation mémoire par origine)."),
    permissionsPolicy: z
      .string()
      .optional()
      .describe(
        "Permissions-Policy (désactive caméra/micro/géo… des API navigateur).",
      ),
  })
  .describe(
    "En-têtes HTTP de sécurité (HSTS, CSP+nonces, frameguard, noSniff… + avancés optionnels).",
  );

// Throttling de login NIST SP 800-63B : backoff PROGRESSIF par identifiant
// saisi, JAMAIS de verrouillage dur (un lockout au N-ième échec offrirait à
// l'attaquant un déni de service gratuit sur le compte de sa victime). Bloqué
// → 429 + `Retry-After` (RFC 6585). Le verrouillage ADMINISTRATIF reste
// `IUser.isLocked()` (décision humaine, pas automatique).
const rateLimitSchema = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .describe(
        "Throttling de login (NIST SP 800-63B) : backoff progressif par identifiant, jamais de lockout dur.",
      ),
    freeAttempts: z
      .number()
      .int()
      .min(1)
      .default(3)
      .describe("Échecs consécutifs tolérés sans délai (fautes de frappe)."),
    baseDelayS: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe(
        "Délai initial (s) après freeAttempts — double à chaque échec suivant.",
      ),
    capDelayS: z
      .number()
      .int()
      .min(1)
      .default(900)
      .describe("Plafond du délai (s) — 900 = 15 min."),
    maxTracked: z
      .number()
      .int()
      .min(100)
      .default(10000)
      .describe(
        "Borne du nombre d'identifiants suivis en mémoire (anti-fuite, éviction des plus anciens).",
      ),
  })
  .describe("Throttling de login (backoff progressif NIST).");

const jwtSchema = z
  .object({
    enabled: z.boolean().default(true),
    alg: z.enum(["EdDSA", "RS256"]).default("EdDSA"),
    accessTtlS: z
      .number()
      .int()
      .default(900)
      .describe("TTL access token (15 min)."),
    refreshTtlS: z
      .number()
      .int()
      .default(604800)
      .describe("TTL refresh token (7 jours)."),
    rotateRefresh: z
      .boolean()
      .default(true)
      .describe("Rotation du refresh token (OWASP)."),
    jwks: z
      .boolean()
      .default(true)
      .describe("Expose JWKS + `kid` (rotation de clés)."),
    audiences: z
      .array(z.string())
      .default([])
      .describe(
        "Audiences acceptées (claim `aud`, RFC 8707). Vide = l'audience de l'app (= `issuer`). La validation d'audience est OBLIGATOIRE côté resource (RFC 9700).",
      ),
    issuer: z
      .string()
      .optional()
      .describe(
        "Émetteur (claim `iss`, RFC 7519). Omis = dérivé du domaine de l'app au boot. STABLE (ne pas changer après émission de refresh).",
      ),
    keystore: z
      .object({
        keySetJson: z
          .string()
          .optional()
          .describe(
            "JWK Set (clé(s) privée(s) Ed25519) injecté par l'app depuis son env — SECRET, jamais loggé. Présent = source `env` (prod cloud).",
          ),
        dir: z
          .string()
          .optional()
          .describe(
            "Dossier de persistance `keyset.json` (chmod 600), généré si absent — opt-in dev/VPS. Sans `keySetJson` ni `dir` = clé ÉPHÉMÈRE en mémoire + warning (refresh non durables).",
          ),
      })
      .default(() => ({}))
      .describe(
        "Source du matériel de signature JWT (priorité) : env (`keySetJson`) → fichier (`dir`) → mémoire+warn. SecretProvider (Vault/KMS) = P16.",
      ),
  })
  .describe(
    "JWT — réservé API service↔service / agents (le web/navigateur utilise la session BFF).",
  );

const tokenStoreSchema = z
  .object({
    store: z
      .string()
      .default("auto")
      .describe(
        "Store de jetons (refresh/PAT/denylist) : auto [défaut] (infra database → drizzle/mongoose ; sinon sqlite local si drizzle chargé ; sinon repli memory volatil)|memory|drizzle|mongoose|redis. Pluggable (`registerTokenStore`). Memory = dev/tests (volatil, non partagé). Vocabulaire unifié : données = `store`.",
      ),
    gcIntervalS: z
      .number()
      .int()
      .min(0)
      .default(600)
      .describe(
        "Intervalle de purge des jetons expirés (s). 0 = désactivé. CHAQUE process purge son store (un store local DOIT être purgé par process).",
      ),
    gcJitter: z
      .boolean()
      .default(true)
      .describe(
        "Étale le gc d'un délai aléatoire (0..interval) par process — évite les balayages simultanés sur un store partagé en cluster.",
      ),
    retentionRevokedDays: z
      .number()
      .int()
      .min(0)
      .default(30)
      .describe(
        "Rétention (jours) d'un PAT révoqué SANS expiration (fenêtre d'audit) avant purge.",
      ),
  })
  .describe(
    "Store de jetons serveur (refresh, PAT, denylist `jti`, seuil de révocation par porteur) + maintenance gc.",
  );

const passkeysSchema = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .describe(
        "Active WebAuthn/passkeys (MFA phishing-resistant, NIST AAL2).",
      ),
    rpId: z
      .string()
      .optional()
      .describe("Relying Party ID (domaine). Omis = domaine de l'app au boot."),
    rpName: z
      .string()
      .optional()
      .describe(
        "Nom lisible de la Relying Party affiché dans l'invite OS/navigateur. Omis = nom de l'app.",
      ),
    origins: z
      .array(z.string())
      .default([])
      .describe("Origines autorisées aux ceremonies. Vide = origine de l'app."),
    userVerification: z
      .enum(["required", "preferred", "discouraged"])
      .default("preferred")
      .describe(
        "Vérification utilisateur (biométrie/PIN) exigée par l'authenticator. Défaut: preferred.",
      ),
    residentKey: z
      .enum(["required", "preferred", "discouraged"])
      .default("preferred")
      .describe(
        "Credential découvrable (passkey usernameless : login sans saisir l'identifiant). Défaut: preferred. 'discouraged' EMPÊCHE le login : la cérémonie anonyme ne cible aucun credential (anti-énumération), elle compte sur la découverte par l'authenticator — un WARNING le rappelle au boot.",
      ),
    authenticatorAttachment: z
      .enum(["platform", "cross-platform", "any"])
      .default("platform")
      .describe(
        "Type d'authentificateur à l'enregistrement. 'platform' = biométrie intégrée (Touch ID/Windows Hello, PAS de QR) [défaut] ; 'cross-platform' = clé externe/téléphone (YubiKey, QR) ; 'any' = les deux (le navigateur propose, QR possible).",
      ),
    attestation: z
      .enum(["none", "direct", "enterprise"])
      .default("none")
      .describe(
        "Conveyance d'attestation demandée au navigateur. Défaut 'none' (passkeys grand public — vie privée). 'direct'/'enterprise' font TRANSMETTRE l'attestation, mais Nodefony ne la confronte à AUCUNE liste de modèles : ni métadonnées FIDO (MDS), ni certificats racines fabricant, et l'AAGUID n'est pas conservé. Le réglage ne suffit donc PAS à tenir un AAL3 régulé — il le prépare. Un WARNING au boot le rappelle si la valeur n'est pas 'none'.",
      ),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .default(60_000)
      .describe(
        "Délai (ms) laissé à l'utilisateur pour compléter une ceremony (navigator.credentials.*). Défaut: 60000.",
      ),
    maxPerUser: z
      .number()
      .int()
      .positive()
      .default(20)
      .describe(
        "Plafond de passkeys enregistrées par utilisateur (409 au-delà). Borne `allowCredentials`/`excludeCredentials`, chargés ENTIERS à chaque cérémonie : sans plafond, un compte qui enrôle en masse fait grossir la réponse du défi de login — déclenchable par un anonyme qui poste son identifiant — et dépasse le `maxCredentialCountInList` des authenticators CTAP2. Défaut: 20 (large pour un humain : appareils + clés physiques + renouvellements).",
      ),
    challengeTtlS: z.number().int().positive().default(300).meta({
      reserved: true,
      description:
        "RÉSERVÉ — non câblé. Durée de vie (s) prévue du challenge serveur (anti-replay). Aujourd'hui le challenge suit la session ; ce TTL dédié n'est lu par aucun authenticator. Défaut: 300 (5 min).",
    }),
    store: z
      .string()
      .default("auto")
      .describe(
        "Backend de stockage des credentials : auto [défaut] (infra database déclarée → drizzle/mongoose ; sinon sqlite local si drizzle chargé ; sinon repli memory volatil)|memory|drizzle|mongoose|redis. Pluggable (`registerWebAuthnStore`). 'memory' = dev/tests (volatil, perdu au redémarrage — les passkeys enregistrés deviennent inutilisables). Persistance = adapter durable auto-enregistré par le module chargé.",
      ),
  })
  .describe("Passkeys (WebAuthn L3 / FIDO2) — synced par défaut.");

const totpSchema = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .describe(
        "Active le 2FA TOTP (RFC 6238, codes à usage unique d'une app d'authentification : Google Authenticator, Authy…).",
      ),
    issuer: z
      .string()
      .optional()
      .describe(
        "Émetteur affiché dans l'app d'authentification (label du QR). Omis = nom de l'app.",
      ),
    algorithm: z
      .enum(["SHA1", "SHA256", "SHA512"])
      .default("SHA1")
      .describe(
        "Fonction HMAC du code. SHA1 = compat maximale (Google Authenticator) [défaut].",
      ),
    digits: z
      .number()
      .int()
      .min(6)
      .max(8)
      .default(6)
      .describe("Nombre de chiffres du code (RFC 4226 §5.3 : 6 minimum)."),
    period: z
      .number()
      .int()
      .positive()
      .default(30)
      .describe(
        "Période d'un code en secondes (RFC 6238 §5.2 : 30 recommandé).",
      ),
    window: z
      .number()
      .int()
      .nonnegative()
      .default(1)
      .describe(
        "Tolérance de dérive d'horloge (± N pas). RFC 6238 §5.2 : « at most one time step » → 1 [défaut]. Plus = surface d'attaque accrue.",
      ),
    recoveryCodes: z
      .number()
      .int()
      .positive()
      .default(10)
      .describe(
        "Nombre de codes de récupération générés à l'activation (NIST SP 800-63B « look-up secrets », usage unique, affichés 1×).",
      ),
    encryptionKey: z
      .string()
      .optional()
      .describe(
        "Clé de chiffrement AES-256-GCM du secret TOTP au repos (fournie par l'app depuis env, ≥ 32 octets après décodage). Omise = clé éphémère dérivée + WARNING (dev mono-process) ; en prod multi-pod, REQUISE (un secret 2FA déchiffrable doit l'être par tous les pods, et jamais en clair).",
      ),
    store: z
      .string()
      .default("auto")
      .describe(
        "Backend de stockage du secret : auto [défaut] | memory | drizzle — plus tout backend ajouté par `registerTotpStore` (la liste qui fait foi est celle de l'écran Stores de Studio, pas ce texte). ⚠️ Contrairement aux sessions, aux jetons et aux passkeys, **seul @nodefony/drizzle fournit un store TOTP** : @nodefony/mongoose et @nodefony/redis n'en enregistrent pas. Sur une infra Mongo, `auto` ne trouve donc pas de backend durable et se replie sur `memory` (repli tracé au boot, et WARNING en production) : les secrets 2FA seraient perdus au redémarrage, verrouillant les utilisateurs hors de leur second facteur. Charger @nodefony/drizzle — même en sqlite local, à côté de Mongo — donne la persistance.",
      ),
  })
  .describe(
    "2FA TOTP (RFC 6238) — second facteur step-up au login. Secret chiffré au repos, codes de récupération hachés.",
  );

const tokenExchangeSchema = z
  .object({
    enabled: z
      .boolean()
      .default(false)
      .describe(
        "Délégation RFC 8693 (agent agit on-behalf-of un user, chaîne `act` auditable). Slot P12 — non implémenté.",
      ),
  })
  .describe("Token Exchange (RFC 8693) — délégation agents/services.");

const apiKeysSchema = z
  .object({
    enabled: z.boolean().default(true),
    prefix: z
      .string()
      .min(1)
      .max(12)
      .regex(/^[a-z0-9]+$/, "préfixe = minuscules/chiffres (charset base64url)")
      .default("nf")
      .describe(
        "Marque des clés émises. Format : `<prefix>_<pubid><secret><crc>` — UN SEUL séparateur `_`, le reste est positionnel (8 + 43 + 6 caractères), car le charset base64url contient lui-même `_` et `-` : découper une clé sur les `_` la casse. Ex. « nf » → `nf_a1b2c3d4XXXX…z9z9z9`, dont `nf_a1b2c3d4` est l'identifiant public affichable.",
      ),
    defaultExpiryDays: z
      .number()
      .int()
      .positive()
      .nullable()
      .default(90)
      .describe("Expiration par défaut (null = jamais)."),
    lastUsedThrottleS: z
      .number()
      .int()
      .nonnegative()
      .default(60)
      .describe(
        "Coalescence d'écriture de `lastUsedAt` (s) — n'écrit pas le store à " +
          "chaque requête (règle perf). 0 = écrit à chaque usage.",
      ),
    maxPerSubject: z
      .number()
      .int()
      .positive()
      .default(100)
      .describe(
        "Plafond de clés actives par porteur (anti-abus du store). Création " +
          "au-delà → 409.",
      ),
    allowedScopes: z
      .array(z.string().min(1))
      .nullable()
      .default(null)
      .describe(
        "Catalogue de scopes autorisés à la création (null = libre). " +
          "L'autorisation réelle reste les rôles frais ∩ scopes à l'usage.",
      ),
  })
  .describe(
    "Clés API (PAT style GitHub/Claude) — hashées au repos, affichées 1×.",
  );

const webhooksSchema = z
  .object({
    enabled: z.boolean().default(true),
    signAlg: z
      .enum(["sha256"])
      .default("sha256")
      .meta({
        reserved: true,
        description:
          "INERTE — l'algorithme de signature est fixé à HMAC-SHA256 " +
          "(`webhookSignature.ts` `signStandardWebhook`). La seule valeur admise " +
          "(`sha256`) est déjà le comportement réel ; le slot Ed25519 " +
          "(Standard Webhooks v1a) n'est pas implémenté.",
      }),
    timestampToleranceS: z
      .number()
      .int()
      .positive()
      .default(300)
      .meta({
        reserved: true,
        description:
          "INERTE côté ÉMETTEUR — Nodefony estampille `webhook-timestamp` mais " +
          "la fenêtre anti-rejeu est appliquée par le RÉCEPTEUR (Standard " +
          "Webhooks). Le framework n'a pas de vérificateur récepteur : ce " +
          "réglage ne borne rien ici.",
      }),
    denyPrivateIps: z
      .boolean()
      .default(true)
      .describe("Bloque SSRF (IP privées / métadonnées cloud)."),
    snapshotTtlS: z
      .number()
      .int()
      .positive()
      .default(30)
      .describe(
        "Fraîcheur (secondes) du cache d'endpoints qui sert au routage des " +
          "livraisons. Un pod ne voit PAS les endpoints créés par un autre pod : " +
          "le store est partagé, pas le cache. Passé ce délai, le premier " +
          "événement d'audit déclenche une relecture en arrière-plan (aucun " +
          "timer, aucun coût sans trafic) — donc la propagation entre pods est " +
          "bornée par cette valeur, jamais immédiate. Baisser pour propager plus " +
          "vite (plus de lectures du store), monter si les endpoints changent rarement.",
      ),
    maxRetries: z
      .number()
      .int()
      .nonnegative()
      .default(5)
      .describe("Tentatives de livraison avant abandon."),
    autoDisableThreshold: z
      .number()
      .int()
      .nonnegative()
      .default(20)
      .describe(
        "Échecs consécutifs avant désactivation auto d'un endpoint (façon GitHub). 0 = jamais.",
      ),
    deliveryTimeoutMs: z
      .number()
      .int()
      .positive()
      .default(10000)
      .describe("Délai max d'une tentative de livraison (ms)."),
    maxConcurrent: z
      .number()
      .int()
      .positive()
      .default(8)
      .describe(
        "Livraisons simultanées max (pool) — borne la charge sortante : un endpoint lent/mort ne peut pas saturer sockets/FD.",
      ),
    maxQueue: z
      .number()
      .int()
      .positive()
      .default(1000)
      .describe(
        "File d'attente max des livraisons. Au-delà : DROP + log (webhook = best-effort, jamais de croissance mémoire illimitée).",
      ),
    allowHttp: z
      .boolean()
      .default(false)
      .describe("Autorise http:// (dev only). Prod : https:// obligatoire."),
    store: z
      .string()
      .default("auto")
      .describe(
        "Backend des endpoints : auto (suit l'infra database déclarée, repli memory) | memory (dev) | drizzle | mongoose. Câblé via registerWebhookStore().",
      ),
    encryptionKey: z
      .string()
      .optional()
      .describe(
        "Clé de chiffrement des secrets de signature au repos (HKDF→AES-256-GCM). Prod : OBLIGATOIRE (absente = webhooks OFF). Dev : clé éphémère + warn.",
      ),
  })
  .describe("Webhooks sortants signés (Standard Webhooks).");

const auditSchema = z
  .object({
    enabled: z.boolean().default(true),
    store: z
      .string()
      .default("auto")
      .describe(
        "Store du journal (résolu via `auditStoreRegistry`). `auto` = suit l'infra database déclarée, repli memory (défaut) ; `memory` = per-pod, volatile, borné ; `drizzle` = persistant + partagé multi-pod (auto-register par l'adapter). Vocabulaire unifié : données = `store`.",
      ),
    immutable: z
      .boolean()
      .default(true)
      .meta({
        reserved: true,
        description:
          "INERTE — l'immuabilité du journal vient du contrat `IAuditStore` " +
          "(aucune méthode `update`/`delete`), pas de ce drapeau. Le passer à " +
          "`false` n'ouvre aucune mutation.",
      }),
    stream: z
      .boolean()
      .default(true)
      .meta({
        reserved: true,
        description:
          "INERTE — la diffusion realtime dépend de la présence d'abonnés WS " +
          "(canal `nodefony:audit`), pas de ce drapeau. Le journal est diffusé " +
          "dès qu'un client s'abonne.",
      }),
    retentionDays: z.number().int().default(365),
  })
  .describe("Journal d'audit sécurité (login, accès refusé, clés, webhooks).");

const studioSchema = z
  .object({
    enabled: z
      .boolean()
      .default(false)
      .describe("Console admin Studio. OFF par défaut (surtout en prod)."),
    exposure: z
      .enum(["localhost", "private", "public"])
      .default("localhost")
      .describe("Portée réseau autorisée."),
    allowedIps: z
      .array(z.string())
      .default([])
      .describe("Whitelist CIDR (deny par défaut si exposure=public)."),
    requireMfa: z
      .boolean()
      .default(false)
      .describe(
        "MFA obligatoire pour l'accès admin. Défaut false : l'enforcement MFA n'est PAS encore câblé (à venir, P6) — un défaut true mentirait (Studio l'afficherait « requis » sans aucun effet). La déclaration des authenticators de la zone admin vit dans l'aire data plane (portée par le framework), pas ici : studioSchema ne durcit que l'EXPOSITION réseau.",
      ),
    auditAllActions: z
      .boolean()
      .default(true)
      .meta({
        reserved: true,
        description:
          "INERTE — l'audit des mutations admin est posé point par point par " +
          "`SecurityAdminApi` (certaines mutations émettent, pas toutes) ; ce " +
          "drapeau ne pilote aucune couverture globale.",
      }),
  })
  .describe(
    "Sécurité de la console Studio — durcissement exposition publique.",
  );

// Configuration d'UN fournisseur OAuth/OIDC (Google, GitHub, Microsoft...). Les
// secrets (clientId/clientSecret) sont fournis par l'app depuis son `env.ts` —
// JAMAIS loggés (le service ne journalise que les NOMS de fournisseurs).
const oauthProviderSchema = z
  .object({
    clientId: z
      .string()
      .min(1)
      .describe("Identifiant client OAuth délivré par le fournisseur."),
    clientSecret: z
      .string()
      .min(1)
      .describe("Secret client OAuth — SECRET, fourni par env, jamais loggé."),
    redirectUri: z
      .string()
      .min(1)
      .describe(
        "URL de callback EXACTE (RFC 9700 : exact string matching) enregistrée chez le fournisseur — doit pointer sur .../oauth2/<provider>/callback.",
      ),
    issuer: z
      .string()
      .optional()
      .describe(
        "Émetteur OIDC self-hosted (Keycloak : URL du realm, ex. https://kc.example/realms/app). REQUIS pour keycloak ; ignoré par les fournisseurs à endpoints fixes (Google/GitHub).",
      ),
    scopes: z
      .array(z.string())
      .default([])
      .describe(
        "Scopes demandés. Vide = défauts du fournisseur (Google: openid/profile/email ; GitHub: read:user/user:email).",
      ),
    // Surcharges PAR FOURNISSEUR (absent = valeur globale oauth2.*). Permet à
    // plusieurs fournisseurs de coexister sans se marcher dessus : un provider de
    // TEST garde son redirect/roles, un provider réel pointe vers la console admin.
    successRedirect: z
      .string()
      .optional()
      .describe(
        "Redirection succès — surcharge le global pour CE fournisseur.",
      ),
    failureRedirect: z
      .string()
      .optional()
      .describe("Redirection échec — surcharge le global pour CE fournisseur."),
    defaultRoles: z
      .array(z.string())
      .optional()
      .describe(
        "Rôles du Shadow User à la création — surcharge le global pour CE fournisseur.",
      ),
  })
  .describe("Fournisseur OAuth/OIDC (secrets via env).");

// Social login OAuth 2.0 (arctic). Authorization Code + PKCE (S256, RFC 7636,
// quand le fournisseur le supporte) + state anti-CSRF + iss anti-mix-up (RFC 9207).
// Le login social produit une SESSION BFF (pas de token exposé au navigateur).
const oauth2Schema = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .describe(
        "Active le social login (les routes ne montent que si ≥1 provider).",
      ),
    defaultRoles: z
      .array(z.string())
      .default(["ROLE_USER"])
      .describe(
        "Rôles du Shadow User à la CRÉATION uniquement (OAuth = authentification, pas autorisation : les rôles ne sont jamais réécrits ensuite, la base fait foi).",
      ),
    allowSignup: z
      .boolean()
      .default(true)
      .describe(
        "true = crée une ligne locale au 1er login (JIT, Shadow User). false = un compte préexistant lié est requis (fail-closed).",
      ),
    successRedirect: z
      .string()
      .default("/")
      .describe("Redirection après login réussi."),
    failureRedirect: z
      .string()
      .default("/login")
      .describe(
        "Redirection après échec (state invalide, refus utilisateur...).",
      ),
    providers: z
      .record(z.string(), oauthProviderSchema)
      .default({})
      .describe(
        "Fournisseurs activés par nom (doit correspondre au registre : builtins google/keycloak/github ; +50 via arctic en enregistrant une fabrique).",
      ),
  })
  .describe(
    "Social login OAuth 2.0 (arctic) — Authorization Code + PKCE, session BFF.",
  );

/**
 * Règle d'autorisation d'un **namespace de canaux WebSocket** (subscribe/inbound)
 * par préfixe. Contraintes cumulatives ; un champ absent = pas de contrainte sur
 * cet axe. Étend OU surcharge les défauts système (placée AVANT eux à l'évaluation).
 */
const realtimeChannelRuleSchema = z
  .object({
    pattern: z
      .string()
      .describe(
        "Préfixe de canal (match `startsWith`) : ex. 'orm:' couvre nodefony:orm:health/nodefony:orm:flow. Placé AVANT les défauts système → permet de surcharger (assouplir/durcir) un namespace réservé.",
      ),
    authenticated: z
      .boolean()
      .optional()
      .describe("Exige une connexion authentifiée (token non anonyme)."),
    roles: z
      .array(z.string())
      .optional()
      .describe("Un de ces rôles suffit (évalué AVEC la hiérarchie de rôles)."),
    scopes: z
      .array(z.string())
      .optional()
      .describe(
        "Un de ces scopes suffit (axe API : JWT/clé API ; une session BFF n'en porte pas).",
      ),
  })
  .describe("Politique d'autorisation d'un namespace de canaux WS.");

export const securityConfigSchema = z.object({
  // Défaut NON VIDE : un encodeur `default` argon2id (OWASP/RFC 9106). Le pont
  // config.encoders (firewall.#provisionSharedServices) pose `passwordEncoder` au
  // container UNIQUEMENT à partir de ces specs — un défaut `{}` laissait l'auth
  // MORTE dès qu'une app ne configurait pas d'encodeur (régression : les encoders
  // du banc vivaient dans le module `test` dev-only → absents en production/cluster,
  // provisionUsers throw au boot). Une app ajoute ses entrées (legacy bcrypt pour la
  // migration au login…) ; le premier reste le principal.
  encoders: z
    .record(z.string(), encoderSchema)
    .default(() => ({ default: encoderSchema.parse({ type: "argon2id" }) }))
    .describe(
      "Chaîne d'encodeurs de mot de passe. 1re entrée = principal (hash à la création), suivantes = legacy en lecture seule (migration au login). Défaut : un argon2id sûr — le firewall en dérive le service `passwordEncoder`.",
    ),
  roleHierarchy: z
    .record(z.string(), z.array(z.string()))
    .default({})
    .describe("Hiérarchie de rôles (ROLE_ADMIN: ['ROLE_USER'])."),
  areas: z
    .record(z.string(), areaSchema)
    .default({})
    .describe("Zones sécurisées (firewall) par nom."),
  realtimeChannels: z
    .array(realtimeChannelRuleSchema)
    .default([])
    .describe(
      "Politiques d'autorisation par préfixe sur le temps réel. Couvre les canaux WS (subscribe/inbound) **ET les actions RPC** : le nom de méthode d'une frame entrante est soumis aux mêmes règles de préfixe — une règle `admin:` garde donc aussi l'action `admin:purge`. Étend/surcharge les défauts système (syslog:/orm:/node:/dashboard:/debugbar:/realtime:/cluster: + :health/:stats = ROLE_ADMIN). Ce qui n'est couvert par aucune règle reste libre, sauf gating `@RealtimeChannel` côté controller.",
    ),
  // Section omise → défauts internes appliqués (parse d'un objet vide).
  cors: corsSchema.default(() => corsSchema.parse({})),
  csrf: csrfSchema.default(() => csrfSchema.parse({})),
  headers: headersSchema.default(() => headersSchema.parse({})),
  rateLimit: rateLimitSchema.default(() => rateLimitSchema.parse({})),
  jwt: jwtSchema.default(() => jwtSchema.parse({})),
  tokenStore: tokenStoreSchema.default(() => tokenStoreSchema.parse({})),
  passkeys: passkeysSchema.default(() => passkeysSchema.parse({})),
  totp: totpSchema.default(() => totpSchema.parse({})),
  tokenExchange: tokenExchangeSchema
    .default(() => tokenExchangeSchema.parse({}))
    .meta({
      reserved: true,
      description:
        "RÉSERVÉ — Token Exchange RFC 8693 (délégation agents/MCP). Slot P12, aucun champ encore lu par le runtime.",
    }),
  oauth2: oauth2Schema.default(() => oauth2Schema.parse({})),
  apiKeys: apiKeysSchema.default(() => apiKeysSchema.parse({})),
  webhooks: webhooksSchema.default(() => webhooksSchema.parse({})),
  audit: auditSchema.default(() => auditSchema.parse({})),
  studio: studioSchema
    .default(() => studioSchema.parse({}))
    .meta({
      reserved: true,
      description:
        "RÉSERVÉ — durcissement de l'exposition réseau de la console Studio. Section entière non câblée (l'enforcement viendra avec Studio, P14) : aucun champ n'est lu par le runtime aujourd'hui.",
    }),
});

/** Entrée du builder (champs avec défaut optionnels). */
export type ISecurityConfigInput = z.input<typeof securityConfigSchema>;
/** Config normalisée et gelée (sortie du builder, lue par le firewall). */
export type ISecurityConfig = z.output<typeof securityConfigSchema>;
/** Config d'une zone normalisée. */
export type ISecurityAreaConfig = z.output<typeof areaSchema>;

/**
 * Défauts du module, matérialisés depuis le schéma (source unique — tous les
 * `.default()` : Zero Trust, CORS strict, Studio OFF). Toujours valides par
 * construction ; passés au `super(..., config)` du Module class.
 */
const config: ISecurityConfig = securityConfigSchema.parse({});

export default config;
