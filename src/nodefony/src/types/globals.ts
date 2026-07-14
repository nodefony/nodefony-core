/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface nodefonyOptions {
  [key: string]: any;
}

declare global {
  interface Error {
    toJSON(): Record<string, any>;
  }
}

/**
 * Modes MOTEUR du kernel — l'axe qui pilote l'optimisation du runtime.
 *
 * `staging` n'en fait pas partie : un staging tourne « comme la production »
 * (mêmes optimisations) et se distingue par son axe de DÉPLOIEMENT, pas par son
 * moteur. Cet axe-là est `APP_ENV`/`NODEFONY_ENV` (string libre : `staging`,
 * `canary`, `prod-eu`…), lu par `loadEnv` (→ `.env.staging`) et exposé par
 * `ConfigContext.appEnv` — il reste entier.
 *
 * `test` n'en fait pas partie non plus : c'est une valeur de `NODE_ENV` que le
 * kernel normalise en `runtimeEnv` (→ `ConfigContext.isTest`), jamais un mode moteur.
 */
declare enum environment {
  dev,
  development,
  prod,
  production,
}

export type EnvironmentType = keyof typeof environment;
export type DebugType = boolean | string | string[];

type JSONArray = Array<JSONValue>;
type JSONValue = string | number | boolean | JSONObject | JSONArray;
export interface JSONObject {
  [x: string]: JSONValue;
}
