import type { ProfileEntry, ProfilePhase } from "./Profiler";
import { MODULE_PROXY_PREFIXES } from "../proxy/rules";

/**
 * Agrégation des profils de requêtes — règle PURE, sans horloge ni I/O.
 *
 * Une seule implémentation pour tout ce qui résume le profileur : l'outil MCP
 * qui observe l'application (`nodefony_observe`), celui qui tire lui-même des
 * requêtes sur une route, et demain la console d'administration. Elle est
 * bornée par construction : un échantillon de durées par route, un nombre
 * maximal de formes SQL retenues, quelques exemples d'erreurs — observer une
 * application chargée ne fait jamais grossir la mémoire avec la fenêtre.
 */

/**
 * Répétitions d'une même forme SQL, dans UNE requête, à partir desquelles on
 * signale un N+1. En dessous, ce sont des boucles courtes légitimes (quelques
 * lectures de configuration, une pagination) qu'on signalerait à tort.
 */
export const N_PLUS_ONE_MIN_REPEATS = 5;

/** Durées retenues par route pour les percentiles (échantillonnage au-delà). */
export const ROUTE_SAMPLE_CAP = 256;

/** Formes SQL distinctes retenues ; les suivantes ne sont plus que comptées. */
export const SQL_SHAPE_CAP = 200;

/** Exemples d'erreurs retenus (statut ≥ 500 ou exception). */
export const ERROR_SAMPLE_CAP = 10;

/** Préfixe des routes de l'outillage (console, API d'administration, porte MCP). */
export const TOOLING_URL_PREFIX = "/nodefony/";

/**
 * Provenance d'un profil : l'application, l'outillage (`/nodefony/…` :
 * console, API d'administration, porte MCP), ou un asset relayé sous un
 * préfixe de module (`/_vite/`).
 */
export type ProfileLane = "app" | "tooling" | "asset";

/**
 * Range un profil par provenance, d'après son URL. Seule règle du partage —
 * les anneaux du profileur et le filtre de l'agrégation la lisent tous deux.
 *
 * @param url - URL du profil, absolue ou chemin.
 * @returns la provenance du profil.
 */
export function profileLane(url: string): ProfileLane {
  const path = urlPath(url);
  if (path.startsWith(TOOLING_URL_PREFIX)) return "tooling";
  for (const prefix of MODULE_PROXY_PREFIXES) {
    if (path.startsWith(prefix)) return "asset";
  }
  return "app";
}

/**
 * Le profil vient-il de l'outillage (routes `/nodefony/…` ou assets relayés)
 * plutôt que de l'application.
 *
 * @param url - URL du profil, absolue ou chemin.
 */
export function isToolingUrl(url: string): boolean {
  return profileLane(url) !== "app";
}

/** Groupe des requêtes qu'aucune route n'a servies (404, statique, sondes). */
export const NO_ROUTE = "(aucune route)";

/** Pseudo-phase : le temps de l'action hors phases imbriquées et hors SQL. */
export const ACTION_SELF_PHASE = "action.self";

/** Longueur maximale d'un message d'erreur rapporté. */
const ERROR_MESSAGE_MAX = 200;

/** Répartition des statuts HTTP d'une route. */
export interface IStatusBreakdown {
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
  /** Dont 401 : la route exige une authentification que la requête n'avait pas. */
  unauthorized: number;
  /** Dont 403 : authentifiée, mais refusée. */
  forbidden: number;
}

/** Temps cumulé d'une phase sur les requêtes d'une route. */
export interface IPhaseTotal {
  totalMs: number;
  /** Requêtes où la phase est apparue et s'est terminée. */
  count: number;
}

/** Statistiques d'une route sur la fenêtre agrégée. */
export interface IRouteStats {
  route: string;
  kind: "http" | "ws";
  controller: string | null;
  action: string | null;
  count: number;
  /** Requêtes sans durée mesurée (mesure des phases désactivée, erreur précoce). */
  untimed: number;
  /**
   * Requêtes SERVIES et chronométrées (statut < 400, sans exception) : la
   * population de tout ce qui se dit « par requête » ci-dessous. Refus et
   * erreurs se lisent dans `status` et `errors`.
   */
  served: number;
  /** Percentiles et maximum, sur les requêtes servies. */
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  status: IStatusBreakdown;
  /** Requêtes en erreur : statut ≥ 500 ou exception levée. */
  errors: number;
  /**
   * Requêtes SQL/NoSQL des requêtes servies : total, maximum dans une
   * requête, temps CUMULÉ (des requêtes parallèles s'y additionnent).
   */
  queries: { total: number; perRequestMax: number; totalMs: number };
  /** Temps par phase des requêtes servies, `action.self` compris. */
  phases: Record<string, IPhaseTotal>;
}

