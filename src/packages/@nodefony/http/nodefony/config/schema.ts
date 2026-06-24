import { z } from "zod";
import { meta } from "./configMeta";

/**
 * Schéma Zod de la configuration de `@nodefony/http`.
 *
 * Source de vérité du module : le type TS est dérivé via `z.infer<>`, et la
 * config est validée au boot du Module class (hook `onKernelRegister`, via le
 * builder {@link import("./defineHttpConfig").defineHttpConfig}) → plante propre
 * avec messages clairs si la config est invalide, plutôt qu'un `undefined.x`
 * silencieux en runtime.
 *
 * Convention figée 2026-05-28 (cf mémoire `feedback_config_validation_zod`).
 * Aligné sur `@nodefony/redis` et `@nodefony/security/defineSecurityConfig.ts`.
 *
 * ## `strict` (strip) vs `loose` (passthrough) — décision de design
 *
 * Zod, par défaut, **supprime silencieusement** les clés inconnues. Pour les
 * sections **transmises telles quelles à une lib tierce** (node:http/https/http2,
 * `ws`, `qs`, `serve-static`), un strip effacerait une option lib légitime non
 * listée ici (ex. `http: { insecureHTTPParser: true }` disparaîtrait). Ces
 * sections sont donc en **`z.looseObject`** (conservent les extras pour la lib).
 * Les sections **100 % consommées par notre code** (`securityHeaders`,
 * `trustProxy`, `certificates`, `session`, `upload`) restent en
 * **`z.object` strict** → le strip attrape les fautes de frappe.
 *
 * ## Métadonnées de champ ({@link meta})
 *
 * Certains champs portent des flags Nodefony (`reserved`, `runtimeMutable`,
 * `kernelDerived`, `secret`) via le helper {@link meta} → recopiés par
 * `z.toJSONSchema()` pour Studio / la doc / un futur reload-à-chaud.
 *
 * ## Pureté
 *
 * Ce schéma reste PUR (pas de `Nodefony.getKernel()` ni `process.env`) → sa
 * sortie est déterministe et sérialisable en JSON Schema ({@link httpConfigJsonSchema}).
 * Les défauts dérivés du kernel (`upload.uploadDir` ← `kernel.tmpDir`,
 * `certificates.openssl.attrs` ← `kernel.domain`/`projectName`) sont injectés
 * APRÈS le parse, dans le builder (kernel disponible à `onKernelRegister`).
 *
 * ⚠️ Piège Zod 4 : un `.default({})` plat NE ré-applique PAS les sous-défauts du
 * sous-schéma. Pattern obligatoire : extraire chaque sous-schéma en const +
 * `.default(() => sub.parse({}))` (le callback force la ré-évaluation).
 */

// ───────────────────────── securityHeaders (strict) ─────────────────────────

const strictTransportSecuritySchema = z
  .object({
    maxAge: z
      .number()
      .int()
      .nonnegative()
      .default(31_536_000)
      .describe(
        "Durée (s) pendant laquelle le navigateur force HTTPS. Défaut 1 an " +
          "(recommandation OWASP). Posé uniquement sur réponses HTTPS/HTTP2.",
      ),
    includeSubDomains: z
      .boolean()
      .default(true)
      .describe("Étend le HSTS à tous les sous-domaines. Défaut true (OWASP)."),
    preload: z
      .boolean()
      .default(false)
      .describe(
        "Inscrit le domaine à la HSTS preload list — ENGAGEMENT IRRÉVERSIBLE. " +
          "Ne pas activer sans avoir lu https://hstspreload.org/#removal.",
      ),
  })
  .describe(
    "HSTS (RFC 6797). Mettre la section à `null` pour ne pas émettre le header.",
  );

