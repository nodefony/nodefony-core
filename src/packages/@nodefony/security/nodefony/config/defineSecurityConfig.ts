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
  type: z.enum(["bcrypt"]).describe("Algorithme de hash du mot de passe."),
  rounds: z
    .number()
    .int()
    .min(10)
    .max(15)
    .default(12)
    .describe("Coût bcrypt (10–15)."),
});

const areaSchema = z.object({
  pattern: z.string().describe("Pattern d'URL (RegExp) capturé par la zone."),
  security: z
    .boolean()
    .default(true)
    .describe("Zone protégée (Zero Trust). false = publique explicite."),
  stateless: z
    .boolean()
    .default(true)
    .describe("HTTP stateless (JWT cookie) — défaut 2026."),
  authenticators: z
    .array(z.string())
    .default([])
    .describe(
      "Authenticators à exécuter (chaîne, tous doivent passer). Validés au boot contre le registre.",
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
      .describe("Défense CSRF par défaut (SameSite + Origin)."),
    sameSite: z.enum(["Strict", "Lax", "None"]).default("Strict"),
    checkOrigin: z
      .boolean()
      .default(true)
      .describe("Vérifie Origin/Referer sur les méthodes mutantes."),
  })
  .describe(
    "Cross-Site Request Forgery — OWASP 2024 (token classique abandonné).",
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

const rateLimitSchema = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .describe("Rate limiting + anti brute-force."),
    loginPoints: z
      .number()
      .int()
      .default(5)
      .describe("Tentatives login avant throttle."),
    loginDurationS: z.number().int().default(60),
    lockoutThreshold: z
      .number()
      .int()
      .default(10)
      .describe("Échecs avant verrouillage du compte."),
  })
  .describe("Limitation de débit / lockout.");

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
  })
  .describe("JWT stateless (cookie HttpOnly;Secure;SameSite=Strict).");

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
