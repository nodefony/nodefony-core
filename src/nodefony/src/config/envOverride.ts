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
  /**
   * La chaîne BRUTE, telle que l'environnement la porte.
   *
   * Gardée parce que {@link coerceEnvValue} devine le type sans connaître la
   * cible : au moment d'APPLIQUER l'override, la config remplacée révèle le type
   * attendu, et seule la chaîne d'origine permet alors de convertir juste
   * ({@link coerceEnvValueLike}). Sans elle, `"1"` était perdu en `Number(1)`
   * avant même qu'on sache qu'une clé booléenne l'attendait.
   */
  readonly raw: string;
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
      raw,
    });
  }
  return out;
}

/**
 * Les écritures d'un booléen qu'un environnement produit réellement.
 *
 * `1`/`0` d'abord, parce que c'est la forme naturelle en shell, en Docker et en
 * manifeste k8s — et celle qui cassait le boot. `on`/`off` et `yes`/`no` sont la
 * même intention écrite autrement ; les refuser obligerait l'utilisateur à
 * deviner laquelle des trois formes son framework accepte.
 */
const BOOLEENS_VRAIS = new Set(["true", "1", "yes", "on"]);
const BOOLEENS_FAUX = new Set(["false", "0", "no", "off"]);

/**
 * La valeur d'environnement convertie vers le type de ce qu'elle REMPLACE.
 *
 * Une variable d'environnement est toujours une chaîne ; seul le schéma sait ce
 * qu'il attend. {@link coerceEnvValue} devine sans lui, et sa devinette rendait
 * un type FAUX que la validation Zod refusait ensuite : `NF__HTTP__TRUSTPROXY=1`
 * donnait `Number(1)`, qu'aucun membre de `z.union([boolean, string, array])`
 * n'accepte — une variable DOCUMENTÉE faisait échouer le boot, à rebours du
 * 12-factor que l'ADR-0006 revendique.
 *
 * L'information manquante est pourtant à portée : la config porte déjà le
 * DÉFAUT du schéma à cet endroit, et son type dit ce qui est attendu.
 *
 * ⚠️ **Le type existant ORIENTE, il ne décide pas.** Convertir aveuglément vers
 * le type de la valeur remplacée serait une faille : `trustProxy` a pour défaut
 * `false` mais accepte aussi une CIDR, et `10.0.0.0/8` deviendrait `true`,
 * c'est-à-dire une confiance TOTALE envers les `X-Forwarded-*`. Seuls des
 * littéraux booléens reconnus sont convertis ; tout le reste retombe sur la
 * devinette, qui garde la chaîne.
 *
 * Les cibles NON ambiguës (nombre, tableau, objet, valeur absente) gardent la
 * devinette : elle y est juste, et le CSV → tableau documenté en dépend.
 *
 * @param raw - la chaîne brute de la variable d'environnement.
 * @param existing - la valeur actuellement en place (le défaut du schéma).
 * @returns la valeur à poser.
 */
export function coerceEnvValueLike(raw: string, existing: unknown): unknown {
  const v = raw.trim().toLowerCase();
  if (typeof existing === "boolean") {
    if (BOOLEENS_VRAIS.has(v)) return true;
    if (BOOLEENS_FAUX.has(v)) return false;
    // Ni l'un ni l'autre : la clé accepte donc autre chose qu'un booléen
    // (`trustProxy` prend aussi une CIDR). On ne tranche pas à sa place.
    return coerceEnvValue(raw);
  }
  if (typeof existing === "string") {
    // Une chaîne attendue reçoit la chaîne. C'est le cas où la devinette est le
    // plus visiblement fausse (`headerServer=1` → `Number(1)`, refusé par
    // `z.string()`), et le moins surprenant à corriger : ce que l'utilisateur a
    // écrit dans son environnement est exactement ce qui arrive.
    return raw.trim();
  }
  return coerceEnvValue(raw);
}