const securityHeadersSchema = z
  .object({
    contentTypeOptions: z
      .string()
      .nullable()
      .default("nosniff")
      .describe(
        "X-Content-Type-Options — bloque le MIME-sniffing. Valeur RFC " +
          "`nosniff` (seule reconnue). `null` = header désactivé.",
      ),
    frameOptions: z
      .string()
      .nullable()
      .default("DENY")
      .describe(
        "X-Frame-Options — anti-clickjacking. `DENY` (recommandé) | " +
          "`SAMEORIGIN`. Superposé par CSP `frame-ancestors`. `null` = désactivé.",
      ),
    strictTransportSecurity: strictTransportSecuritySchema
      .nullable()
      .default(() => strictTransportSecuritySchema.parse({}))
      .describe("HSTS — voir sous-schéma. `null` = header désactivé."),
  })
  .describe(
    "En-têtes de sécurité HTTP — defaults OWASP secure-by-default, posés en " +
      "amont du pipeline (couvre aussi les statics).",
  );

// ───────────────────────── upload (strict — mapping busboy) ──────────────────

const uploadSchema = z
  .object({
    uploadDir: meta(z.string().default(""), {
      kernelDerived: true,
      description:
        "Répertoire de dépôt des fichiers uploadés. Vide (défaut) = résolu sur " +
        "`kernel.tmpDir` par le builder. Chemin relatif = relatif à la racine projet.",
    }),
    maxFileSize: z
      .number()
      .int()
      .positive()
      .default(524_288_000)
      .describe(
        "Taille max d'UN fichier (busboy `limits.fileSize`, octets). 500 MB. " +
          "Dépassement → 413. Réduire en production.",
      ),
    maxTotalFileSize: z
      .number()
      .int()
      .positive()
      .default(524_288_000)
      .describe(
        "Taille CUMULÉE max de tous les fichiers d'une requête (octets, compteur " +
          "Nodefony — busboy n'a pas de cumul natif). Anti-saturation disque. → 413.",
      ),
    maxFiles: z
      .number()
      .int()
      .nonnegative()
      .default(1000)
      .describe(
        "Nombre max de fichiers par requête (busboy `limits.files`) — anti-DoS.",
      ),
    maxFields: z
      .number()
      .int()
      .nonnegative()
      .default(1000)
      .describe(
        "Nombre max de champs texte (busboy `limits.fields`) — anti-abus.",
      ),
    maxFieldsSize: z
      .number()
      .int()
      .positive()
      .default(2_097_152)
      .describe(
        "Taille max d'UN champ texte (busboy `limits.fieldSize`, octets). 2 MB.",
      ),
    hashAlgorithm: z
      .union([z.literal(false), z.enum(["sha256", "sha1", "md5"])])
      .default(false)
      .describe(
        "Hash calculé pendant le stream du fichier (intégrité). `false` (défaut, " +
          "0 coût CPU) | `sha256` | `sha1` | `md5`.",
      ),
    encoding: z
      .string()
      .default("utf-8")
      .describe("Encodage par défaut des champs texte (busboy `defCharset`)."),
  })
  .describe(
    "Sous-système d'upload busboy (streaming pur — fichiers écrits au fil de " +
      "l'eau, jamais bufferisés en RAM).",
  );

// ───────────────────────── queryString (loose → qs) ─────────────────────────

const queryStringSchema = z
  .looseObject({
    parameterLimit: z
      .number()
      .int()
      .positive()
      .default(1000)
      .describe("Nombre max de paramètres acceptés (qs `parameterLimit`)."),
    delimiter: z
      .string()
      .default("&")
      .describe("Séparateur de paramètres. `&` = standard HTTP."),
    ignoreQueryPrefix: z
      .boolean()
      .default(true)
      .describe(
        "Ignore le `?` initial avant parsing (qs `ignoreQueryPrefix`).",
      ),
  })
  .describe(
    "Parseur de query string `qs`. Loose : toute option `qs` supplémentaire " +
      "(depth, arrayLimit, allowDots…) est transmise telle quelle.",
  );

// ───────────────────────── serveurs http / https (loose) ────────────────────

