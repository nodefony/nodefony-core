import type {
  ILogDriver,
  ILogDriverProbe,
  ILogQueryCriteria,
  IPduLike,
} from "./ILogDriver";
import { filterPdus } from "./filterPdus";
import { coerceRecord } from "./FileLogDriver";
import { basicAuthHeader, DEFAULT_OPENSEARCH_INDEX } from "./opensearchShared";
import { resolveFetch, fetchWithTimeout } from "../httpFetch";
import type { FetchLike } from "../httpFetch";

export interface OpenSearchLogDriverOptions {
  /** Base URL d'OpenSearch, ex. `http://127.0.0.1:9200`. */
  url: string;
  /** Index interrogé (défaut `nodefony-logs`). Doit matcher le transport. */
  index?: string;
  /** Utilisateur (auth basic) — prod avec plugin sécurité activé. */
  username?: string;
  /** Mot de passe (auth basic). */
  password?: string;
  /** Headers HTTP additionnels. */
  headers?: Record<string, string>;
  /**
   * Budget de scan : nombre max de documents RAPATRIÉS (`size`) avant filtrage local
   * (chemin admin FROID, anti-OOM). Défaut 1000. La pagination fine est ensuite
   * appliquée par {@link filterPdus}.
   */
  maxHits?: number;
  /** Timeout de la query (ms). Défaut 8000. */
  timeoutMs?: number;
  /** Implémentation `fetch` (tests / proxy). Défaut : `fetch` global. */
  fetchImpl?: FetchLike;
}

/**
 * Extrait les `_source` d'une réponse `_search` OpenSearch (`hits.hits[]._source`),
 * narrowing SÛR (0 `any`).
 */
function extractSources(json: unknown): unknown[] {
  if (typeof json !== "object" || json === null) return [];
  const hits = (json as { hits?: unknown }).hits;
  if (typeof hits !== "object" || hits === null) return [];
  const arr = (hits as { hits?: unknown }).hits;
  if (!Array.isArray(arr)) return [];
  const out: unknown[] = [];
  for (const h of arr) {
    if (typeof h === "object" && h !== null) {
      out.push((h as { _source?: unknown })._source);
    }
  }
  return out;
}