/**
 * Résout un segment (minuscule) vers la clé réelle d'un objet : match exact
 * d'abord, sinon match insensible à la casse. `null` si aucune clé ne correspond.
 */
function resolveKey(node: Record<string, unknown>, seg: string): string | null {
  // Refus EXPLICITE des clés qui touchent la chaîne de prototypes. Jusqu'ici le
  // refus était un ACCIDENT HEUREUX : `__proto__` n'est ni propriété propre ni
  // énumérable, donc les deux lignes suivantes rendaient `null` d'elles-mêmes.
  // L'accident cessait dès qu'un schéma issu de `JSON.parse` déclarait la clé —
  // `JSON.parse('{"__proto__":{}}')` crée, lui, une propriété PROPRE. Mesuré :
  // le prototype de l'objet de configuration était alors DÉTOURNÉ, et
  // `constructor` remplacé par un objet. (`Object.prototype` restait intact :
  // l'alerte js/prototype-polluting-assignment surestime la portée, elle ne
  // l'invente pas.) Cette garde est le point de passage UNIQUE de
  // `applyResolvedPath` et de `declaredTypeAtPath` — elle ferme les deux voies.
  if (seg === "__proto__" || seg === "constructor" || seg === "prototype") {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(node, seg)) return seg;
  for (const k of Object.keys(node)) {
    if (k.toLowerCase() === seg) return k;
  }
  return null;
}

/**
 * Type déclaré par un JSON Schema pour un chemin — `null` si le chemin n'y est
 * pas déclaré, ou si le schéma prend une forme que cette lecture ne comprend pas.
 *
 * **Le schéma dit ce que la VALEUR ignore.** Une clé optionnelle sans défaut
 * n'existe pas dans l'objet de configuration : la résolution par les clés
 * présentes la déclare donc « inconnue » et refuse la surcharge, pour une clé
 * pourtant déclarée, documentée et lue par le code. Ce sont précisément les
 * réglages dont l'ABSENCE est signifiante — ceux que le framework résout par
 * environnement quand on ne les écrit pas — et donc ceux qu'un exploitant a le
 * plus besoin de poser sur une image déjà construite.
 *
 * Le core n'importe PAS zod : chaque module publie son schéma en JSON pur
 * (`Module.configSchema()`), et cette fonction n'y navigue que par `properties`.
 * Toute autre forme — `anyOf`, `$ref`, union — rend `null` : on n'assouplit que
 * ce qu'on COMPREND, et le refus d'aujourd'hui reste le comportement par défaut.
 *
 * @param schema - JSON Schema du module, tel que `Module.configSchema()` le rend.
 * @param path - segments du chemin (minuscules).
 * @returns le `type` JSON Schema de la feuille, `"unknown"` si déclarée sans type, ou `null`.
 */
export function declaredTypeAtPath(
  schema: unknown,
  path: string[],
): string | null {
  if (path.length === 0 || schema === null || typeof schema !== "object") {
    return null;
  }
  let node = schema as Record<string, unknown>;
  for (let i = 0; i < path.length; i++) {
    const props = node.properties;
    if (props === null || typeof props !== "object") {
      return null;
    }
    const bag = props as Record<string, unknown>;
    const key = resolveKey(bag, path[i]);
    if (key === null) {
      return null;
    }
    const next = bag[key];
    if (next === null || typeof next !== "object") {
      return null;
    }
    node = next as Record<string, unknown>;
  }
  const t = node.type;
  return typeof t === "string" ? t : "unknown";
}

/**
 * Convertit une chaîne d'environnement vers le type que le SCHÉMA déclare.
 *
 * Sert quand la clé est absente de la valeur : il n'y a alors rien à imiter, et
 * {@link coerceEnvValueLike} devinerait — `"1"` deviendrait le nombre `1` là où
 * un booléen est attendu, et le parse du module refuserait une surcharge
 * pourtant correcte.
 *
 * @param raw - la chaîne d'environnement.
 * @param type - le `type` JSON Schema de la feuille.
 * @returns la valeur convertie ; la devinette générique si le type est inconnu.
 */
