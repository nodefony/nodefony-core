import { z } from "zod";

/**
 * Builder type-safe de la configuration de sécurité Nodefony.
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
 * Validé + gelé au boot ; conflits de patterns de zones détectés au boot.
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
      .describe(
        "Strict-Transport-Security (force HTTPS). ⚙️ TRANSPORT : posé par @nodefony/http à l'entrée brute (couvre statics + erreurs + serveur nu) — security ne le ré-émet pas (1 source/en-tête).",
      ),
    hstsMaxAgeS: z
      .number()
      .int()
      .default(31536000)
      .describe(
        "Durée HSTS (s). Défaut: 1 an, includeSubDomains. ⚙️ TRANSPORT (http).",
      ),
    csp: z
      .string()
      .default(
        // ⚠️ DOIT rester identique au défaut de `config/config.ts` (réf humaine) —
        // divergence = CSP runtime ≠ Zod (vécu : un seul des deux mis à jour).
        "default-src 'self'; script-src 'self' 'nonce-{{nonce}}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'",
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
      .describe(
        "X-Frame-Options (anti-clickjacking). ⚙️ TRANSPORT : posé par @nodefony/http (couvre statics + erreurs) — security ne le ré-émet pas.",
      ),
    noSniff: z
      .boolean()
      .default(true)
      .describe(
        "X-Content-Type-Options: nosniff. ⚙️ TRANSPORT : posé par @nodefony/http (couvre statics + erreurs) — security ne le ré-émet pas.",
      ),
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
      .describe(
        "Retire X-Powered-By (anti-fingerprinting). No-op sous Nodefony : aucun X-Powered-By n'est émis (≠ Express) ; le `Server` est géré par @nodefony/http.",
      ),
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
    driver: z
      .string()
      .default("memory")
      .describe(
        "Store de jetons (refresh/PAT/denylist) : memory|file|drizzle|mongoose|redis. Pluggable (`registerTokenStore`). Memory = dev/tests (volatile, non partagé).",
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
        "Credential découvrable (passkey usernameless : login sans saisir l'identifiant). Défaut: preferred.",
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
        "Conveyance d'attestation. Défaut 'none' (passkeys grand public, pas de vérif chaîne de certs fabricant — vie privée). 'direct'/'enterprise' = AAL3 régulé (vérif AAGUID/MDS requise).",
      ),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .default(60_000)
      .describe(
        "Délai (ms) laissé à l'utilisateur pour compléter une ceremony (navigator.credentials.*). Défaut: 60000.",
      ),
    challengeTtlS: z
      .number()
      .int()
      .positive()
      .default(300)
      .describe(
        "Durée de vie (s) du challenge serveur (anti-replay, lié à la session). Défaut: 300 (5 min).",
      ),
    store: z
      .string()
      .default("memory")
      .describe(
        "Backend de stockage des credentials : memory|file|drizzle|mongoose|redis. Pluggable (`registerWebAuthnStore`). 'memory' = volatile, perdu au redémarrage [défaut] ; 'file' = persiste sur disque (mono-process : dev / petit déploiement) ; drizzle/mongoose/redis = cluster/prod (l'app câble l'adapter de son module backend).",
      ),
    storePath: z
      .string()
      .optional()
      .describe(
        "Chemin du fichier JSON (driver 'file'). Omis = <cwd>/var/webauthn-credentials.json.",
      ),
  })
  .describe("Passkeys (WebAuthn L3 / FIDO2) — synced par défaut.");

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
      .default("nf")
      .describe("Préfixe des clés : nf_<prefix>_<secret>."),
    defaultExpiryDays: z
      .number()
      .int()
      .nullable()
      .default(90)
      .describe("Expiration par défaut (null = jamais)."),
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
      .describe("HMAC sortant (X-Nodefony-Signature-256)."),
    timestampToleranceS: z
      .number()
      .int()
      .default(300)
      .describe("Fenêtre anti-replay (style Stripe)."),
    denyPrivateIps: z
      .boolean()
      .default(true)
      .describe("Bloque SSRF (IP privées / métadonnées cloud)."),
    maxRetries: z.number().int().default(5),
  })
  .describe("Webhooks sortants signés.");

const auditSchema = z
  .object({
    enabled: z.boolean().default(true),
    immutable: z
      .boolean()
      .default(true)
      .describe("Journal append-only (tamper-evident)."),
    stream: z
      .boolean()
      .default(true)
      .describe("Diffusion realtime WS vers Studio."),
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
      .describe("Audit de CHAQUE action mutante de la console."),
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
        "Préfixe de canal (match `startsWith`) : ex. 'orm:' couvre orm:health/orm:flow. Placé AVANT les défauts système → permet de surcharger (assouplir/durcir) un namespace réservé.",
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

const securityConfigSchema = z.object({
  encoders: z.record(z.string(), encoderSchema).default({}),
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
      "Politiques d'autorisation des canaux WS (subscribe/inbound) par préfixe. Étend/surcharge les défauts système (syslog:/orm:/node:/dashboard:/debugbar:/realtime:/cluster: + :health/:stats = ROLE_ADMIN). Les canaux applicatifs non listés restent libres, sauf gating @RealtimeChannel côté controller.",
    ),
  // Section omise → défauts internes appliqués (parse d'un objet vide).
  cors: corsSchema.default(() => corsSchema.parse({})),
  csrf: csrfSchema.default(() => csrfSchema.parse({})),
  headers: headersSchema.default(() => headersSchema.parse({})),
  rateLimit: rateLimitSchema.default(() => rateLimitSchema.parse({})),
  jwt: jwtSchema.default(() => jwtSchema.parse({})),
  tokenStore: tokenStoreSchema.default(() => tokenStoreSchema.parse({})),
  passkeys: passkeysSchema.default(() => passkeysSchema.parse({})),
  tokenExchange: tokenExchangeSchema.default(() =>
    tokenExchangeSchema.parse({}),
  ),
  oauth2: oauth2Schema.default(() => oauth2Schema.parse({})),
  apiKeys: apiKeysSchema.default(() => apiKeysSchema.parse({})),
  webhooks: webhooksSchema.default(() => webhooksSchema.parse({})),
  audit: auditSchema.default(() => auditSchema.parse({})),
  studio: studioSchema.default(() => studioSchema.parse({})),
});

/** Entrée du builder (champs avec défaut optionnels). */
export type ISecurityConfigInput = z.input<typeof securityConfigSchema>;
/** Config normalisée et gelée (sortie du builder, lue par le firewall). */
export type ISecurityConfig = z.output<typeof securityConfigSchema>;
/** Config d'une zone normalisée. */
export type ISecurityAreaConfig = z.output<typeof areaSchema>;

