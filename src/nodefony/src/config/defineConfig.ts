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
import {
  parseNfEnvOverrides,
  applyResolvedPath,
  pathLooksSecret,
  resolveFailureHint,
} from "./envOverride";
import type {
  AppConfigInput,
  ConfigContext,
  ConfigInput,
  ResolvedAppConfig,
} from "./types";

/** Segment réservé adressant la config de l'APPLICATION (vs un module). */
const APP_SEGMENT = "app";

/**
 * Rapport d'application des overrides `NF__APP__*` — surfacé par le Kernel une
 * fois son logger prêt (le merge tourne dans `resolve()`, AVANT le logger).
 */
export interface AppEnvOverrideReport {
  /** Overrides appliqués (chemin + drapeau secret pour la rédaction au log). */
  readonly applied: ReadonlyArray<{ path: string[]; secret: boolean }>;
  /** Messages « did you mean » pour les chemins `NF__APP__*` non résolus. */
  readonly warnings: string[];
}

/** Clé non-énumérable où le rapport d'override app est rangé sur la config résolue. */
const APP_ENV_REPORT: unique symbol = Symbol("nodefony.appEnvOverrideReport");

/**
 * Applique les overrides `NF__APP__<CHEMIN…>` sur la config APP **fusionnée**,
 * AVANT sa validation Zod (fail-closed : une valeur invalide sera rejetée par
 * `validateAppConfig`). Pur (ne loggue pas) : renvoie un rapport que le Kernel
 * surface. `app` n'est pas un nom de module → 0 collision avec `NF__<MODULE>__*`.
 *
 * N'altère QUE des chemins déjà présents (= champs ayant un défaut framework, cf
 * `defaultAppConfig`) ; un champ opt-in SANS défaut (`domainCheck`, `domainAlias`)
 * doit être déclaré par l'app pour devenir surchargeable — sinon WARNING + « did
 * you mean ». Le schéma app étant non-strict, on ne crée jamais de clé fantôme.
 *
 * @param merged - config app fusionnée (mutée en place).
 * @param env - source d'environnement (typiquement `process.env`).
 * @returns le rapport (appliqués + warnings).
 */
export function applyAppEnvOverrides(
  merged: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): AppEnvOverrideReport {
  const applied: Array<{ path: string[]; secret: boolean }> = [];
  const warnings: string[] = [];
  for (const ov of parseNfEnvOverrides(env)) {
    if (ov.moduleSeg !== APP_SEGMENT) continue;
    if (applyResolvedPath(merged, ov.path, ov.value)) {
      applied.push({ path: ov.path, secret: pathLooksSecret(ov.path) });
    } else {
      warnings.push(
        `Override env app ignoré : chemin "${ov.path.join(".")}" inconnu (${ov.envKey})` +
          resolveFailureHint(merged, ov.path),
      );
    }
  }
  return { applied, warnings };
}

/**
 * Lit le rapport d'override `NF__APP__*` rangé sur une config résolue (clé
 * non-énumérable). `null` si absent (config legacy / pas un descripteur).
 *
 * @param config - config app résolue par {@link defineConfig}.
 * @returns le rapport, ou `null`.
 */
export function readAppEnvOverrideReport(
  config: unknown,
): AppEnvOverrideReport | null {
  if (config && typeof config === "object" && APP_ENV_REPORT in config) {
    return (config as { [APP_ENV_REPORT]?: AppEnvOverrideReport })[
      APP_ENV_REPORT
    ] as AppEnvOverrideReport;
  }
  return null;
}

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
  // Override env `NF__APP__*` ENTRE le merge et la validation → la valeur surchargée
  // est validée par le Zod app (fail-closed). Le rapport est rangé hors énumération
  // pour que le Kernel le surface (warnings « did you mean ») une fois son logger prêt.
  const report = applyAppEnvOverrides(
    merged as Record<string, unknown>,
    process.env,
  );
  validateAppConfig(merged);
  Object.defineProperty(merged, APP_ENV_REPORT, {
    value: report,
    enumerable: false,
    configurable: true,
  });
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