const httpServerSchema = z
  .looseObject({
    maxHeadersCount: z
      .number()
      .int()
      .nonnegative()
      .default(2000)
      .describe("Nombre max d'en-têtes par requête — anti header flooding."),
    keepAliveTimeout: z
      .number()
      .int()
      .nonnegative()
      .default(5000)
      .describe(
        "Délai keep-alive (ms) entre deux requêtes sur la même socket TCP.",
      ),
    timeout: z
      .number()
      .int()
      .nonnegative()
      .default(120_000)
      .describe("Timeout global de la socket (ms). 0 = désactivé."),
    requestTimeout: z
      .number()
      .int()
      .nonnegative()
      .default(30_000)
      .describe(
        "Timeout de réception requête complète (ms) — anti slow-loris.",
      ),
    responseTimeout: z
      .number()
      .int()
      .nonnegative()
      .default(30_000)
      .describe("Timeout d'envoi de la réponse complète (ms)."),
    headers: z
      .record(z.string(), z.string())
      .nullable()
      .default(null)
      .describe("En-têtes ajoutés à toutes les réponses. `null` = aucun."),
  })
  .describe(
    "Serveur HTTP (node:http, port 5151). Loose : toute option `net.Server`/" +
      "`http.Server` supplémentaire (insecureHTTPParser, maxRequestsPerSocket…) " +
      "est transmise.",
  );

const httpsServerSchema = httpServerSchema
  .extend({
    rejectUnauthorized: z
      .boolean()
      .default(false)
      .describe(
        "Rejette les certificats TLS non valides (auto-signés inclus). false en " +
          "dev (certs auto-signés), TOUJOURS true en production.",
      ),
  })
  .describe(
    "Serveur HTTPS (node:https + HTTP/2, port 5152). Loose : options TLS " +
      "(ciphers, minVersion…) transmises.",
  );

// ───────────────────────── http2 / http3 (loose) ────────────────────────────

const http2Schema = z
  .looseObject({
    maxConcurrentStreams: z
      .number()
      .int()
      .positive()
      .default(100)
      .describe(
        "Flux concurrents max par session HTTP/2 — défense CVE-2023-44487 " +
          "(Rapid Reset). Envoyé dans les SETTINGS.",
      ),
    maxSessionMemory: z
      .number()
      .int()
      .positive()
      .default(10)
      .describe(
        "Mémoire max (Mo) par session HTTP/2 — borne l'amplification mémoire.",
      ),
  })
  .describe(
    "Serveur HTTP/2 (sur le port HTTPS, allowHTTP1). Loose : options " +
      "`http2.SecureServerOptions` transmises.",
  );

const http3Schema = z.looseObject({});

// ───────────────────────── certificates (strict) ────────────────────────────

const opensslAttrSchema = z
  .looseObject({
    name: z.string().optional(),
    value: z.string().optional(),
    shortName: z.string().optional(),
  })
  .describe("Champ de sujet/issuer node-forge (CertificateField).");

const opensslSchema = z
  .object({
    size: z
      .number()
      .int()
      .positive()
      .default(2048)
      .describe(
        "Taille de la clé RSA (bits). 2048 minimum, 4096 recommandé en prod.",
      ),
    hash: z
      .enum(["sha256", "sha384", "sha512"])
      .default("sha256")
      .describe(
        "Algorithme de hachage de la signature. SHA-1 INTERDIT (collision " +
          "SHAttered 2017 ; CA/Browser Forum depuis 2016).",
      ),
    validityDays: z
      .number()
      .int()
      .positive()
      .default(365)
      .describe(
        "Durée de validité du certificat (jours). ≤ 398 recommandé (CA/B Forum).",
      ),
    backdateMinutes: z
      .number()
      .int()
      .min(0)
      .default(5)
      .describe(
        "Recul de notBefore (minutes) — tolère le décalage d'horloge du client " +
          "(évite « certificate not yet valid »).",
      ),
    attrs: meta(z.array(opensslAttrSchema).default([]), {
      kernelDerived: true,
      description:
        "Attributs du certificat (commonName, organizationName…). Vide (défaut) " +
        "= dérivés du kernel par le builder (commonName ← domain).",
    }),
  })
  .describe("Options de génération du certificat auto-signé (node-forge).");

