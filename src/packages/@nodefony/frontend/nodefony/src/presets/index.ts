import type {
  FrontPresetType,
  IFrontPreset,
} from "../../interfaces/IFrontPreset";
import react19Preset from "./react19-vite";
import vue3Preset from "./vue3-vite";
import angularPreset from "./angular-vite";
import vanillaPreset from "./vanilla-vite";
import svelte5Preset from "./svelte5-vite";

/** Les presets fournis par le module, dans l'ordre où le builder les enregistre. */
export const builtinPresets: ReadonlyArray<IFrontPreset> = [
  react19Preset,
  vue3Preset,
  angularPreset,
  vanillaPreset,
  svelte5Preset,
];

const builtinByType = new Map<FrontPresetType, IFrontPreset>(
  builtinPresets.map((preset) => [preset.type, preset]),
);

/**
 * Le preset fourni pour un type — registre par défaut du générateur de
 * configuration du serveur de développement.
 *
 * @param type - identifiant du preset
 * @returns le preset, ou `undefined` si aucun preset fourni ne porte ce type
 */
export function getBuiltinPreset(
  type: FrontPresetType,
): IFrontPreset | undefined {
  return builtinByType.get(type);
}
