import { z } from "zod";

/**
 * @nodefony/framework — CONFIGURATION DU MODULE (schéma Zod = source unique).
 *
 * ⭐ TL;DR : CE SCHÉMA EST LA CONFIG. Chaque `.default(...)` = la valeur d'usine ;
 * changer un défaut du module = ÉDITER ICI (et nulle part ailleurs). L'app, elle,
 * surcharge via `use("@nodefony/...", { … })` dans SON `nodefony.config.ts`.
 *
 * RÈGLE D'OR (ADR-0006) : ce fichier porte le **schéma Zod commenté** (type +
 * validation + défaut + doc) ET matérialise les défauts. Aucune valeur n'est
 * re-tapée ailleurs. Le builder (`defineModuleConfig.ts` →
 * `defineFrameworkConfig`) importe le schéma D'ICI (nœud bas : ce fichier
 * n'importe que `zod` → pas de cycle). La config est validée au boot du Module
 * class (hook `onKernelRegister`, cf `index.ts`) → plante propre avec un
 * message clair si la config est invalide, plutôt qu'un `undefined.x`
 * silencieux en runtime.
 *
 * ## Surface volontairement minimale
 *
 * Le framework n'expose presque aucune option : son rôle (Router/Resolver/
 * Controller/décorateurs) est piloté par les décorateurs et le code, pas par la
 * config. Les seules clés réellement consommées dans le source :
 *   - `router` / `adminBroker` — bags d'options de **Service de base** transmis
 *     tels quels aux Services `Router` / `AdminBroker` (4ᵉ arg du `super(...)`).
 *     Aucune forme métier figée → `looseObject` + `optional` (ne RIEN stripper,
 *     absent par défaut = `undefined`, comme avant validation).
 *
 * ## Pureté
 *
 * Aucun `Nodefony.getKernel()` ni `process.env` → sortie déterministe,
 * sérialisable en JSON Schema (`frameworkConfigJsonSchema` dans
 * `defineModuleConfig.ts`) pour Studio.
 */

// Bag d'options de Service de base (Router / AdminBroker). `looseObject` =
// aucune clé strippée (options Service génériques, pas une config figée).
const serviceOptionsSchema = z.looseObject({});

// Sous-schéma extrait (piège Zod 4 : un `.default({…})` plat ne ré-applique pas
// les sous-défauts gcIntervalS/gcJitter → `.default(() => schema.parse({}))`).
const idempotencySchema = z.strictObject({
  store: z
    .string()
    .default("auto")
    .describe(
      "Backing du cache d'idempotence des mutations (`@Idempotent` + data " +
        "plane admin). `auto` (défaut) = suit l'infra déclarée (NF_REDIS_URL " +
        "→ redis, sinon NF_DATABASE_URL → drizzle, sinon memory per-pod). " +
        "`memory` = cache per-pod (la socket reste affine à son pod). Un nom " +
        "DISTRIBUÉ (`redis`, `drizzle`) est enregistré via " +
        "`registerIdempotencyStore(name, …)` (auto-register par les adapters) " +
        "ET résolu au boot → override du défaut mémoire. Un nom EXPLICITE dont " +
        "l'initialisation échoue AVORTE le boot en PRODUCTION uniquement " +
        "(fail-loud : pas de dédup silencieuse en cluster) ; en dev/test, " +
        "WARNING + repli mémoire pour ne pas bloquer une machine sans infra. " +
        "Reco prod multi-pod : `redis` (SET NX + TTL natif).",
    ),
  gcIntervalS: z
    .number()
    .int()
    .min(0)
    .default(600)
    .describe(
      "Intervalle de purge des clés d'idempotence expirées (s), HORS " +
        "hot-path. N'a d'effet QUE pour un store SANS expiration native " +
        "(`drizzle` → `DELETE WHERE expiresAt<=now`) ; `redis` (TTL `PX`) et " +
        "`memory` (purge passive) l'ignorent. 0 = timer désarmé (cron/k8s).",
    ),
  gcJitter: z
    .boolean()
    .default(true)
    .describe(
      "Étale le départ du gc d'idempotence par process — anti thundering-herd " +
        "sur le store SQL partagé en cluster.",
    ),
});