export function coerceEnvValueForType(raw: string, type: string): unknown {
  const t = raw.trim();
  if (type === "string") {
    return t;
  }
  if (type === "boolean") {
    const bas = t.toLowerCase();
    if (BOOLEENS_VRAIS.has(bas)) return true;
    if (BOOLEENS_FAUX.has(bas)) return false;
    return t;
  }
  if (type === "number" || type === "integer") {
    const n = Number(t);
    return Number.isNaN(n) ? t : n;
  }
  return coerceEnvValue(t);
}

/**
 * Pose `value` dans `target` au `path` donné, en résolvant chaque segment contre
 * les clés EXISTANTES (insensible à la casse). N'altère QUE des chemins déjà
 * présents dans la config (= champs ayant un défaut) — un chemin inconnu n'est pas
 * créé (évite une clé fantôme à la mauvaise casse que le Zod ignorerait
 * silencieusement) : la fonction renvoie alors `false` pour signalement.
 *
 * Quand `raw` est fourni, la valeur posée est RECALCULÉE contre celle qu'elle
 * remplace ({@link coerceEnvValueLike}) : c'est ici, et nulle part ailleurs,
 * qu'on connaît à la fois la chaîne d'origine et le type attendu. Sans `raw`, le
 * comportement est inchangé — aucun appelant existant ne bouge.
 *
 * Quand `schema` est fourni, un chemin ABSENT de la valeur mais DÉCLARÉ par le
 * schéma est créé — c'est le cas d'une clé optionnelle sans défaut, dont
 * l'absence est signifiante et que rien ne permettait de poser jusqu'ici. La
 * garde reste entière pour ce qui n'est ni présent ni déclaré : c'est elle qui
 * empêche une clé fantôme à la mauvaise casse, que le parse du module
 * strippe ensuite SANS un mot.
 *
 * @param target - objet de config du module (muté en place).
 * @param path - segments du chemin (minuscules).
 * @param value - valeur à poser (devinée par {@link coerceEnvValue}).
 * @param raw - la chaîne d'environnement d'origine, quand elle est connue.
 * @param schema - JSON Schema du module ({@link declaredTypeAtPath}), s'il en publie un.
 * @returns `true` si appliqué, `false` si le chemin n'est ni présent ni déclaré.
 */
export function applyResolvedPath(
  target: Record<string, unknown>,
  path: string[],
  value: unknown,
  raw?: string,
  schema?: unknown,
): boolean {
  if (path.length === 0) return false;
  const declaredType =
    schema === undefined ? null : declaredTypeAtPath(schema, path);
  let node: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = resolveKey(node, path[i]);
    if (key === null) {
      // Le conteneur manque. On ne le crée QUE si le schéma déclare la feuille :
      // sans cette condition on fabriquerait l'arborescence d'une faute de
      // frappe, et la surcharge paraîtrait appliquée jusqu'à disparaître au parse.
      if (declaredType === null) return false;
      const neuf: Record<string, unknown> = {};
      node[path[i]] = neuf;
      node = neuf;
      continue;
    }
    const next = node[key];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      return false;
    }
    node = next as Record<string, unknown>;
  }
  const feuille = path[path.length - 1];
  const leaf = resolveKey(node, feuille);
  if (leaf === null) {
    if (declaredType === null) return false;
    // Rien à imiter : c'est le SCHÉMA qui dit le type, pas la valeur d'à côté.
    node[feuille] =
      raw === undefined ? value : coerceEnvValueForType(raw, declaredType);
    return true;
  }
  node[leaf] = raw === undefined ? value : coerceEnvValueLike(raw, node[leaf]);
  return true;
}

