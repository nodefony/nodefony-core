/**
 * Override générique de configuration par variable d'environnement (ADR-0006 D3).
 *
 * Forme : `NF__<MODULE>__<CHEMIN…>=valeur`. Le **double underscore `__`** sépare
 * les niveaux (choix .NET Core / Docker — explicite, sans ambiguïté avec le
 * camelCase). Le 1ᵉʳ segment = le module (`SECURITY` → `@nodefony/security`), les
 * suivants = le chemin dans sa config. Les segments sont **insensibles à la casse**
 * et résolus contre les clés RÉELLES de la config (`ACCESSTTLS` → `accessTtlS`).
 *
 * Précédence (cf ADR-0006 D5) : appliqué APRÈS le merge de l'app (`use()` /
 * `module-<name>`) et AVANT la validation Zod du module → le schéma valide/rejette
 * la valeur surchargée (fail-closed). Résolu **1× au boot** (hors hot path).
 *
 * @example
 * ```bash
 * NF__SECURITY__JWT__ACCESSTTLS=300
 * NF__HTTP__SERVERS__HTTPS__PORT=8443
 * NF__SECURITY__CORS__ORIGINS=https://a.com,https://b.com   # CSV → array
 * ```
 */

/** Préfixe d'un override générique (double underscore). */
const NF_PREFIX = "NF__";

/** Un override d'environnement résolu (issu d'une variable `NF__…`). */
export interface NfEnvOverride {
  /** Variable d'env d'origine (ex. `NF__SECURITY__JWT__ACCESSTTLS`). */
  readonly envKey: string;
  /** Segment module normalisé minuscule (ex. `security`). */
  readonly moduleSeg: string;
  /** Chemin dans la config du module, segments minuscules (ex. `["jwt","accessttls"]`). */
  readonly path: string[];
  /** Valeur coercée (booléen / nombre / tableau CSV / objet JSON / chaîne). */
  readonly value: unknown;
}

/**
 * Coerce une valeur d'environnement (toujours une chaîne) vers son type probable.
 *
 * Coercion **explicite** (le piège `z.coerce.boolean("false") === true` est évité) :
 * `"true"/"false"` → booléen ; entier/décimal → nombre ; `[…]`/`{…}` → JSON ;
 * une chaîne contenant `,` → tableau de chaînes (CSV) ; sinon la chaîne brute.
 *
 * @param raw - valeur brute de la variable d'environnement.
 * @returns la valeur typée.
 */
export function coerceEnvValue(raw: string): unknown {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (
    (v.startsWith("[") && v.endsWith("]")) ||
    (v.startsWith("{") && v.endsWith("}"))
  ) {
    try {
      return JSON.parse(v);
    } catch {
      // JSON malformé → traiter comme une chaîne brute (ne pas perdre la valeur).
    }
  }
  if (v.includes(",")) {
    return v
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return v;
}

/**
 * Scanne `env` et extrait tous les overrides `NF__<MODULE>__<CHEMIN…>`.
 *
 * Ignore les clés sans au moins un module + un champ (`NF__X` seul), et les
 * valeurs `undefined`. Ne touche PAS `env` (lecture seule).
 *
 * @param env - source d'environnement (typiquement `process.env`).
 * @returns la liste des overrides résolus (vide si aucun).
 */
export function parseNfEnvOverrides(env: NodeJS.ProcessEnv): NfEnvOverride[] {
  const out: NfEnvOverride[] = [];
  for (const envKey in env) {
    if (!envKey.startsWith(NF_PREFIX)) continue;
    const segs = envKey
      .slice(NF_PREFIX.length)
      .split("__")
      .filter((s) => s.length > 0);
    if (segs.length < 2) continue;
    const raw = env[envKey];
    if (raw === undefined) continue;
    const [moduleSeg, ...path] = segs;
    out.push({
      envKey,
      moduleSeg: moduleSeg.toLowerCase(),
      path: path.map((s) => s.toLowerCase()),
      value: coerceEnvValue(raw),
    });
  }
  return out;
}

/**
 * Résout un segment (minuscule) vers la clé réelle d'un objet : match exact
 * d'abord, sinon match insensible à la casse. `null` si aucune clé ne correspond.
 */
function resolveKey(node: Record<string, unknown>, seg: string): string | null {
  if (Object.prototype.hasOwnProperty.call(node, seg)) return seg;
  for (const k of Object.keys(node)) {
    if (k.toLowerCase() === seg) return k;
  }
  return null;
}

/**
 * Pose `value` dans `target` au `path` donné, en résolvant chaque segment contre
 * les clés EXISTANTES (insensible à la casse). N'altère QUE des chemins déjà
 * présents dans la config (= champs ayant un défaut) — un chemin inconnu n'est pas
 * créé (évite une clé fantôme à la mauvaise casse que le Zod ignorerait
 * silencieusement) : la fonction renvoie alors `false` pour signalement.
 *
 * @param target - objet de config du module (muté en place).
 * @param path - segments du chemin (minuscules).
 * @param value - valeur à poser.
 * @returns `true` si appliqué, `false` si le chemin ne résout pas vers une clé connue.
 */
export function applyResolvedPath(
  target: Record<string, unknown>,
  path: string[],
  value: unknown,
): boolean {
  if (path.length === 0) return false;
  let node: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = resolveKey(node, path[i]);
    if (key === null) return false;
    const next = node[key];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      return false;
    }
    node = next as Record<string, unknown>;
  }
  const leaf = resolveKey(node, path[path.length - 1]);
  if (leaf === null) return false;
  node[leaf] = value;
  return true;
}

/** Heuristique : ce chemin porte-t-il un secret (à rédiger dans les logs) ? */
export function pathLooksSecret(path: string[]): boolean {
  return path.some((s) => /secret|password|key|token|credential/i.test(s));
}
