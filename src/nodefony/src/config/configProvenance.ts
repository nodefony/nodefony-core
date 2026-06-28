/**
 * Provenance de configuration par champ (ADR-0006 D5/D7 — surfaçage Studio).
 *
 * Calcule, pour chaque valeur feuille de la config résolue d'un module, son
 * ORIGINE — sans instrumenter le pipeline de merge. La provenance est **re-dérivée
 * à l'introspection** en confrontant trois sources :
 *
 * - **`env`** : le chemin figure dans `envPaths` (surchargé par `NF__<MODULE>__…`) ;
 * - **`app`** : sinon, la valeur résolue diffère du défaut (surchargée par
 *   `nodefony.config.ts` / `use()`) ;
 * - **`default`** : sinon, c'est le défaut du framework (`schema.parse({})`).
 *
 * Répond à « d'où vient cette valeur ? » (la douleur « je vois rien ») sans coût au
 * boot (calcul à la demande, côté data plane admin).
 */

/** Origine d'une valeur de configuration résolue. */
export type ConfigOrigin = "default" | "app" | "env";

/** Objet « simple » (pas null, pas tableau, pas instance exotique). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype ||
      Object.getPrototypeOf(v) === null)
  );
}

/** Égalité structurelle suffisante pour des valeurs de config (JSON-sérialisables). */
function valueEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function originOf(
  pathLower: string,
  resolved: unknown,
  def: unknown,
  envPaths: ReadonlySet<string>,
): ConfigOrigin {
  if (envPaths.has(pathLower)) return "env";
  if (!valueEquals(resolved, def)) return "app";
  return "default";
}

function walk(
  resolved: Record<string, unknown>,
  defaults: Record<string, unknown> | undefined,
  prefix: string,
  envPaths: ReadonlySet<string>,
  out: Record<string, ConfigOrigin>,
): void {
  for (const key of Object.keys(resolved)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const rv = resolved[key];
    const dv = defaults ? defaults[key] : undefined;
    // Descendre tant que les DEUX côtés sont des objets simples (mêmes sous-clés
    // potentielles) ; sinon (feuille, tableau, ou objet apparu côté app) → origine.
    if (isPlainObject(rv) && isPlainObject(dv)) {
      walk(rv, dv, path, envPaths, out);
    } else {
      out[path] = originOf(path.toLowerCase(), rv, dv, envPaths);
    }
  }
}

/**
 * Calcule l'origine de chaque valeur feuille de la config résolue d'un module.
 *
 * @param resolved - config effective du module (ex. `module.options` résolu).
 * @param defaults - défauts purs du module (`schema.parse({})`).
 * @param envPaths - chemins surchargés par env, en **dot-notation minuscule**
 *   (ex. `"jwt.accessttls"`) — typiquement dérivés de `parseNfEnvOverrides`.
 * @returns map `{ "chemin.pointé": "default" | "app" | "env" }`.
 */
export function computeConfigProvenance(
  resolved: Record<string, unknown>,
  defaults: Record<string, unknown>,
  envPaths: ReadonlySet<string> = new Set(),
): Record<string, ConfigOrigin> {
  const out: Record<string, ConfigOrigin> = {};
  walk(resolved, defaults, "", envPaths, out);
  return out;
}

/**
 * Reconstruit l'objet des défauts d'un module depuis son JSON Schema
 * (`z.toJSONSchema`, retourné par `Module.configSchema()`) — utile quand le schéma
 * Zod n'est pas accessible (côté data plane admin). Walk récursif des `properties` :
 * prend `default` quand présent (y compris pour un objet entier), sinon descend.
 *
 * @param jsonSchema - JSON Schema d'une config de module (ou `null`).
 * @returns objet des défauts (vide si pas de schéma exploitable).
 */
export function extractJsonSchemaDefaults(
  jsonSchema: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isPlainObject(jsonSchema)) return out;
  const props = jsonSchema.properties;
  if (!isPlainObject(props)) return out;
  for (const key of Object.keys(props)) {
    const node = props[key];
    if (!isPlainObject(node)) continue;
    if ("default" in node) {
      out[key] = node.default;
    } else if (isPlainObject(node.properties)) {
      out[key] = extractJsonSchemaDefaults(node);
    }
  }
  return out;
}