/** Un N+1 : la même forme SQL répétée dans une requête. */
export interface INPlusOne {
  route: string;
  controller: string | null;
  action: string | null;
  shape: string;
  /** Plus grand nombre de répétitions vu dans une requête. */
  maxRepeats: number;
  /** Requêtes touchées. */
  requests: number;
  /** Temps cumulé de ces répétitions. */
  totalMs: number;
  /** Une requête touchée, pour aller voir son profil complet. */
  sampleRequestId: string;
}

/** Une forme SQL et son coût sur la fenêtre. */
export interface ISqlShapeStats {
  shape: string;
  connector: string | null;
  count: number;
  totalMs: number;
  maxMs: number;
  /** Routes qui l'ont émise (au plus cinq). */
  routes: string[];
}

/** Un exemple d'erreur, de quoi la retrouver dans le journal. */
export interface IErrorSample {
  route: string;
  status: number | null;
  error: string | null;
  requestId: string;
}

/** Le rapport agrégé. */
export interface IProfileReport {
  /** Requêtes agrégées (hors outillage filtré). */
  requests: number;
  http: number;
  ws: number;
  /** Requêtes de l'outillage écartées (`/nodefony/…`, `/_vite/…`). */
  filteredTooling: number;
  /** Requêtes sans durée mesurée. */
  untimed: number;
  /** Triées par p95 décroissant. */
  routes: IRouteStats[];
  /** Triés par temps cumulé décroissant. */
  nPlusOne: INPlusOne[];
  /** Les dix formes SQL les plus coûteuses (temps cumulé décroissant). */
  slowQueries: ISqlShapeStats[];
  /** Formes SQL distinctes vues au-delà de la capacité, comptées sans détail. */
  sqlShapesDropped: number;
  errors: IErrorSample[];
}

/** Réglages d'une agrégation. */
export interface IProfileAggregatorOptions {
  /** Répétitions à partir desquelles une forme SQL est un N+1. */
  nPlusOneMinRepeats?: number | undefined;
  /** Agréger aussi les requêtes de l'outillage (`/nodefony/…`, `/_vite/…`). */
  includeTooling?: boolean | undefined;
  /** Source d'aléa de l'échantillonnage — injectée par les tests. */
  random?: (() => number) | undefined;
}

/** Accumulateur : on lui donne les profils un à un, il rend le rapport. */
export interface IProfileAggregator {
  /** Ajoute un profil ; `false` s'il a été écarté (outillage). */
  add(entry: ProfileEntry): boolean;
  /** Le rapport à cet instant ; l'accumulateur continue d'accepter des profils. */
  result(): IProfileReport;
}

/**
 * Réduit une requête SQL (ou le descripteur d'une commande NoSQL) à sa FORME :
 * valeurs remplacées par `?`, listes de valeurs repliées, blancs compactés.
 *
 * Deux requêtes qui ne diffèrent que par leurs valeurs ont la même forme — c'est
 * ce qui permet de reconnaître un N+1. Et aucune valeur ne survit : la forme
 * peut sortir dans un rapport sans emporter une donnée personnelle.
 *
 * @param sql - le texte tel que l'adaptateur l'a poussé au profileur.
 * @returns la forme normalisée.
 */
export function sqlShape(sql: string): string {
  return (
    sql
      // Descripteur JSON (mongoose) : valeurs après `:`.
      .replace(/:\s*"(?:[^"\\]|\\.)*"/g, ":?")
      .replace(
        /:\s*(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)\b/g,
        ":?",
      )
      // Tableau plat de valeurs (`$in`, tableau PostgreSQL).
      .replace(/\[[^[\]{}]+\]/g, "[?…]")
      // SQL : chaînes, paramètres numérotés, nombres.
      .replace(/'(?:[^']|'')*'/g, "?")
      .replace(/\$\d+/g, "?")
      .replace(/(?<![\w$])\d+(?:\.\d+)?/g, "?")
      // Listes de longueur variable : une seule forme quel que soit leur nombre.
      .replace(/\bin\s*\(\s*\?(?:\s*,\s*\?)*\s*\)/gi, "in (?…)")
      .replace(/\bvalues\s*\([^()]*\)(?:\s*,\s*\([^()]*\))*/gi, "values (…)")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Phase `action` terminée : sa durée est connue. */