export const frameworkConfigSchema = z
  .strictObject({
    router: serviceOptionsSchema
      .optional()
      .describe(
        "Options transmises au Service `Router` (bag d'options de Service de " +
          "base : logger, timers…). Loose : non strippées. Absent (défaut) = aucune.",
      ),
    adminBroker: serviceOptionsSchema
      .optional()
      .describe(
        "Options transmises au Service `AdminBroker` (data plane admin " +
          "`/nodefony/<ns>/api/*`). Loose : non strippées. Absent (défaut) = aucune.",
      ),
    idempotency: idempotencySchema
      .default(() => idempotencySchema.parse({}))
      .describe(
        "Idempotence des mutations (anti double-effet). Cf " +
          "draft-ietf-httpapi-idempotency-key-header.",
      ),
  })
  .describe("Configuration de @nodefony/framework.");

/** Type de sortie (config normalisée + défauts appliqués). */
export type FrameworkConfig = z.infer<typeof frameworkConfigSchema>;
/** Type d'entrée (toutes sections omissibles — défauts du schéma). */
export type FrameworkConfigInput = z.input<typeof frameworkConfigSchema>;

// Config par défaut DÉRIVÉE du schéma Zod (source unique — jamais de défaut
// écrit à la main, cf `feedback_config_validation_zod`). `parse({})` matérialise
// les défauts. `router`/`adminBroker` restent absents (optional)
// → les Services reçoivent `undefined`, comportement historique inchangé.
export default {
  ...frameworkConfigSchema.parse({}),

  // ── P6 J3b — AIRE DATA PLANE (verrou du data plane d'admin) ──
  // C'est le FRAMEWORK qui porte l'aire, pas Studio : le data plane
  // /nodefony/<ns>/api/* est monté SANS condition par le broker du framework
  // (onKernelReady → broker.mountAll), donc il existe même sans Studio. Le
  // déclarant porte l'aire ; « pas de couplage à la vue » (Studio = vue, le data
  // plane = état du framework). Override inter-modules « module-security »,
  // appliqué par le Kernel AVANT la validation Zod du firewall (convention-frère
  // de src/modules/test/config.ts). framework n'importe JAMAIS security : si
  // security est absent, l'override est simplement ignoré (0 cycle).
  "module-security": {
    areas: {
      // Carve-out PUBLIC de la liveness/readiness, HORS `nodefony-admin`. Pattern
      // EXACT (`$`) → ne couvre QUE /nodefony/kernel/api/livez (jamais /info ni
      // /modules, qui restent fermés). Plus LONG que le pattern admin → le
      // firewall trie les zones par longueur de source décroissante
      // (firewall.ts) → cette zone gagne le match pour /livez. `anonymous` en
      // SECOND (mode "first") : une session BFF présente identifie l'admin (le
      // handler renvoie les détails) ; sans session, l'anonyme passe (minimum
      // vital) → les sondes k8s/Docker NON authentifiées vérifient que le pod est
      // UP. `realtime: false` : route HTTP pure (pas de handshake WS à fermer).
      "nodefony-liveness": {
        pattern: "^/nodefony/kernel/api/livez$",
        authenticators: ["session", "anonymous"],
        realtime: false,
      },
      "nodefony-admin": {
        // Tous les espaces data plane : /nodefony/<ns>/api(/...). Le (/|$) capture
        // aussi /nodefony/profiler/api (sans slash final). Pattern verrouillé par
        // securedArea.test.ts contre l'inventaire réel des namespaces.
        pattern: "^/nodefony/[^/]+/api(/|$)",
        authenticators: ["session"], // session BFF (cookie opaque). RBAC par rôle = P6.8.
        // Casier de session unique ("default", partagé app+admin) : le login BFF est
        // partagé → pas d'isolation par casier (sans traversée de contexte, non portée —
        // cf mémoire). Isolation admin/app = RBAC par rôle (P6.8), comme OWASP/Symfony.
        // défauts : security true (Zero Trust), mode "first", stateless false,
        // realtime true (la zone ferme AUSSI le WS — api.request + subscribe ;
        // opt-out explicite `realtime: false` pour une zone strictement HTTP).
      },
    },
  },
};