/**
 * Valide + normalise + gèle la configuration de sécurité.
 *
 * @param config - configuration brute de l'app (sections omises = défauts sûrs).
 * @returns config gelée prête pour le firewall.
 * @throws ZodError si invalide ; Error si deux zones partagent un pattern.
 */
export function defineSecurityConfig(
  config: ISecurityConfigInput = {},
): ISecurityConfig {
  const validated = securityConfigSchema.parse(config);
  detectConflicts(validated.areas);
  return Object.freeze(validated);
}

/**
 * JSON Schema introspectable de la config sécurité — **Studio génère son
 * formulaire d'édition depuis ça** (labels/types/défauts/descriptions),
 * sans UI hardcodée. Surface du data plane `/nodefony/security/api/config/schema`.
 */
export function securityConfigJsonSchema(): unknown {
  return z.toJSONSchema(securityConfigSchema);
}

/** Refuse deux zones avec le même pattern (ambiguïté de match, détectée au boot). */
function detectConflicts(areas: Record<string, { pattern: string }>): void {
  const seen = new Map<string, string>();
  for (const [name, area] of Object.entries(areas)) {
    const prev = seen.get(area.pattern);
    if (prev) {
      throw new Error(
        `defineSecurityConfig: zones "${prev}" et "${name}" partagent le pattern "${area.pattern}".`,
      );
    }
    seen.set(area.pattern, name);
  }
}