function isFinishedAction(
  p: ProfilePhase,
): p is ProfilePhase & { durationMs: number } {
  return p.name === "action" && p.durationMs !== null;
}

/**
 * Temps de l'action hors phases imbriquées et hors SQL : le code de l'action
 * elle-même et des services qu'elle appelle.
 *
 * Les phases imbriquées (`initialize`, `render`, `send`…) ne sont pas
 * nommées ici : est imbriquée toute phase terminée qui tient dans l'intervalle
 * de l'action. Les intervalles (phases et SQL) sont fusionnés avant d'être
 * retranchés — une requête SQL lancée pendant le rendu n'est pas comptée deux
 * fois.
 *
 * @returns la durée propre en ms, ou `null` sans phase `action` terminée.
 */
function actionSelfMs(entry: ProfileEntry): number | null {
  const action = entry.phases.find(isFinishedAction);
  if (action === undefined) return null;
  const start = action.startMs;
  const end = start + action.durationMs;
  const inner: [number, number][] = [];
  for (const p of entry.phases) {
    if (p === action || p.durationMs === null) continue;
    const pEnd = p.startMs + p.durationMs;
    if (p.startMs >= start && pEnd <= end) inner.push([p.startMs, pEnd]);
  }
  for (const q of entry.queries ?? []) {
    if (q.startMs === undefined) continue;
    const qStart = Math.max(q.startMs, start);
    const qEnd = Math.min(q.startMs + q.durationMs, end);
    if (qEnd > qStart) inner.push([qStart, qEnd]);
  }
  inner.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let curStart = -Infinity;
  let curEnd = -Infinity;
  for (const [s, e] of inner) {
    if (s > curEnd) {
      if (curEnd > curStart) covered += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  if (curEnd > curStart) covered += curEnd - curStart;
  return Math.max(0, action.durationMs - covered);
}

/**
 * Une requête en ERREUR du serveur : statut ≥ 500, ou exception levée sans
 * verdict client. Règle unique — le rapport, ses exemples et la lecture de leurs
 * journaux en dépendent.
 *
 * Un statut 4xx n'en est JAMAIS une, même porteur d'une exception : un refus
 * 401/403 (l'authentification lève une `AuthenticationError`) ou une ressource
 * absente est le verdict rendu au client, compté à part — le lister parmi les
 * erreurs ferait chercher une panne là où il manque une identité.
 *
 * @param entry - le profil (seuls statut et erreur sont lus).
 */
export function isFailedProfile(
  entry: Pick<ProfileEntry, "status" | "error">,
): boolean {
  if (entry.status === null) return entry.error !== null;
  if (entry.status >= 500) return true;
  return entry.status < 400 && entry.error !== null;
}

/**
 * Le chemin d'une URL de profil. Le profileur enregistre l'URL ABSOLUE
 * (`http://hôte:port/chemin`) : un filtre écrit sur le chemin ne mordrait
 * jamais dessus. Sans `URL` à construire — appelée sur chaque profil lu.
 */
export function urlPath(url: string): string {
  if (url.startsWith("/")) return url;
  const scheme = url.indexOf("://");
  if (scheme === -1) return url;
  const slash = url.indexOf("/", scheme + 3);
  return slash === -1 ? "/" : url.slice(slash);
}

/** Percentile au rang le plus proche, sur un tableau TRIÉ non vide. */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)] ?? null;
}

/** Arrondi au centième de milliseconde : au-delà, c'est du bruit de mesure. */
function round(ms: number): number {
  return Math.round(ms * 100) / 100;
}

interface IRouteAcc {
  stats: IRouteStats;
  samples: number[];
  /** Durées vues (échantillonnage : chaque durée a la même chance d'être gardée). */
  seen: number;
}

interface IShapeAcc {
  shape: string;
  connector: string | null;
  count: number;
  totalMs: number;
  maxMs: number;
  routes: Set<string>;
}

function emptyStatus(): IStatusBreakdown {
  return { s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0, unauthorized: 0, forbidden: 0 };
}

function countStatus(status: IStatusBreakdown, code: number | null): void {
  if (code === null) return;
  if (code >= 500) status.s5xx += 1;
  else if (code >= 400) {
    status.s4xx += 1;
    if (code === 401) status.unauthorized += 1;
    else if (code === 403) status.forbidden += 1;
  } else if (code >= 300) status.s3xx += 1;
  else if (code >= 200) status.s2xx += 1;
}

