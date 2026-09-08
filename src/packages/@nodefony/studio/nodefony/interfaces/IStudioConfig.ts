import type { z } from "zod";
import type { studioConfigSchema } from "../config/config";

/**
 * Configuration normalisée et gelée de `@nodefony/studio` (sortie du builder
 * `defineStudioConfig`, lue par le module et ses controllers).
 *
 * Type dérivé du schéma Zod — NE PAS redéclarer les champs à la main (ils
 * divergeraient silencieusement de la source de vérité `config/config.ts`).
 */
export type IStudioConfig = z.infer<typeof studioConfigSchema>;

/**
 * Entrée du builder `defineStudioConfig` — tous les champs portant un défaut
 * sont optionnels (l'app ne fournit que ce qu'elle surcharge).
 *
 * C'est CE type que le registre `NodefonyModuleConfig` enregistre : sans lui,
 * `use("@nodefony/studio", { … })` accepterait n'importe quelle clé, que Zod
 * retirerait ensuite en silence.
 */
export type IStudioConfigInput = z.input<typeof studioConfigSchema>;
