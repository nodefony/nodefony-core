import { z } from "zod";

/**
 * @nodefony/redis — CONFIGURATION DU MODULE (schéma Zod = source unique).
 *
 * ⭐ TL;DR : CE SCHÉMA EST LA CONFIG. Chaque `.default(...)` = la valeur d'usine ;
 * changer un défaut du module = ÉDITER ICI (et nulle part ailleurs). L'app, elle,
 * surcharge via `use("@nodefony/...", { … })` dans SON `nodefony.config.ts`.
 *
 * RÈGLE D'OR (ADR-0006) : ce fichier porte le **schéma Zod commenté** (type +
 * validation + défaut + doc) ET matérialise les défauts via `parse({})`. Aucune
 * valeur n'est re-tapée ailleurs. Le builder (`defineModuleConfig.ts` →
 * `defineRedisConfig`) et les types (`interfaces/IRedisConfig.ts`) importent le
 * schéma D'ICI (nœud bas : ce fichier n'importe que `zod` → pas de cycle).
 *
 * La config est validée au boot du Module class (hook `onKernelRegister`, via
 * le builder {@link defineRedisConfig}) → plante propre avec messages clairs si
 * la config est invalide, plutôt qu'un `undefined.x` silencieux en runtime.
 *
 * ⚠️ ENV : ce schéma reste PUR (pas de lecture `process.env` ici, sinon il
 * deviendrait non déterministe et non sérialisable en JSON Schema). La surcharge
 * par variables d'environnement (`REDIS_URL`, `REDIS_HOST`, `REDIS_PORT`,
 * `REDIS_PASSWORD`) est appliquée dans {@link defineRedisConfig}, APRÈS le parse.
 *
 * SURCHARGE PAR L'APPLICATION (fusion récursive) :
 *
 *   // nodefony.config.ts
 *   use("@nodefony/redis", {
 *     globalOptions: { socket: { host: "redis.internal", tls: true } },
 *     connections: { cache: { name: "cache", database: 1 } },
 *   })
 *
 * ⚠️ NE PAS éditer les défauts matérialisés en bas de fichier : modifier les
 * `.default(...)` du schéma. La validation + le merge env finaux sont faits dans
 * `index.ts` au hook `onKernelRegister` via `defineRedisConfig`.
 */

// Sous-schémas extraits — réutilisés dans `.default(() => sub.parse({}))` pour
// que les sous-défauts soient appliqués quand la section parente est omise (Zod
// 4 n'applique PAS les sous-défauts via un `.default({})` plat — cf realtime).

const reconnectStrategySchema = z
  .object({
    baseMs: z
      .number()
      .int()
      .positive()
      .default(100)
      .describe(
        "Délai de base (ms) du back-off de reconnexion. Le délai effectif = " +
          "min(tentative × baseMs, maxMs). Défaut 100 ms (1ʳᵉ retry à 100 ms, " +
          "2ᵉ à 200 ms…). Remplace l'ancien `retry_strategy` JS hardcodé.",
      ),
    maxMs: z
      .number()
      .int()
      .positive()
      .default(10_000)
      .describe(
        "Plafond (ms) du délai de reconnexion — évite un back-off qui explose. " +
          "Défaut 10 s. Au-delà, le client retente à intervalle constant `maxMs`.",
      ),
    maxRetries: z
      .number()
      .int()
      .nonnegative()
      .default(0)
      .describe(
        "Nombre maximal de tentatives de reconnexion avant abandon définitif. " +
          "0 (défaut) = illimité (résilience prod : le client retente sans fin). " +
          "Mettre une valeur finie pour fail-fast en CI/test.",
      ),
  })
  .describe(
    "Politique de reconnexion (back-off linéaire borné). Convertie en fonction " +
      "`socket.reconnectStrategy` de redis v5 au runtime, dans la connexion.",
  );

const socketSchema = z
  .object({
    host: z
      .string()
      .min(1)
      .default("localhost")
      .describe(
        "Hôte du serveur Redis. Défaut `localhost` (jamais d'hôte d'infra " +
          "hardcodé). Surchargeable par l'env `REDIS_HOST`. Aligné sur l'infra " +
          "`docker/docker-compose.yml` (Redis bindé `127.0.0.1:6379`).",
      ),
    port: z
      .number()
      .int()
      .min(1)
      .max(65_535)
      .default(6379)
      .describe("Port TCP du serveur Redis. Défaut 6379. Env `REDIS_PORT`."),
    family: z
      .union([z.literal(0), z.literal(4), z.literal(6)])
      .default(0)
      .describe(
        "Famille IP pour la résolution DNS : 0 = auto (IPv4+IPv6), 4 = IPv4, " +
          "6 = IPv6. Défaut 0 (laisse Node choisir).",
      ),
    connectTimeout: z
      .number()
      .int()
      .positive()
      .default(5_000)
      .describe(
        "Délai max (ms) d'établissement de la connexion TCP avant échec. " +
          "Défaut 5 s. Empêche un boot qui pend indéfiniment si Redis est " +
          "injoignable.",
      ),
    tls: z
      .boolean()
      .default(false)
      .describe(
        "Active TLS (Redis over SSL, schéma `rediss://`). Défaut false (dev " +
          "local en clair). Mettre true en prod managée / cross-host non " +
          "fiable. Recommandation sécurité : true dès que le réseau n'est pas " +
          "de confiance.",
      ),
    reconnectStrategy: reconnectStrategySchema.default(() =>
      reconnectStrategySchema.parse({}),
    ),
  })
  .describe("Options socket TCP/TLS communes à toutes les connexions.");

