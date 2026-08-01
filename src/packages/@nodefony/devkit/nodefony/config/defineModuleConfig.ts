import { z } from "zod";
import { devkitConfigSchema } from "./config";
import type { DevkitConfig, DevkitConfigInput } from "./config";

/**
 * @nodefony/devkit — LE COMMENT : builder PUR de la config.
 *
 * ⭐ TL;DR : ce fichier VALIDE et GÈLE. Il ne porte AUCUNE valeur — les défauts
 * vivent dans le schéma de `./config.ts` (règle d'or ADR-0006). Pour changer un
 * défaut, c'est là-bas ; ici, on ne fait que le faire respecter.
 *
 * Le nom du FICHIER est le même dans tous les modules Nodefony
 * (`defineModuleConfig.ts`) ; la FONCTION, elle, est préfixée par le module —
 * deux modules importés côte à côte ne se marchent pas dessus.
 *
 * L'override env générique (`NF__DEVKIT__<CHEMIN>`) est appliqué par le core,
 * pas ici. Si le module a besoin d'une variable d'env DÉDIÉE, elle s'applique
 * APRÈS le parse, dans cette fonction, pour que le schéma reste pur.
 *
 * @param config - config brute venue de `use("@nodefony/devkit", { … })`.
 * @returns config validée et gelée.
 * @throws Error si un champ est invalide (toutes les erreurs Zod agrégées, par champ).
 */
export function defineDevkitConfig(
  config: DevkitConfigInput = {},
): DevkitConfig {
  try {
    return Object.freeze(devkitConfigSchema.parse(config));
  } catch (e) {
    const issues =
      e instanceof Error && "issues" in e && Array.isArray(e.issues)
        ? (e.issues as Array<{ path: (string | number)[]; message: string }>)
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join(" · ")
        : (e as Error).message;
    throw new Error(`[@nodefony/devkit] config invalide : ${issues}`);
  }
}

/**
 * JSON Schema de la config — Studio en dérive son formulaire d'édition
 * (libellés, types, défauts, descriptions), sans une ligne d'UI écrite à la main.
 */
export function devkitConfigJsonSchema(): unknown {
  return z.toJSONSchema(devkitConfigSchema);
}
