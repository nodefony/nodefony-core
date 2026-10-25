/**
 * **Recherche globale de la configuration** — PUR (0 JSX), testé sans navigateur.
 *
 * Un seul index pour tous les modules ET le noyau, bâti une fois à partir des
 * données déjà reçues (`/nodefony/kernel/api/config`) : aucune requête de plus,
 * aucune dépendance. La recherche porte sur ce qu'un humain tape quand il cherche
 * un réglage — un morceau de clé, un mot de la description, le nom d'un module,
 * une variable `NF_…`, une valeur — et tolère ce qu'il tape mal :
 *
 * - accents, casse et séparateurs ignorés (`jwt.accessTtlS` ≡ `JWT__ACCESSTTLS`) ;
 * - mots de clé en camelCase éclatés (`accessTtlS` répond à `ttl`) ;
 * - une faute de frappe pardonnée sur un mot de clé d'au moins 5 lettres ;
 * - quelques synonymes français ↔ anglais (`journal` → `log`, `base` → `connectors`).
 *
 * Tous les mots de la requête doivent répondre (ET). Les secrets ne sont jamais
 * indexés par leur valeur : la redaction est serveur, mais l'index n'a même pas
 * à connaître le masque.
 */
import { compactText, normalizeText } from "../../components/ui/searchText";
import { valueText } from "../../components/ui/json/jsonFormat";

/**
 * Ce que la recherche lit d'un réglage — un sous-ensemble STRUCTUREL de
 * `ConfigField` (`ConfigLayout`). Volontairement local : le moteur reste pur et
 * se teste sans charger l'UI ; un `ConfigField` s'y passe tel quel.
 */
export interface ISearchableField {
  key: string;
  type?: string | undefined;
  description?: unknown;
  constraint?: unknown;
  secret?: boolean | undefined;
  source?: "default" | "module" | "app" | "env" | "runtime" | undefined;
  env?: string | undefined;
  recipe?: string | undefined;
  /** `live` : à chaud ; `boot` : au prochain démarrage ; `readonly` : non modifiable. */
  mutability?: "live" | "boot" | "readonly" | undefined;
  /** Réservé : pas encore lu par le code. */
  reserved?: boolean | undefined;
}

/** Ce que la recherche lit d'un module (sous-ensemble de `ModuleConfig`). */
export interface ISearchableModule {
  entry: {
    key: string;
    name: string;
    isApp: boolean;
    config: Record<string, unknown>;
    envKeys: Record<string, string>;
  };
  sections: { fields: ISearchableField[] }[];
}

/** Un réglage indexé (une ligne de résultat possible). */
export interface ConfigSearchDoc {
  /** Clé Studio du module (`http`, `security`, clé de l'application…). */
  moduleKey: string;
  /** Nom affiché (`@nodefony/http`, nom de l'application…). */
  moduleName: string;
  /** Réglage du noyau (config racine de l'application) plutôt que d'un module. */
  isApp: boolean;
  /** Le réglage, tel que `ConfigLayout` le rend. */
  field: ISearchableField;
  /** Valeur effective BRUTE (`undefined` pour un secret : jamais lue). */
  value: unknown;
  /** Valeur effective en texte (`""` pour un secret). */
  valueText: string;
  /** Description du schéma en texte (`""` si absente). */
  description: string;
  /** Variable d'environnement la plus simple qui règle ce champ (courte, sinon recette). */
  envVar: string | null;
  /** Variable réellement posée qui surcharge ce champ, si l'environnement le fait. */
  envSet: string | null;
  /** Rang du module dans la page (départage stable). */
  order: number;
  // ── Formes normalisées, calculées une fois à l'indexation ──
  segments: string[];
  words: string[];
  compactKey: string;
  compactModule: string;
  compactEnv: string[];
  normDesc: string;
  normValues: string;
}

/** Un résultat classé. */
export interface ConfigSearchHit {
  doc: ConfigSearchDoc;
  score: number;
}

/** Résultat d'une recherche : les meilleurs résultats et le nombre total trouvé. */
export interface ConfigSearchResult {
  hits: ConfigSearchHit[];
  total: number;
}

/**
 * Synonymes d'une requête (forme compacte) → mots de clé qu'ils désignent.
 * Courte à dessein : une table longue fabrique du bruit. Une entrée n'a sa place
 * que si le mot est celui qu'un débutant tape et que la clé ne contient pas.
 */
const SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ["domaine", ["domain"]],
  ["hote", ["host", "hostname", "domain"]],
  ["ecoute", ["port", "host"]],
  ["serveur", ["servers", "server"]],
  ["journal", ["log", "logs", "syslog"]],
  ["journaux", ["log", "logs", "syslog"]],
  ["trace", ["log", "debug", "trace"]],
  ["base", ["connectors", "database", "dialect", "url"]],
  ["bdd", ["connectors", "database", "dialect", "url"]],
  ["database", ["connectors", "dialect", "url"]],
  ["db", ["connectors", "database", "dialect"]],
  ["cache", ["redis", "cache"]],
  ["certificat", ["certificates", "cert", "tls", "https"]],
  ["ssl", ["tls", "https", "cert"]],
  ["fichier", ["file", "upload", "filename", "dir"]],
  ["dossier", ["dir", "path", "folder"]],
  ["chemin", ["path", "dir"]],
  ["televersement", ["upload"]],
  ["cle", ["key", "secret"]],
  ["motdepasse", ["password", "secret"]],
  ["origine", ["origin", "cors"]],
  ["jeton", ["token", "jwt"]],
  ["expiration", ["ttl", "expires", "maxage", "timeout"]],
  ["duree", ["ttl", "maxage", "timeout", "duration"]],
  ["delai", ["timeout", "ttl", "delay"]],
  ["courriel", ["mail", "smtp", "email"]],
  ["utilisateur", ["user", "users"]],
  ["parefeu", ["firewall", "firewalls"]],
  ["tempsreel", ["realtime", "websocket", "ws"]],
  ["socket", ["websocket", "ws", "realtime"]],
  ["limite", ["limit", "max", "rate"]],
  ["entete", ["header", "headers"]],
  ["compression", ["compress", "gzip"]],
  ["langue", ["locale", "lang", "i18n"]],
]);

/** Plafond par défaut de résultats rendus (le compte total reste exact). */
export const SEARCH_LIMIT = 50;

/** Points par mode de correspondance (le meilleur mode d'un mot est retenu). */
const SCORE = {
  segmentExact: 10,
  segmentPrefix: 7,
  key: 5,
  env: 5,
  fuzzy: 4,
  module: 3,
  description: 2,
  value: 1,
} as const;

