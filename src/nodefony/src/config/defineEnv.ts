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
 *   NF_LOKI_URL: envString({ optional: true }),
 * });
 * // env.NF_LOG_DRIVER : "stdout" | "file" | "null"
 * ```
 */
import { readFileSync } from "node:fs";
import { z } from "zod";

/** Nature coercée d'une variable d'env du catalogue. */
export type EnvVarKind = "string" | "number" | "boolean" | "enum";

/**
 * Métadonnées INTROSPECTABLES d'une variable du catalogue — capturées à la
 * déclaration (le défaut serait sinon piégé dans la closure `z.preprocess`).
 * Portées par le schéma Zod (clé non-énumérable) puis agrégées par `defineEnv`
 * sur l'objet `env` retourné → alimentent la génération de `.env.example`.
 */
export interface EnvVarMeta {
  /** Nature coercée (`string`/`number`/`boolean`/`enum`). */
  readonly kind: EnvVarKind;
  /** La variable peut-elle être absente (→ `undefined`) ? */
  readonly optional: boolean;
  /** Valeur par défaut déclarée (`undefined` si aucune). */
  readonly default?: unknown;
  /** Doc (`.describe()`), reprise telle quelle dans `.env.example`. */
  readonly description?: string;
  /** Valeurs autorisées (enum uniquement). */
  readonly values?: readonly string[];
}

/** {@link EnvVarMeta} + le nom de la variable (clé du catalogue). */
export interface NamedEnvVarMeta extends EnvVarMeta {
  readonly name: string;
}

/** Clé non-énumérable des métadonnées posées sur un schéma d'env. */
const ENV_META: unique symbol = Symbol("nodefony.envVarMeta");
/** Clé non-énumérable du catalogue agrégé posé sur l'objet `env` retourné. */
const ENV_CATALOG: unique symbol = Symbol("nodefony.envCatalog");

/** Attache `meta` à `schema` (non-énumérable → invisible pour Zod/sérialisation). */
function tagMeta<S extends z.ZodTypeAny>(schema: S, meta: EnvVarMeta): S {
  Object.defineProperty(schema, ENV_META, {
    value: meta,
    enumerable: false,
    configurable: true,
  });
  return schema;
}

/** Lit les métadonnées posées sur un schéma d'env (ou `null`). */
function readMeta(schema: unknown): EnvVarMeta | null {
  if (schema && typeof schema === "object" && ENV_META in schema) {
    return (schema as { [ENV_META]?: EnvVarMeta })[ENV_META] ?? null;
  }
  return null;
}

/**
 * Catalogue introspectable des variables déclarées par {@link defineEnv}, lu sur
 * l'objet `env` retourné. Source unique pour générer `.env.example` (anti-dérive).
 *
 * @param env - l'objet retourné par `defineEnv` (catalogue de l'app).
 * @returns la liste ordonnée des métadonnées par variable (vide si non reconnu).
 */
export function getEnvCatalog(env: unknown): readonly NamedEnvVarMeta[] {
  if (env && typeof env === "object" && ENV_CATALOG in env) {
    return (
      (env as { [ENV_CATALOG]?: readonly NamedEnvVarMeta[] })[ENV_CATALOG] ?? []
    );
  }
  return [];
}

/**
 * Résout la valeur d'une variable, en honorant la convention `<KEY>_FILE`
 * (ADR-0006 D3) : si `KEY` est absente mais `KEY_FILE` pointe un fichier (Docker
 * secret, K8s, Vault), lit son contenu (newline final retiré). Lever si les deux
 * sont posés (ambiguïté) ou si le fichier est illisible (fail-fast au boot).
 *
 * @param key - nom de la variable du catalogue.
 * @param source - source d'environnement.
 * @returns la valeur (directe ou lue du fichier), ou `undefined` si absente.
 */
function resolveFileEnv(
  key: string,
  source: Record<string, string | undefined>,
): string | undefined {
  const direct = source[key];
  const filePath = source[`${key}_FILE`];
  if (filePath === undefined || filePath === "") return direct;
  if (direct !== undefined && direct !== "") {
    throw new Error(
      `[nodefony] ${key} ET ${key}_FILE sont tous deux définis — n'en garder qu'un (un secret monté = ${key}_FILE).`,
    );
  }
  try {
    return readFileSync(filePath, "utf8").replace(/\r?\n$/, "");
  } catch (e) {
    throw new Error(
      `[nodefony] ${key}_FILE : lecture de "${filePath}" impossible (${(e as Error).message}).`,
    );
  }
}

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
  return tagMeta(withDoc(schema, description), {
    kind: "string",
    optional: Boolean(optional && def === undefined),
    default: def,
    description,
  }) as z.ZodType<string | undefined>;
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
  return tagMeta(withDoc(schema, description), {
    kind: "number",
    optional: Boolean(optional && def === undefined),
    default: def,
    description,
  }) as z.ZodType<number | undefined>;
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
  return tagMeta(withDoc(schema, description), {
    kind: "boolean",
    optional: false, // toujours une valeur (absente → `def`)
    default: def,
    description,
  }) as z.ZodType<boolean>;
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
  return tagMeta(withDoc(schema, description), {
    kind: "enum",
    optional: Boolean(optional && def === undefined),
    default: def,
    description,
    values: [...values],
  }) as z.ZodType<T[number] | undefined>;
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
  for (const key of Object.keys(catalog))
    input[key] = resolveFileEnv(key, source);
  const result = shape.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(env)"}: ${i.message}`)
      .join(" · ");
    throw new Error(
      `[nodefony] Variables d'environnement invalides : ${issues}`,
    );
  }
  // Agrège les métadonnées (introspectables) du catalogue sur l'objet retourné,
  // en clé NON-énumérable → invisible pour le typage/consommateurs, lue par
  // `getEnvCatalog` (génération `.env.example`). Posé AVANT le freeze.
  const catalogMeta: NamedEnvVarMeta[] = Object.keys(catalog).map((name) => {
    const m = readMeta(catalog[name]);
    return m
      ? { name, ...m }
      : { name, kind: "string" as const, optional: true };
  });
  const data = result.data as Record<string, unknown>;
  Object.defineProperty(data, ENV_CATALOG, {
    value: Object.freeze(catalogMeta),
    enumerable: false,
    configurable: true,
  });
  return Object.freeze(data) as {
    readonly [K in keyof M]: z.infer<M[K]>;
  };
}
