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
  .describe("Cross-Origin Resource Sharing.");

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
      .describe("Strict-Transport-Security (force HTTPS)."),
    hstsMaxAgeS: z
      .number()
      .int()
      .default(31536000)
      .describe("Durée HSTS (s). Défaut: 1 an, includeSubDomains."),
    csp: z
      .string()
      .default("default-src 'self'")
      .describe("Content-Security-Policy."),
    cspNonces: z
      .boolean()
      .default(true)
      .describe("Nonce CSP par requête (bloque l'inline non signé)."),
    frameguard: z
      .enum(["deny", "sameorigin"])
      .default("deny")
      .describe("X-Frame-Options (anti-clickjacking)."),
    noSniff: z
      .boolean()
      .default(true)
      .describe("X-Content-Type-Options: nosniff."),
    referrerPolicy: z
      .string()
      .default("no-referrer")
      .describe("Referrer-Policy."),
    hidePoweredBy: z
      .boolean()
      .default(true)
      .describe("Retire X-Powered-By (anti-fingerprinting)."),
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
        "Audiences acceptées (claim `aud`, RFC 8707). Vide = l'audience de l'app. La validation d'audience est OBLIGATOIRE côté resource (RFC 9700).",
      ),
  })
  .describe(
    "JWT — réservé API service↔service / agents (le web/navigateur utilise la session BFF).",
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
    origins: z
      .array(z.string())
      .default([])
      .describe("Origines autorisées aux ceremonies. Vide = origine de l'app."),
    userVerification: z
      .enum(["required", "preferred", "discouraged"])
      .default("preferred")
      .describe(
        "Vérification utilisateur (biométrie/PIN) exigée par l'authenticator.",
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
      .default(true)
      .describe("MFA obligatoire pour l'accès admin."),
    authenticators: z
      .array(z.string())
      .default(["jwt"])
      .describe("Auth de la zone admin (mtls+jwt recommandé si public)."),
    auditAllActions: z
      .boolean()
      .default(true)
      .describe("Audit de CHAQUE action mutante de la console."),
  })
  .describe(
    "Sécurité de la console Studio — durcissement exposition publique.",
  );

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
  // Section omise → défauts internes appliqués (parse d'un objet vide).
  cors: corsSchema.default(() => corsSchema.parse({})),
  csrf: csrfSchema.default(() => csrfSchema.parse({})),
  headers: headersSchema.default(() => headersSchema.parse({})),
  rateLimit: rateLimitSchema.default(() => rateLimitSchema.parse({})),
  jwt: jwtSchema.default(() => jwtSchema.parse({})),
  passkeys: passkeysSchema.default(() => passkeysSchema.parse({})),
  tokenExchange: tokenExchangeSchema.default(() =>
    tokenExchangeSchema.parse({}),
  ),
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