const sanSchema = z
  .object({
    dns: meta(z.array(z.string()).default([]), {
      kernelDerived: true,
      description:
        "Noms DNS du Subject Alternative Name (RFC 5280 §4.2.1.6). Vide = " +
        "dérivé du kernel (localhost + domain).",
    }),
    ip: z
      .array(z.string())
      .default([])
      .describe("Adresses IP du SAN. Vide = dérivé (127.0.0.1, ::1)."),
  })
  .describe(
    "Subject Alternative Name explicite. Vide = dérivé (localhost + domaine " +
      "kernel). Chrome ignore le commonName depuis RFC 2818 → le SAN fait foi.",
  );

const certDevSchema = z
  .object({
    useMkcert: z
      .boolean()
      .default(true)
      .describe(
        "Préférer mkcert (CA locale trustée) en dev → HTTPS sans erreur " +
          "navigateur (HMR/WSS). false = forcer le fallback auto-signé. Ignoré hors dev.",
      ),
  })
  .describe("Options de génération du certificat en développement.");

const certificatesSchema = z
  .object({
    strategy: z
      .enum(["auto", "mkcert", "selfsigned", "explicit"])
      .default("auto")
      .describe(
        "Stratégie de fourniture du certificat. `auto` (défaut) = mkcert si " +
          "dispo en dev, sinon auto-signé. `explicit` = `key`/`cert` fournis " +
          "(PROD : Let's Encrypt, ingress…). `mkcert`/`selfsigned` = forcer. " +
          "La génération est un confort de DÉVELOPPEMENT — en prod, fournir un " +
          "vrai certificat (Nodefony n'est pas une autorité de certification).",
      ),
    ca: z
      .string()
      .default("")
      .describe("Chemin du CA bundle. Vide = auto-signé."),
    key: z
      .string()
      .default("")
      .describe("Chemin de la clé privée TLS. Vide = générée."),
    cert: z
      .string()
      .default("")
      .describe("Chemin du certificat TLS. Vide = généré."),
    privateKeyMode: meta(z.number().int().default(0o600), {
      description:
        "Permissions POSIX de la clé privée écrite sur disque (0600 = " +
        "lecture/écriture owner uniquement). Une clé TLS ne doit JAMAIS être " +
        "world-readable.",
    }),
    san: sanSchema.default(() => sanSchema.parse({})),
    dev: certDevSchema.default(() => certDevSchema.parse({})),
    openssl: opensslSchema.default(() => opensslSchema.parse({})),
  })
  .describe("Certificats TLS du serveur HTTPS et WSS.");

// ───────────────────────── websocket / websocketSecure (loose → ws) ──────────

