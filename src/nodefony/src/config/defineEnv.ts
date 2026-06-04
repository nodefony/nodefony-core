/**
 * `defineEnv` — catalogue de variables d'environnement typé + validé (back-only, D1).
 *
 * SEUL point du framework qui lit `process.env` (12-factor). Chaque variable est
 * déclarée avec sa coercion (string/number/boolean/enum), son défaut et sa doc ;
 * `defineEnv` lit la source UNE fois, valide (zod), et retourne un objet **figé +
 * typé**. Le type inféré (`typeof env`) alimente `ConfigContext<E>` → `ctx.env.X`
 * auto-complété + typé dans `defineConfig` (pilier #1, niveau 4 ; pattern t3-env /
 * Adonis `Env.create`).
 *
 * **Fail-fast** : une valeur présente mais invalide (enum hors liste, nombre
 * malformé, requis manquant) lève au boot avec un message clair nommant la
 * variable — au lieu d'un fallback silencieux qui masque un bug de déploiement.
 * Une valeur ABSENTE (ou chaîne vide) prend le défaut déclaré.
 *
 * @example
 * ```ts
 * // env.ts
 * import { defineEnv, envEnum, envString, envBoolean } from "nodefony";
 * export const env = defineEnv({
 *   NF_LOG_DRIVER: envEnum(["stdout", "file", "null"], { default: "stdout" }),
 *   NF_LOG_FILE_SYNC: envBoolean({ default: false }),
 *   LOKI_URL: envString({ optional: true }),
 * });
 * // env.NF_LOG_DRIVER : "stdout" | "file" | "null"
 * ```
 */
import { z } from "zod";

/** Ensembles 12-factor (insensibles à la casse) pour la coercion booléenne. */
const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

/** Une variable d'env absente = `undefined`, `null`, ou chaîne vide. */
function isAbsent(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

interface BaseOpts {
  /** Doc de la variable (attachée via `.describe()` → introspection Studio). */
  description?: string;
}
interface StrOpts extends BaseOpts {
  /** Valeur par défaut si la variable est absente. */
  default?: string;
  /** Autorise l'absence (résultat `undefined`) — sinon variable requise. */
  optional?: boolean;
}
interface NumOpts extends BaseOpts {
  default?: number;
  optional?: boolean;
}
interface BoolOpts extends BaseOpts {
  /** Valeur par défaut si absente (défaut : `false`). */
  default?: boolean;
}
interface EnumOpts<T extends string> extends BaseOpts {
  default?: T;
  optional?: boolean;
}

function withDoc<S extends z.ZodTypeAny>(schema: S, description?: string): S {
  return (description ? schema.describe(description) : schema) as S;
}

/**
 * Variable d'env STRING. Avec `default` → toujours présente ; `optional:true` →
 * `string | undefined` ; sinon requise (absente → erreur au boot).
 */
export function envString(
  opts: StrOpts & { optional: true },
): z.ZodType<string | undefined>;
export function envString(opts?: StrOpts): z.ZodType<string>;
export function envString(opts: StrOpts = {}): z.ZodType<string | undefined> {
  const { default: def, optional, description } = opts;
  const inner: z.ZodTypeAny =
    optional && def === undefined ? z.string().optional() : z.string();
  const schema = z.preprocess((v) => (isAbsent(v) ? def : v), inner);
  return withDoc(schema, description) as z.ZodType<string | undefined>;
}

/**
 * Variable d'env NUMBER (coercée). Valeur non numérique → erreur au boot.
 */
export function envNumber(
  opts: NumOpts & { optional: true },
): z.ZodType<number | undefined>;
export function envNumber(opts?: NumOpts): z.ZodType<number>;
export function envNumber(opts: NumOpts = {}): z.ZodType<number | undefined> {
  const { default: def, optional, description } = opts;
  const inner: z.ZodTypeAny =
    optional && def === undefined ? z.number().optional() : z.number();
  const schema = z.preprocess((v) => {
    if (isAbsent(v)) return def;
    const n = Number(v);
    return Number.isNaN(n) ? v : n; // non numérique → laissé brut → z.number rejette
  }, inner);
  return withDoc(schema, description) as z.ZodType<number | undefined>;
}

/**
 * Variable d'env BOOLEAN 12-factor : `1/true/yes/on` → true, `0/false/no/off` →
 * false (insensible à la casse). Absente → `default` (défaut `false`). Valeur hors
 * de ces ensembles → erreur au boot (typo détectée, ex. `tru`).
 */
export function envBoolean(opts: BoolOpts = {}): z.ZodType<boolean> {
  const { default: def = false, description } = opts;
  const schema = z.preprocess((v) => {
    if (isAbsent(v)) return def;
    const s = String(v).trim().toLowerCase();
    if (TRUTHY.has(s)) return true;
    if (FALSY.has(s)) return false;
    return v; // invalide → laissé brut → z.boolean rejette
  }, z.boolean());
  return withDoc(schema, description) as z.ZodType<boolean>;
}

/**
 * Variable d'env ENUM (ensemble fermé). Valeur hors liste → erreur au boot.
 * Le type littéral est préservé (`env.X` typé sur l'union exacte).
 */
export function envEnum<T extends readonly [string, ...string[]]>(
  values: T,
  opts: EnumOpts<T[number]> & { optional: true },
): z.ZodType<T[number] | undefined>;
export function envEnum<T extends readonly [string, ...string[]]>(
  values: T,
  opts?: EnumOpts<T[number]>,
): z.ZodType<T[number]>;
export function envEnum<T extends readonly [string, ...string[]]>(
  values: T,
  opts: EnumOpts<T[number]> = {},
): z.ZodType<T[number] | undefined> {
  const { default: def, optional, description } = opts;
  const base = z.enum(values as unknown as [string, ...string[]]);
  const inner: z.ZodTypeAny =
    optional && def === undefined ? base.optional() : base;
  const schema = z.preprocess((v) => (isAbsent(v) ? def : v), inner);
  return withDoc(schema, description) as z.ZodType<T[number] | undefined>;
}

/**
 * Lit + valide un catalogue de variables d'environnement, une fois, au boot.
 *
 * @typeParam M - map `{ NOM_VAR: <helper env> }`.
 * @param catalog - déclaration des variables (clé = nom de la variable d'env).
 * @param source - source des valeurs (défaut `process.env` ; injectable pour les tests).
 * @returns objet **figé** + typé : `{ [NOM]: valeur coercée }`.
 * @throws Error (message agrégé nommant chaque variable fautive) si invalide.
 */
export function defineEnv<M extends Record<string, z.ZodTypeAny>>(
  catalog: M,
  source: Record<string, string | undefined> = process.env,
): { readonly [K in keyof M]: z.infer<M[K]> } {
  const shape = z.object(catalog);
  const input: Record<string, string | undefined> = {};
  for (const key of Object.keys(catalog)) input[key] = source[key];
  const result = shape.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(env)"}: ${i.message}`)
      .join(" · ");
    throw new Error(
      `[nodefony] Variables d'environnement invalides : ${issues}`,
    );
  }
  return Object.freeze(result.data) as {
    readonly [K in keyof M]: z.infer<M[K]>;
  };
}
