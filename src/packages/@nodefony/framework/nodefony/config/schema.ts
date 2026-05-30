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
 * config. Les seules clés réellement consommées dans le source (audit 2026-05-30) :
 *   - `watch` — RÉSERVÉ au futur serveur HMR (non lu en runtime aujourd'hui).
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

export const frameworkConfigSchema = z
  .object({
    watch: meta(z.boolean().default(true), {
      reserved: true,
      description:
        "RÉSERVÉ — futur serveur HMR du framework (hot-reload dev). Non lu en " +
        "runtime actuellement. NE PAS retirer (réservé feature, cf session 2026-05-30).",
    }),
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