// Surcharge socket par connexion : champs SANS défaut (optionnels purs) — pour
// que seuls les champs explicitement posés écrasent `globalOptions.socket` lors
// de la fusion. Un `socketSchema.partial()` ré-appliquerait les `.default()` et
// clobberait silencieusement le global (port 6379, etc.).
const socketOverrideSchema = z
  .object({
    host: z.string().min(1).optional(),
    port: z.number().int().min(1).max(65_535).optional(),
    family: z.union([z.literal(0), z.literal(4), z.literal(6)]).optional(),
    connectTimeout: z.number().int().positive().optional(),
    tls: z.boolean().optional(),
  })
  .describe("Surcharge socket par connexion (champs optionnels, sans défaut).");

const connectionSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .describe(
        "Nom logique de la connexion (clé dans `connections` + `CLIENT " +
          "SETNAME` côté Redis pour l'introspection `CLIENT LIST`).",
      ),
    database: z
      .number()
      .int()
      .nonnegative()
      .default(0)
      .describe(
        "Numéro de base Redis (`SELECT`). Défaut 0. ⚠️ Le pub/sub Redis est " +
          "GLOBAL (ignore la base) ; `database` n'isole que les commandes " +
          "clé-valeur (storage). À utiliser pour cloisonner des apps sur une " +
          "même instance.",
      ),
    socket: socketOverrideSchema
      .optional()
      .describe(
        "Surcharge socket spécifique à cette connexion (host/port/tls…). " +
          "Fusionnée par-dessus `globalOptions.socket`. Champs omis = hérités " +
          "du global (PAS de défaut local, sinon ils clobberaient le global).",
      ),
  })
  .describe("Définition d'une connexion Redis nommée.");

const globalOptionsSchema = z
  .object({
    socket: socketSchema.default(() => socketSchema.parse({})),
    username: z
      .string()
      .optional()
      .describe(
        "Nom d'utilisateur ACL Redis 6+ (`ACL`). Optionnel. Si absent et " +
          "`password` présent → auth legacy `requirepass` (utilisateur " +
          "`default`). Env : non surchargé (mettre dans la config app).",
      ),
    password: z
      .string()
      .optional()
      .meta({
        secret: true,
        description:
          "Mot de passe Redis (`requirepass` ou ACL). Optionnel en dev sans " +
          "auth. ⚠️ Zero Trust : Redis DOIT avoir une auth même en dev (cf " +
          "docker compose `--requirepass`). Surchargé par l'env " +
          "`REDIS_PASSWORD` — NE JAMAIS committer un secret dans la config.",
      }),
  })
  .describe(
    "Options communes fusionnées dans CHAQUE connexion (socket + credentials).",
  );

export const redisConfigSchema = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .describe(
        "Active le module au boot. true = les connexions définies sont " +
          "ouvertes à l'init du service. false = module chargé mais inerte " +
          "(aucune connexion, 0 socket) — utile pour désactiver Redis en CI.",
      ),
    url: z
      .string()
      .optional()
      .meta({
        secret: true,
        description:
          "URL Redis complète `redis[s]://[[user][:pass]@]host[:port][/db]`. Si " +
          "fournie (ou via env `REDIS_URL`), elle prend PRÉCÉDENCE sur " +
          "`globalOptions`/`socket` pour TOUTES les connexions (host/port/auth " +
          "extraits de l'URL). Pratique pour les PaaS (Heroku, Upstash…). Porte " +
          "potentiellement le credential (user:pass) → traitée comme un secret.",
      }),
    globalOptions: globalOptionsSchema.default(() =>
      globalOptionsSchema.parse({}),
    ),
    connections: z
      .record(z.string(), connectionSchema)
      .default(() => ({
        main: connectionSchema.parse({ name: "main" }),
        publish: connectionSchema.parse({ name: "publish" }),
        subscribe: connectionSchema.parse({ name: "subscribe" }),
      }))
      .describe(
        "Connexions nommées. Défaut : 3 connexions `main` (commandes/storage), " +
          "`publish` (PUBLISH) et `subscribe` (SUBSCRIBE). Pourquoi 3 : un " +
          "client Redis abonné ne peut plus émettre de commandes normales " +
          "(contrainte protocole) → pub/sub exige des clients dédiés.",
      ),
  })
  .describe("Configuration de @nodefony/redis.");

/** Type de sortie (config normalisée + défauts appliqués). */
export type RedisConfig = z.infer<typeof redisConfigSchema>;

/**
 * Défauts du module, matérialisés depuis le schéma (source unique). Toujours
 * valides par construction ; passés au `super(..., config)` du Module class.
 */
const config: RedisConfig = redisConfigSchema.parse({});

export default config;