const websocketSchema = z
  .looseObject({
    keepaliveInterval: z
      .number()
      .int()
      .positive()
      .default(20_000)
      .describe(
        "Intervalle (ms) des pings keep-alive — détecte les connexions zombies.",
      ),
    keepaliveGracePeriod: z
      .number()
      .int()
      .positive()
      .default(10_000)
      .describe(
        "Délai de grâce (ms) après un ping sans réponse avant fermeture.",
      ),
    closeTimeout: z
      .number()
      .int()
      .positive()
      .default(5000)
      .describe(
        "Timeout (ms) de fermeture propre avant destruction de la socket.",
      ),
    maxPayload: z
      .number()
      .int()
      .positive()
      .default(1024 * 1024)
      .describe(
        "Taille max (octets) d'un message WS entrant. Au-delà → close RFC 6455 " +
          "1009 « Message Too Big ». Défaut 1 MiB (secure-by-default anti DoS mémoire).",
      ),
    allowedOrigins: z
      .union([z.boolean(), z.string(), z.array(z.string())])
      .default(false)
      .describe(
        "Allowlist d'`Origin` acceptées au handshake WS (anti-CSWSH, OWASP " +
          "WSTG-CLNT-10 — les navigateurs n'appliquent PAS CORS aux WebSockets). " +
          "`false` (DÉFAUT) = same-origin : l'`Origin` doit correspondre au `Host` " +
          "(+ loopback toléré en development pour le dev cross-port). `true` = " +
          "désactive le contrôle (Origin filtré en amont). string/liste = Origins " +
          "cross-origin additionnelles : hostname exact (`app.example.com`) ou " +
          "wildcard un-label (`*.example.com`). Une requête SANS `Origin` (client " +
          "non-navigateur) est toujours acceptée.",
      ),
    // ── Options natives `ws@8` (ServerOptions) — câblées dans new WebSocketServer ──
    // Défauts alignés sur ceux de `ws@8.21` (sauf maxPayload, durci ci-dessus à 1 MiB).
    perMessageDeflate: z
      .union([
        z.boolean(),
        z.looseObject({
          serverNoContextTakeover: z
            .boolean()
            .optional()
            .describe(
              "Le serveur ne conserve PAS le contexte de compression entre messages " +
                "(moins de RAM par connexion, ratio de compression plus faible).",
            ),
          clientNoContextTakeover: z
            .boolean()
            .optional()
            .describe("Idem côté client (négocié dans le handshake)."),
          serverMaxWindowBits: z
            .number()
            .int()
            .min(8)
            .max(15)
            .optional()
            .describe(
              "Taille de la fenêtre LZ77 côté serveur (8-15) ; plus bas = moins de RAM.",
            ),
          clientMaxWindowBits: z
            .number()
            .int()
            .min(8)
            .max(15)
            .optional()
            .describe("Taille de la fenêtre LZ77 côté client (8-15)."),
          threshold: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .describe(
              "Taille min (octets) d'un message pour être compressé. Défaut `ws` 1024.",
            ),
          concurrencyLimit: z
            .number()
            .int()
            .positive()
            .optional()
            .describe(
              "Nombre max d'opérations zlib concurrentes (back-pressure CPU). Défaut `ws` 10.",
            ),
        }),
      ])
      .default(false)
      .describe(
        "Compression permessage-deflate (RFC 7692). Défaut false : la compression coûte " +
          "CPU + mémoire et expose au zip-bomb (un petit payload compressé se décompresse " +
          "en message géant). `true` = options par défaut, ou objet pour régler fenêtres / " +
          "seuil / concurrence. N'activer que si le gain réseau le justifie.",
      ),
    skipUTF8Validation: z
      .boolean()
      .default(false)
      .describe(
        "Désactive la validation UTF-8 des frames texte (RFC 6455 §8.1). Gain CPU au prix " +
          "de l'acceptation de frames texte invalides — laisser false sauf charge extrême maîtrisée.",
      ),
    autoPong: z
      .boolean()
      .default(true)
      .describe(
        "Répond automatiquement par un pong à chaque ping entrant (RFC 6455 §5.5.2-5.5.3). " +
          "Laisser true — requis par le protocole et par le heartbeat des pairs.",
      ),
    allowSynchronousEvents: z
      .boolean()
      .default(true)
      .describe(
        "Émet les events ('message', 'ping'…) de plusieurs frames lues dans un même chunk " +
          "réseau de façon synchrone (ws@8.18+). true = meilleur débit ; false = un event par " +
          "tick d'event loop (latence plus régulière, plus équitable entre connexions).",
      ),
    // ── Backpressure SORTANTE (politique Nodefony, PAS une option ws) ──
    maxBackpressure: z
      .number()
      .int()
      .nonnegative()
      .default(4 * 1024 * 1024)
      .describe(
        "Seuil (octets) du buffer d'envoi par connexion (`ws.bufferedAmount`) au-delà duquel " +
          "`backpressurePolicy` s'applique. Borne la RAM d'envoi face à un client LENT À " +
          "RECEVOIR (anti-OOM) ; broadcast() amplifie (un seul lent peut plomber la diffusion). " +
          "0 = désactivé. Défaut 4 MiB.",
      ),
    backpressurePolicy: z
      .enum(["drop", "close"])
      .default("drop")
      .describe(
        "Action quand `ws.bufferedAmount` dépasse `maxBackpressure`. 'drop' = sauter la frame " +
          "pour ce client (il reste connecté, dégradable — idéal télémétrie/broadcast, défaut). " +
          "'close' = fermer le client (RFC 6455 close 1013 « Try Again Later »). La fusion " +
          "(coalesce) relève de la couche canal realtime, pas du transport.",
      ),
  })
  .describe(
    "Serveur WebSocket (`ws@8`). Les options ci-dessus (+ loose : `verifyClient`, " +
      "`handleProtocols`, `path`, `WebSocket`…) sont transmises à `ws`. GÉRÉ par Nodefony et " +
      "donc NON exposé : `server`/`host`/`port` (attaché au serveur HTTP), `noServer` (forcé off), " +
      "`clientTracking` (forcé true — requis par broadcast() + heartbeat), `backlog` (celui du " +
      "serveur HTTP). `keepalive*`/`closeTimeout` sont des knobs Nodefony, pas des options `ws`.",
  );