function addPhase(
  phases: Record<string, IPhaseTotal>,
  name: string,
  ms: number,
): void {
  const total = (phases[name] ??= { totalMs: 0, count: 0 });
  total.totalMs += ms;
  total.count += 1;
}

/**
 * Crée un accumulateur de profils.
 *
 * @param options - seuil N+1, prise en compte de l'outillage, aléa injecté.
 * @returns l'accumulateur ; son `result()` peut être appelé à tout moment.
 */
export function createProfileAggregator(
  options: IProfileAggregatorOptions = {},
): IProfileAggregator {
  const minRepeats = options.nPlusOneMinRepeats ?? N_PLUS_ONE_MIN_REPEATS;
  const includeTooling = options.includeTooling ?? false;
  const random = options.random ?? Math.random;

  const routes = new Map<string, IRouteAcc>();
  const nPlusOne = new Map<string, INPlusOne>();
  const shapes = new Map<string, IShapeAcc>();
  const errors: IErrorSample[] = [];
  let requests = 0;
  let http = 0;
  let ws = 0;
  let filteredTooling = 0;
  let untimed = 0;
  let sqlShapesDropped = 0;
  const droppedShapes = new Set<string>();

  function routeAcc(entry: ProfileEntry, route: string): IRouteAcc {
    const key = `${entry.kind}\u0000${route}`;
    let acc = routes.get(key);
    if (acc === undefined) {
      acc = {
        stats: {
          route,
          kind: entry.kind,
          controller: entry.controller,
          action: entry.action,
          count: 0,
          untimed: 0,
          served: 0,
          p50Ms: null,
          p95Ms: null,
          maxMs: null,
          status: emptyStatus(),
          errors: 0,
          queries: { total: 0, perRequestMax: 0, totalMs: 0 },
          phases: {},
        },
        samples: [],
        seen: 0,
      };
      routes.set(key, acc);
    }
    return acc;
  }

  function sample(acc: IRouteAcc, ms: number): void {
    acc.seen += 1;
    if (acc.samples.length < ROUTE_SAMPLE_CAP) {
      acc.samples.push(ms);
      return;
    }
    // Échantillonnage par réservoir : la fenêtre reste représentée sans
    // retenir toutes ses durées.
    const slot = Math.floor(random() * acc.seen);
    if (slot < ROUTE_SAMPLE_CAP) acc.samples[slot] = ms;
  }

  function countQueries(entry: ProfileEntry, stats: IRouteStats): void {
    const queries = entry.queries;
    if (queries === undefined || queries.length === 0) return;
    const q = stats.queries;
    q.total += queries.length;
    if (queries.length > q.perRequestMax) q.perRequestMax = queries.length;
    for (const one of queries) q.totalMs += one.durationMs;
  }

  function addQueries(entry: ProfileEntry, route: string): void {
    const queries = entry.queries;
    if (queries === undefined || queries.length === 0) return;
    const perShape = new Map<string, { n: number; ms: number }>();
    for (const q of queries) {
      const shape = sqlShape(q.sql);
      const local = perShape.get(shape);
      if (local === undefined) perShape.set(shape, { n: 1, ms: q.durationMs });
      else {
        local.n += 1;
        local.ms += q.durationMs;
      }
      let global = shapes.get(shape);
      if (global === undefined) {
        if (shapes.size >= SQL_SHAPE_CAP) {
          if (!droppedShapes.has(shape) && droppedShapes.size < SQL_SHAPE_CAP) {
            droppedShapes.add(shape);
          }
          continue;
        }
        global = {
          shape,
          connector: q.connector ?? null,
          count: 0,
          totalMs: 0,
          maxMs: 0,
          routes: new Set(),
        };
        shapes.set(shape, global);
      }
      global.count += 1;
      global.totalMs += q.durationMs;
      if (q.durationMs > global.maxMs) global.maxMs = q.durationMs;
      if (global.routes.size < 5) global.routes.add(route);
    }
    for (const [shape, { n, ms }] of perShape) {
      if (n < minRepeats) continue;
      const key = `${route}\u0000${shape}`;
      const found = nPlusOne.get(key);
      if (found === undefined) {
        nPlusOne.set(key, {
          route,
          controller: entry.controller,
          action: entry.action,
          shape,
          maxRepeats: n,
          requests: 1,
          totalMs: ms,
          sampleRequestId: entry.requestId,
        });
      } else {
        found.requests += 1;
        found.totalMs += ms;
        if (n > found.maxRepeats) {
          found.maxRepeats = n;
          found.sampleRequestId = entry.requestId;
        }
      }
    }
  }

  return {
    add(entry) {
      if (!includeTooling && isToolingUrl(entry.url)) {
        filteredTooling += 1;
        return false;
      }
      requests += 1;
      if (entry.kind === "ws") ws += 1;
      else http += 1;
      const route = entry.route ?? NO_ROUTE;
      const acc = routeAcc(entry, route);
      const stats = acc.stats;
      stats.count += 1;
      countStatus(stats.status, entry.status);
      const failed = isFailedProfile(entry);
      if (failed) {
        stats.errors += 1;
        if (errors.length < ERROR_SAMPLE_CAP) {
          errors.push({
            route,
            status: entry.status,
            error:
              entry.error === null
                ? null
                : entry.error.slice(0, ERROR_MESSAGE_MAX),
            requestId: entry.requestId,
          });
        }
      }
      // UNE population pour tout ce qui se dit « par requête » : les requêtes
      // servies et chronométrées. Un refus (401/403, rendu en quelques ms) ou
      // une erreur ne mesurent pas la route : mêlés aux autres, ils feraient
      // tomber p50 et diluer le temps des phases et du SQL.
      const served = !failed && (entry.status === null || entry.status < 400);
      if (entry.durationMs === null) {
        stats.untimed += 1;
        untimed += 1;
      } else if (served) {
        stats.served += 1;
        sample(acc, entry.durationMs);
        if (stats.maxMs === null || entry.durationMs > stats.maxMs) {
          stats.maxMs = entry.durationMs;
        }
        for (const p of entry.phases) {
          if (p.durationMs !== null) {
            addPhase(stats.phases, p.name, p.durationMs);
          }
        }
        const self = actionSelfMs(entry);
        if (self !== null) addPhase(stats.phases, ACTION_SELF_PHASE, self);
        countQueries(entry, stats);
      }
      // N+1 et formes SQL : TOUTES les requêtes — une 500 qui boucle sur la
      // base est un N+1 aussi.
      addQueries(entry, route);
      sqlShapesDropped = droppedShapes.size;
      return true;
    },

    result() {
      const routeList: IRouteStats[] = [];
      for (const acc of routes.values()) {
        const sorted = [...acc.samples].sort((a, b) => a - b);
        const p50 = percentile(sorted, 50);
        const p95 = percentile(sorted, 95);
        const phases: Record<string, IPhaseTotal> = {};
        for (const [name, t] of Object.entries(acc.stats.phases)) {
          phases[name] = { totalMs: round(t.totalMs), count: t.count };
        }
        routeList.push({
          ...acc.stats,
          p50Ms: p50 === null ? null : round(p50),
          p95Ms: p95 === null ? null : round(p95),
          maxMs: acc.stats.maxMs === null ? null : round(acc.stats.maxMs),
          status: { ...acc.stats.status },
          queries: {
            ...acc.stats.queries,
            totalMs: round(acc.stats.queries.totalMs),
          },
          phases,
        });
      }
      routeList.sort((a, b) => (b.p95Ms ?? -1) - (a.p95Ms ?? -1));

      const nPlusOneList = [...nPlusOne.values()]
        .map((n) => ({
          route: n.route,
          controller: n.controller,
          action: n.action,
          shape: n.shape,
          maxRepeats: n.maxRepeats,
          requests: n.requests,
          totalMs: round(n.totalMs),
          sampleRequestId: n.sampleRequestId,
        }))
        .sort((a, b) => b.totalMs - a.totalMs);

      const slowQueries = [...shapes.values()]
        .sort((a, b) => b.totalMs - a.totalMs)
        .slice(0, 10)
        .map((s) => ({
          shape: s.shape,
          connector: s.connector,
          count: s.count,
          totalMs: round(s.totalMs),
          maxMs: round(s.maxMs),
          routes: [...s.routes],
        }));

      return {
        requests,
        http,
        ws,
        filteredTooling,
        untimed,
        routes: routeList,
        nPlusOne: nPlusOneList,
        slowQueries,
        sqlShapesDropped,
        errors: errors.slice(),
      };
    },
  };
}

/**
 * Agrège une liste de profils en une fois.
 *
 * @param entries - les profils, dans n'importe quel ordre.
 * @param options - mêmes réglages que {@link createProfileAggregator}.
 * @returns le rapport.
 */
export function aggregateProfiles(
  entries: Iterable<ProfileEntry>,
  options: IProfileAggregatorOptions = {},
): IProfileReport {
  const aggregator = createProfileAggregator(options);
  for (const entry of entries) aggregator.add(entry);
  return aggregator.result();
}