/** Éclate un identifiant camelCase en mots (`accessTtlS` → `access ttl s`). */
function splitCamel(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Valeur brute d'un chemin pointé dans la config effective. */
function valueAt(config: unknown, path: string): unknown {
  let cur: unknown = config;
  for (const seg of path.split(".")) {
    if (!isRecord(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Texte d'une valeur pour l'index (objets sérialisés, `""` si absente). */
function textOf(v: unknown): string {
  if (v === undefined) return "";
  if (typeof v === "object" && v !== null) {
    try {
      return JSON.stringify(v);
    } catch {
      return "";
    }
  }
  return valueText(v);
}

/**
 * Deux mots sont-ils à au plus UNE opération l'un de l'autre (substitution,
 * insertion, suppression, ou inversion de deux lettres voisines) ? Version
 * bornée de Damerau-Levenshtein : linéaire, sans matrice.
 */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) {
    // substitution, ou inversion de deux lettres voisines
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return (
      a[i] === b[i + 1] &&
      a[i + 1] === b[i] &&
      a.slice(i + 2) === b.slice(i + 2)
    );
  }
  // une lettre en trop d'un côté
  return la > lb
    ? a.slice(i + 1) === b.slice(i)
    : a.slice(i) === b.slice(i + 1);
}

/**
 * Construit l'index de recherche à partir des modules agrégés par la page.
 *
 * @param modules - modules du modèle (`buildConfigModel(...).modules`).
 * @returns un document par réglage, dans l'ordre de la page.
 */
export function buildConfigSearchIndex(
  modules: readonly ISearchableModule[],
): ConfigSearchDoc[] {
  const out: ConfigSearchDoc[] = [];
  modules.forEach((m, order) => {
    const { entry } = m;
    const compactModule = compactText(`${entry.name} ${entry.key}`);
    for (const sec of m.sections) {
      for (const field of sec.fields) {
        const raw = field.secret ? undefined : valueAt(entry.config, field.key);
        const description =
          typeof field.description === "string" ? field.description : "";
        const envSet = entry.envKeys[field.key.toLowerCase()] ?? null;
        const envVar = field.env ?? field.recipe ?? null;
        const words = splitCamel(field.key).map(compactText);
        const segments = field.key.split(".").map(compactText);
        const constraint =
          typeof field.constraint === "string" ? field.constraint : "";
        out.push({
          moduleKey: entry.key,
          moduleName: entry.name,
          isApp: entry.isApp,
          field,
          value: raw,
          valueText: textOf(raw),
          description,
          envVar,
          envSet,
          order,
          segments,
          words,
          compactKey: compactText(field.key),
          compactModule,
          compactEnv: [field.env, field.recipe, envSet]
            .filter((v): v is string => typeof v === "string")
            .map(compactText),
          normDesc: normalizeText(description),
          normValues: normalizeText(
            `${field.type ?? ""} ${constraint} ${textOf(raw)}`,
          ),
        });
      }
    }
  });
  return out;
}

/** Meilleur score d'UNE forme de mot sur un document (0 = ne répond pas). */
function scoreForm(doc: ConfigSearchDoc, form: string, norm: string): number {
  if (!form) return 0;
  const parts = [...doc.segments, ...doc.words];
  if (parts.includes(form)) return SCORE.segmentExact;
  if (parts.some((p) => p.startsWith(form))) return SCORE.segmentPrefix;
  if (doc.compactKey.includes(form)) return SCORE.key;
  if (doc.compactEnv.some((e) => e.includes(form))) return SCORE.env;
  if (
    form.length >= 5 &&
    parts.some((p) => p.length >= 4 && withinOneEdit(p, form))
  ) {
    return SCORE.fuzzy;
  }
  if (doc.compactModule.includes(form)) return SCORE.module;
  if (norm && doc.normDesc.includes(norm)) return SCORE.description;
  if (norm && doc.normValues.includes(norm)) return SCORE.value;
  return 0;
}

/** Score d'un mot de la requête, synonymes compris (un synonyme vaut un point de moins). */
function scoreTerm(doc: ConfigSearchDoc, term: string): number {
  // Un mot qui commence par `NF_` désigne une variable : on ne cherche qu'elles.
  if (/^nf_/i.test(term)) {
    const form = compactText(term);
    if (doc.compactEnv.includes(form)) return SCORE.segmentExact;
    return doc.compactEnv.some((e) => e.includes(form)) ? SCORE.env : 0;
  }
  const form = compactText(term);
  const norm = normalizeText(term);
  let best = scoreForm(doc, form, norm);
  for (const syn of SYNONYMS.get(form) ?? []) {
    best = Math.max(best, scoreForm(doc, syn, syn) - 1);
  }
  return best;
}

/** Un réglage dont la valeur diffère du défaut (ce qu'on cherche le plus souvent). */
function isOverridden(doc: ConfigSearchDoc): boolean {
  const s = doc.field.source;
  return s === "app" || s === "env" || s === "runtime";
}

/**
 * Cherche dans l'index. Tous les mots doivent répondre ; le score est la somme
 * des meilleurs modes de chaque mot. Départage : réglages modifiés d'abord,
 * puis clé la plus courte, puis ordre de la page.
 *
 * @param index - index bâti par {@link buildConfigSearchIndex}.
 * @param query - texte saisi.
 * @param limit - nombre maximal de résultats rendus.
 * @returns les meilleurs résultats et le nombre total de réglages trouvés.
 */
export function searchConfig(
  index: readonly ConfigSearchDoc[],
  query: string,
  limit: number = SEARCH_LIMIT,
): ConfigSearchResult {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return { hits: [], total: 0 };
  const hits: ConfigSearchHit[] = [];
  for (const doc of index) {
    let score = 0;
    let all = true;
    for (const t of terms) {
      const s = scoreTerm(doc, t);
      if (s === 0) {
        all = false;
        break;
      }
      score += s;
    }
    if (all) hits.push({ doc, score });
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      Number(isOverridden(b.doc)) - Number(isOverridden(a.doc)) ||
      a.doc.field.key.length - b.doc.field.key.length ||
      a.doc.order - b.doc.order,
  );
  return { hits: hits.slice(0, limit), total: hits.length };
}