// ───────────────────────── statics (loose → serve-static) ───────────────────

const staticOptionsSchema = z
  .looseObject({
    cacheControl: z
      .boolean()
      .optional()
      .describe("Active le header Cache-Control."),
    maxAge: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Durée de cache (selon l'entrée : secondes pour defaultOptions, ms côté serve-static).",
      ),
  })
  .describe(
    "Options serve-static d'une entrée statique. Loose : index, dotfiles, etag, " +
      "lastModified… transmises telles quelles.",
  );

const staticEntrySchema = z
  .looseObject({
    path: z.string().describe("Chemin relatif à la racine projet."),
    options: staticOptionsSchema.optional(),
  })
  .describe("Répertoire statique servi.");

const staticsSchema = z
  .looseObject({
    enabled: z
      .boolean()
      .default(true)
      .describe(
        "Active le serveur de fichiers statiques intégré. `false` = AUCUN " +
          "montage config-driven (`web`/`assets`…) → 0 listener, 0 résolution de " +
          "chemin au boot. À mettre en production quand un reverse-proxy/CDN " +
          "(nginx, Caddy, Varnish) sert les statiques. N.B. : ne gate PAS les " +
          "montages programmatiques addMount() (assets Vite via @nodefony/frontend).",
      ),
    defaultOptions: staticOptionsSchema
      .default(() => ({ cacheControl: true, maxAge: 96 * 60 * 60 }))
      .describe(
        "Options appliquées à TOUTES les entrées (sauf surcharge). maxAge en secondes.",
      ),
    web: staticEntrySchema
      .default(() => ({
        path: "public",
        options: { maxAge: 30 * 24 * 60 * 60 * 1000 },
      }))
      .describe("Répertoire `web` servi par défaut depuis la racine projet."),
  })
  .describe(
    "Fichiers statiques (serve-static). Loose : chaque entrée additionnelle " +
      "(`assets`, …) est transmise. Dev uniquement — préférer un reverse-proxy en prod.",
  );

// ───────────────────────── session (strict) ─────────────────────────────────

const sessionCookieSchema = z
  .object({
    maxAge: z
      .number()
      .int()
      .nonnegative()
      .default(0)
      .describe(
        "Durée de vie (s). 0 = cookie de session (fermé avec le navigateur).",
      ),
    httpOnly: z
      .boolean()
      .default(true)
      .describe("Inaccessible via JS (document.cookie) — protection XSS."),
    secure: z
      .boolean()
      .default(true)
      .describe("Envoyé uniquement via HTTPS. TOUJOURS true en production."),
    signed: z
      .boolean()
      .default(false)
      .describe("Signe le cookie avec le secret HMAC du kernel."),
    hostPrefix: z
      .union([z.boolean(), z.literal("auto")])
      .default("auto")
      .describe(
        "Préfixe `__Host-` du cookie de session (RFC 6265bis / OWASP : " +
          'anti session-fixation cross-subdomain). `"auto"` (défaut) = appliqué ' +
          "sur transport TLS (https/wss) uniquement ; `true` = toujours (l'opérateur " +
          "garantit le TLS côté client, ex. proxy terminant le TLS) ; `false` = jamais.",
      ),
  })
  .describe("Options du cookie de session.");

