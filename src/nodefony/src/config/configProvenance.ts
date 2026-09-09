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

/** Une clé `reserved` que l'app (ou l'env) a posée à une valeur non-défaut. */
export interface ISetReservedKey {
  /** Chemin pointé dans la config du module (ex. `webhooks.timestampToleranceS`). */
  path: string;
  /** `description` du champ (`.meta()`) — nomme la clé active de remplacement. */
  description: string;
}

function walkReserved(
  schemaProps: Record<string, unknown>,
  resolved: Record<string, unknown> | undefined,
  prefix: string,
  out: ISetReservedKey[],
): void {
  for (const key of Object.keys(schemaProps)) {
    const node = schemaProps[key];
    if (!isPlainObject(node)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const rv = resolved ? resolved[key] : undefined;
    if (node.reserved === true) {
      // Champ INERTE : « posé » = la valeur est PRÉSENTE dans la config résolue ET
      // diffère du défaut du schéma (peu importe que ce soit l'app via `use()` ou un
      // `NF__…` env — les deux sont futiles sur une clé réservée). Un défaut inchangé
      // = rien à signaler. La garde `!== undefined` évite un faux positif si la config
      // résolue est partielle (absente ≠ défaut sinon) : en usage réel `mod.options`
      // est complet (post-Zod, défauts appliqués), mais on reste robuste au desync.
      if (rv !== undefined && !valueEquals(rv, node.default)) {
        out.push({
          path,
          description:
            typeof node.description === "string" ? node.description : "",
        });
      }
    } else if (isPlainObject(node.properties)) {
      walkReserved(
        node.properties as Record<string, unknown>,
        isPlainObject(rv) ? rv : undefined,
        path,
        out,
      );
    }
  }
}

/**
 * Trouve les clés `reserved` du JSON Schema d'un module que la config résolue a
 * fait DÉVIER de leur défaut — i.e. qu'une application a posées en croyant régler un
 * comportement, alors qu'elles sont inertes (le levier vit ailleurs). Le pendant, au
 * BOOT, du drapeau `reserved` que Studio se contente de griser : sans ce filet, une
 * clé réservée écrite reste un silence (contrairement à une clé inconnue, qui est
 * déjà signalée — {@link computeConfigProvenance} côté env). Chaque entrée porte la
 * `description` du champ, qui nomme la clé active de remplacement.
 *
 * @param jsonSchema - JSON Schema du module (`Module.configSchema()`), ou `null`.
 * @param resolved - config effective du module (`module.options` post-validation).
 * @returns les clés réservées posées à une valeur non-défaut (vide si aucune).
 */
export function findSetReservedKeys(
  jsonSchema: unknown,
  resolved: Record<string, unknown>,
): ISetReservedKey[] {
  const out: ISetReservedKey[] = [];
  if (!isPlainObject(jsonSchema)) return out;
  const props = jsonSchema.properties;
  if (!isPlainObject(props)) return out;
  walkReserved(props, resolved, "", out);
  return out;
}

/** Une feuille de configuration que `override` remplace dans `base`. */
export interface IOverwrittenLeaf {
  /** Chemin de la clé, segment par segment (`["nested", "a"]`). */
  path: string[];
  /** La valeur que `base` portait. */
  before: unknown;
  /** La valeur que `override` impose. */
  after: unknown;
}

/**
 * Les feuilles de `base` que `override` REMPLACE — jamais celles qu'il complète.
 *
 * Descend tant que les deux côtés sont des objets simples ; ailleurs, une clé
 * présente des deux côtés avec deux valeurs différentes est un écrasement. Une
 * clé absente de `base` est un complément, et ne figure pas dans le résultat.
 * Sert au Kernel pour signaler qu'un module contredit une décision de
 * l'application (#291) — la fusion, elle, reste celle d'`extend`.
 *
 * @param base - ce qui était posé (typiquement la config `use()` de l'application).
 * @param override - ce qu'un module impose par-dessus (`module-<nom>`).
 * @returns les écrasements, dans l'ordre des clés de `override`.
 */
export function findOverwrittenLeaves(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): IOverwrittenLeaf[] {
  const out: IOverwrittenLeaf[] = [];
  const walkOver = (
    b: Record<string, unknown>,
    o: Record<string, unknown>,
    prefix: string[],
  ): void => {
    for (const key of Object.keys(o)) {
      if (!(key in b) || b[key] === undefined) continue;
      const bv = b[key];
      const ov = o[key];
      if (isPlainObject(bv) && isPlainObject(ov)) {
        walkOver(bv, ov, [...prefix, key]);
      } else if (!valueEquals(bv, ov)) {
        out.push({ path: [...prefix, key], before: bv, after: ov });
      }
    }
  };
  walkOver(base, override, []);
  return out;
}

/** Rang d'une origine : la plus forte l'emporte quand une feuille en agrège plusieurs. */
const ORIGIN_RANK: Record<string, number> = {
  default: 0,
  app: 1,
  runtime: 2,
  env: 3,
};

/**
 * L'origine d'une clé du CATALOGUE, agrégée depuis la provenance par feuille.
 *
 * `computeConfigProvenance` descend dans un objet dès que les deux côtés en
 * sont un : pour un objet LIBRE (`areas`, `roleHierarchy`, `oauth2.providers`)
 * elle produit `areas.nodefony-admin = "app"`, jamais `areas`. Or le catalogue
 * fait de cet objet une seule feuille. Chercher la clé exacte et conclure
 * « défaut » quand elle manque affirmait le contraire de la vérité — sur le
 * firewall et la hiérarchie des rôles. Ici, la clé exacte gagne si elle
 * existe ; sinon l'origine la plus forte de ses sous-clés (`env` > `runtime` >
 * `app` > `default`) ; sinon `default`.
 *
 * @param provenance - la map par feuille, ou `null` sans schéma.
 * @param key - le chemin pointé de la clé du catalogue.
 * @returns l'origine agrégée.
 */
export function aggregateProvenance(
  provenance: Record<string, string> | null | undefined,
  key: string,
): string {
  if (!provenance) return "default";
  const exact = provenance[key];
  if (exact !== undefined) return exact;
  const prefix = `${key}.`;
  let best = "default";
  for (const path of Object.keys(provenance)) {
    if (!path.startsWith(prefix)) continue;
    const origin = provenance[path];
    if ((ORIGIN_RANK[origin] ?? 0) > (ORIGIN_RANK[best] ?? 0)) best = origin;
  }
  return best;
}
