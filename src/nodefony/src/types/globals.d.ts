/* eslint-disable @typescript-eslint/no-explicit-any */
export interface nodefonyOptions {
  [key: string]: any;
}

declare global {
  interface Error {
    toJSON(): Record<string, any>;
  }
}

declare enum environment {
  "dev",
  "development",
  "prod",
  "production",
  "staging",
}

export type EnvironmentType = keyof typeof environment;
export type DebugType = boolean | string | string[];

interface JSONArray extends Array<JSONValue> {}
type JSONValue = string | number | boolean | JSONObject | JSONArray;
export interface JSONObject {
  [x: string]: JSONValue;
}
