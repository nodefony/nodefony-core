/**
 * `use()` — colocation de la config d'un module dans le manifeste `modules`
 * (back-only, D1 ; pilier #1 du chantier configuration : typage impeccable).
 *
 * Au lieu d'éparpiller la config d'un module dans une clé `module-<nom>` à la
 * racine de la config app (legacy, non typée), on la **colocalise** avec son
 * entrée de chargement :
 *
 * @example
 * ```ts
 * // nodefony.config.ts
 * import { defineConfig, use } from "nodefony";
 * export default defineConfig({
 *   modules: [
 *     "@nodefony/http",
 *     use("@nodefony/security", { firewalls: { main: { pattern: "^/api" } } }),
 *     use("@nodefony/drizzle", { dialect: "postgres" }, { policy: "dev" }),
 *   ],
 * });
 * ```
 *
 * **Le Graal (niveau ③)** : la config passée à `use("@nodefony/security", …)`
 * est typée AVEC les clés du module ciblé (autocomplétion + hover TSDoc). Le
 * mécanisme est le registre augmentable {@link NodefonyModuleConfig} : chaque
 * module enrichit l'index par *declaration merging* (pattern Nuxt/Pinia) →
 * aucune dépendance de type centralisée, l'écosystème tiers s'y branche aussi.
 */
import type { ModulePolicy } from "../types/IModuleManifest";
import type { KnownModule, ModuleEntryInput, ResolvedAppConfig } from "./types";

/**
 * Registre AUGMENTABLE des configs par module — vide par défaut, enrichi par
 * chaque module via *declaration merging* sur le package `nodefony` :
 *
 * @example
 * ```ts
 * // dans @nodefony/security
 * import type { ISecurityConfig } from "./nodefony/interfaces/ISecurityConfig";
 * declare module "nodefony" {
 *   interface NodefonyModuleConfig {
 *     "@nodefony/security": ISecurityConfig;
 *   }
 * }
 * ```
 *
 * Une fois augmentée, {@link ConfigOf} résout `"@nodefony/security"` vers
 * `ISecurityConfig` → `use()` propose les bonnes clés. Un module non enregistré
 * reste accepté (config `Record<string, unknown>`), jamais bloqué.
 */
// L'interface vide EST le point d'extension (declaration merging). Volontaire.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface NodefonyModuleConfig {}

/**
 * Type de la config d'un module `N` : sa forme enregistrée dans
 * {@link NodefonyModuleConfig} si elle existe, sinon un objet libre (le module
 * n'a pas (encore) publié son type de config — toujours utilisable).
 *
 * @typeParam N - nom du module (littéral connu {@link KnownModule} ou tiers).
 */
export type ConfigOf<N extends KnownModule> =
  N extends keyof NodefonyModuleConfig
    ? NodefonyModuleConfig[N]
    : Record<string, unknown>;

/** Options de chargement passées à {@link use} (3ᵉ argument). */
export interface UseOptions {
  /** Politique de chargement. Défaut `"optional"`. `"dev"` = hors production. */
  policy?: ModulePolicy;
  /** Garde évaluée sur la config résolue ; `false` → module ignoré (0 coût). */
  when?: (config: ResolvedAppConfig) => boolean;
}

/**
 * Construit une entrée de manifeste `modules` avec config colocalisée + typée.
 *
 * Le générique `N` capture le nom du module au call-site → `config` est
 * contraint à {@link ConfigOf}<N> (autocomplétion des clés du module ciblé).
 * Le type de RETOUR est volontairement élargi à {@link ModuleEntryInput} (la
 * config stockée dans le tableau est hétérogène) : le typage fort vit à l'appel,
 * pas dans le conteneur — exactement le pattern `defineNuxtConfig`/`app.use`.
 *
 * @param name - nom du module à charger (`KnownModule` autocomplété, string tierce acceptée).
 * @param config - config du module, typée selon le registre (optionnelle).
 * @param opts - politique + garde de chargement (`policy`/`when`).
 * @returns une entrée `{ name, config?, policy?, when? }` pour l'array `modules`.
 */
export function use<N extends KnownModule>(
  name: N,
  config?: ConfigOf<N>,
  opts?: UseOptions,
): ModuleEntryInput {
  const entry: ModuleEntryInput = { name };
  if (config !== undefined) {
    // Élargissement contrôlé : `ConfigOf<N>` (forme concrète au call-site) →
    // forme de stockage hétérogène du manifeste. Pas un `any` (cast borné).
    entry.config = config as Record<string, unknown>;
  }
  if (opts?.policy !== undefined) {
    entry.policy = opts.policy;
  }
  if (opts?.when !== undefined) {
    entry.when = opts.when;
  }
  return entry;
}
