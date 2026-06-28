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

/**
 * Distance d'édition de Levenshtein entre deux chaînes (2 lignes glissantes, pas
 * de matrice complète). Sert au « did you mean » : proposer la clé la plus proche
 * quand un segment d'override `NF__*` est mal orthographié.
 *
 * @param a - première chaîne.
 * @param b - seconde chaîne.
 * @returns le nombre minimal d'insertions/suppressions/substitutions.
 */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Parmi `candidates`, renvoie le plus proche de `target` (insensible à la casse)
 * SI la distance d'édition reste plausible (≤ 40 % de la plus longue, plancher 2)
 * — sinon `null` (ne jamais suggérer une correspondance absurde). Calque le « the
 * most similar command is » de git : aide au debug d'un nom de variable d'env mal tapé.
 *
 * @param target - segment fourni par l'utilisateur (issu d'un `NF__…`).
 * @param candidates - clés réelles existantes à comparer.
 * @returns la meilleure suggestion, ou `null` si trop éloignée.
 */
export function closestMatch(
  target: string,
  candidates: string[],
): string | null {
  const t = target.toLowerCase();
  let best: string | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = editDistance(t, c.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  if (best === null) return null;
  const threshold = Math.max(
    2,
    Math.floor(Math.max(t.length, best.length) * 0.4),
  );
  return bestD <= threshold ? best : null;
}

/** Échec de résolution d'un chemin d'override : où ça a cassé + ce qui existait. */
export interface ResolveFailure {
  /** Index (dans `path`) du segment qui n'a pas résolu. */
  readonly index: number;
  /** Segment fautif (minuscule, tel que fourni). */
  readonly segment: string;
  /** Clés réelles disponibles au niveau où la résolution a échoué. */
  readonly available: string[];
}

/**
 * Rejoue la résolution de `path` contre `target` pour DIAGNOSTIQUER un échec :
 * renvoie le 1ᵉʳ segment qui ne correspond à aucune clé (ou qui traverse un
 * non-objet) + les clés disponibles à ce niveau. `null` si tout résout (pas un
 * échec). Miroir de lecture seule de {@link applyResolvedPath} — ne mute rien.
 *
 * @param target - objet de config du module (non muté).
 * @param path - segments du chemin (minuscules).
 * @returns le détail de l'échec, ou `null` si le chemin résout entièrement.
 */
export function diagnoseResolveFailure(
  target: Record<string, unknown>,
  path: string[],
): ResolveFailure | null {
  if (path.length === 0) return null;
  let node: Record<string, unknown> = target;
  for (let i = 0; i < path.length; i++) {
    const key = resolveKey(node, path[i]);
    if (key === null) {
      return { index: i, segment: path[i], available: Object.keys(node) };
    }
    if (i < path.length - 1) {
      const next = node[key];
      if (typeof next !== "object" || next === null || Array.isArray(next)) {
        // segment intermédiaire qui ne mène pas à un objet traversable
        return { index: i, segment: path[i], available: Object.keys(node) };
      }
      node = next as Record<string, unknown>;
    }
  }
  return null;
}

/**
 * Construit le suffixe de message « did you mean » d'un chemin d'override qui n'a
 * pas résolu contre `target` : nomme le segment fautif, propose la clé la plus
 * proche et liste les clés disponibles. Chaîne vide si rien d'exploitable.
 * Partagé par les overrides de MODULE (Kernel) et d'APP (defineConfig).
 *
 * @param target - objet de config cible (lu seul, non muté).
 * @param path - segments du chemin de l'override (minuscules).
 * @returns un suffixe commençant par ` — …`, ou `""`.
 */
export function resolveFailureHint(
  target: Record<string, unknown>,
  path: string[],
): string {
  const diag = diagnoseResolveFailure(target, path);
  if (!diag || diag.available.length === 0) return "";
  const suggestion = closestMatch(diag.segment, diag.available);
  const keys = diag.available.join(", ");
  return suggestion
    ? ` — segment "${diag.segment}" inconnu, vouliez-vous dire « ${suggestion} » ? (clés: ${keys})`
    : ` — segment "${diag.segment}" inconnu (clés disponibles: ${keys})`;
}
