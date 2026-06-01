/**
 * Registre de configuration **riche** par module (brique `ConfigLayout` +
 * `ConfigSummaryCard`).
 *
 * Un module migré (schéma Zod mappé vers `ConfigSection[]`) s'enregistre ici via
 * une **entry** `{ module, schema, sections }` — partagée par la **fiche
 * détaillée** (onglet Config) ET la **card de synthèse** (accueil module), donc 0
 * divergence. C'est le point d'extension de la VISION partagée : ajouter un module
 * = ajouter une entry, rien d'autre à câbler.
 *
 * On indexe par le `name` de l'URL `/nodefony/modules/:name` ET par la
 * `key`/`package` (robuste aux variantes `http` / `@nodefony/http`).
 */
import type { ConfigSchemaStatus, ConfigSection } from "../../components/ui";
import { HTTP_CONFIG_SECTIONS } from "./HttpConfigPanel";

export interface ModuleConfigEntry {
  /** Libellé du module (en-tête `ConfigLayout`). */
  module: string;
  /** Statut de migration Zod. */
  schema: ConfigSchemaStatus;
  /** Sections (mappées du schéma Zod). */
  sections: ConfigSection[];
}

const HTTP_ENTRY: ModuleConfigEntry = {
  module: "@nodefony/http",
  schema: "zod",
  sections: HTTP_CONFIG_SECTIONS,
};

export const MODULE_CONFIGS: Record<string, ModuleConfigEntry> = {
  http: HTTP_ENTRY,
  "@nodefony/http": HTTP_ENTRY,
};

/** Résout l'entry de config d'un module (ou `undefined` = fallback dump). */
export function resolveModuleConfig(
  ...keys: (string | null | undefined)[]
): ModuleConfigEntry | undefined {
  for (const k of keys) {
    if (k && MODULE_CONFIGS[k]) return MODULE_CONFIGS[k];
  }
  return undefined;
}
