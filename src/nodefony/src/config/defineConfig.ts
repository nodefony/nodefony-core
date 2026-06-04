/**
 * Moteur `defineConfig` — builder unique de la config d'application (back-only, D1).
 *
 * `nodefony.config.ts` exporte `default defineConfig(obj | (ctx) => obj)`. Le
 * builder porte TOUS les défauts (deep-merge user sur {@link defaultAppConfig}),
 * valide (Zod) au resolve, et retourne un DESCRIPTEUR que le Kernel résout au boot
 * avec le contexte d'environnement (`ctx`). La forme fonction permet de différencier
 * la config par environnement sans fichier `config.<env>.ts` parallèle (D3).
 *
 * @example
 * ```ts
 * // nodefony.config.ts
 * import { defineConfig } from "nodefony";
 * export default defineConfig((ctx) => ({
 *   domain: ctx.isProd ? "0.0.0.0" : "127.0.0.1",
 *   servers: { http: { port: 8080 } },
 *   modules: ["@nodefony/http", "@nodefony/framework"],
 * }));
 * ```
 */
import { extend } from "../Tools";
import { defaultAppConfig } from "./defaults";
import { validateAppConfig } from "./schema";
import type {
  AppConfigInput,
  ConfigContext,
  ConfigInput,
  ResolvedAppConfig,
} from "./types";

/**
 * Marque de marque (brand) interne d'un descripteur de config. Symbole privé au
 * module : non exporté → un objet quelconque ne peut pas se faire passer pour un
 * descripteur, et le type public {@link AppConfigDescriptor} reste propre.
 */
const CONFIG_DESCRIPTOR: unique symbol = Symbol("nodefony.configDescriptor");

/** Descripteur brandé réellement produit (forme interne). */
interface BrandedDescriptor {
  readonly [CONFIG_DESCRIPTOR]: true;
  resolve(ctx: ConfigContext): ResolvedAppConfig;
}

/**
 * Descripteur de config retourné par {@link defineConfig}. Opaque : le Kernel
 * appelle `resolve(ctx)` au boot pour obtenir la config fusionnée + validée.
 */
export interface AppConfigDescriptor {
  /**
   * Résout la config finale : applique le contexte d'env (forme fonction),
   * deep-merge sous les défauts framework, valide (Zod). Lève si invalide.
   *
   * @param ctx - contexte d'environnement (env, appEnv, isProd…).
   * @returns la config app résolue et validée.
   */
  resolve(ctx: ConfigContext): ResolvedAppConfig;
}

/**
 * Deep-merge la config user sous les défauts framework, puis valide.
 *
 * Réutilise `extend(true, {}, …)` — le merge profond standard du framework (cf
 * `Module.readOverrideModuleConfig`, `Syslog`) : 1 seule sémantique de merge
 * partout. Cible `{}` fraîche → ne mute NI les défauts NI l'input. Coût négligeable
 * (boot unique, ~µs ; ce n'est pas un hot path — cf retrait de `extend` du pipeline
 * per-requête, commit 02c32c2, hors sujet ici).
 *
 * @param userInput - config écrite par l'app (déjà résolue si forme fonction).
 * @returns config fusionnée + validée.
 */
function mergeAndValidate(userInput: AppConfigInput): ResolvedAppConfig {
  const merged = extend(
    true,
    {},
    defaultAppConfig,
    userInput,
  ) as ResolvedAppConfig;
  validateAppConfig(merged);
  return merged;
}

/**
 * Builder unique de la config d'application.
 *
 * @typeParam E - forme du catalogue d'env typé (inféré de `defineEnv`, Lot 2) →
 *   `ctx.env` typé + auto-complété dans la forme fonction.
 * @param input - objet de config, ou fonction `(ctx) => objet` pour le par-env.
 * @returns un descripteur résolvable par le Kernel au boot.
 */
export function defineConfig<E = Record<string, unknown>>(
  input: ConfigInput<E>,
): AppConfigDescriptor {
  const descriptor: BrandedDescriptor = {
    [CONFIG_DESCRIPTOR]: true,
    resolve(ctx: ConfigContext): ResolvedAppConfig {
      const userInput: AppConfigInput =
        typeof input === "function" ? input(ctx as ConfigContext<E>) : input;
      return mergeAndValidate(userInput);
    },
  };
  return descriptor;
}

/**
 * Garde de type : `value` est-il un descripteur produit par {@link defineConfig} ?
 * Utilisé par le Kernel (`loadApp`, Lot 4) pour distinguer une app moderne
 * (`export default defineConfig(…)`) d'une config objet legacy.
 *
 * @param value - valeur à tester (typiquement l'export `default` de l'app).
 * @returns `true` si c'est un descripteur de config.
 */
export function isConfigDescriptor(
  value: unknown,
): value is AppConfigDescriptor {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { [CONFIG_DESCRIPTOR]?: unknown })[CONFIG_DESCRIPTOR] === true
  );
}
