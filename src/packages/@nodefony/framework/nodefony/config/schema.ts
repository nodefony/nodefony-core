import { z } from "zod";
import { meta } from "@nodefony/http";

/**
 * Schéma Zod de la configuration de `@nodefony/framework`.
 *
 * Source de vérité du module : la config (`./config.ts`) est dérivée via
 * `frameworkConfigSchema.parse({})` (jamais de défaut écrit à la main) et
 * validée au boot du Module class (hook `onKernelRegister`, cf `index.ts`) →
 * plante propre avec un message clair si la config est invalide, plutôt qu'un
 * `undefined.x` silencieux en runtime.
 *
 * Convention figée 2026-05-28 (cf mémoire `feedback_config_validation_zod`).
 * Aligné sur `@nodefony/http/config/schema.ts` (dont le helper {@link meta} est
 * réutilisé — framework dépend déjà de http : import légal dans ce sens).
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
 * sérialisable en JSON Schema ({@link frameworkConfigJsonSchema}) pour Studio.
 */

// Bag d'options de Service de base (Router / AdminBroker). `looseObject` =
// aucune clé strippée (options Service génériques, pas une config figée).
const serviceOptionsSchema = z.looseObject({});

// Sous-schéma extrait (piège Zod 4 : un `.default({…})` plat ne ré-applique pas
// les sous-défauts gcIntervalS/gcJitter → `.default(() => schema.parse({}))`).
const idempotencySchema = z.object({
  store: z
    .string()
    .default("memory")
    .describe(
      "Backing du cache d'idempotence des mutations (`@Idempotent` + data " +
        "plane admin). `memory` (défaut) = cache per-pod (la socket reste " +
        "affine à son pod). Un nom DISTRIBUÉ (`redis`, `drizzle`) doit être " +
        "câblé par l'application via `registerIdempotencyStore(name, …)` ET " +
        "résolu au boot → override du défaut mémoire. Un nom non câblé fait " +
        "ÉCHOUER le boot (fail-loud : pas de dédup silencieuse en cluster). " +
        "Reco prod multi-pod : `redis` (SET NX + TTL natif, 409 in-flight réel).",
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
  .object({
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

export type FrameworkConfig = z.infer<typeof frameworkConfigSchema>;
export type FrameworkConfigInput = z.input<typeof frameworkConfigSchema>;

/**
 * JSON Schema introspectable de la config framework — destiné au formulaire
 * d'édition Studio (futur) et à la documentation générée.
 */
export function frameworkConfigJsonSchema(): unknown {
  return z.toJSONSchema(frameworkConfigSchema);
}
