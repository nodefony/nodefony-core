import { z } from "zod";
import type { UiDeliveryMode } from "@nodefony/http";

/**
 * @nodefony/studio — CONFIGURATION DU MODULE (schéma Zod = source unique).
 *
 * ⭐ TL;DR : CE SCHÉMA EST LA CONFIG. Chaque `.default(...)` = la valeur d'usine ;
 * changer un défaut du module = ÉDITER ICI (et nulle part ailleurs). L'app, elle,
 * surcharge via `use("@nodefony/studio", { … })` dans SON `nodefony.config.ts`.
 *
 * RÈGLE D'OR (ADR-0006) : ce fichier porte le **schéma Zod commenté** (type +
 * validation + défaut + doc) ET matérialise les défauts via `parse({})`. Aucune
 * valeur n'est re-tapée ailleurs. Le builder (`defineModuleConfig.ts` →
 * `defineStudioConfig`) et les types (`interfaces/IStudioConfig.ts`) importent
 * le schéma D'ICI.
 *
 * ⚠️ ENV : ce schéma reste PUR (aucune lecture `process.env`), pour rester
 * déterministe et sérialisable en JSON Schema. L'app pose `ui` depuis son
 * catalogue d'env (`ctx.env.NF_STUDIO_UI`), là où les variables se lisent.
 */

/**
 * Valeurs acceptées par la molette de livraison de l'UI.
 *
 * Le `satisfies` amarre cette liste au type que `@nodefony/http` publie
 * ({@link UiDeliveryMode}), consommé par `resolveUiDelivery` : une valeur qui
 * n'existerait pas là-bas ne compile pas ici. On ne redéclare donc pas la
 * grammaire — on prouve qu'on en est un sous-ensemble.
 */
const UI_DELIVERY_MODES = [
  "auto",
  "static",
  "vite",
] as const satisfies readonly UiDeliveryMode[];

export const studioConfigSchema = z
  .strictObject({
    ui: z
      .enum(UI_DELIVERY_MODES)
      .default("auto")
      .describe(
        "Molette de livraison de l'UI Studio (`resolveUiDelivery`, " +
          "@nodefony/http) : `auto` = Vite si possible (dev + sources + " +
          "@nodefony/frontend), sinon les assets pré-buildés shippés dans le " +
          "paquet npm ; `static` force le pré-buildé (`dist/frontend/`, produit " +
          "au publish) ; `vite` force le dev-server HMR (dépôt self-hosted / " +
          "contribution). Défaut `auto`.",
      ),
    publicMount: z
      .literal(false)
      .default(false)
      .describe(
        "Opt-out du montage statique natif (`server-static`, @nodefony/http). " +
          "TOUJOURS false pour Studio : `public/dist` est l'outDir du flux Vite " +
          "— jamais servi tel quel. Les assets Studio partent sous " +
          "`/_assets/studio/` (Vite en dev, `PrebuiltUi` en static). Seule la " +
          "valeur `false` est acceptée : un montage sous `/studio/` servirait " +
          "des sources de build.",
      ),
    "module-frontend": z
      .looseObject({
        https: z
          .boolean()
          .default(true)
          .describe(
            "Sert le dev-server Vite en HTTPS avec les certificats Nodefony — " +
              "évite le mixed-content quand la page vient de server-https " +
              "(5152). Défaut true.",
          ),
      })
      .default(() => ({ https: true }))
      .describe(
        "Réglages transmis TELS QUELS à @nodefony/frontend pour l'entrée Vite " +
          "de Studio. `looseObject` (et non `strictObject`) parce que la " +
          "grammaire de cette section appartient à @nodefony/frontend : y " +
          "refuser une clé inconnue interdirait une option légitime de ce " +
          "module-là. C'est son propre schéma qui la valide.",
      ),
  })
  .describe("Configuration de @nodefony/studio.");

/** Type de sortie (config normalisée + défauts appliqués). */
export type StudioConfig = z.infer<typeof studioConfigSchema>;

/**
 * Défauts du module, matérialisés depuis le schéma (source unique). Toujours
 * valides par construction ; passés au `super(..., config)` du Module class.
 */
const config: StudioConfig = studioConfigSchema.parse({});

export default config;