/** Lit une string à `key` dans un objet inconnu (narrowing sûr). */
function pickStr(o: unknown, key: string): string | undefined {
  if (typeof o !== "object" || o === null) return undefined;
  const v = (o as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

/** Lit un nombre à `key` dans un objet inconnu (narrowing sûr). */
function pickNum(o: unknown, key: string): number | undefined {
  if (typeof o !== "object" || o === null) return undefined;
  const v = (o as Record<string, unknown>)[key];
  return typeof v === "number" ? v : undefined;
}

/** Lit la sous-valeur objet à `key` (pour `root.version.number`). */
function pickObj(o: unknown, key: string): unknown {
  if (typeof o !== "object" || o === null) return undefined;
  return (o as Record<string, unknown>)[key];
}

/**
 * Driver `opensearch` du Log Backplane (LB.4) — relit les logs dans **OpenSearch**
 * via `POST /{index}/_search` (Query DSL). **Adaptateur, pas moteur** : OpenSearch
 * borne le rapatriement (range sur `timeStamp` + `sort` desc + budget `size`), puis
 * {@link filterPdus} est l'**autorité finale** sur le sous-ensemble → sémantique
 * identique aux drivers `memory`/`file`. Une logique, N façades.
 *
 * Chaque `_source` est le record wire indexé par {@link OpenSearchTransport} →
 * {@link coerceRecord} (documents non conformes ignorés). Chemin **FROID** (admin/debug).
 * Index encore absent (404 `index_not_found`) → résultat VIDE (normal : aucun log
 * indexé). Vraie panne (réseau, 5xx) → `throw` explicite (infra de logs prod visible).
 *
 * @param options - URL OpenSearch + index + budget.
 * @returns un `ILogDriver` `opensearch` queryable (Node-only).
 */
export function createOpenSearchLogDriver(
  options: OpenSearchLogDriverOptions,
): ILogDriver {
  const base = options.url.replace(/\/+$/, "");
  const index = options.index ?? DEFAULT_OPENSEARCH_INDEX;
  const maxHits = options.maxHits ?? 1000;
  const timeoutMs = options.timeoutMs ?? 8000;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...basicAuthHeader(options.username, options.password),
    ...options.headers,
  };
  const fetchImpl = resolveFetch(options.fetchImpl);

  return {
    name: "opensearch",
    capabilities: { write: true, query: true, stream: false },
    query: async (criteria: ILogQueryCriteria) => {
      // On délègue à OpenSearch UNIQUEMENT le bornage robuste (range temporel + tri +
      // budget). `timeStamp` est numérique → range/sort sans hypothèse de mapping. Les
      // critères string (severity/module/text/requestId) sont laissés à filterPdus pour
      // garantir la MÊME sémantique que les autres drivers (casse, inclusion, exact).
      const filter: unknown[] = [];
      if (criteria.from !== undefined || criteria.to !== undefined) {
        const range: Record<string, number> = {};
        if (criteria.from !== undefined) range.gte = criteria.from;
        if (criteria.to !== undefined) range.lte = criteria.to;
        filter.push({ range: { timeStamp: range } });
      }
      const body = JSON.stringify({
        size: maxHits,
        track_total_hits: true,
        sort: [{ timeStamp: { order: "desc" } }],
        query: filter.length > 0 ? { bool: { filter } } : { match_all: {} },
      });

      const url = `${base}/${encodeURIComponent(index)}/_search`;
      const res = await fetchWithTimeout(
        fetchImpl,
        url,
        { method: "POST", headers, body },
        timeoutMs,
      );
      if (res.status === 404) {
        // Index pas encore créé (aucun log indexé) → vide, comme un fichier absent.
        return { rows: [], total: 0, truncated: false };
      }
      if (!res.ok) {
        throw new Error(`OpenSearchLogDriver: search HTTP ${res.status}`);
      }
      const sources = extractSources(await res.json());
      const records: IPduLike[] = [];
      for (const src of sources) {
        const rec = coerceRecord(src);
        if (rec) records.push(rec);
      }
      // OpenSearch renvoie récent d'abord (sort desc) ; filterPdus attend FIFO → inverse.
      records.reverse();
      return filterPdus(records, criteria);
    },
    probe: async (): Promise<ILogDriverProbe> => {
      // GET `/` → version + nom de cluster (joignabilité). Puis `_count` de l'index
      // (best-effort : index absent = 0). Sonde FROIDE (admin), ne throw jamais.
      const t0 = Date.now();
      try {
        const res = await fetchWithTimeout(
          fetchImpl,
          `${base}/`,
          { method: "GET", headers },
          timeoutMs,
        );
        const latencyMs = Date.now() - t0;
        if (!res.ok) {
          return {
            ok: false,
            latencyMs,
            detail: `OpenSearch / → HTTP ${res.status}`,
            info: { endpoint: base, httpStatus: res.status },
          };
        }
        const root = await res.json();
        const info: Record<string, string | number> = { endpoint: base, index };
        const version = pickStr(pickObj(root, "version"), "number");
        if (version) info.version = version;
        const cluster = pickStr(root, "cluster_name");
        if (cluster) info.cluster = cluster;
        // Nombre de documents indexés (best-effort — index pas encore créé = 0).
        try {
          const cres = await fetchWithTimeout(
            fetchImpl,
            `${base}/${encodeURIComponent(index)}/_count`,
            { method: "GET", headers },
            timeoutMs,
          );
          if (cres.ok) {
            const count = pickNum(await cres.json(), "count");
            if (count !== undefined) info.docs = count;
          } else if (cres.status === 404) {
            info.docs = 0;
          }
        } catch {
          /* _count best-effort : on n'échoue pas la sonde pour ça */
        }
        return { ok: true, latencyMs, info };
      } catch (e) {
        return {
          ok: false,
          latencyMs: Date.now() - t0,
          detail: e instanceof Error ? e.message : "unreachable",
          info: { endpoint: base },
        };
      }
    },
  };
}