const sessionSchema = z
  .object({
    applyTransaction: z
      .boolean()
      .default(true)
      .describe(
        "Utilise les transactions pour le storage (handler `drizzle`).",
      ),
    use_strict_mode: z
      .boolean()
      .default(true)
      .describe(
        "Rejette les IDs de session inconnus (crée une nouvelle session).",
      ),
    name: z
      .string()
      .min(1)
      .default("nodefony")
      .describe("Nom du cookie de session."),
    handler: z
      .string()
      .min(1)
      .default("files")
      .describe(
        "Storage de session : nom d'un service DI ou handler enregistré " +
          "(`files` | `drizzle` | `mongoose`).",
      ),
    save_path: z
      .string()
      .default("./tmp/sessions")
      .describe(
        "Chemin de stockage du handler `files` (relatif à la racine projet).",
      ),
    gc_probability: z
      .number()
      .int()
      .nonnegative()
      .default(5)
      .describe(
        "Numérateur de la probabilité de GC (gc_probability / gc_divisor).",
      ),
    gc_divisor: z
      .number()
      .int()
      .positive()
      .default(100)
      .describe(
        "Dénominateur de la probabilité de GC. 5/100 = 5 % par requête.",
      ),
    gc_maxlifetime: z
      .number()
      .int()
      .positive()
      .default(1440)
      .describe("Durée de vie max d'une session inactive (s). 1440 = 24 min."),
    absolute_timeout: z
      .number()
      .int()
      .nonnegative()
      .default(0)
      .describe(
        "Absolute timeout (OWASP, s) : âge MAX d'une session depuis sa création, " +
          "indépendant de l'activité. 0 = désactivé (seul l'idle s'applique).",
      ),
    hash_function: z
      .enum(["md5", "sha1"])
      .default("sha1")
      .describe(
        "Algorithme de hachage des IDs de session. `sha1` (défaut, plus " +
          "résistant aux collisions) | `md5`.",
      ),
    use_cookies: z
      .boolean()
      .default(true)
      .describe("Transmet l'ID de session via les cookies (recommandé)."),
    use_only_cookies: z
      .boolean()
      .default(true)
      .describe(
        "N'accepte l'ID QUE via cookies (anti session-fixation par URL).",
      ),
    use_trans_sid: z
      .boolean()
      .default(true)
      .describe(
        "Autorise l'ID en query string (clé = `name`) si `use_only_cookies` est false.",
      ),
    referer_check: z
      .boolean()
      .default(false)
      .describe("Vérifie que le Referer correspond au domaine courant."),
    cookie: sessionCookieSchema.default(() => sessionCookieSchema.parse({})),
  })
  .describe(
    "Gestionnaire de sessions (cookie chiffré AES-256-CTR). Handlers : " +
      "files (défaut) · drizzle · mongoose.",
  );

// ───────────────────────── racine ───────────────────────────────────────────

