import { z } from "zod";
import { parseModuleConfig } from "nodefony";
import { <%= it.camel %>ConfigSchema } from "./config";
import type { <%= it.pascal %>Config, <%= it.pascal %>ConfigInput } from "./config";

/**
 * <%= it.pkgName %> — LE COMMENT : builder PUR de la config.
 *
 * ⭐ TL;DR : ce fichier VALIDE et GÈLE. Il ne porte AUCUNE valeur — les défauts
 * vivent dans le schéma de `./config.ts` (règle d'or ADR-0006). Pour changer un
 * défaut, c'est là-bas ; ici, on ne fait que le faire respecter.
 *
 * Le nom du FICHIER est le même dans tous les modules Nodefony
 * (`defineModuleConfig.ts`) ; la FONCTION, elle, est préfixée par le module —
 * deux modules importés côte à côte ne se marchent pas dessus.
 *
 * L'override env générique (`NF__<%= it.upper %>__<CHEMIN>`) est appliqué par le core,
 * pas ici. Si le module a besoin d'une variable d'env DÉDIÉE, elle s'applique
 * APRÈS le parse, dans cette fonction, pour que le schéma reste pur.
 *
 * 🔴 **La validation passe par `parseModuleConfig`, du cœur** — un seul endroit
 * pour une seule règle. Il lève une `BootConfigurationError`, et pas une `Error`
 * ordinaire : le kernel distingue les deux. Un hook de cycle de vie qui lève une
 * erreur QUELCONQUE est absorbé en développement (fail-soft — il protège la DX
 * d'un module optionnel cassé), tandis qu'une erreur de CONFIGURATION interrompt
 * le boot dans TOUS les environnements. Mesuré sur un module généré : avec une
 * `Error`, `use("<%= it.pkgName %>", { gretting: "…" })` laissait l'application
 * démarrer, servir, et rendre 0 — la faute de frappe n'atteignait personne. Une
 * configuration explicite qu'on ne peut pas honorer ne se répare pas en
 * continuant.
 *
 * ⚠️ Ne PAS réécrire ce bloc à la main : les dix modules du framework portaient
 * chacun leur copie du `try`/`catch`, et elles avaient divergé sur les deux
 * points qui comptent — le type de l'erreur levée et la langue du message.
 *
 * @param config - config brute venue de `use("<%= it.pkgName %>", { … })`.
 * @returns config validée et gelée.
 * @throws BootConfigurationError si un champ est invalide ou inconnu (toutes les
 *   erreurs Zod agrégées, par champ) — le boot s'interrompt, en dev comme en prod.
 */
export function define<%= it.pascal %>Config(
  config: <%= it.pascal %>ConfigInput = {},
): <%= it.pascal %>Config {
  return Object.freeze(
    parseModuleConfig(<%= it.camel %>ConfigSchema, config, "<%= it.pkgName %>"),
  );
}

/**
 * JSON Schema de la config — Studio en dérive son formulaire d'édition
 * (libellés, types, défauts, descriptions), sans une ligne d'UI écrite à la main.
 */
export function <%= it.camel %>ConfigJsonSchema(): unknown {
  return z.toJSONSchema(<%= it.camel %>ConfigSchema);
}