/**
 * Relit la valeur posée à `path` — la SYMÉTRIQUE de {@link applyResolvedPath}.
 *
 * Sert au journal du boot : depuis que la valeur est convertie contre le type
 * attendu, ce qui est écrit dans la config n'est plus forcément ce que
 * `coerceEnvValue` avait deviné. Journaliser la devinette afficherait
 * `TRUSTPROXY = 1` sur une config qui porte `true` — le genre d'écart qu'on
 * poursuit une heure avant de comprendre qu'il vient du journal.
 *
 * @param target - objet de config du module.
 * @param path - segments du chemin (minuscules).
 * @returns la valeur en place, ou `undefined` si le chemin ne résout pas.
 */
export function readResolvedPath(
  target: Record<string, unknown>,
  path: string[],
): unknown {
  if (path.length === 0) return undefined;
  let node: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = resolveKey(node, path[i]);
    if (key === null) return undefined;
    const next = node[key];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      return undefined;
    }
    node = next as Record<string, unknown>;
  }
  const leaf = resolveKey(node, path[path.length - 1]);
  return leaf === null ? undefined : node[leaf];
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
 * Clés déclarées par le schéma au niveau `prefix` — vide si le schéma ne dit
 * rien de ce niveau, ou s'il prend une forme que cette lecture ne comprend pas.
 *
 * @param schema - JSON Schema du module, ou `undefined`.
 * @param prefix - segments déjà traversés (minuscules).
 * @returns les noms de propriétés déclarés à ce niveau.
 */
export function declaredKeysAtPath(
  schema: unknown,
  prefix: string[],
): string[] {
  if (schema === null || typeof schema !== "object") return [];
  let node = schema as Record<string, unknown>;
  for (const seg of prefix) {
    const props = node.properties;
    if (props === null || typeof props !== "object") return [];
    const bag = props as Record<string, unknown>;
    const key = resolveKey(bag, seg);
    if (key === null) return [];
    const next = bag[key];
    if (next === null || typeof next !== "object") return [];
    node = next as Record<string, unknown>;
  }
  const props = node.properties;
  return props !== null && typeof props === "object"
    ? Object.keys(props as Record<string, unknown>)
    : [];
}

/**
 * Construit le suffixe de message « did you mean » d'un chemin d'override qui n'a
 * pas résolu contre `target` : nomme le segment fautif, propose la clé la plus
 * proche et liste les clés disponibles. Chaîne vide si rien d'exploitable.
 * Partagé par les overrides de MODULE (Kernel) et d'APP (defineConfig).
 *
 * **Les clés DÉCLARÉES comptent autant que les présentes.** Une clé optionnelle
 * sans défaut n'existe pas dans la valeur : ne lister que celle-ci proposerait à
 * l'utilisateur une liste amputée, et lui ferait chercher une faute de frappe
 * dans un nom parfaitement écrit — l'inverse du service qu'un « did you mean »
 * doit rendre.
 *
 * @param target - objet de config cible (lu seul, non muté).
 * @param path - segments du chemin de l'override (minuscules).
 * @param schema - JSON Schema du module, quand il en publie un.
 * @returns un suffixe commençant par ` — …`, ou `""`.
 */
export function resolveFailureHint(
  target: Record<string, unknown>,
  path: string[],
  schema?: unknown,
): string {
  const diag = diagnoseResolveFailure(target, path);
  if (!diag) return "";
  const declarees = declaredKeysAtPath(schema, path.slice(0, diag.index));
  const disponibles = [...new Set([...diag.available, ...declarees])].sort();
  if (disponibles.length === 0) return "";
  const suggestion = closestMatch(diag.segment, disponibles);
  const keys = disponibles.join(", ");
  return suggestion
    ? ` — segment "${diag.segment}" inconnu, vouliez-vous dire « ${suggestion} » ? (clés: ${keys})`
    : ` — segment "${diag.segment}" inconnu (clés disponibles: ${keys})`;
}