export const httpConfigSchema = z
  .object({
    watch: meta(z.boolean().default(true), {
      reserved: true,
      description:
        "RÉSERVÉ (no-op) — le hot-reload dev (watch → rebuild ciblé → restart de " +
        "process) est déjà assuré GLOBALEMENT par le DevSupervisor sur tout " +
        "`src/` (liste de chemins fixe), PAS par ce flag. Un vrai HMR backend " +
        "in-process est impossible en ESM (Node ne décharge pas un module déjà " +
        "importé → le restart est le seul rechargement fiable ; le frontend garde " +
        "le HMR Vite). Ce flag per-module n'est lu nulle part aujourd'hui ; " +
        "réservé à un futur opt-out per-module du watch. NE PAS retirer (réservé, " +
        "cf sessions 2026-05-30 / 2026-06-24).",
    }),
    headerServer: meta(z.string().nullable().default("nodefony"), {
      runtimeMutable: true,
      description:
        "Valeur de l'en-tête `Server:`. `null` = ne pas exposer l'identité du " +
        "serveur (recommandé en production). Relu à chaque requête (éditable à chaud).",
    }),
    trustProxy: z
      .union([z.boolean(), z.string(), z.array(z.string())])
      .default(false)
      .describe(
        "Confiance envers les en-têtes `X-Forwarded-*` (RFC 7239). `false` " +
          "(DÉFAUT, secure) = ignorés. `true` = confiance totale (UNIQUEMENT si " +
          "reverse-proxy unique point d'entrée). IP/CIDR/liste/preset " +
          "(`loopback`/`linklocal`/`uniquelocal`) = confiance conditionnelle au socket.",
      ),
    trustedHosts: z
      .union([z.boolean(), z.string(), z.array(z.string())])
      .default(false)
      .describe(
        "Barrière `Host` testée AVANT le routing (anti Host-header injection). " +
          "Le domaine canonique (`kernel.domain`) est TOUJOURS accepté, + le " +
          "loopback (`localhost`/`127.0.0.1`/`[::1]`) en development. `false` " +
          "(DÉFAUT) = ce socle seul. `true` = bypass (tout `Host` passe — quand un " +
          "reverse-proxy filtre déjà le `Host`, cf cloud-native). string/liste = " +
          "vhosts additionnels : exact (`marseille.fr`) ou wildcard un-label " +
          "(`*.cdn.example.com`). N.B. : ce n'est PAS la liste des vhosts servis " +
          "(ça, c'est `@Domain` sur les contrôleurs) — juste la barrière sécu.",
      ),
    securityHeaders: securityHeadersSchema.default(() =>
      securityHeadersSchema.parse({}),
    ),
    maxBodySize: z
      .number()
      .int()
      .nonnegative()
      .default(1_048_576)
      .describe(
        "Taille max (octets) d'un corps de requête NON-multipart (JSON, " +
          "urlencoded, XML, brut) avant rejet RFC 9110 413 « Content Too Large ». " +
          "Vérifiée d'abord sur `Content-Length` (rejet avant lecture), puis en " +
          "continu pendant le streaming (anti chunked/Content-Length menteur). " +
          "Défaut 1 MiB (secure-by-default, anti DoS mémoire). 0 = illimité. Le " +
          "multipart a ses propres limites (`upload.maxFileSize`/`maxTotalFileSize`).",
      ),
    upload: uploadSchema.default(() => uploadSchema.parse({})),
    queryString: queryStringSchema.default(() => queryStringSchema.parse({})),
    http: httpServerSchema.default(() => httpServerSchema.parse({})),
    https: httpsServerSchema.default(() => httpsServerSchema.parse({})),
    http2: http2Schema.default(() => http2Schema.parse({})),
    http3: meta(
      http3Schema.default(() => http3Schema.parse({})),
      {
        reserved: true,
        description:
          "RÉSERVÉ — serveur HTTP/3 (QUIC), nécessitera Node.js >= 28.",
      },
    ),
    certificates: certificatesSchema.default(() =>
      certificatesSchema.parse({}),
    ),
    websocket: websocketSchema.default(() => websocketSchema.parse({})),
    websocketSecure: websocketSchema
      .default(() => websocketSchema.parse({}))
      .describe(
        "Serveur WebSocket Secure (wss://, port 5152). Même forme que `websocket`.",
      ),
    statics: staticsSchema.default(() => staticsSchema.parse({})),
    session: sessionSchema.default(() => sessionSchema.parse({})),
  })
  .describe("Configuration de @nodefony/http.");

export type HttpConfig = z.infer<typeof httpConfigSchema>;
export type HttpConfigInput = z.input<typeof httpConfigSchema>;

/**
 * Schéma JSON (draft 2020-12) de la config http, dérivé du schéma Zod ci-dessus.
 *
 * `z.toJSONSchema()` recopie les `description`, `default`, types/contraintes ET
 * les flags Nodefony attachés via {@link meta} (`reserved`, `runtimeMutable`,
 * `kernelDerived`, `secret`) → source de vérité UNIQUE pour l'introspection
 * Studio (page détail module, onglet Config) : plus de table de réglages recopiée
 * à la main côté front. Exposé via {@link import("../../index").Http.configSchema}.
 *
 * @returns le JSON Schema de la configuration de `@nodefony/http`.
 */
export function httpConfigJsonSchema(): unknown {
  return z.toJSONSchema(httpConfigSchema);
}
